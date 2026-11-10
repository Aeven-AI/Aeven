/**
 * Yjs Service Provider for account sync. Every account signed in on this Host syncs unless the user turned it off
 * on this device: it keeps a local store under `accounts/<hash>/sync/sync.db` and, while a client of that account
 * holds a session on this Host (so its Aeven access token resolves), one relay connection that reads the account
 * key state and exchanges encrypted frames with the account's other devices. With `keepConnected`, the connection
 * also stays open while no client is signed in, through a sync grant the relay issued to this device. The key is
 * the relay's, or one the user's passkey unwraps on this device. Devices of the account on the same local
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
import {
  Sync, type SyncDevice, type SyncDocument, type SyncLease, type SyncPasskey, type SyncStatus, type SyncStreamBatch,
} from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import { SyncOffload } from './offload.ts'
import { LanTransport, localRoutes, MdnsDiscovery, type LanRoute } from './lan.ts'
import { RELAY_MAX_MESSAGE_BYTES, RelayConnection, type RelayCredential, RelayError } from './relay.ts'
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
  /**
   * Whether each account stays connected to the relay while none of its clients is signed in here. The first
   * connection opened with a user's access token asks the relay for a sync grant, kept in the account's store, and
   * later connections present the grant when no access token resolves. A Host that serves an account's browser
   * sessions sets it, so the account is current before the browser opens.
   */
  keepConnected: boolean
  /**
   * How often a device without `keepConnected` stamps `seenAt` on its device entry while its relay connection is
   * open, so the account's always-on device can tell a desktop that is on from one that is asleep or closed.
   */
  presenceMs: number
  /**
   * How recent another device's `seenAt` must be for this device to dial the routes it advertises; a device that
   * stamped longer ago, or marked itself offline, is not dialed by route.
   */
  routeWindowMs: number
  /**
   * How long a device without `keepConnected` waits, when it shuts down cleanly, for its `offline` mark to reach the
   * relay before it closes the connection anyway.
   */
  leaveMs: number
  /**
   * Logical names of documents fetched before the rest of a catch-up when this device holds no state for them, so
   * a new device shows the account's conversation and workspace lists before the long tail arrives. Defaults to
   * none, so every document arrives in relay order.
   */
  firstDocuments: string[]
}

const STORE_SEGMENTS = ['sync', 'sync.db'] as const

/** The document holding each device's name, keyed by device id. */
const DEVICES = 'devices'

/** One device's entry in the devices document. */
interface DeviceName {
  name: string
  /** Set by a device that stays connected without a client, such as Aeven Cloud. */
  alwaysOn?: boolean
  /** When a device without `alwaysOn` last stamped its open relay connection, in milliseconds since the Unix epoch. */
  seenAt?: number
  /** Set by a device without `alwaysOn` that shut down cleanly; its next stamp removes it. */
  offline?: true
  /** Addresses a device without `alwaysOn` accepts local-network links on, rewritten with each stamp. */
  routes?: LanRoute[]
}

/**
 * Whether a value another device wrote is a usable route; the devices document crosses a durable boundary.
 * @param value - the value.
 * @returns whether it names an IPv4 host and a port.
 */
function isRoute(value: unknown): value is LanRoute {
  const route = value as Partial<LanRoute> | null
  return typeof route === 'object' && route !== null && typeof route.host === 'string'
    && typeof route.port === 'number' && Number.isInteger(route.port) && route.port > 0 && route.port <= 65_535
}

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
  /** The started links' port, which this device advertises with its routes. */
  lanPort?: number
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
    keepConnected: Schema.boolean().default(false),
    presenceMs: Schema.natural().min(1_000).default(60_000),
    leaveMs: Schema.natural().default(1_500),
    routeWindowMs: Schema.natural().min(1_000).default(150_000),
    firstDocuments: Schema.array(Schema.string()).default([]),
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
      // A desktop that shuts down cleanly says so first, so the always-on device stops sending it new conversations.
      await Promise.all([...this.accounts.values()].map(account => this.leave(account)))
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
        firstDocuments: this.config.firstDocuments,
      },
      () => {
        this.updateLan(owner)
        this.notifyStatus(owner)
      },
      (id) => {
        this.notifyDocument(owner, id)
        if (vault.ready() && id === vault.documentId(DEVICES)) {
          this.routeLan(owner)
          this.ctx.emit('sync/devices', owner)
        }
      },
      (message, error) => {
        this.ctx.logger.warn(message)
        this.ctx.logger.warn(error)
      },
      this.offload,
      () => { this.notifyReset(owner) },
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
        account.lanPort = transport.port()
        this.nameDevice(owner, account)
        this.routeLan(owner, transport)
        return transport
      }, (error: unknown) => {
        this.ctx.logger.warn('sync: local-network links for %s could not start: %s', owner, error)
        return undefined
      })
    } else if (!ready && account.lan !== undefined) {
      const stopping = account.lan
      delete account.lan
      delete account.lanPort
      vault.setLanSender(undefined)
      void stopping.then(transport => transport?.close())
    } else {
      void account.lan?.then((transport) => { transport?.refresh() })
    }
  }

  /**
   * What the account's next connection authenticates with: a signed-in user's access token, else this device's
   * sync grant when the Host keeps accounts connected.
   * @param owner - the account.
   * @param account - its store.
   * @returns the credential, or undefined while neither is available.
   */
  private async credential(owner: string, account: Account): Promise<RelayCredential | undefined> {
    const token = (await this.ctx.credentials.resolve(this.tokenRef, owner).catch(() => undefined))?.value
    if (token !== undefined) return { scheme: 'Bearer', token }
    const grant = this.config.keepConnected ? account.store.relayGrant() : undefined
    return grant === undefined ? undefined : { scheme: 'Grant', token: grant }
  }

  /**
   * Ask the relay for a sync grant over a connection a user's access token opened, when this Host keeps accounts
   * connected and the account holds none. A relay without grants refuses, and the account then connects only
   * while a client is signed in.
   * @param owner - the account.
   * @param account - its store.
   * @param relay - the connection.
   */
  private async takeGrant(owner: string, account: Account, relay: RelayConnection): Promise<void> {
    if (!this.config.keepConnected || account.store.relayGrant() !== undefined) return
    try {
      const answer = await relay.request('grant.issue', { device: account.store.deviceId() })
      if (typeof answer.token === 'string') account.store.setRelayGrant(answer.token)
    } catch (error) {
      this.ctx.logger.debug('sync: no sync grant for %s: %s', owner, error)
    }
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

  private open(credential: RelayCredential, account: Account): Promise<RelayConnection> {
    return RelayConnection.open(this.config.relayUrl, credential, {
      frame: (seq, frame) => { account.vault.receiveFrame(seq, frame) },
      closed: () => { account.vault.detach() },
    }, this.config.connectTimeoutMs, this.config.requestTimeoutMs)
  }

  /** Record this device's name in the account's devices document once it holds the account key. */
  private nameDevice(owner: string, account: Account): void {
    const device = account.vault.status().device
    if (!account.vault.ready() || device === undefined) return
    const names = account.vault.openDocument(DEVICES)
    const map = names.doc.getMap<DeviceName>('names')
    const current = map.get(device)
    // A device that stays connected without a client, such as Aeven Cloud, says so; older builds read only `name`.
    // Any other device stamps when it was last connected, which the always-on device reads as presence.
    const changed = current?.name !== this.config.deviceName || (current.alwaysOn === true) !== this.config.keepConnected
    if (changed || !this.config.keepConnected) {
      // Only a device without `keepConnected` advertises routes: an always-on server's addresses are not on the
      // account's networks.
      const port = this.config.keepConnected ? undefined : account.lanPort
      map.set(device, {
        name: this.config.deviceName,
        ...this.config.keepConnected ? { alwaysOn: true } : { seenAt: Date.now() },
        ...port === undefined ? {} : { routes: localRoutes(port) },
      })
    }
    if (changed) this.ctx.emit('sync/devices', owner)
    names.close()
  }

  /**
   * Hand the local-network links the routes of the account's present devices, so they dial the ones mDNS missed.
   * @param owner - the account.
   * @param started - the links, when the caller already holds them.
   */
  private routeLan(owner: string, started?: LanTransport): void {
    const account = this.accounts.get(owner)
    if (this.config.keepConnected || account === undefined || !account.vault.ready()) return
    const names = account.vault.openDocument(DEVICES)
    const now = Date.now()
    const routes = new Map<string, LanRoute[]>()
    for (const [device, entry] of names.doc.getMap<DeviceName>('names').entries()) {
      const present = entry.alwaysOn !== true && entry.offline !== true && entry.seenAt !== undefined
        && now - entry.seenAt <= this.config.routeWindowMs
      if (present && Array.isArray(entry.routes)) routes.set(device, entry.routes.filter(isRoute))
    }
    names.close()
    if (started !== undefined) started.setRoutes(routes)
    else void account.lan?.then((transport) => { transport?.setRoutes(routes) })
  }

  /**
   * Mark this device offline on its device entry and wait, at most `leaveMs`, for the mark to reach the relay. The
   * next presence stamp rewrites the entry without it.
   * @param account - an account whose relay connection may be open.
   */
  private async leave(account: Account): Promise<void> {
    const device = account.vault.status().device
    if (this.config.keepConnected || account.relay === undefined || !account.vault.ready() || device === undefined) return
    const names = account.vault.openDocument(DEVICES)
    const map = names.doc.getMap<DeviceName>('names')
    const current = map.get(device)
    map.set(device, { name: this.config.deviceName, ...current?.seenAt === undefined ? {} : { seenAt: current.seenAt }, offline: true })
    names.close()
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      account.vault.flush(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, this.config.leaveMs) }),
    ])
    clearTimeout(timer)
  }

  private live(owner: string, account: Account): boolean {
    return !this.disposed && this.accounts.get(owner) === account
  }

  private async connectLoop(owner: string, account: Account): Promise<void> {
    while (this.live(owner, account)) {
      const credential = account.vault.enabled() ? await this.credential(owner, account) : undefined
      if (credential !== undefined && this.live(owner, account)) await this.session(owner, credential, account)
      if (!this.live(owner, account)) return
      await this.wait(account)
    }
  }

  private async session(owner: string, credential: RelayCredential, account: Account): Promise<void> {
    let relay: RelayConnection
    try {
      relay = await this.open(credential, account)
    } catch (error) {
      this.ctx.logger.debug('sync: relay connection for %s failed: %s', owner, error)
      // A refused grant was revoked or expired; the next sign-in issues a new one.
      if (credential.scheme === 'Grant' && error instanceof RelayError && error.code === 'refused') account.store.setRelayGrant(undefined)
      return
    }
    if (!this.live(owner, account)) {
      relay.close()
      return
    }
    account.relay = relay
    try {
      await account.vault.attach(relay)
      this.nameDevice(owner, account)
      if (credential.scheme === 'Bearer') void this.takeGrant(owner, account, relay)
    } catch (error) {
      this.ctx.logger.warn('sync: catching up with the relay failed for %s', owner)
      this.ctx.logger.warn(error)
      relay.close()
    }
    // The user turned sync off while the connection opened.
    if (!account.vault.enabled()) relay.close()
    const presence = this.config.keepConnected
      ? undefined
      : setInterval(() => {
        if (!this.live(owner, account)) return
        this.nameDevice(owner, account)
        this.routeLan(owner)
      }, this.config.presenceMs)
    presence?.unref()
    await relay.closed
    clearInterval(presence)
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
    if (enabled) {
      if (account.vault.status().error !== undefined) account.relay?.close()
      account.wake()
    }
  }

  private vaultOf(owner: string): AccountVault {
    const vault = this.accounts.get(owner)?.vault
    if (vault === undefined) throw new Error('this device does not sync the account')
    return vault
  }

  /** @inheritdoc */
  override async protect(owner: string, passkey: SyncPasskey): Promise<void> {
    await this.vaultOf(owner).protect(passkey)
    this.nameAfterKey(owner)
  }

  /** @inheritdoc */
  override async addPasskey(owner: string, passkey: SyncPasskey): Promise<void> {
    await this.vaultOf(owner).addPasskey(passkey)
  }

  /** @inheritdoc */
  override async removePasskey(owner: string, credentialId: string): Promise<void> {
    await this.vaultOf(owner).removePasskey(credentialId)
  }

  /** @inheritdoc */
  override async unlock(owner: string, passkey: SyncPasskey): Promise<void> {
    this.vaultOf(owner).unlock(passkey)
    this.nameAfterKey(owner)
    await Promise.resolve()
  }

  /** @inheritdoc */
  override async unprotect(owner: string): Promise<void> {
    await this.vaultOf(owner).unprotect()
    this.nameAfterKey(owner)
  }

  /** @inheritdoc */
  override async acceptServerKey(owner: string): Promise<void> {
    this.vaultOf(owner).acceptServerKey()
    this.nameAfterKey(owner)
    await Promise.resolve()
  }

  /** A key this device took outside a connection's start still needs this device's name in the new documents. */
  private nameAfterKey(owner: string): void {
    const account = this.accounts.get(owner)
    if (account !== undefined) this.nameDevice(owner, account)
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
      this.ctx.emit('sync/devices', owner)
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
  secret(owner: string, label: string): string {
    const account = this.accounts.get(owner)
    if (account === undefined) throw new Error('this device does not sync the account')
    return account.vault.secret(label)
  }

  /** @inheritdoc */
  async openDocument(owner: string, name: string): Promise<SyncDocument> {
    const vault = this.readyVault(owner)
    await Promise.resolve()
    return vault.openDocument(name)
  }
}
