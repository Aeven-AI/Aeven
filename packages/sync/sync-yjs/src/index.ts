/**
 * Yjs Service Provider for account sync. Each enrolled account keeps a local store under
 * `accounts/<hash>/sync/sync.db` and, while a client of that account holds a session on this Host (so its
 * Aeven access token resolves), one relay connection that exchanges encrypted frames with the account's other
 * devices.
 * @module @aeven/sync-yjs
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@aeven/credentials'
import { accountHomePath, avnHomePath, ACCOUNTS_DIR_NAME } from '@aeven/home-paths'
import { Sync, type SyncDocument, type SyncJoin, type SyncJoinRequest, type SyncStatus, type SyncStreamBatch } from '@aeven/sync'
import { JoinRequester } from './join.ts'
import { RelayConnection, type RelayHandlers } from './relay.ts'
import { SyncStore } from './store.ts'
import { AccountVault } from './vault.ts'

/** Provider configuration. */
export interface Config {
  /** WebSocket URL of the Aeven sync relay. */
  relayUrl: string
  /** Credential reference holding each account's Aeven access token. */
  credentialRef: string
  /** Wait before reconnecting after a dropped connection or while no token resolves, in milliseconds. */
  reconnectMs: number
  /** Longest a relay handshake may take, in milliseconds. */
  connectTimeoutMs: number
  /** Stored updates per document before they are merged into one. */
  compactAfter: number
  /** Frames per document since its last snapshot before this device queues a new one. */
  snapshotAfter: number
}

const STORE_SEGMENTS = ['sync', 'sync.db'] as const

interface Account {
  store: SyncStore
  vault: AccountVault
  /** The open relay connection, if any. */
  relay?: RelayConnection
  /** Ends the connection loop's current wait early, such as after enrollment. */
  wake: () => void
  /** The join in progress, with its code once an enrolled device answered. */
  joining?: { code?: string }
}

/** Yjs account sync provider. */
export default class YjsSync extends Sync {
  static inject = ['credentials']

  static Config: Schema<Config> = Schema.object({
    relayUrl: Schema.string().required(),
    credentialRef: Schema.string().default('AEVEN_TOKEN'),
    reconnectMs: Schema.natural().min(100).default(5_000),
    connectTimeoutMs: Schema.natural().min(100).default(10_000),
    compactAfter: Schema.natural().min(1).default(200),
    snapshotAfter: Schema.natural().min(1).default(500),
  })

  private readonly accounts = new Map<string, Account>()
  private readonly tokenRef: CredentialRef
  private disposed = false

  /**
   * @param ctx - context providing `credentials`.
   * @param config - relay endpoint, credential reference, and tuning.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    this.tokenRef = credentialRef(config.credentialRef)
  }

  /** Open every enrolled account's store and start its connection loop. */
  [Service.init](): void {
    this.ctx.effect(() => () => {
      this.disposed = true
      for (const account of this.accounts.values()) {
        account.relay?.close()
        account.wake()
        account.vault.dispose()
        account.store.close()
      }
      this.accounts.clear()
    }, 'sync-yjs: accounts')
    const root = avnHomePath(ACCOUNTS_DIR_NAME)
    if (!existsSync(root)) return
    for (const directory of readdirSync(root)) {
      const path = join(root, directory, ...STORE_SEGMENTS)
      if (!existsSync(path)) continue
      const owner = SyncStore.ownerOf(path)
      if (owner !== undefined) this.account(owner)
    }
  }

  private account(owner: string): Account {
    let account = this.accounts.get(owner)
    if (account !== undefined) return account
    const store = new SyncStore(accountHomePath(owner, ...STORE_SEGMENTS), owner)
    const vault = new AccountVault(
      store,
      { compactAfter: this.config.compactAfter, snapshotAfter: this.config.snapshotAfter },
      () => { this.notifyStatus(owner) },
      () => { this.notifyJoinRequests(owner) },
      (id) => { this.notifyDocument(owner, id) },
      (message, error) => {
        this.ctx.logger.warn(message)
        if (error !== undefined) this.ctx.logger.warn(error)
      },
    )
    account = { store, vault, wake: () => {} }
    this.accounts.set(owner, account)
    void this.connectLoop(owner, account)
    return account
  }

  private async token(owner: string): Promise<string | undefined> {
    return (await this.ctx.credentials.resolve(this.tokenRef, owner).catch(() => undefined))?.value
  }

  private wait(account: Account): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.config.reconnectMs)
      function done(): void {
        clearTimeout(timer)
        account.wake = () => {}
        resolve()
      }
      account.wake = done
    })
  }

  private open(owner: string, token: string, account: Account): Promise<RelayConnection> {
    return RelayConnection.open(this.config.relayUrl, token, {
      frame: (seq, frame) => { account.vault.receiveFrame(seq, frame) },
      chain: (entry) => {
        try {
          account.vault.receiveChainEntry(entry)
        } catch (error) {
          this.ctx.logger.warn('sync: the relay pushed an invalid chain entry for %s', owner)
          this.ctx.logger.warn(error)
        }
      },
      signal: (from, data) => {
        if (account.relay !== undefined) account.vault.receiveSignal(account.relay, from, data)
      },
      closed: () => { account.vault.detach() },
    }, this.config.connectTimeoutMs)
  }

  private live(owner: string, account: Account): boolean {
    return !this.disposed && this.accounts.get(owner) === account
  }

  private async connectLoop(owner: string, account: Account): Promise<void> {
    while (this.live(owner, account)) {
      const token = account.vault.hasKeys() ? await this.token(owner) : undefined
      if (token !== undefined && this.live(owner, account)) await this.session(owner, token, account)
      if (!this.live(owner, account)) return
      await this.wait(account)
    }
  }

  private async session(owner: string, token: string, account: Account): Promise<void> {
    let relay: RelayConnection
    try {
      relay = await this.open(owner, token, account)
    } catch (error) {
      this.ctx.logger.debug('sync: relay connection for %s failed: %s', owner, error)
      return
    }
    if (!this.live(owner, account)) {
      relay.close()
      return
    }
    account.relay = relay
    try {
      await account.vault.attach(relay)
    } catch (error) {
      this.ctx.logger.warn('sync: catching up with the relay failed for %s', owner)
      this.ctx.logger.warn(error)
      relay.close()
    }
    // A device that is waiting for admission, or was removed, has nothing to exchange.
    if (!account.vault.enrolled()) relay.close()
    await relay.closed
    if (account.relay === relay) delete account.relay
  }

  /** @inheritdoc */
  status(owner: string): SyncStatus {
    const account = this.accounts.get(owner)
    if (account === undefined) return { state: 'unenrolled', devices: 0, pending: 0 }
    const status = account.vault.status()
    if (account.joining === undefined || status.state !== 'unenrolled') return status
    return { ...status, state: 'joining', ...account.joining.code === undefined ? {} : { joinCode: account.joining.code } }
  }

  private async connect(owner: string, handlers: Partial<RelayHandlers>): Promise<RelayConnection> {
    const token = await this.token(owner)
    if (token === undefined) throw new Error('this needs a signed-in session for the account on this Host')
    return RelayConnection.open(this.config.relayUrl, token, {
      frame: () => {},
      chain: () => {},
      signal: () => {},
      closed: () => {},
      ...handlers,
    }, this.config.connectTimeoutMs)
  }

  /** @inheritdoc */
  async vaultExists(owner: string): Promise<boolean> {
    const relay = await this.connect(owner, {})
    try {
      const { entries } = await relay.request('chain.get') as { entries: unknown[] }
      return entries.length > 0
    } finally {
      relay.close()
    }
  }

  /** @inheritdoc */
  async createVault(owner: string): Promise<void> {
    const account = this.account(owner)
    const relay = await this.connect(owner, {})
    try {
      await account.vault.create(relay)
    } finally {
      relay.close()
    }
    account.wake()
  }

  /** @inheritdoc */
  async join(owner: string): Promise<SyncJoin> {
    const account = this.account(owner)
    if (account.joining !== undefined) throw new Error('this device is already asking to join')
    const keys = account.vault.prepareJoin()
    const pending: { requester?: JoinRequester } = {}
    let settle!: { resolve: () => void; reject: (error: Error) => void }
    const admitted = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject }
    })
    let done = false
    const relay = await this.connect(owner, {
      signal: (from, data) => { pending.requester?.receive(from, data) },
      chain: (entry) => {
        if (entry.body.type !== 'add-device' || entry.body.device.id !== keys.id) return
        done = true
        relay.close()
        settle.resolve()
        account.wake()
      },
      closed: () => {
        if (!done) settle.reject(new Error('the join ended before an enrolled device admitted this one'))
      },
    })
    const requester = new JoinRequester(relay, keys)
    pending.requester = requester
    const joining: { code?: string } = {}
    account.joining = joining
    const finish = (): void => {
      if (account.joining !== joining) return
      delete account.joining
      this.notifyStatus(owner)
    }
    void admitted.then(finish, finish)
    void requester.code.then((code) => {
      joining.code = code
      this.notifyStatus(owner)
    })
    this.notifyStatus(owner)
    await requester.start()
    return {
      code: requester.code,
      admitted,
      cancel: () => { relay.close() },
    }
  }

  /** @inheritdoc */
  acceptJoins(owner: string): () => void {
    const account = this.accounts.get(owner)
    if (account?.relay === undefined) throw new Error('adding a device needs a connection to the relay')
    return account.vault.acceptJoins(account.relay)
  }

  /** @inheritdoc */
  joinRequests(owner: string): readonly SyncJoinRequest[] {
    return (this.accounts.get(owner)?.vault.joinRequests() ?? []).map(({ id, code }) => ({ id, code }))
  }

  /** @inheritdoc */
  async approveJoin(owner: string, id: string): Promise<void> {
    const account = this.accounts.get(owner)
    const request = account?.vault.takeJoinRequest(id)
    if (account === undefined || request === undefined) throw new Error(`no join request ${id} is waiting`)
    if (account.relay === undefined) throw new Error('approving a device needs a connection to the relay')
    await account.vault.admit(account.relay, request.keys)
  }

  /** @inheritdoc */
  rejectJoin(owner: string, id: string): void {
    this.accounts.get(owner)?.vault.takeJoinRequest(id)
  }

  private enrolledVault(owner: string): AccountVault {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device is not enrolled in the account\'s vault')
    return account.vault
  }

  /** @inheritdoc */
  appendStream(owner: string, name: string, payload: Uint8Array): Promise<void> {
    this.enrolledVault(owner).appendStream(name, payload)
    return Promise.resolve()
  }

  /** @inheritdoc */
  readStream(owner: string, name: string, after: number): Promise<{ batches: SyncStreamBatch[]; more: boolean }> {
    return this.enrolledVault(owner).readStream(name, after)
  }

  /** @inheritdoc */
  documentId(owner: string, name: string): string {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device is not enrolled in the account\'s vault')
    return account.vault.documentId(name)
  }

  /** @inheritdoc */
  openDocument(owner: string, name: string): Promise<SyncDocument> {
    const account = this.accounts.get(owner)
    if (account === undefined) return Promise.reject(new Error('this device is not enrolled in the account\'s vault'))
    return Promise.resolve(account.vault.openDocument(name))
  }
}
