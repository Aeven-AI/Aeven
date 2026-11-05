/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceBindRequest,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceConflictsRequest,
  WorkspaceConflictsValue,
  WorkspaceFilesIgnoresRequest,
  WorkspaceFilesPauseRequest,
  WorkspaceFilesSettings,
  WorkspaceGetFilesRequest,
  WorkspaceGetFilesValue,
  WorkspaceResolveConflictRequest,
  WorkspaceResolveConflictValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceValue,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Workspace Controller configuration. */
export interface Config {
  /**
   * Whether callers may give a Workspace a directory of this Host, by creating
   * one over a path or binding one. A Host that serves accounts of different
   * people sets `false`: a directory there would expose the Host's own files,
   * so its Workspaces are created by title and carry none. Defaults to `true`.
   */
  readonly folders?: boolean
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry']

  static Config: Schema<Config> = Schema.object({ folders: Schema.boolean() })

  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed

  /**
   * @param ctx - Host context containing the Workspace registry.
   * @param config - whether Workspaces may take directories of this Host.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    this.commands = new WorkspaceCommands(ctx, config.folders ?? true)
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory, or
   * create a Workspace with no directory under a title.
   * @param request - directory path to register, or title of a pathless Workspace.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('create')
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @Remote('rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request)
  }

  /**
   * Give a Workspace without a directory on this Host, such as one another device of the account registered, a
   * directory here. The directory stays on this Host.
   * @param request - Workspace identity and directory path.
   * @returns the updated Workspace projection.
   */
  @Remote('bind')
  bind(request: WorkspaceBindRequest): Promise<WorkspaceValue> {
    return this.commands.bind(request)
  }

  /**
   * Ask for a Workspace's files now on the user's behalf, such as after they accept to install Git.
   * @param request - Workspace identity.
   * @returns the request receipt.
   */
  @Remote('getFiles')
  getFiles(request: WorkspaceGetFilesRequest): Promise<WorkspaceGetFilesValue> {
    return this.commands.getFiles(request)
  }

  /**
   * Read file sync on this Host for the calling account.
   * @returns whether it is paused, the ignore patterns, and the account's Workspaces with their files' place and status.
   */
  @Remote('filesSettings')
  filesSettings(): Promise<WorkspaceFilesSettings> {
    return Promise.resolve(this.commands.filesSettings())
  }

  /**
   * Pause or resume file sync on this Host for the calling account.
   * @param request - whether to pause.
   * @returns file sync after the change.
   */
  @Remote('setFilesPaused')
  setFilesPaused(request: WorkspaceFilesPauseRequest): Promise<WorkspaceFilesSettings> {
    return Promise.resolve(this.commands.setFilesPaused(request))
  }

  /**
   * Replace the patterns no folder syncs, the same on every device of the account.
   * @param request - the patterns.
   * @returns file sync after the change.
   */
  @Remote('setFilesIgnores')
  setFilesIgnores(request: WorkspaceFilesIgnoresRequest): Promise<WorkspaceFilesSettings> {
    return this.commands.setFilesIgnores(request)
  }

  /**
   * List a Workspace's files that two devices changed differently.
   * @param request - Workspace identity.
   * @returns the conflicts with both versions' text where available.
   */
  @Remote('conflicts')
  conflicts(request: WorkspaceConflictsRequest): Promise<WorkspaceConflictsValue> {
    return this.commands.conflicts(request)
  }

  /**
   * Keep one version of a conflicting file.
   * @param request - Workspace identity, file, and the version to keep.
   * @returns whether the file had a conflict.
   */
  @Remote('resolveConflict')
  resolveConflict(request: WorkspaceResolveConflictRequest): Promise<WorkspaceResolveConflictValue> {
    return this.commands.resolveConflict(request)
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @Remote('insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @Remote('archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Restore one Session to Workspace grouping surfaces.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  @Remote('unarchiveSession')
  unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.unarchiveSession(request)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    return this.feed.follow(signal)
  }
}

export default WorkspaceController
