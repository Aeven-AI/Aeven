/**
 * The account's workspace files on this device: which folder each workspace syncs as, which devices hold it, and
 * where a workspace that arrived from another device keeps its files here.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import { brandString } from '@aeven/brand'
import type { FileSyncFolderId, FileSyncPeerId } from '@aeven/file-sync'
import type { SyncDocument } from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import { fitsDisk, locationHint, placeWorkspace } from '@aeven/workspace'
import type { WorkspaceId } from '@aeven/workspace'

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
  /** Largest workspace this device downloads without being asked. */
  prefetchMaxBytes: number
  /** Share of the disk a download must leave free. */
  minFreeDiskRatio: number
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
}

/** Keeps each account's folder workspaces in sync between its devices. */
export class WorkspaceFiles {
  private readonly accounts = new Map<string, Promise<Account | undefined>>()
  private readonly shared = new Map<FileSyncFolderId, Shared>()
  /** Serializes each account's reconciliation, so a bind it causes runs after the pass that made it. */
  private readonly passes = new Map<string, Promise<void>>()

  /**
   * @param ctx - context providing `fileSync`, `workspaceRegistry`, and `sync`.
   * @param options - placement root and disk budget.
   */
  constructor(private readonly ctx: Context, private readonly options: WorkspaceFilesOptions) {}

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
   * Record the size of a folder this device holds completely, so other devices can budget its download.
   * @param id - the folder whose status changed.
   */
  async folderChanged(id: FileSyncFolderId): Promise<void> {
    const shared = this.shared.get(id)
    const status = this.ctx.fileSync.status(id)
    if (shared === undefined || status?.state !== 'idle' || status.needFiles > 0) return
    const account = await this.accounts.get(shared.owner)
    if (account === undefined) return
    const folders = this.folderMap(account)
    const entry = folders.get(shared.workspace)
    if (entry === undefined || (entry.bytes === status.globalBytes && entry.files === status.globalFiles)) return
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

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const owner of [...this.accounts.keys()]) await this.reset(owner)
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
    const workspaces = registry.list().filter(workspace => workspace.owner === owner && !workspace.isBuiltIn)
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
        if (entry === undefined) folders.set(workspace.id, files)
        const id = brandString<FileSyncFolderId>(files.folder)
        present.add(workspace.id)
        this.shared.set(id, { owner, workspace: workspace.id })
        await this.ctx.fileSync.share({ id, owner, path: workspace.path })
      } else if (workspace.kind === 'remote' && entry !== undefined && await this.fits(entry.bytes)) {
        // Binding commits a registry change, whose `workspace/changed` runs the pass that shares the folder.
        await registry.bind(workspace.id, await placeWorkspace(workspace.title, entry.hint, this.options.root))
      }
    }
    for (const [id, shared] of this.shared) {
      if (shared.owner !== owner || present.has(shared.workspace)) continue
      this.shared.delete(id)
      await this.ctx.fileSync.unshare(id)
    }
  }

  /** Whether downloading this many bytes stays within the prefetch limit and leaves the required share of the disk free. */
  private fits(bytes: number): Promise<boolean> {
    return fitsDisk(this.options.root, bytes, this.options.prefetchMaxBytes, this.options.minFreeDiskRatio)
  }
}

/** A new descriptor for a folder workspace this device opened, under a random folder id. */
function describe(path: string): SyncedWorkspaceFiles {
  const hint = locationHint(path)
  return { folder: randomUUID(), bytes: 0, files: 0, ...hint === undefined ? {} : { hint } }
}

/** Whether a directory is the top of a Git work tree. */
function isWorkTree(path: string): boolean {
  return existsSync(join(path, '.git'))
}
