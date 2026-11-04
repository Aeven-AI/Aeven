/**
 * Service Definition for file sync (`ctx.fileSync`): a folder on this device is kept the same as the folder with the
 * same id on the account's other devices, peer to peer. Consumers decide which folders travel and where they live;
 * the provider owns the transport, its process, and how changes reach the peers it is given.
 * @module @aeven/file-sync
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@aeven/brand'

/** One device's identity on the file transport, distinct from its account sync device id. */
export type FileSyncPeerId = Branded<'FileSyncPeerId'>

/** One synchronized folder's id, the same on every device that holds the folder; random, never a path or title. */
export type FileSyncFolderId = Branded<'FileSyncFolderId'>

/** One file two devices changed differently: the version kept under its name and the copy the transport set aside. */
export interface FileSyncConflict {
  /** `/`-separated path of the file, relative to the folder. */
  path: string
  /** `/`-separated path of the other version's copy, relative to the folder. */
  copy: string
}

/** A folder this device shares with its account's other devices. */
export interface FileSyncFolder {
  /** The folder's id on every device. */
  id: FileSyncFolderId
  /** The account whose peers the folder is shared with. */
  owner: string
  /** Absolute directory on this device; created when absent. */
  path: string
  /**
   * The only peers of the account the folder travels to, such as the one device a transfer is for; absent shares it
   * with every peer {@link FileSync.setPeers} lists for the account. A listed peer the account does not list is ignored.
   */
  peers?: readonly FileSyncPeerId[]
}

/** Where one shared folder stands on this device. */
export type FileSyncFolderState =
  /** Reading the folder to find changes. */
  | 'scanning'
  /** Receiving changes from peers. */
  | 'syncing'
  /** Holds every file the account's devices agree on. */
  | 'idle'
  /** The folder cannot sync, for example because its directory is gone; see {@link FileSyncFolderStatus.error}. */
  | 'error'

/** One shared folder's state and the size of what the account's devices hold in it. */
export interface FileSyncFolderStatus {
  /** Current state. */
  state: FileSyncFolderState
  /** Bytes and files in the folder as the account's devices agree on it. */
  globalBytes: number
  globalFiles: number
  /** Bytes and files this device still has to receive. */
  needBytes: number
  needFiles: number
  /**
   * Files this device cannot store, such as names its filesystem rejects; they stay counted in
   * {@link FileSyncFolderStatus.needFiles} because the peers still hold them.
   */
  failedFiles: number
  /** Why the folder cannot sync; present only in `error`. */
  error?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileSync: FileSync
  }

  interface Events {
    /**
     * A shared folder's status changed; read it with {@link FileSync.status}.
     * @mode emit
     * @param folder - the folder whose status changed.
     */
    'file-sync/folder'(folder: FileSyncFolderId): void
  }
}

/** File sync capability. */
export abstract class FileSync extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fileSync')
  }

  /**
   * This device's identity on the file transport, which the account's other devices pass to {@link setPeers}.
   * @returns the peer id, once the transport has started.
   */
  abstract peerId(): Promise<FileSyncPeerId>

  /**
   * Replace the devices an account's folders are shared with. A peer absent from the list stops receiving and
   * sending changes for every folder of the account; this device itself is ignored when listed.
   * @param owner - the account.
   * @param peers - the account's other devices' peer ids.
   * @returns when the transport applies the list.
   */
  abstract setPeers(owner: string, peers: readonly FileSyncPeerId[]): Promise<void>

  /**
   * Keep a folder in sync with the account's peers. Sharing an id again with another path moves it to that path.
   * @param folder - the folder, its account, and its directory here.
   * @returns when the transport has started on the folder.
   */
  abstract share(folder: FileSyncFolder): Promise<void>

  /**
   * Stop syncing a folder on this device; its files stay on disk.
   * @param id - a folder {@link share} started.
   * @returns when the transport no longer serves the folder.
   */
  abstract unshare(id: FileSyncFolderId): Promise<void>

  /**
   * Read a shared folder's status.
   * @param id - the folder.
   * @returns its status, or undefined for a folder this device does not share or whose status is not known yet.
   */
  abstract status(id: FileSyncFolderId): FileSyncFolderStatus | undefined

  /**
   * Pause or resume every folder of an account on this device; a paused folder neither sends nor receives changes.
   * @param owner - the account.
   * @param paused - whether its folders pause.
   * @returns when the transport applies it.
   */
  abstract setPaused(owner: string, paused: boolean): Promise<void>

  /**
   * Look at these paths now instead of waiting for the filesystem watcher, so a change this device just made reaches
   * the peers at once.
   * @param id - a folder {@link share} started.
   * @param paths - `/`-separated paths relative to the folder.
   * @returns when the transport has queued the scan.
   */
  abstract scan(id: FileSyncFolderId, paths: readonly string[]): Promise<void>

  /**
   * Move one file to the front of the download queue when the account's devices hold it and this device does not yet.
   * @param id - a folder {@link share} started.
   * @param path - `/`-separated path relative to the folder.
   * @returns whether the file is on its way: false when it is already here or no device holds it.
   */
  abstract prioritize(id: FileSyncFolderId, path: string): Promise<boolean>

  /**
   * List the files of a shared folder that two devices changed differently.
   * @param id - a folder {@link share} started.
   * @returns each conflicting file and the copy of its other version.
   */
  abstract conflicts(id: FileSyncFolderId): Promise<FileSyncConflict[]>

  /**
   * Keep one version of a conflicting file: `file` keeps the version under its name and removes the copy, `copy`
   * moves the copy's content over the file.
   * @param id - a folder {@link share} started.
   * @param conflict - a conflict {@link conflicts} listed.
   * @param keep - which version stays.
   * @returns when the folder holds one version.
   */
  abstract resolveConflict(id: FileSyncFolderId, conflict: FileSyncConflict, keep: 'file' | 'copy'): Promise<void>

  /**
   * Publish a status change to `file-sync/folder` listeners.
   * @param folder - the folder whose status changed.
   */
  protected notifyFolder(folder: FileSyncFolderId): void {
    this.ctx.emit('file-sync/folder', folder)
  }
}

export default FileSync
