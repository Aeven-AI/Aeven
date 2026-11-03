/**
 * Syncthing Service Provider for file sync. One Syncthing process per Host, supervised through the subprocess
 * capability with its home under `$AVN_HOME/file-sync/syncthing`, keeps every shared folder in sync with the peers
 * each account lists. The provider configures it only through its loopback REST API under a random key, turns off
 * usage and crash reporting and automatic upgrades, and restarts it with backoff after it exits unexpectedly.
 * @module @aeven/file-sync-syncthing
 */
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@aeven/brand'
import {
  FileSync, type FileSyncFolder, type FileSyncFolderId, type FileSyncFolderState, type FileSyncFolderStatus,
  type FileSyncPeerId,
} from '@aeven/file-sync'
import { avnHomePath } from '@aeven/home-paths'
import type { SubprocessHandle } from '@aeven/subprocess'
import { folderSummarySchema, SyncthingRequestError, SyncthingRest, type FolderSummary, type SyncthingEvent } from './rest.ts'

/** Provider configuration. */
export interface Config {
  /** Syncthing executable, absolute or a bare name on `PATH`. */
  binary: string
  /** Syncthing's configuration and database directory. */
  home: string
  /** Addresses Syncthing accepts peer connections on, in its own syntax; `default` is TCP and QUIC on port 22000 plus relays. */
  listenAddresses: string[]
  /** Global discovery servers, in Syncthing's syntax; `default` is the public Syncthing pool. */
  discoveryServers: string[]
  /** Whether peers on the same local network find each other by broadcast. */
  localDiscovery: boolean
  /** Whether connections may go through relays when no direct connection succeeds. */
  relays: boolean
  /** Filesystem-watcher delay of shared folders, in seconds. */
  watcherDelayS: number
  /** Wait between learning of a peer's change and pulling it, in seconds; Syncthing's own default is 1. */
  pullerDelayS: number
  /** Full rescan interval of shared folders, in seconds; the watcher reports changes in between. */
  rescanIntervalS: number
  /** Days a file replaced or deleted by a peer is kept in the folder's `.stversions`. */
  versionRetentionDays: number
  /** Ignore patterns, in Syncthing's syntax, written for every shared folder. */
  ignores: string[]
  /** Longest the process may take to answer its REST API after it starts, in milliseconds. */
  startupTimeoutMs: number
  /** Longest one REST request may take, in milliseconds. */
  requestTimeoutMs: number
  /** Longest one event long poll waits for an event, in seconds. */
  eventsWaitS: number
  /** Time between asking the process to stop and killing it, in milliseconds. */
  stopGraceMs: number
  /** First wait before restarting a process that exited unexpectedly, doubling per consecutive failure, in milliseconds. */
  restartMs: number
  /** Longest wait between restarts; a process that ran this long resets the backoff, in milliseconds. */
  restartMaxMs: number
}

/** Folder labels and device names the provider writes, so it recognizes its own entries in Syncthing's configuration. */
const LABEL_PREFIX = 'aeven:'

/** Events that change a folder's status. */
const FOLDER_EVENTS = ['StateChanged', 'FolderSummary', 'FolderErrors'] as const

/** Syncthing's folder states mapped to the capability's. */
function folderState(state: string): FileSyncFolderState {
  switch (state) {
    case 'idle':
      return 'idle'
    case 'scanning':
    case 'scan-waiting':
      return 'scanning'
    case 'error':
      return 'error'
    // `syncing`, `sync-waiting`, `sync-preparing`, `cleaning`, and states later Syncthing versions add are transfers.
    default:
      return 'syncing'
  }
}

function folderStatus(summary: FolderSummary): FileSyncFolderStatus {
  const state = folderState(summary.state)
  return {
    state,
    globalBytes: summary.globalBytes,
    globalFiles: summary.globalFiles,
    needBytes: summary.needBytes,
    needFiles: summary.needFiles,
    ...state === 'error' && summary.error !== undefined && summary.error !== '' ? { error: summary.error } : {},
  }
}

/** A free loopback port for the REST listener, released before Syncthing binds it. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  if (address === null || typeof address === 'string') throw new Error('syncthing: no loopback port was assigned')
  return address.port
}

/** The running process and the client bound to it. */
interface Running {
  handle: SubprocessHandle
  rest: SyncthingRest
  peer: FileSyncPeerId
  startedAt: number
}

/** Syncthing file sync provider. */
export default class SyncthingFileSync extends FileSync {
  static inject = ['subprocess']

  static Config: Schema<Config> = Schema.object({
    binary: Schema.string().required(),
    home: Schema.string().default(avnHomePath('file-sync', 'syncthing')),
    listenAddresses: Schema.array(Schema.string()).default(['default']),
    discoveryServers: Schema.array(Schema.string()).default(['default']),
    localDiscovery: Schema.boolean().default(true),
    relays: Schema.boolean().default(true),
    watcherDelayS: Schema.natural().min(1).default(1),
    pullerDelayS: Schema.natural().default(0),
    rescanIntervalS: Schema.natural().min(60).default(3_600),
    versionRetentionDays: Schema.natural().min(1).default(30),
    ignores: Schema.array(Schema.string()).default([
      '.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target', '.next', '.turbo', '.cache',
      '(?d).DS_Store', '(?d)Thumbs.db', '*.tmp',
    ]),
    startupTimeoutMs: Schema.natural().min(1_000).default(30_000),
    requestTimeoutMs: Schema.natural().min(1_000).default(15_000),
    eventsWaitS: Schema.natural().min(1).default(60),
    stopGraceMs: Schema.natural().min(100).default(10_000),
    restartMs: Schema.natural().min(100).default(1_000),
    restartMaxMs: Schema.natural().min(1_000).default(60_000),
  })

  private executable: string | undefined
  private running: Running | undefined
  /** Settles with the running process once it answers; replaced on every restart. */
  private ready: Promise<Running>
  private markReady!: (running: Running) => void
  private failReady!: (error: unknown) => void
  private disposed = false
  private failures = 0
  private restartTimer: NodeJS.Timeout | undefined
  /** Folders shared through {@link share}, by id. */
  private readonly folders = new Map<FileSyncFolderId, FileSyncFolder>()
  /** Each account's peers, as {@link setPeers} last listed them. */
  private readonly peers = new Map<string, readonly FileSyncPeerId[]>()
  private readonly statuses = new Map<FileSyncFolderId, FileSyncFolderStatus>()
  /** Serializes configuration writes so a restart's reapply and a caller's change never interleave. */
  private writes: Promise<void> = Promise.resolve()

  /**
   * @param ctx - context providing `subprocess`.
   * @param config - executable, directories, transport, and process budgets.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    this.ready = this.pendingReady()
  }

  /** Resolve the executable, then start the process in the background; stop it when the plugin is disposed. */
  async [Service.init](): Promise<void> {
    this.executable = await this.ctx.subprocess.resolveExecutable(this.config.binary)
    this.ctx.effect(() => async () => {
      this.disposed = true
      clearTimeout(this.restartTimer)
      const running = this.running
      this.running = undefined
      if (running !== undefined) {
        running.handle.terminate()
        await running.handle.waitForExit()
      }
    }, 'file-sync-syncthing: process')
    void this.start()
  }

  /** @inheritdoc */
  async peerId(): Promise<FileSyncPeerId> {
    return (await this.ready).peer
  }

  /** @inheritdoc */
  async setPeers(owner: string, peers: readonly FileSyncPeerId[]): Promise<void> {
    const listed = [...new Set(peers)].sort()
    if (JSON.stringify(this.peers.get(owner)) === JSON.stringify(listed)) return
    this.peers.set(owner, listed)
    await this.write(async (running) => {
      await this.applyDevices(running)
      for (const folder of this.folders.values()) {
        if (folder.owner === owner) await this.applyFolder(running, folder)
      }
    })
  }

  /** @inheritdoc */
  async share(folder: FileSyncFolder): Promise<void> {
    const known = this.folders.get(folder.id)
    if (known?.path === folder.path && known.owner === folder.owner && samePeers(known.peers, folder.peers)) return
    this.folders.set(folder.id, { ...folder, ...folder.peers === undefined ? {} : { peers: [...folder.peers] } })
    await mkdir(folder.path, { recursive: true })
    await this.write(async (running) => {
      await this.applyFolder(running, folder)
      await this.refreshStatus(running, folder.id)
    })
  }

  /** @inheritdoc */
  async unshare(id: FileSyncFolderId): Promise<void> {
    if (!this.folders.delete(id)) return
    this.statuses.delete(id)
    await this.write(async (running) => {
      await running.rest.request('DELETE', `/rest/config/folders/${encodeURIComponent(id)}`)
    })
    this.notifyFolder(id)
  }

  /** @inheritdoc */
  status(id: FileSyncFolderId): FileSyncFolderStatus | undefined {
    return this.statuses.get(id)
  }

  /** Whether the plugin is still mounted; read through a call because awaits in between may dispose it. */
  private live(): boolean {
    return !this.disposed
  }

  private pendingReady(): Promise<Running> {
    const ready = new Promise<Running>((resolve, reject) => {
      this.markReady = resolve
      this.failReady = reject
    })
    // A start that fails before anyone asked must not surface as an unhandled rejection; callers await `ready`.
    ready.catch(() => {})
    return ready
  }

  /** Run one configuration change against the running process, after the changes queued before it. */
  private write(change: (running: Running) => Promise<void>): Promise<void> {
    const next = this.writes.then(async () => { await change(await this.ready) })
    this.writes = next.catch(() => {})
    return next
  }

  private async start(): Promise<void> {
    if (this.disposed || this.executable === undefined) return
    let started: Running | undefined
    try {
      const running = await this.launch(this.executable)
      started = running
      if (!this.live()) {
        running.handle.terminate()
        return
      }
      this.running = running
      void running.handle.done.then(() => { this.exited(running) }, () => { this.exited(running) })
      await this.configure(running)
      this.markReady(running)
      void this.followEvents(running)
    } catch (error) {
      // The supervisor owns the retry, so a process left running by a failed configuration is stopped first.
      if (started !== undefined && this.running === started) {
        this.running = undefined
        started.handle.terminate()
      }
      this.ctx.logger('file-sync').warn(`file-sync: starting Syncthing failed: ${String(error)}`)
      this.failReady(error)
      this.ready = this.pendingReady()
      this.scheduleRestart()
    }
  }

  private async launch(executable: string): Promise<Running> {
    const home = this.config.home
    await mkdir(home, { recursive: true })
    const env = { STNODEFAULTFOLDER: '1', STNOUPGRADE: '1' }
    const stdio = { stdin: 'ignore', stdout: { maxBytes: 16_384 }, stderr: { maxBytes: 16_384 } } as const
    // `generate` keeps an existing key and configuration, so it runs on every start and creates them only once.
    const generate = this.ctx.subprocess.spawn({
      argv: [executable, 'generate', `--home=${home}`, '--no-port-probing'], cwd: home, stdio, env, graceMs: this.config.stopGraceMs,
    })
    const generated = await generate.done
    if (generated.exitCode !== 0) {
      throw new Error(`syncthing generate exited with ${String(generated.exitCode ?? generated.signal)}: ${generate.collected.stderr?.readFrom(0).text ?? ''}`)
    }
    const port = await freePort()
    const apiKey = randomBytes(24).toString('base64url')
    const handle = this.ctx.subprocess.spawn({
      argv: [
        executable, 'serve', `--home=${home}`, '--no-browser', '--no-restart', '--no-upgrade',
        `--gui-address=http://127.0.0.1:${String(port)}`, `--gui-apikey=${apiKey}`, '--log-level=WARN',
      ],
      cwd: home, stdio, env, graceMs: this.config.stopGraceMs,
    })
    const rest = new SyncthingRest(`http://127.0.0.1:${String(port)}`, apiKey, this.config.requestTimeoutMs)
    const deadline = Date.now() + this.config.startupTimeoutMs
    const child = { exited: false }
    void handle.done.finally(() => { child.exited = true })
    while (!(await rest.healthy())) {
      if (child.exited) throw new Error(`syncthing exited during startup: ${handle.collected.stderr?.readFrom(0).text ?? ''}`)
      if (Date.now() > deadline) {
        handle.terminate()
        throw new Error('syncthing did not answer its REST API in time')
      }
      await new Promise((resolve) => { setTimeout(resolve, 50) })
    }
    return { handle, rest, peer: brandString<FileSyncPeerId>(await rest.deviceId()), startedAt: Date.now() }
  }

  /**
   * Apply the process options, then this run's peers and folders. Devices and folders a previous run configured
   * but no current account lists are removed, so a device taken off the account while the Host was stopped is not
   * trusted again.
   */
  private async configure(running: Running): Promise<void> {
    await running.rest.request('PATCH', '/rest/config/options', {
      listenAddresses: this.config.listenAddresses,
      globalAnnounceServers: this.config.discoveryServers,
      globalAnnounceEnabled: this.config.discoveryServers.length > 0,
      localAnnounceEnabled: this.config.localDiscovery,
      relaysEnabled: this.config.relays,
      natEnabled: true,
      urAccepted: -1,
      crashReportingEnabled: false,
      autoUpgradeIntervalH: 0,
      startBrowser: false,
      setLowPriority: true,
    })
    // A changed listen address or discovery setting applies only after a restart. The options are stored, so the
    // process the supervisor starts next comes up with them and needs no further restart.
    const restart = await running.rest.request('GET', '/rest/config/restart-required')
    if (typeof restart === 'object' && restart !== null && 'requiresRestart' in restart && restart.requiresRestart === true) {
      await running.rest.request('POST', '/rest/system/restart')
      throw new Error('syncthing restarts to apply its options')
    }
    for (const folder of await running.rest.folders()) {
      const id = brandString<FileSyncFolderId>(folder.id)
      if (folder.label.startsWith(LABEL_PREFIX) && !this.folders.has(id)) {
        await running.rest.request('DELETE', `/rest/config/folders/${encodeURIComponent(folder.id)}`)
      }
    }
    await this.applyDevices(running)
    for (const folder of this.folders.values()) {
      await this.applyFolder(running, folder)
      await this.refreshStatus(running, folder.id)
    }
  }

  /** Make the configured devices exactly this device plus every account's listed peers. */
  private async applyDevices(running: Running): Promise<void> {
    const wanted = new Set(this.allPeers(running))
    for (const device of await running.rest.devices()) {
      if (device.deviceID === running.peer || wanted.has(brandString<FileSyncPeerId>(device.deviceID))) continue
      if (device.name.startsWith(LABEL_PREFIX)) await running.rest.request('DELETE', `/rest/config/devices/${encodeURIComponent(device.deviceID)}`)
    }
    for (const peer of wanted) {
      await running.rest.request('PUT', `/rest/config/devices/${encodeURIComponent(peer)}`, {
        deviceID: peer, name: `${LABEL_PREFIX}${peer.slice(0, 7)}`, addresses: ['dynamic'],
        autoAcceptFolders: false, introducer: false, untrusted: false,
      })
    }
  }

  private allPeers(running: Running): FileSyncPeerId[] {
    return [...new Set([...this.peers.values()].flat())].filter(peer => peer !== running.peer)
  }

  /** Write one folder's configuration and ignore patterns, shared with this device and its account's peers. */
  private async applyFolder(running: Running, folder: FileSyncFolder): Promise<void> {
    const only = folder.peers === undefined ? undefined : new Set(folder.peers)
    const peers = (this.peers.get(folder.owner) ?? []).filter(peer => peer !== running.peer && (only?.has(peer) ?? true))
    await running.rest.request('PUT', `/rest/config/folders/${encodeURIComponent(folder.id)}`, {
      id: folder.id,
      label: `${LABEL_PREFIX}${folder.id}`,
      path: folder.path,
      type: 'sendreceive',
      devices: [running.peer, ...peers].map(deviceID => ({ deviceID })),
      fsWatcherEnabled: true,
      fsWatcherDelayS: this.config.watcherDelayS,
      pullerDelayS: this.config.pullerDelayS,
      rescanIntervalS: this.config.rescanIntervalS,
      versioning: {
        type: 'staggered',
        params: { maxAge: String(this.config.versionRetentionDays * 86_400), cleanInterval: '3600' },
      },
      paused: false,
    })
    await running.rest.request('POST', `/rest/db/ignores?folder=${encodeURIComponent(folder.id)}`, { ignore: this.config.ignores })
  }

  private async refreshStatus(running: Running, id: FileSyncFolderId): Promise<void> {
    try {
      this.statuses.set(id, folderStatus(await running.rest.folderStatus(id)))
      this.notifyFolder(id)
    } catch (error) {
      // A folder Syncthing has not started yet has no status; the next event reports it.
      if (!(error instanceof SyncthingRequestError)) throw error
    }
  }

  /** Follow folder events while this process runs; a failed poll ends with the process or retries. */
  private async followEvents(running: Running): Promise<void> {
    let since = 0
    while (!this.disposed && this.running === running) {
      let events: SyncthingEvent[]
      try {
        events = await running.rest.events(since, FOLDER_EVENTS, this.config.eventsWaitS)
      } catch (error) {
        if (!this.live() || this.running !== running) return
        this.ctx.logger('file-sync').debug(`file-sync: reading Syncthing events failed: ${String(error)}`)
        await new Promise((resolve) => { setTimeout(resolve, this.config.restartMs) })
        continue
      }
      for (const event of events) {
        since = Math.max(since, event.id)
        await this.applyEvent(running, event)
      }
    }
  }

  private async applyEvent(running: Running, event: SyncthingEvent): Promise<void> {
    const data = event.data
    if (typeof data !== 'object' || data === null || !('folder' in data) || typeof data.folder !== 'string') return
    const id = brandString<FileSyncFolderId>(data.folder)
    if (!this.folders.has(id)) return
    if (event.type === 'FolderSummary' && 'summary' in data) {
      const parsed = folderSummarySchema.safeParse(data.summary)
      if (!parsed.success) return
      this.statuses.set(id, folderStatus(parsed.data))
      this.notifyFolder(id)
      return
    }
    // A state change or error list carries no sizes; reading the summary keeps both consistent.
    await this.refreshStatus(running, id)
  }

  /** Restart a process that exited while the plugin is live, backing off after repeated failures. */
  private exited(running: Running): void {
    if (this.running !== running) return
    this.running = undefined
    this.ready = this.pendingReady()
    if (this.disposed) return
    if (Date.now() - running.startedAt >= this.config.restartMaxMs) this.failures = 0
    this.ctx.logger('file-sync').warn('file-sync: Syncthing exited; restarting')
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.disposed) return
    const delay = Math.min(this.config.restartMs * 2 ** this.failures, this.config.restartMaxMs)
    this.failures += 1
    clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => { void this.start() }, delay)
  }
}

/** Whether two optional peer restrictions name the same peers. */
function samePeers(left: readonly FileSyncPeerId[] | undefined, right: readonly FileSyncPeerId[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}
