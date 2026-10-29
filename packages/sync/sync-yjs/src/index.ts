/**
 * Yjs Service Provider for account sync. Every account signed in on this Host syncs unless the user turned it off
 * on this device: it keeps a local store under `accounts/<hash>/sync/sync.db` and, while a client of that account
 * holds a session on this Host (so its Aeven access token resolves), one relay connection that takes the account
 * key and exchanges encrypted frames with the account's other devices. Devices of the account on the same local
 * network also link directly and send each other updates as they are made.
 * @module @aeven/sync-yjs
 */
import { existsSync, readdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@aeven/credentials'
import { accountHomePath, avnHomePath, ACCOUNTS_DIR_NAME } from '@aeven/home-paths'
import { Sync, type SyncDevice, type SyncDocument, type SyncLease, type SyncStatus, type SyncStreamBatch } from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import { SyncOffload } from './offload.ts'
import { LanTransport, MdnsDiscovery } from './lan.ts'
import { RELAY_MAX_MESSAGE_BYTES, RelayConnection } from './relay.ts'
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
  /** Longest a relay request may wait for its answer before the connection is closed and opened again, in milliseconds. */
  requestTimeoutMs: number
  /** Most queued frames one publish request carries. */
  publishFrames: number
  /** Maximum complete publish request bytes, including base64url and JSON. */
  publishBytes: number
  /** Name this device shows the account's other devices; the host name unless configured. */
  deviceName: string
  /** Stored updates per document before they are merged into one. */
  compactAfter: number
  /** Frames per document since its last snapshot before this device queues a new one. */
  snapshotAfter: number
  /** Received frames opened on the sync worker and stored in one transaction per batch. */
  applyFrames: number
  /** Pause between two batches while a backlog waits, in milliseconds; it bounds the CPU and disk share of catch-up. */
  applyPauseMs: number
  /** Frames one catch-up page asks the relay for. */
  pageFrames: number
  /** Shortest interval between two status notifications, in milliseconds. */
  statusMs: number
  /** Whether the account's devices on the same local network link directly. */
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

interface Account {
  store: SyncStore
  loop?: Promise<void>
  vault: AccountVault
  /** The open relay connection, if any. */
  relay?: RelayConnection
  /** Ends the connection loop's current wait early, such as after the user turned sync back on. */
  wake: () => void
  /** The local-network links while this device holds the account key; undefined when they failed to start. */
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
    requestTimeoutMs: Schema.natural().min(100).default(60_000),
    publishFrames: Schema.natural().min(1).default(100),
    publishBytes: Schema.natural().min(1_024).max(RELAY_MAX_MESSAGE_BYTES).default(2_097_152),
    deviceName: Schema.string().min(1).default(hostname()),
    compactAfter: Schema.natural().min(1).default(200),
    snapshotAfter: Schema.natural().min(1).default(500),
    applyFrames: Schema.natural().min(1).default(200),
    applyPauseMs: Schema.natural().default(16),
    pageFrames: Schema.natural().min(1).default(500),
    statusMs: Schema.natural().default(250),
    lan: Schema.boolean().default(true),
    lanPort: Schema.natural().max(65_535).default(0),
    lanRetryMs: Schema.natural().min(100).default(5_000),
    lanMaxBytes: Schema.natural().min(1_024).default(8_388_608),
  })

  private readonly accounts = new Map<string, Account>()
  private readonly tokenRef: CredentialRef
  /** One worker thread, shared by every account, opens received frames and merges document updates. */
  private readonly offload = new SyncOffload()
  private disposed = false

  /**
   * @param ctx - context providing `credentials`.
   * @param config - relay endpoint, credential reference, and tuning.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    this.tokenRef = credentialRef(config.credentialRef)
  }

  /** Open every stored account's store, start its connection loop, and start an account once one of its clients signs in. */
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
      await this.offload.dispose()
    }, 'sync-yjs: accounts')
    // An account syncs from the moment one of its clients signs in on this Host.
    this.ctx.on('credentials/session-updated', (ref, user) => {
      if (ref !== this.tokenRef || this.disposed) return
      this.account(user).wake()
    })
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
      {
        compactAfter: this.config.compactAfter,
        snapshotAfter: this.config.snapshotAfter,
        applyFrames: this.config.applyFrames,
        applyPauseMs: this.config.applyPauseMs,
        pageFrames: this.config.pageFrames,
        statusMs: this.config.statusMs,
        publishFrames: this.config.publishFrames,
        publishBytes: this.config.publishBytes,
      },
      () => {
        this.updateLan(owner)
        this.notifyStatus(owner)
      },
      (id) => { this.notifyDocument(owner, id) },
      (message, error) => {
        this.ctx.logger.warn(message)
        this.ctx.logger.warn(error)
      },
      this.offload,
    )
    account = { store, vault, wake: () => {} }
    this.accounts.set(owner, account)
    account.loop = this.connectLoop(owner, account)
    this.updateLan(owner)
    return account
  }

  /** Start the account's local-network links once this device holds the account key, and stop them when it stops syncing. */
  private updateLan(owner: string): void {
    const account = this.accounts.get(owner)
    if (!this.config.lan || account === undefined) return
    const { vault } = account
    const ready = vault.ready() && !this.disposed
    if (ready && account.lan === undefined) {
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
    } else if (!ready && account.lan !== undefined) {
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

  private open(token: string, account: Account): Promise<RelayConnection> {
    return RelayConnection.open(this.config.relayUrl, token, {
      frame: (seq, frame) => { account.vault.receiveFrame(seq, frame) },
      closed: () => { account.vault.detach() },
    }, this.config.connectTimeoutMs, this.config.requestTimeoutMs)
  }

  /** Record this device's name in the account's devices document once it holds the account key. */
  private nameDevice(account: Account): void {
    const device = account.vault.status().device
    if (!account.vault.ready() || device === undefined) return
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
      const token = account.vault.enabled() ? await this.token(owner) : undefined
      if (token !== undefined && this.live(owner, account)) await this.session(owner, token, account)
      if (!this.live(owner, account)) return
      await this.wait(account)
    }
  }

  private async session(owner: string, token: string, account: Account): Promise<void> {
    let relay: RelayConnection
    try {
      relay = await this.open(token, account)
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
    // The user turned sync off while the connection opened.
    if (!account.vault.enabled()) relay.close()
    await relay.closed
    delete account.relay
  }

  /** @inheritdoc */
  status(owner: string): SyncStatus {
    return this.accounts.get(owner)?.vault.status() ?? { state: 'starting', pending: 0, queued: 0 }
  }

  /** @inheritdoc */
  setEnabled(owner: string, enabled: boolean): void {
    const account = this.account(owner)
    account.vault.setEnabled(enabled)
    if (enabled) account.wake()
  }

  /** @inheritdoc */
  async devices(owner: string): Promise<SyncDevice[]> {
    const vault = this.readyVault(owner)
    const current = vault.deviceId()
    const names = vault.openDocument(DEVICES)
    try {
      const map = names.doc.getMap<{ name: string }>('names')
      const ids = [current, ...[...map.keys()].filter(id => id !== current)] as DeviceId[]
      return ids.map(id => ({ id, name: map.get(id)?.name ?? '', current: id === current }))
    } finally {
      names.close()
      await Promise.resolve()
    }
  }

  /** @inheritdoc */
  async removeDevice(owner: string, device: DeviceId): Promise<void> {
    const vault = this.readyVault(owner)
    if (device === vault.deviceId()) throw new Error('this device cannot remove itself from the account')
    const names = vault.openDocument(DEVICES)
    try {
      names.doc.getMap<{ name: string }>('names').delete(device)
    } finally {
      names.close()
      await Promise.resolve()
    }
  }

  private readyVault(owner: string): AccountVault {
    const vault = this.accounts.get(owner)?.vault
    if (vault?.ready() !== true) throw new Error('this device does not sync the account')
    return vault
  }

  private leaseConnection(owner: string): { relay: RelayConnection; device: DeviceId; vault: AccountVault } {
    const account = this.accounts.get(owner)
    const status = account?.vault.status()
    if (account?.relay === undefined || status?.state !== 'online' || status.device === undefined) {
      throw new Error('exclusive sync work needs the account connected to the relay')
    }
    return { relay: account.relay, device: status.device, vault: account.vault }
  }

  /** @inheritdoc */
  override async synchronize(owner: string): Promise<void> {
    await this.readyVault(owner).synchronize()
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
    this.readyVault(owner).appendStream(name, payload)
    await Promise.resolve()
  }

  /** @inheritdoc */
  override async linked(owner: string): Promise<number> {
    const transport = await this.accounts.get(owner)?.lan
    return transport?.peers().length ?? 0
  }

  /** @inheritdoc */
  override watchStream(owner: string, name: string, listener: (payload: Uint8Array) => void): () => void {
    return this.readyVault(owner).watchStream(name, listener)
  }

  /** @inheritdoc */
  async readStream(owner: string, name: string, after: number): Promise<{ batches: SyncStreamBatch[]; more: boolean }> {
    return await this.readyVault(owner).readStream(name, after)
  }

  /** @inheritdoc */
  storedDocuments(owner: string): readonly string[] {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device does not sync the account')
    return account.store.storedDocuments()
  }

  /** @inheritdoc */
  localValue(owner: string, key: string): string | undefined {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device does not sync the account')
    return account.store.localValue(key)
  }

  /** @inheritdoc */
  setLocalValue(owner: string, key: string, value: string): void {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device does not sync the account')
    account.store.setLocalValue(key, value)
  }

  /** @inheritdoc */
  documentId(owner: string, name: string): string {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device does not sync the account')
    return account.vault.documentId(name)
  }

  /** @inheritdoc */
  async openDocument(owner: string, name: string): Promise<SyncDocument> {
    const vault = this.readyVault(owner)
    await Promise.resolve()
    return vault.openDocument(name)
  }
}
