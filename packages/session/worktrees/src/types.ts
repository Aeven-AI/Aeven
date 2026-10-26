/** Types for the worktree capability. */

import type { Branded } from '@aeven/brand'
import type { SessionId } from '@aeven/session'

/** A branch name a worktree checkout is created on. */
export type WorktreeBranch = Branded<'WorktreeBranch'>

/** An absolute path to a worktree checkout. */
export type WorktreePath = Branded<'WorktreePath'>

/** One registered worktree as `git worktree list --porcelain` reports it. */
export interface WorktreeInfo {
  /** Absolute path of the checkout. */
  readonly path: WorktreePath
  /** Full `refs/heads/...` reference, or `undefined` for a detached checkout. */
  readonly ref: string | undefined
  /** Commit the checkout stands on. */
  readonly head: string
  /** Whether this is the main working tree rather than a linked one. */
  readonly main: boolean
  /** Whether git reports the checkout as prunable. */
  readonly prunable: boolean
}

/** What a caller may choose when creating a worktree. */
export interface CreateWorktreeRequest {
  /** Checkout name; the branch is this name under the configured prefix, and the directory is this name. Omit for a generated one. */
  readonly name?: string
  /** Commit or branch the new worktree starts from; defaults to `HEAD` of the session's repository. */
  readonly from?: string
}

/** A created worktree checkout, as logged and reported. */
export interface CreatedWorktree {
  /** Absolute path of the new checkout. */
  readonly path: WorktreePath
  /** Branch the checkout was created on. */
  readonly branch: WorktreeBranch
  /** Commit the branch started from: the requested revision, or a snapshot commit of the delegating agent's working tree. */
  readonly baseCommit: string
  /** Root of the repository's main working tree. */
  readonly repositoryRoot: string
  /** Outcome of the configured dependency setup, or `null` when no setup entry matched the checkout. */
  readonly setup: string | null
}

/** A worktree removed through the service. */
export interface RemovedWorktree {
  /** Absolute path of the removed checkout. */
  readonly path: WorktreePath
  /** Branch the checkout was on, or `undefined` for a detached checkout. */
  readonly branch: WorktreeBranch | undefined
  /** Whether the branch was deleted with it. */
  readonly branchDeleted: boolean
  /** Directory the session works in afterwards. */
  readonly cwd: string | undefined
}

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /**
     * This session moved into a worktree checkout: log-only, non-surface. The
     * paired `session/cwd` carries the directory change; this event carries
     * the branch facts the model is told about the checkout.
     * @param worktree - the checkout the session now works in.
     */
    'worktree/entered': { worktree: CreatedWorktree }
    /**
     * This session created a worktree checkout for a delegated child agent:
     * log-only, non-surface. The child's own log records `worktree/entered`.
     * @param worktree - the checkout created for the child.
     * @param child - the child session the checkout belongs to.
     */
    'worktree/delegated': { worktree: CreatedWorktree; child: SessionId }
    /**
     * This session removed a worktree checkout: log-only, non-surface. Drops
     * the checkout from the session's entered and delegated worktrees.
     * @param path - absolute path of the removed checkout.
     */
    'worktree/removed': { path: string }
  }
}

/** Host state of the `worktrees` projection: the checkout this session works in and those it created for children. */
export interface WorktreesUnitState {
  /** The checkout this session last entered and has not removed, or null. */
  entered: CreatedWorktree | null
  /** Checkouts this session created for delegated children and has not removed. */
  delegated: { worktree: CreatedWorktree; child: SessionId }[]
}

declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Worktree checkouts folded from `worktree/*` events. */
    worktrees: WorktreesUnitState
  }
}
