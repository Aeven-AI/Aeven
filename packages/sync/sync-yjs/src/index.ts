/**
 * Yjs Service Provider for account sync. Each enrolled account keeps a local store under
 * `accounts/<hash>/sync/sync.db` and, while a client of that account holds a session on this Host (so its
 * Aeven access token resolves), one relay connection that exchanges encrypted frames with the account's other
 * devices. Devices of the account on the same local network also link directly and send each other updates as
 * they are made.
 * @module @aeven/sync-yjs
 */
import { existsSync, readdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@aeven/credentials'
import { accountHomePath, avnHomePath, ACCOUNTS_DIR_NAME } from '@aeven/home-paths'
import { Sync, type SyncDevice, type SyncDocument, type SyncJoin, type SyncJoinRequest, type SyncLease, type SyncStatus, type SyncStreamBatch } from '@aeven/sync'
import { recoveryKeysOf, type DeviceId } from '@aeven/sync-vault'
import { JoinRequester } from './join.ts'
import { LanTransport, MdnsDiscovery } from './lan.ts'
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
  /** Name this device shows the account's other devices; the host name unless configured. */
  deviceName: string
  /** Stored updates per document before they are merged into one. */
  compactAfter: number
  /** Frames per document since its last snapshot before this device queues a new one. */
  snapshotAfter: number
  /** Whether enrolled devices on the same local network link directly. */
  lan: boolean
  /** Port this device accepts local-network links on; 0 picks a free one. */
  lanPort: number
  /** Wait before linking again to a device on the local network whose link closed, in milliseconds. */
  lanRetryMs: number
  /** Largest message a local-network link accepts, in bytes. */
  lanMaxBytes: number
}

const STORE_SEGMENTS = ['sync', 'sync.db'] as const

/** The document holding each device's name, keyed by device id. */
const DEVICES = 'devices'

/** Handler for pushes a short-lived connection does not use. */
function ignore(): void {}

interface Account {
  store: SyncStore
  loop?: Promise<void>
  vault: AccountVault
  /** The open relay connection, if any. */
  relay?: RelayConnection
  /** Ends the connection loop's current wait early, such as after enrollment. */
  wake: () => void
  /** The join in progress, with its code once an enrolled device answered. */
  joining?: { code?: string }
  /** The local-network links while this device is enrolled; undefined when it failed to start. */
  lan?: Promise<LanTransport | undefined>
}

/** Yjs account sync provider. */
export default class YjsSync extends Sync {
  static inject = ['credentials']

  static Config: Schema<Config> = Schema.object({
    relayUrl: Schema.string().required(),
    credentialRef: Schema.string().default('AEVEN_TOKEN'),
    reconnectMs: Schema.natural().min(100).default(5_000),
    connectTimeoutMs: Schema.natural().min(100).default(10_000),
    deviceName: Schema.string().min(1).default(hostname()),
    compactAfter: Schema.natural().min(1).default(200),
    snapshotAfter: Schema.natural().min(1).default(500),
    lan: Schema.boolean().default(true),
    lanPort: Schema.natural().max(65_535).default(0),
    lanRetryMs: Schema.natural().min(100).default(5_000),
    lanMaxBytes: Schema.natural().min(1_024).default(8_388_608),
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
    this.ctx.effect(() => async () => {
      this.disposed = true
      for (const account of this.accounts.values()) {
        account.relay?.close()
        account.wake()
      }
      await Promise.all([...this.accounts.values()].map(async (account) => {
        await account.loop
        await (await account.lan)?.close()
        await account.vault.dispose()
        account.store.close()
      }))
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
      () => {
        this.updateLan(owner)
        this.notifyStatus(owner)
      },
      () => { this.notifyJoinRequests(owner) },
      (id) => { this.notifyDocument(owner, id) },
      (message, error) => {
        this.ctx.logger.warn(message)
        this.ctx.logger.warn(error)
      },
    )
    account = { store, vault, wake: () => {} }
    this.accounts.set(owner, account)
    account.loop = this.connectLoop(owner, account)
    this.updateLan(owner)
    return account
  }

  /** Start the account's local-network links once it is enrolled, stop them when it is not, and drop removed devices. */
  private updateLan(owner: string): void {
    const account = this.accounts.get(owner)
    if (!this.config.lan || account === undefined) return
    const { vault } = account
    const enrolled = vault.enrolled() && !this.disposed
    if (enrolled && account.lan === undefined) {
      account.lan = LanTransport.start({
        tag: () => vault.lanTag(),
        device: () => vault.deviceId(),
        sign: data => vault.signLan(data),
        verify: (device, data, signature) => vault.verifyLan(device, data, signature),
        receive: (frame) => { vault.receiveLanFrame(frame) },
      }, new MdnsDiscovery(), {
        port: this.config.lanPort,
        handshakeMs: this.config.connectTimeoutMs,
        retryMs: this.config.lanRetryMs,
        maxBytes: this.config.lanMaxBytes,
      }).then((transport) => {
        vault.setLanSender((frame) => { transport.send(frame) })
        return transport
      }, (error: unknown) => {
        this.ctx.logger.warn('sync: local-network links for %s could not start: %s', owner, error)
        return undefined
      })
    } else if (!enrolled && account.lan !== undefined) {
      const stopping = account.lan
      delete account.lan
      vault.setLanSender(undefined)
      void stopping.then(transport => transport?.close())
    } else {
      void account.lan?.then((transport) => { transport?.refresh() })
    }
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
      signal: (from, data, connection) => { account.vault.receiveSignal(connection, from, data) },
      closed: () => { account.vault.detach() },
    }, this.config.connectTimeoutMs)
  }

  /** Record this device's name in the account's devices document once it is enrolled. */
  private nameDevice(account: Account): void {
    const device = account.vault.status().device
    if (!account.vault.enrolled() || device === undefined) return
    const names = account.vault.openDocument(DEVICES)
    const map = names.doc.getMap<{ name: string }>('names')
    if (map.get(device)?.name !== this.config.deviceName) map.set(device, { name: this.config.deviceName })
    names.close()
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
      this.nameDevice(account)
    } catch (error) {
      this.ctx.logger.warn('sync: catching up with the relay failed for %s', owner)
      this.ctx.logger.warn(error)
      relay.close()
    }
    // A device that is waiting for admission, or was removed, has nothing to exchange.
    if (!account.vault.enrolled()) relay.close()
    await relay.closed
    delete account.relay
  }

  /** @inheritdoc */
  status(owner: string): SyncStatus {
    const account = this.accounts.get(owner)
    if (account === undefined) return { state: 'unenrolled', devices: 0, pending: 0, recovery: false }
    const status = account.vault.status()
    if (account.joining === undefined || status.state !== 'unenrolled') return status
    return { ...status, state: 'joining', ...account.joining.code === undefined ? {} : { joinCode: account.joining.code } }
  }

  private async connect(owner: string, handlers: Partial<RelayHandlers>): Promise<RelayConnection> {
    const token = await this.token(owner)
    if (token === undefined) throw new Error('this needs a signed-in session for the account on this Host')
    return RelayConnection.open(this.config.relayUrl, token, {
      frame: ignore,
      chain: ignore,
      signal: ignore,
      closed: ignore,
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
  async setRecovery(owner: string, secret: Uint8Array): Promise<void> {
    const account = this.accounts.get(owner)
    if (account?.relay === undefined) throw new Error('setting up recovery needs a connection to the relay')
    await account.vault.setRecovery(account.relay, recoveryKeysOf(secret))
  }

  /** @inheritdoc */
  async recover(owner: string, secret: Uint8Array): Promise<void> {
    const account = this.account(owner)
    if (account.joining !== undefined) throw new Error('this device is already asking to join')
    const relay = await this.connect(owner, {})
    try {
      await account.vault.recover(relay, recoveryKeysOf(secret))
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
    // A second join is refused while this one is registered, so this join is still the account's when it ends.
    const finish = (): void => {
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
  async devices(owner: string): Promise<SyncDevice[]> {
    const vault = this.enrolledVault(owner)
    const ids = vault.deviceIds()
    if (ids.length === 0) return []
    const names = vault.openDocument(DEVICES)
    try {
      const map = names.doc.getMap<{ name: string }>('names')
      return ids.map((id, index) => ({ id, name: map.get(id)?.name ?? '', current: index === 0 }))
    } finally {
      names.close()
      await Promise.resolve()
    }
  }

  /** @inheritdoc */
  async removeDevice(owner: string, device: DeviceId): Promise<void> {
    const account = this.accounts.get(owner)
    if (account?.relay === undefined) throw new Error('removing a device needs a connection to the relay')
    await account.vault.removeDevice(account.relay, device)
    const names = account.vault.openDocument(DEVICES)
    names.doc.getMap('names').delete(device)
    names.close()
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

  private leaseConnection(owner: string): { relay: RelayConnection; device: DeviceId; vault: AccountVault } {
    const account = this.accounts.get(owner)
    const status = account?.vault.status()
    if (account?.relay === undefined || status?.state !== 'online' || status.device === undefined) {
      throw new Error('exclusive sync work needs an enrolled account connected to the relay')
    }
    return { relay: account.relay, device: status.device, vault: account.vault }
  }

  /** @inheritdoc */
  override async synchronize(owner: string): Promise<void> {
    await this.enrolledVault(owner).synchronize()
  }

  /** @inheritdoc */
  async acquireLease(owner: string, name: string, ttlMs: number): Promise<SyncLease> {
    const { relay, device, vault } = this.leaseConnection(owner)
    const result = await relay.request('lease.acquire', { name: vault.documentId(`leases/${name}`), device, ttlMs })
    if (typeof result.granted !== 'boolean' || typeof result.holder !== 'string' ||
      !Number.isSafeInteger(result.expiresAt) || (result.granted && result.holder !== device)) {
      throw new Error('the relay returned an invalid lease')
    }
    return { granted: result.granted, holder: result.holder as DeviceId, expiresAt: result.expiresAt as number }
  }

  /** @inheritdoc */
  async releaseLease(owner: string, name: string): Promise<void> {
    const { relay, device, vault } = this.leaseConnection(owner)
    await relay.request('lease.release', { name: vault.documentId(`leases/${name}`), device })
  }

  /** @inheritdoc */
  async appendStream(owner: string, name: string, payload: Uint8Array): Promise<void> {
    this.enrolledVault(owner).appendStream(name, payload)
    await Promise.resolve()
  }

  /** @inheritdoc */
  override async linked(owner: string): Promise<number> {
    const transport = await this.accounts.get(owner)?.lan
    return transport?.peers().length ?? 0
  }

  /** @inheritdoc */
  override watchStream(owner: string, name: string, listener: (payload: Uint8Array) => void): () => void {
    return this.enrolledVault(owner).watchStream(name, listener)
  }

  /** @inheritdoc */
  async readStream(owner: string, name: string, after: number): Promise<{ batches: SyncStreamBatch[]; more: boolean }> {
    return await this.enrolledVault(owner).readStream(name, after)
  }

  /** @inheritdoc */
  documentId(owner: string, name: string): string {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device is not enrolled in the account\'s vault')
    return account.vault.documentId(name)
  }

  /** @inheritdoc */
  async openDocument(owner: string, name: string): Promise<SyncDocument> {
    const vault = this.enrolledVault(owner)
    await Promise.resolve()
    return vault.openDocument(name)
  }
}
