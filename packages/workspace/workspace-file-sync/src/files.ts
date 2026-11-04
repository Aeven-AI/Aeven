/**
 * The account's workspace files on this device: which folder each workspace syncs as, which devices hold it, and
 * where a workspace that arrived from another device keeps its files here.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import { brandString } from '@aeven/brand'
import type { FileSyncFolderId, FileSyncFolderStatus, FileSyncPeerId } from '@aeven/file-sync'
import type { SyncDocument } from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import { byRecentUse, fitsDisk, locationHint, markedDirectory, onBatteryPower, placeWorkspace, WorkspaceFileStatusReport, writeMarker } from '@aeven/workspace'
import type { WorkspaceConflict, WorkspaceConflictChoice, WorkspaceFileStatus, WorkspaceId } from '@aeven/workspace'
import type { SessionId } from '@aeven/session'

/** The document mapping each device of the account to its file transport peer id. */
const PEERS = 'file-sync/peers'
/** The document describing each workspace's synchronized files. */
const FOLDERS = 'file-sync/folders'

/** One device's file transport identity as the peers document holds it. */
interface SyncedPeer {
  peer: string
}

/** One workspace's synchronized files as the folders document holds it. */
export interface SyncedWorkspaceFiles {
  /** The transport folder id, the same on every device. */
  folder: string
  /** Size of the files as the account's devices last agreed on them. */
  bytes: number
  files: number
  /** The directory relative to the publishing device's home directory, `/`-separated; a placement hint, never a binding. */
  hint?: string
}

/** Placement and disk budget for workspaces that arrive from another device. */
export interface WorkspaceFilesOptions {
  /** Directory a workspace lands in when its hint names no usable directory here. */
  root: string
  /** Share of the disk a download must leave free. */
  minFreeDiskRatio: number
  /** Directory holding one marker per folder this device has held completely. */
  completeDirectory: string
  /** Longest a read waits for a file that is still arriving from another device. */
  readWaitMs: number
  /** Interval between checks for a file a read waits for. */
  readPollMs: number
  /** Delay that gathers the files the agent touched into one targeted scan. */
  scanDelayMs: number
  /** Longest a command that reads the whole tree waits for a first download to finish. */
  gateWaitMs: number
  /** Size above which a first download waits while this computer runs on battery. */
  batteryDeferBytes: number
  /** Shortest interval between two listings of one folder's conflicting versions. */
  conflictScanMs: number
  /** Largest file, in bytes, whose two versions are shown as text. */
  conflictTextMaxBytes: number
}

interface Account {
  device: DeviceId
  peers: SyncDocument
  folders: SyncDocument
}

/** A folder this device shares, and the workspace and account it belongs to. */
interface Shared {
  owner: string
  workspace: WorkspaceId
  /** The folder's directory here. */
  path: string
}

/** Keeps each account's folder workspaces in sync between its devices. */
export class WorkspaceFiles {
  private readonly accounts = new Map<string, Promise<Account | undefined>>()
  private readonly shared = new Map<FileSyncFolderId, Shared>()
  private readonly statuses: WorkspaceFileStatusReport
  /** Paths waiting for a targeted scan, by folder. */
  private readonly pendingScans = new Map<FileSyncFolderId, Set<string>>()
  /** Each folder's last count of conflicting files and when it was taken. */
  private readonly conflictCounts = new Map<FileSyncFolderId, { count: number; at: number }>()
  /** Serializes each account's reconciliation, so a bind it causes runs after the pass that made it. */
  private readonly passes = new Map<string, Promise<void>>()

  /**
   * @param ctx - context providing `fileSync`, `workspaceRegistry`, and `sync`.
   * @param options - placement root and disk budget.
   */
  constructor(private readonly ctx: Context, private readonly options: WorkspaceFilesOptions) {
    this.statuses = new WorkspaceFileStatusReport(ctx.workspaceRegistry)
  }

  /**
   * Open the account's documents once this device syncs it, publish this device's peer id, and reconcile. Later
   * calls for an attached account return at once; document changes, device changes, and registry changes drive it
   * from then on.
   * @param owner - the account.
   */
  async attach(owner: string): Promise<void> {
    if (this.accounts.has(owner)) return
    const account = await this.account(owner)
    if (account === undefined) return
    await this.refreshPeers(owner)
    await this.reconcile(owner)
  }

  /**
   * Share the account's folders with exactly the devices the account lists and whose peer id is known.
   * @param owner - the account.
   */
  async refreshPeers(owner: string): Promise<void> {
    const account = await this.accounts.get(owner)
    if (account === undefined) return
    const listed = new Set((await this.ctx.sync.devices(owner)).map(device => device.id))
    const peers = [...this.peerMap(account).entries()]
      .filter(([device]) => device !== account.device && listed.has(brandString<DeviceId>(device)))
      .map(([, entry]) => brandString<FileSyncPeerId>(entry.peer))
    await this.ctx.fileSync.setPeers(owner, peers)
  }

  /** Reconcile every account this device has attached. */
  reconcileAll(): void {
    for (const owner of this.accounts.keys()) void this.reconcile(owner)
  }

  /**
   * Report a shared folder's status as its workspace's file status, and record the size of a folder this device
   * holds completely, so other devices can budget its download.
   * @param id - the folder whose status changed.
   */
  async folderChanged(id: FileSyncFolderId): Promise<void> {
    const shared = this.shared.get(id)
    const status = this.ctx.fileSync.status(id)
    if (shared === undefined || status === undefined) return
    const account = await this.accounts.get(shared.owner)
    if (account === undefined) return
    const folders = this.folderMap(account)
    const entry = folders.get(shared.workspace)
    if (entry === undefined) return
    const complete = await this.complete(id, status, entry)
    const fileStatus = folderFileStatus(status, entry, complete)
    const conflicts = fileStatus === undefined ? await this.conflictCount(id) : 0
    this.statuses.set(shared.workspace, conflicts > 0 ? { state: 'conflict', count: conflicts } : fileStatus)
    if (!complete || status.state !== 'idle' || status.needFiles > status.failedFiles) return
    if (entry.bytes === status.globalBytes && entry.files === status.globalFiles) return
    folders.set(shared.workspace, { ...entry, bytes: status.globalBytes, files: status.globalFiles })
  }

  /**
   * Close the account's documents because they started over under a new key; the next status attaches again.
   * @param owner - the account.
   */
  async reset(owner: string): Promise<void> {
    const opening = this.accounts.get(owner)
    this.accounts.delete(owner)
    const account = await opening
    account?.peers.close()
    account?.folders.close()
  }

  /**
   * Hold a read of a file that the account's devices hold and this device has not received yet: move it to the front
   * of the download queue and wait until it is here, up to `readWaitMs`. Any other read proceeds at once.
   * @param path - the absolute path about to be read.
   * @param signal - cancels the wait with the tool call.
   */
  async beforeRead(path: string, signal: AbortSignal | undefined): Promise<void> {
    if (existsSync(path)) return
    const folder = this.folderOf(path)
    if (folder === undefined) return
    if (!await this.ctx.fileSync.prioritize(folder.id, folder.relative)) return
    const deadline = Date.now() + this.options.readWaitMs
    while (!existsSync(path) && Date.now() < deadline && signal?.aborted !== true) {
      await delay(this.options.readPollMs, undefined, signal === undefined ? {} : { signal }).catch(() => undefined)
    }
  }

  /**
   * Scan a file the agent just read or wrote in a shared folder, gathered with others for `scanDelayMs`, so its change
   * reaches the peers without waiting for the filesystem watcher.
   * @param path - the absolute path that was touched.
   */
  touched(path: string): void {
    const folder = this.folderOf(path)
    if (folder === undefined) return
    const pending = this.pendingScans.get(folder.id)
    if (pending !== undefined) {
      pending.add(folder.relative)
      return
    }
    this.pendingScans.set(folder.id, new Set([folder.relative]))
    setTimeout(() => {
      const paths = [...this.pendingScans.get(folder.id) ?? []]
      this.pendingScans.delete(folder.id)
      this.ctx.fileSync.scan(folder.id, paths).catch((error: unknown) => {
        this.ctx.logger('workspace-file-sync').warn(`workspace-file-sync: scanning changed files failed: ${String(error)}`)
      })
    }, this.options.scanDelayMs)
  }

  /**
   * The shared folder of a session's workspace while its first download has not finished.
   * @param sessionId - the session the command runs in.
   * @returns the folder still arriving, or undefined when the session's files are here or not synced as a folder.
   */
  arriving(sessionId: SessionId): FileSyncFolderId | undefined {
    const placement = this.ctx.workspaceRegistry.placeSession(sessionId)
    if (placement.state !== 'filed') return undefined
    for (const [id, shared] of this.shared) {
      if (shared.workspace === placement.workspace.id && !existsSync(this.completeMarker(id))) return id
    }
    return undefined
  }

  /**
   * Wait until a folder's first download finishes, up to `gateWaitMs`.
   * @param id - a folder {@link arriving} named.
   * @param signal - cancels the wait with the command.
   * @returns whether the folder finished within the wait.
   */
  async untilArrived(id: FileSyncFolderId, signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + this.options.gateWaitMs
    while (!existsSync(this.completeMarker(id))) {
      if (Date.now() >= deadline || signal.aborted) return false
      await delay(this.options.readPollMs, undefined, { signal }).catch(() => undefined)
    }
    return true
  }

  /** The shared folder that contains a path, and the path relative to it, `/`-separated. */
  private folderOf(path: string): { id: FileSyncFolderId; relative: string } | undefined {
    for (const [id, shared] of this.shared) {
      const rel = relative(shared.path, path)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue
      return { id, relative: rel.split(sep).join('/') }
    }
    return undefined
  }

  /** Close every open document and withdraw the file statuses this Consumer reported. */
  async dispose(): Promise<void> {
    for (const owner of [...this.accounts.keys()]) await this.reset(owner)
    this.statuses.clear()
  }

  private account(owner: string): Promise<Account | undefined> {
    const existing = this.accounts.get(owner)
    if (existing !== undefined) return existing
    const status = this.ctx.sync.status(owner)
    const device = status.device
    if (status.state === 'disabled' || status.state === 'starting' || device === undefined) return Promise.resolve(undefined)
    const opening = this.open(owner, device).catch((error: unknown) => {
      this.accounts.delete(owner)
      this.ctx.logger('workspace-file-sync').warn(`workspace-file-sync: opening the account's documents failed: ${String(error)}`)
      return undefined
    })
    this.accounts.set(owner, opening)
    return opening
  }

  private async open(owner: string, device: DeviceId): Promise<Account> {
    const [peers, folders] = await Promise.all([
      this.ctx.sync.openDocument(owner, PEERS),
      this.ctx.sync.openDocument(owner, FOLDERS),
    ])
    const account: Account = { device, peers, folders }
    const peer = await this.ctx.fileSync.peerId()
    const map = this.peerMap(account)
    if (map.get(device)?.peer !== peer) map.set(device, { peer })
    map.observe((_event: YMapEvent<SyncedPeer>, transaction: Transaction) => {
      if (!transaction.local) void this.refreshPeers(owner)
    })
    this.folderMap(account).observe((_event: YMapEvent<SyncedWorkspaceFiles>, transaction: Transaction) => {
      if (!transaction.local) void this.reconcile(owner)
    })
    return account
  }

  private peerMap(account: Account): YMap<SyncedPeer> {
    return account.peers.doc.getMap<SyncedPeer>('peers')
  }

  private folderMap(account: Account): YMap<SyncedWorkspaceFiles> {
    return account.folders.doc.getMap<SyncedWorkspaceFiles>('folders')
  }

  private reconcile(owner: string): Promise<void> {
    const pass = (this.passes.get(owner) ?? Promise.resolve()).then(() => this.reconcileNow(owner)).catch((error: unknown) => {
      this.ctx.logger('workspace-file-sync').warn(`workspace-file-sync: reconciling workspace files failed: ${String(error)}`)
    })
    this.passes.set(owner, pass)
    return pass
  }

  /**
   * Share each folder workspace of the account, publish a descriptor for one that has none, and give a workspace
   * that arrived from another device a directory here when its files fit the disk budget. A folder whose workspace
   * left this device stops syncing; its files stay.
   */
  private async reconcileNow(owner: string): Promise<void> {
    const account = await this.accounts.get(owner)
    if (account === undefined) return
    const folders = this.folderMap(account)
    const registry = this.ctx.workspaceRegistry
    const workspaces = byRecentUse(registry.list().filter(workspace => workspace.owner === owner && !workspace.isBuiltIn))
    let battery: Promise<boolean> | undefined
    const present = new Set<WorkspaceId>()
    for (const workspace of workspaces) {
      const entry = folders.get(workspace.id)
      if (workspace.kind === 'folder' && workspace.path !== undefined) {
        // A Git work tree travels through Git; a folder that became one stops syncing as a folder.
        if (isWorkTree(workspace.path)) {
          if (entry !== undefined) folders.delete(workspace.id)
          continue
        }
        const files = entry ?? describe(workspace.path)
        const id = brandString<FileSyncFolderId>(files.folder)
        if (entry === undefined) {
          // The device that describes a folder holds it completely by definition.
          await this.markComplete(id)
          folders.set(workspace.id, files)
        }
        present.add(workspace.id)
        this.shared.set(id, { owner, workspace: workspace.id, path: workspace.path })
        // The marker travels with the files and lets another device recognize a copy it already holds.
        await writeMarker(workspace.path, workspace.id)
        await this.ctx.fileSync.share({ id, owner, path: workspace.path })
        await this.folderChanged(id)
      } else if (workspace.kind === 'remote' && entry !== undefined) {
        present.add(workspace.id)
        // A copy this device already holds is bound in place; the transport then exchanges only the differences.
        const held = await markedDirectory(workspace.id, workspace.title, entry.hint, this.options.root)
        if (held !== undefined) {
          await registry.bind(workspace.id, held)
          continue
        }
        if (!await this.fits(entry.bytes)) {
          this.statuses.set(workspace.id, { state: 'failed', reason: 'disk' })
          continue
        }
        if (entry.bytes > this.options.batteryDeferBytes && await (battery ??= this.onBattery())) {
          this.statuses.set(workspace.id, { state: 'paused' })
          continue
        }
        // Binding commits a registry change, whose `workspace/changed` runs the pass that shares the folder.
        this.statuses.set(workspace.id, { state: 'syncing', progress: 0 })
        await registry.bind(workspace.id, await placeWorkspace(workspace.title, entry.hint, this.options.root))
      }
    }
    for (const [id, shared] of this.shared) {
      if (shared.owner !== owner || present.has(shared.workspace)) continue
      this.shared.delete(id)
      await this.ctx.fileSync.unshare(id)
      await rm(this.completeMarker(id), { force: true })
    }
    // Another account's workspaces keep their statuses; a deleted workspace's status goes with it.
    this.statuses.retain((id) => {
      const workspace = registry.get(id)
      return present.has(id) || (workspace !== undefined && workspace.owner !== owner)
    })
  }

  /**
   * Whether this device has held the folder completely: once its status shows every file the account's devices
   * agree on and at least as many files as the descriptor last recorded, a marker keeps the answer across restarts.
   * Before the device reaches a peer it agrees with itself on an empty folder, which the descriptor's count rules out.
   */
  private async complete(id: FileSyncFolderId, status: FileSyncFolderStatus, entry: SyncedWorkspaceFiles): Promise<boolean> {
    if (existsSync(this.completeMarker(id))) return true
    if (status.state !== 'idle' || status.needFiles > status.failedFiles || status.globalFiles < entry.files) return false
    await this.markComplete(id)
    return true
  }

  private async markComplete(id: FileSyncFolderId): Promise<void> {
    await mkdir(this.options.completeDirectory, { recursive: true })
    await writeFile(this.completeMarker(id), '')
  }

  private completeMarker(id: FileSyncFolderId): string {
    return join(this.options.completeDirectory, id)
  }

  /**
   * The conflicts of a workspace this Consumer syncs, with both versions' text where they are small text files.
   * @param workspace - the workspace.
   * @returns its conflicts, or undefined for a workspace this Consumer does not sync as a folder.
   */
  async conflicts(workspace: WorkspaceId): Promise<WorkspaceConflict[] | undefined> {
    const found = this.sharedOf(workspace)
    if (found === undefined) return undefined
    const [id, shared] = found
    const listed = await this.ctx.fileSync.conflicts(id)
    return Promise.all(listed.map(async conflict => ({
      path: conflict.path,
      thisText: await this.text(join(shared.path, ...conflict.path.split('/'))),
      otherText: await this.text(join(shared.path, ...conflict.copy.split('/'))),
    })))
  }

  /**
   * Keep one version of a conflicting file in a workspace this Consumer syncs.
   * @param workspace - the workspace.
   * @param path - the conflicting file.
   * @param keep - which version stays.
   * @returns whether this Consumer syncs the workspace and the file had a conflict.
   */
  async resolve(workspace: WorkspaceId, path: string, keep: WorkspaceConflictChoice): Promise<boolean> {
    const found = this.sharedOf(workspace)
    if (found === undefined) return false
    const [id] = found
    const conflict = (await this.ctx.fileSync.conflicts(id)).find(candidate => candidate.path === path)
    if (conflict === undefined) return false
    await this.ctx.fileSync.resolveConflict(id, conflict, keep === 'this' ? 'file' : 'copy')
    this.conflictCounts.delete(id)
    await this.folderChanged(id)
    return true
  }

  private sharedOf(workspace: WorkspaceId): [FileSyncFolderId, Shared] | undefined {
    for (const entry of this.shared) {
      if (entry[1].workspace === workspace) return entry
    }
    return undefined
  }

  /** A folder's count of conflicting files, listed again at most every `conflictScanMs`. */
  private async conflictCount(id: FileSyncFolderId): Promise<number> {
    const last = this.conflictCounts.get(id)
    if (last !== undefined && Date.now() - last.at < this.options.conflictScanMs) return last.count
    const count = (await this.ctx.fileSync.conflicts(id)).length
    this.conflictCounts.set(id, { count, at: Date.now() })
    return count
  }

  /** A file's text when it is small and has no NUL byte; otherwise null, so the two versions are not compared as text. */
  private async text(path: string): Promise<string | null> {
    const info = await stat(path).catch(() => undefined)
    if (info?.isFile() !== true || info.size > this.options.conflictTextMaxBytes) return null
    const bytes = await readFile(path)
    return bytes.includes(0) ? null : bytes.toString('utf8')
  }

  /**
   * Whether this computer runs on battery, through the subprocess capability when it is mounted.
   * @returns true only when the platform reports battery power.
   */
  onBattery(): Promise<boolean> {
    return onBatteryPower(this.ctx)
  }

  /** Whether downloading this many bytes leaves the required share of the disk free. */
  private fits(bytes: number): Promise<boolean> {
    return fitsDisk(this.options.root, bytes, this.options.minFreeDiskRatio)
  }
}

/** A new descriptor for a folder workspace this device opened, under a random folder id. */
function describe(path: string): SyncedWorkspaceFiles {
  const hint = locationHint(path)
  return { folder: randomUUID(), bytes: 0, files: 0, ...hint === undefined ? {} : { hint } }
}

/**
 * A shared folder's status as its workspace's file status: nothing while the folder is complete and current, and the
 * download progress against the larger of the agreed size and the descriptor's size before it first completes.
 */
function folderFileStatus(
  status: FileSyncFolderStatus,
  entry: SyncedWorkspaceFiles,
  complete: boolean,
): WorkspaceFileStatus | undefined {
  if (status.state === 'error') return { state: 'failed', reason: 'folder' }
  // Files this device cannot store stay needed forever; the rest decides whether the folder is current.
  const need = Math.max(0, status.needFiles - status.failedFiles)
  // Idle while files are missing: no device that holds them is reachable.
  if (status.state === 'idle' && (need > 0 || !complete)) return { state: 'waiting' }
  if (complete && need > 0) return { state: 'syncing' }
  if (complete) return status.failedFiles > 0 ? { state: 'failed', reason: 'unstorable', count: status.failedFiles } : undefined
  const total = Math.max(status.globalBytes, entry.bytes)
  if (total === 0) return { state: 'syncing' }
  return { state: 'syncing', progress: Math.min(1, Math.max(0, (status.globalBytes - status.needBytes) / total)) }
}

/** Whether a directory is the top of a Git work tree. */
function isWorkTree(path: string): boolean {
  return existsSync(join(path, '.git'))
}
