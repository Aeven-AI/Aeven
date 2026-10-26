/** Types for the worktree capability. */

import type { Branded } from '@aeven/brand'

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

/** What creating a worktree reports back. */
export interface CreatedWorktree {
  /** Absolute path of the new checkout, which the session now works in. */
  readonly path: WorktreePath
  /** Branch the checkout was created on. */
  readonly branch: WorktreeBranch
  /** Commit the branch started from. */
  readonly baseCommit: string
  /** Root of the repository the checkout was linked to. */
  readonly repositoryRoot: string
}
