/** Workspace command implementation and stable Remote failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@aeven/workspace'
import {
  WorkspaceDefaultImmutableError,
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from '@aeven/workspace'
import { RemoteError, remoteErrorOf } from '@aeven/typert-protocol'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/settings'
import type { SessionId } from '@aeven/session'
import { callerWorkspaceView, workspaceSessionVisible, workspaceView, workspaceVisible } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceBindRequest,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceConflictsRequest,
  WorkspaceConflictsValue,
  WorkspaceFilesIgnoresRequest,
  WorkspaceFilesPauseRequest,
  WorkspaceFilesSettings,
  WorkspaceGetFilesRequest,
  WorkspaceGetFilesValue,
  WorkspaceResolveConflictRequest,
  WorkspaceResolveConflictValue,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceValue,
} from './types.ts'

/** Most ignore patterns one account keeps. */
const MAX_IGNORES = 500
/** Longest one ignore pattern. */
const MAX_IGNORE_LENGTH = 500

/**
 * The refusal a Host without Workspace directories answers a directory request with.
 * @returns the error to reject with.
 */
function foldersUnavailable(): RemoteError<'workspace/folders-unavailable'> {
  return new RemoteError('workspace/folders-unavailable', 'Workspaces on this Host have no folder; create one by name', {})
}

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /**
   * @param ctx - Host context containing the Workspace registry.
   * @param folders - whether callers may give a Workspace a directory of this Host.
   */
  constructor(private readonly ctx: Context, private readonly folders: boolean = true) {}

  /**
   * Create or resolve one Workspace over an existing directory, or create a
   * Workspace with no directory under a title.
   * @param request - directory path to register, or title of a pathless Workspace.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    const { path, title } = request
    if ((path === undefined) === (title === undefined)) {
      return Promise.reject(new RemoteError('gateway/bad-request', 'workspace.create takes a path or a title, not both', {}))
    }
    // The caller owns what they register; another account adding the same
    // directory gets a workspace of its own.
    const owner = this.ctx.get('identityUsers')?.actingUser()?.id
    if (title !== undefined) {
      const trimmed = title.trim()
      if (trimmed === '') {
        return Promise.reject(new RemoteError('gateway/bad-request', 'a Workspace without a directory needs a non-blank title', {}))
      }
      return this.enqueue(async () => {
        const workspace = await this.ctx.workspaceRegistry.createVirtual(trimmed, owner)
        return { workspace: this.view(workspace), created: true }
      })
    }
    return this.createAt(path as string, owner)
  }

  /**
   * Create or resolve one Workspace over an existing directory of this Host.
   * @param path - directory path to register.
   * @param owner - the acting account.
   * @returns the Workspace and whether this call created it.
   */
  private createAt(path: string, owner: string | undefined): Promise<WorkspaceCreateValue> {
    if (!this.folders) return Promise.reject(foldersUnavailable())
    const request = { path }
    return this.enqueue(async () => {
      try {
        const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path, owner)
        if (existing !== undefined) {
          return { workspace: this.view(existing), created: false }
        }
        const workspace = await this.ctx.workspaceRegistry.create(request.path, undefined, owner)
        return { workspace: this.view(workspace), created: true }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
          { cause: error },
        )
      }
    })
  }

  /**
   * Give one Workspace without a directory here a directory of this Host.
   * @param request - Workspace identity and directory path.
   * @returns the updated Workspace projection.
   */
  bind(request: WorkspaceBindRequest): Promise<WorkspaceValue> {
    if (!this.folders) return Promise.reject(foldersUnavailable())
    return this.enqueue(async () => {
      this.requireWorkspace(request.workspaceId)
      try {
        const workspace = await this.ctx.workspaceRegistry.bind(WorkspaceId(request.workspaceId), request.path)
        return { workspace: this.view(workspace) }
      } catch (error) {
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot bind the Workspace to "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
          { cause: error },
        )
      }
    })
  }

  /**
   * Pass the user's request for a Workspace's files to the Consumer that syncs them.
   * @param request - Workspace identity.
   * @returns the request receipt.
   */
  getFiles(request: WorkspaceGetFilesRequest): Promise<WorkspaceGetFilesValue> {
    return this.enqueue(() => {
      this.requireWorkspace(request.workspaceId)
      this.ctx.workspaceRegistry.requestFiles(WorkspaceId(request.workspaceId))
      return Promise.resolve({ requested: true as const })
    })
  }

  /**
   * Read file sync on this Host for the calling account.
   * @returns whether it is paused, the ignore patterns, and the account's Workspaces with their files' place and status.
   */
  filesSettings(): WorkspaceFilesSettings {
    const owner = this.ctx.get('identityUsers')?.actingUser()?.id
    const registry = this.ctx.workspaceRegistry
    const settings = this.ctx.get('settings')?.get('file-sync') as { ignores?: string[] } | undefined
    return {
      paused: owner !== undefined && registry.filesPaused(owner),
      ignores: settings?.ignores ?? [],
      workspaces: registry.list()
        .filter(workspace => !workspace.isBuiltIn && workspace.owner === owner)
        .map(workspace => ({
          workspaceId: workspace.id,
          title: workspace.title,
          path: workspace.path ?? null,
          files: workspaceView(workspace, registry.fileStatus(workspace.id)).files,
        })),
    }
  }

  /**
   * Pause or resume file sync on this Host for the calling account.
   * @param request - whether to pause.
   * @returns file sync after the change.
   */
  setFilesPaused(request: WorkspaceFilesPauseRequest): WorkspaceFilesSettings {
    const owner = this.ctx.get('identityUsers')?.actingUser()?.id
    if (owner === undefined) throw new RemoteError('gateway/bad-request', 'pausing file sync needs a signed-in user', {})
    this.ctx.workspaceRegistry.setFilesPaused(owner, request.paused)
    return this.filesSettings()
  }

  /**
   * Replace the patterns no folder syncs, the same on every device of the account.
   * @param request - the patterns.
   * @returns file sync after the change.
   */
  async setFilesIgnores(request: WorkspaceFilesIgnoresRequest): Promise<WorkspaceFilesSettings> {
    const ignores = request.ignores.map(pattern => pattern.trim()).filter(pattern => pattern !== '')
    if (ignores.length > MAX_IGNORES || ignores.some(pattern => pattern.length > MAX_IGNORE_LENGTH)) {
      throw new RemoteError(
        'gateway/bad-request',
        `ignore patterns are limited to ${String(MAX_IGNORES)} of ${String(MAX_IGNORE_LENGTH)} characters`,
        {},
      )
    }
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new RemoteError('gateway/bad-request', 'this Host keeps no settings', {})
    await settings.update('file-sync', { ignores })
    return this.filesSettings()
  }

  /**
   * List a Workspace's files that two devices changed differently.
   * @param request - Workspace identity.
   * @returns the conflicts with both versions' text where available.
   */
  async conflicts(request: WorkspaceConflictsRequest): Promise<WorkspaceConflictsValue> {
    this.requireWorkspace(request.workspaceId)
    const conflicts = await this.ctx.workspaceRegistry.conflicts(WorkspaceId(request.workspaceId))
    return { conflicts: conflicts.map(conflict => ({ path: conflict.path, thisText: conflict.thisText, otherText: conflict.otherText })) }
  }

  /**
   * Keep one version of a conflicting file.
   * @param request - Workspace identity, file, and the version to keep.
   * @returns whether the file had a conflict.
   */
  resolveConflict(request: WorkspaceResolveConflictRequest): Promise<WorkspaceResolveConflictValue> {
    return this.enqueue(async () => {
      this.requireWorkspace(request.workspaceId)
      const resolved = await this.ctx.workspaceRegistry.resolveConflict(WorkspaceId(request.workspaceId), request.path, request.keep)
      return { resolved }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(new RemoteError('gateway/bad-request', 'Workspace rename requires a non-blank title', {}))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title
          && workspaceVisible(this.ctx, candidate.isBuiltIn, candidate.owner))) {
          throw new RemoteError(
            'workspace/name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: this.view(workspace) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      this.requireWorkspace(request.workspaceId)
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    this.requireWorkspace(request.workspaceId)
    if (request.beforeWorkspaceId !== undefined) this.requireWorkspace(request.beforeWorkspaceId)
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return {
        workspaceIds: workspaceIds.filter((id) => {
          const workspace = this.ctx.workspaceRegistry.get(id)
          return workspace !== undefined && workspaceVisible(this.ctx, workspace.isBuiltIn, workspace.owner)
        }),
      }
    } catch (error) {
      // `insertBefore` is the one mutating verb that does not ride `enqueue`.
      const pinned = pinnedWorkspaceError(error)
      if (pinned !== undefined) throw pinned
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    this.requireSession(request.sessionId)
    if (request.beforeSessionId !== undefined) this.requireSession(request.beforeSessionId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw new RemoteError(
        'workspace/move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
        { cause: error },
      )
    }
    return { workspace: this.view(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    this.requireSession(request.sessionId)
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
    }
    return {
      archivedSessionIds: this.ctx.workspaceRegistry.archivedSessionIds
        .filter(id => workspaceSessionVisible(this.ctx, id)),
    }
  }

  /**
   * Remove one Session from the registry-global archive set.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  async unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    this.requireSession(request.sessionId)
    await this.ctx.workspaceRegistry.unarchiveSession(request.sessionId)
    return {
      archivedSessionIds: this.ctx.workspaceRegistry.archivedSessionIds
        .filter(id => workspaceSessionVisible(this.ctx, id)),
    }
  }

  /** Another account's workspace reads as absent. */
  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined || !workspaceVisible(this.ctx, workspace.isBuiltIn, workspace.owner)) {
      throw workspaceNotFound(workspaceId)
    }
    return workspace
  }

  /** Another account's session reads as absent. */
  private requireSession(sessionId: SessionId): void {
    if (!workspaceSessionVisible(this.ctx, sessionId)) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
  }

  /** The workspace as the acting caller sees it: only their own sessions. */
  private view(workspace: Workspace): ReturnType<typeof workspaceView> {
    return callerWorkspaceView(
      this.ctx,
      workspaceView(workspace, this.ctx.workspaceRegistry.fileStatus(workspace.id)),
      this.ctx.get('identityUsers')?.actingUser(),
    )
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail
      .then(operation)
      // The one funnel every mutating command shares, so the pinned-workspace
      // refusal becomes its typed wire failure once instead of at each verb.
      .catch((error: unknown) => { throw pinnedWorkspaceError(error) ?? error })
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

/**
 * Translate the registry's pinned-workspace refusal into its Remote failure.
 * @param error - the error a registry mutation raised.
 * @returns the mapped failure, or `undefined` when this is not that refusal.
 */
function pinnedWorkspaceError(error: unknown): RemoteError<'workspace/default-immutable'> | undefined {
  if (!(error instanceof WorkspaceDefaultImmutableError)) return undefined
  return new RemoteError(
    'workspace/default-immutable',
    `the built-in workspace cannot be ${error.operation === 'rename' ? 'renamed' : error.operation === 'delete' ? 'deleted' : 'moved'}`,
    { workspaceId: error.workspaceId, operation: error.operation },
  )
}

function workspaceNotFound(workspaceId: WorkspaceId): RemoteError<'workspace/not-found'> {
  return new RemoteError(
    'workspace/not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
