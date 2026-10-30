/**
 * Normalized values of the version-control seam: reports and requests that every
 * provider produces and accepts, independent of the engine behind them.
 *
 * Paths are repository-relative, POSIX-style, because a report crosses to a tool
 * result and a model reads it on any platform. A caller supplies its checkout
 * directory; the provider resolves the repository and returns its root, so
 * operations work from any subdirectory of a checkout.
 * @module @aeven/vcs/types
 */

import type { VcsProviderId } from './brand.ts'

/** How one side of a checkout reports a path's change. */
export type VcsChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'untracked'
  | 'conflicted'
  /** A status code the provider does not classify; callers must not read it as clean. */
  | 'unknown'

/** One changed path, with each side of the checkout reported separately. */
export interface VcsChange {
  /** Repository-relative path, POSIX separators. */
  readonly path: string
  /** Staged change in the index, or null when the index matches the revision for this path. */
  readonly staged: VcsChangeKind | null
  /** Unstaged change in the working tree, or null when the file matches the index. */
  readonly worktree: VcsChangeKind | null
}

/** Branch, upstream, and changed-path report for one checkout. */
export interface VcsStatus {
  /** Absolute path of the checkout that contains the queried directory. */
  readonly repositoryRoot: string
  /** Checked-out branch, or null at a detached HEAD. */
  readonly branch: string | null
  /** Remote-tracking ref this branch follows, or null without an upstream. */
  readonly upstream: string | null
  /** Commits ahead of the upstream; 0 without one. */
  readonly ahead: number
  /** Commits behind the upstream; 0 without one. */
  readonly behind: number
  /** Changed paths, ordered by path. */
  readonly changes: readonly VcsChange[]
  /** True when the checkout holds more changed paths than the provider returned. */
  readonly truncated: boolean
}

/** What to compare for a diff. */
export interface VcsDiffRequest {
  /** Restrict the diff to one repository-relative path. */
  readonly path?: string | undefined
  /** Compare the index with HEAD instead of the working tree with the index. */
  readonly staged?: boolean | undefined
  /** Compare two revisions, e.g. `main..HEAD`; takes precedence over `staged`. */
  readonly range?: string | undefined
}

/** Unified diff text, bounded by the provider's configured size. */
export interface VcsDiff {
  readonly text: string
  /** True when the diff exceeded the provider's bound and was cut. */
  readonly truncated: boolean
}

/** One recorded commit, as a log entry. */
export interface VcsCommit {
  /** Full commit hash. */
  readonly hash: string
  /** Abbreviated hash for display. */
  readonly shortHash: string
  /** Author name as recorded. */
  readonly author: string
  /** Author date, ISO 8601. */
  readonly date: string
  /** First line of the commit message. */
  readonly subject: string
}

/** How much history to report. */
export interface VcsLogRequest {
  /** Number of commits, capped by the provider's configured maximum. */
  readonly limit?: number | undefined
}

/** Recent commits, newest first. */
export interface VcsLog {
  readonly commits: readonly VcsCommit[]
}

/** What to commit. */
export interface VcsCommitRequest {
  /** Commit message; providers reject an empty one. */
  readonly message: string
  /** Repository-relative paths to stage first; omit to commit the index as it stands. */
  readonly paths?: readonly string[] | undefined
}

/** The commit a request created. */
export interface VcsCommitResult {
  readonly commit: VcsCommit
}

/** One local branch. */
export interface VcsBranch {
  readonly name: string
  readonly current: boolean
}

/** What branch operation to perform. */
export interface VcsSwitchRequest {
  readonly name: string
  /** Create the branch before switching to it. */
  readonly create?: boolean | undefined
  /** Revision the created branch starts from; defaults to HEAD. */
  readonly from?: string | undefined
  /** Switch despite uncommitted changes; the provider still refuses when Git would carry them across. */
  readonly allowDirty?: boolean | undefined
}

/** The branch now checked out. */
export interface VcsSwitchResult {
  readonly branch: string
  readonly created: boolean
}

/** Which branch to delete. */
export interface VcsDeleteBranchRequest {
  readonly name: string
  /** Delete even when the branch is not merged; the default refuses, as `git branch -d` does. */
  readonly force?: boolean | undefined
}

/** Which remote operation to run. */
export interface VcsRemoteRequest {
  readonly operation: 'fetch' | 'push'
  /** Remote name; the provider uses the branch's own remote when omitted. */
  readonly remote?: string | undefined
  /** Branch to push; the provider uses the checked-out branch when omitted. */
  readonly branch?: string | undefined
}

/** Output a remote operation produced, for the caller to read. */
export interface VcsRemoteResult {
  readonly output: string
}

/** What to merge. */
export interface VcsMergeRequest {
  /** Revision to merge into the checked-out branch. */
  readonly ref: string
  /** Abort an in-progress merge instead of starting one. */
  readonly abort?: boolean | undefined
}

/** How a merge ended. */
export interface VcsMergeResult {
  readonly outcome: 'merged' | 'conflicted' | 'up-to-date' | 'aborted'
  /** Repository-relative paths left with conflicts; empty unless `outcome` is `conflicted`. */
  readonly conflicts: readonly string[]
  /** Engine output, trimmed, for the caller to quote. */
  readonly output: string
}

/**
 * The checkout operations every provider implements and every consumer calls.
 * A `cwd` is always a directory a caller chose: an implementation resolves the
 * repository itself rather than assuming the root.
 */
export interface VcsOperations {
  /**
   * Report the checkout's branch, upstream, and changed paths.
   * @param cwd - any directory inside a checkout.
   * @param signal - cancels the engine call.
   * @returns the normalized status report.
   */
  status(cwd: string, signal?: AbortSignal): Promise<VcsStatus>

  /**
   * Render a unified diff of the requested comparison.
   * @param cwd - any directory inside a checkout.
   * @param request - what to compare.
   * @param signal - cancels the engine call.
   * @returns the diff text and whether it was cut at the provider's bound.
   */
  diff(cwd: string, request: VcsDiffRequest, signal?: AbortSignal): Promise<VcsDiff>

  /**
   * List recent commits.
   * @param cwd - any directory inside a checkout.
   * @param request - how many commits to report.
   * @param signal - cancels the engine call.
   * @returns commits, newest first.
   */
  log(cwd: string, request: VcsLogRequest, signal?: AbortSignal): Promise<VcsLog>

  /**
   * Stage repository-relative paths.
   * @param cwd - any directory inside a checkout.
   * @param paths - repository-relative paths; an empty list is a caller error.
   * @param signal - cancels the engine call.
   */
  stage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<void>

  /**
   * Remove paths from the index, leaving the working tree untouched.
   * @param cwd - any directory inside a checkout.
   * @param paths - repository-relative paths; an empty list is a caller error.
   * @param signal - cancels the engine call.
   */
  unstage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<void>

  /**
   * Commit the index, after staging `request.paths` when they are given.
   * @param cwd - any directory inside a checkout.
   * @param request - the message and optional paths to stage first.
   * @param signal - cancels the engine call.
   * @returns the created commit.
   */
  commit(cwd: string, request: VcsCommitRequest, signal?: AbortSignal): Promise<VcsCommitResult>

  /**
   * List local branches.
   * @param cwd - any directory inside a checkout.
   * @param signal - cancels the engine call.
   * @returns branches in engine order, the current one flagged.
   */
  listBranches(cwd: string, signal?: AbortSignal): Promise<readonly VcsBranch[]>

  /**
   * Create and/or check out a branch.
   * @param cwd - any directory inside a checkout.
   * @param request - the branch, whether to create it, and its start point.
   * @param signal - cancels the engine call.
   * @returns the branch now checked out.
   */
  switchBranch(cwd: string, request: VcsSwitchRequest, signal?: AbortSignal): Promise<VcsSwitchResult>

  /**
   * Delete a local branch.
   * @param cwd - any directory inside a checkout.
   * @param request - the branch and whether an unmerged branch may go.
   * @param signal - cancels the engine call.
   */
  deleteBranch(cwd: string, request: VcsDeleteBranchRequest, signal?: AbortSignal): Promise<void>

  /**
   * Fetch from or push to a remote.
   * @param cwd - any directory inside a checkout.
   * @param request - the remote operation and its targets.
   * @param signal - cancels the engine call.
   * @returns the engine's output for the caller to read.
   */
  remote(cwd: string, request: VcsRemoteRequest, signal?: AbortSignal): Promise<VcsRemoteResult>

  /**
   * Merge a revision into the checked-out branch, or abort a merge in progress.
   * @param cwd - any directory inside a checkout.
   * @param request - the revision, or the abort flag.
   * @param signal - cancels the engine call.
   * @returns the outcome and any conflicted paths.
   */
  merge(cwd: string, request: VcsMergeRequest, signal?: AbortSignal): Promise<VcsMergeResult>
}

/**
 * One version-control implementation. A provider reports its own failures as
 * {@link VcsError} with a stable code.
 */
export interface VcsProvider extends VcsOperations {
  /** Id this provider reserves at registration. */
  readonly id: VcsProviderId

  /**
   * Resolve the repository a directory belongs to.
   * @param cwd - any directory inside a checkout.
   * @param signal - cancels the engine call.
   * @returns the absolute repository root, or null when `cwd` is not in one.
   */
  detect(cwd: string, signal?: AbortSignal): Promise<string | null>
}

/**
 * `ctx.vcs`: the checkout operations over whichever provider handles the
 * directory, plus the registration that supplies them.
 */
export interface VcsService extends VcsOperations {
  /**
   * Reserve a provider id and the operations it implements.
   * @param provider - the implementation to publish.
   * @returns the disposer that withdraws it.
   */
  registerProvider(provider: VcsProvider): () => void

  /**
   * Select the provider that handles a directory and resolve its repository.
   * @param cwd - any directory inside a checkout.
   * @param signal - cancels detection.
   * @returns the provider and the absolute repository root.
   */
  repository(cwd: string, signal?: AbortSignal): Promise<{ provider: VcsProvider; repositoryRoot: string }>
}
