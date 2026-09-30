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
import type { SessionId } from '@aeven/session'
import { callerWorkspaceView, workspaceSessionVisible, workspaceView, workspaceVisible } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        // The caller owns what they register; another account adding the same
        // directory gets a workspace of its own.
        const owner = this.ctx.get('identityUsers')?.actingUser()?.id
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
          && workspaceVisible(this.ctx, candidate.isDefault, candidate.owner))) {
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
          return workspace !== undefined && workspaceVisible(this.ctx, workspace.isDefault, workspace.owner)
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

  /** Another account's workspace reads as absent. */
  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined || !workspaceVisible(this.ctx, workspace.isDefault, workspace.owner)) {
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
    return callerWorkspaceView(this.ctx, workspaceView(workspace), this.ctx.get('identityUsers')?.actingUser())
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
