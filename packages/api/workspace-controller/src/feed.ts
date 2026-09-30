/** Reconnect-safe Workspace baseline and increment producer. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@aeven/deque'
import type { DomainChanged } from '@aeven/storage-domain'
import type { User } from '@aeven/identity-user'
import type { SessionId } from '@aeven/session'
import type { Workspace, WorkspaceRecord } from '@aeven/workspace'
import {
  workspaceDomainState,
  workspaceRecord,
  WorkspaceId,
} from '@aeven/workspace'
import type {
  WorkspaceBaseline,
  WorkspaceFollowFrame,
  WorkspaceView,
} from './types.ts'

/**
 * Project one authoritative Workspace entity into its Remote value.
 *
 * The domain expresses "no directory" as an absent (`undefined`) path, but a
 * Remote boundary carries JSON only, so absence crosses the wire as `null`.
 * This mapping is the single place that conversion happens.
 * @param workspace - authoritative registry entity.
 * @returns detached Workspace projection for Remote consumers.
 */
export function workspaceView(workspace: Workspace): WorkspaceView {
  return {
    workspaceId: workspace.id,
    isDefault: workspace.isDefault,
    kind: workspace.kind,
    path: workspace.path ?? null,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

/**
 * Project one durable record that arrived as a domain change.
 *
 * The built-in bit is not in the record — it lives in the domain global — so it
 * is decided by comparing the changed id against the registry's current answer
 * rather than by reading the changed value.
 * @param workspaceId - id the change names.
 * @param value - the changed record value.
 * @param defaultWorkspaceId - the registry's built-in id, when it has one.
 * @returns detached Workspace projection for Remote consumers.
 */
function changedWorkspaceView(
  workspaceId: string,
  value: unknown,
  defaultWorkspaceId: string | undefined,
): WorkspaceView {
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: WorkspaceId(workspaceId),
    isDefault: defaultWorkspaceId === workspaceId,
    kind: record.kind,
    path: record.path ?? null,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Whether a caller may see a workspace: the built-in one belongs to the
 * product and every account sees it, every other one only its owner.
 * @param ctx - Host context carrying the identity seam.
 * @param isDefault - whether the workspace is the built-in one.
 * @param owner - account id the workspace records.
 * @param caller - the caller captured at admission; defaults to the acting user.
 * @returns true when the caller may see and change the workspace.
 */
export function workspaceVisible(
  ctx: Context,
  isDefault: boolean,
  owner: string | undefined,
  caller: User | undefined = ctx.get('identityUsers')?.actingUser(),
): boolean {
  return isDefault || (ctx.get('identityUsers')?.mayAccess(owner, caller) ?? true)
}

/**
 * Whether a caller may see a session listed in a workspace.
 * @param ctx - Host context carrying the workspace registry and identity seam.
 * @param sessionId - the listed session.
 * @param caller - the caller captured at admission; defaults to the acting user.
 * @returns true when the caller owns the session, or nothing is authenticated.
 */
export function workspaceSessionVisible(
  ctx: Context,
  sessionId: SessionId,
  caller: User | undefined = ctx.get('identityUsers')?.actingUser(),
): boolean {
  return ctx.get('identityUsers')?.mayAccess(ctx.workspaceRegistry.sessionOwner(sessionId), caller) ?? true
}

/**
 * A workspace projection reduced to the sessions one caller owns.
 * @param ctx - Host context carrying the workspace registry and identity seam.
 * @param view - the full projection.
 * @param caller - the caller the projection is for.
 * @returns the projection listing only the caller's sessions.
 */
export function callerWorkspaceView(ctx: Context, view: WorkspaceView, caller: User | undefined): WorkspaceView {
  return { ...view, sessionIds: view.sessionIds.filter(id => workspaceSessionVisible(ctx, id, caller)) }
}

/** Owns Workspace domain observation and all active follow generations. */
export class WorkspaceFeed {
  private readonly followers = new Set<WorkspaceFollower>()
  private knownIds: Set<string>
  private order: readonly string[]
  private archived: readonly string[]

  /** @param ctx - Host context containing the authoritative Workspace registry. */
  constructor(private readonly ctx: Context) {
    const baseline = ctx.workspaceRegistry.list()
    this.knownIds = new Set(baseline.map(workspace => String(workspace.id)))
    this.order = baseline.map(workspace => String(workspace.id))
    this.archived = ctx.workspaceRegistry.archivedSessionIds.map(String)
    ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    }, 'workspace-controller.feed')
  }

  /**
   * Read the complete current projection for one caller synchronously.
   * @param caller - the user the projection is for; defaults to the acting user.
   * @returns the caller's active Workspaces and archived Session identities.
   */
  baseline(caller: User | undefined = this.ctx.get('identityUsers')?.actingUser()): WorkspaceBaseline {
    return {
      items: this.ctx.workspaceRegistry.list()
        .filter(workspace => workspaceVisible(this.ctx, workspace.isDefault, workspace.owner, caller))
        .map(workspace => callerWorkspaceView(this.ctx, workspaceView(workspace), caller)),
      archivedSessionIds: this.ctx.workspaceRegistry.archivedSessionIds
        .filter(id => workspaceSessionVisible(this.ctx, id, caller)),
    }
  }

  /**
   * Open one generation beginning with a complete baseline.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    signal.throwIfAborted()
    // Each follower sees only the workspaces and sessions its caller owns.
    const follower = new WorkspaceFollower(this.ctx.get('identityUsers')?.actingUser())
    this.followers.add(follower)
    try {
      yield { type: 'baseline', value: this.baseline(follower.caller) }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace') return
    if (change.table === '') {
      if (change.operation !== 'put') return
      const state = workspaceDomainState.parse(change.value)
      const nextOrder = state.workspaceIds.map(String)
      const orderChanged = !sameStrings(this.order, nextOrder)
      for (const id of state.workspaceIds) {
        if (this.knownIds.has(id)) continue
        const workspace = this.ctx.workspaceRegistry.get(id)
        if (workspace === undefined) {
          throw new Error(`committed Workspace registry references missing Workspace "${id}"`)
        }
        this.knownIds.add(id)
        this.publishUpsert(workspaceView(workspace), workspace.owner)
      }
      this.order = nextOrder
      if (orderChanged) {
        for (const follower of this.followers) {
          follower.push({
            type: 'order',
            workspaceIds: state.workspaceIds.filter((id) => {
              const workspace = this.ctx.workspaceRegistry.get(id)
              return workspace !== undefined
                && workspaceVisible(this.ctx, workspace.isDefault, workspace.owner, follower.caller)
            }),
          })
        }
      }
      const nextArchived = state.archivedSessionIds.map(String)
      if (!sameStrings(this.archived, nextArchived)) {
        this.archived = nextArchived
        for (const follower of this.followers) {
          follower.push({
            type: 'archived',
            archivedSessionIds: state.archivedSessionIds
              .filter(id => workspaceSessionVisible(this.ctx, id, follower.caller)),
          })
        }
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.knownIds.delete(change.key)) return
      this.publish({ type: 'remove', workspaceId: WorkspaceId(change.key) })
      return
    }
    if (!this.knownIds.has(change.key)) return
    // The registry's owner, not the stored field: a record written before
    // workspaces carried an owner takes the owner of its Sessions there.
    this.publishUpsert(
      changedWorkspaceView(change.key, change.value, this.ctx.workspaceRegistry.defaultWorkspaceId),
      this.ctx.workspaceRegistry.get(WorkspaceId(change.key))?.owner,
    )
  }

  private publishUpsert(view: WorkspaceView, owner: string | undefined): void {
    for (const follower of this.followers) {
      if (!workspaceVisible(this.ctx, view.isDefault, owner, follower.caller)) continue
      follower.push({ type: 'upsert', workspace: callerWorkspaceView(this.ctx, view, follower.caller) })
    }
  }

  private publish(frame: Exclude<WorkspaceFollowFrame, { readonly type: 'baseline' }>): void {
    for (const follower of this.followers) follower.push(frame)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

class WorkspaceFollower {
  /** @param caller - the user the stream was opened for. */
  constructor(readonly caller: User | undefined) {}

  private readonly frames = new Deque<WorkspaceFollowFrame>()
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: WorkspaceFollowFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.popFront()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        /* v8 ignore next -- one read owns the sole installed wait callback. */
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      /* v8 ignore next -- native signals and the private queue cannot change during this synchronous setup. */
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}
