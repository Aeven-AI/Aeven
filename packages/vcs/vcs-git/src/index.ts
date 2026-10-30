/**
 * Git provider for `ctx.vcs`: repository detection and the seam's checkout
 * operations, implemented with git commands through `ctx.subprocess`.
 *
 * Read-only reports (detection, status, diff, log, dirty checks) run with
 * repository hooks and fsmonitor disabled. History and checkout changes —
 * staging, committing, branch movement, fetch, push, merge — run the
 * repository's own configuration, because there the hooks are the policy the
 * user chose. Diffs and paths are returned bounded, and a cut result says so
 * instead of looking complete.
 *
 * Namespace plugin (named exports, no default export). Registration is
 * effect-scoped: disposal withdraws the provider from `ctx.vcs`.
 * @module @aeven/vcs-git
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { VcsError } from '@aeven/vcs'
import type {
  VcsBranch,
  VcsCommitRequest,
  VcsCommitResult,
  VcsDeleteBranchRequest,
  VcsDiff,
  VcsDiffRequest,
  VcsLog,
  VcsLogRequest,
  VcsMergeRequest,
  VcsMergeResult,
  VcsProvider,
  VcsProviderId,
  VcsRemoteRequest,
  VcsRemoteResult,
  VcsStatus,
  VcsSwitchRequest,
  VcsSwitchResult,
} from '@aeven/vcs'
import { commandFailure, runGit } from './git.ts'
import type { GitLimits, GitRunResult } from './git.ts'
import { parseBranches, parseLog, parsePaths, parseStatus } from './parse.ts'

export { commandFailure, runGit } from './git.ts'
export type { GitLimits, GitRunResult } from './git.ts'
export { parseBranches, parseLog, parsePaths, parseStatus } from './parse.ts'
export type { ParsedStatus } from './parse.ts'

/** Cordis plugin name. */
export const name = 'vcs-git'

/** Services this plugin registers against and executes through. */
export const inject = ['subprocess', 'vcs']

/** Field separator for the formats this provider asks git for. */
const UNIT_SEPARATOR = '\u001f'

/** Record separator for the log format this provider asks git for. */
const RECORD_SEPARATOR = '\u001e'

/** Deployment bounds and defaults for the git provider. */
export interface Config {
  /** Grace a git child gets between termination signals. */
  graceMs: number
  /** Largest output tail retained for one git call. */
  outputMaxBytes: number
  /** Largest diff returned to a caller; a longer diff is cut and marked truncated. */
  diffMaxBytes: number
  /** Commit count reported when a request omits one. */
  logLimit: number
  /** Largest commit count a request may ask for. */
  logLimitMax: number
  /** Largest number of changed paths one status report keeps. */
  statusMaxEntries: number
}

/** Validation and defaults for {@link Config}. */
export const Config: z<Config> = z.object({
  graceMs: z.number().min(100).max(60_000).default(5_000),
  outputMaxBytes: z.number().min(65_536).max(8_000_000).default(1_000_000),
  diffMaxBytes: z.number().min(1_024).max(4_000_000).default(200_000),
  logLimit: z.number().min(1).max(200).default(20),
  logLimitMax: z.number().min(1).max(500).default(100),
  statusMaxEntries: z.number().min(1).max(100_000).default(2_000),
})

/**
 * Reject a path list that names nothing, so a caller cannot stage or unstage an
 * implicit whole tree by accident.
 * @param paths - the requested repository-relative paths.
 * @param operation - the operation name used in the failure message.
 */
function requirePaths(paths: readonly string[], operation: string): void {
  if (paths.length === 0) {
    throw new VcsError(`${operation} needs at least one repository-relative path`, 'VCS_INVALID_REQUEST')
  }
  if (paths.some(path => path.trim() === '')) {
    throw new VcsError(`${operation} received an empty path`, 'VCS_INVALID_REQUEST')
  }
}

/**
 * Build the provider bound to this plugin instance's context and configuration.
 * @param ctx - the plugin context supplying `subprocess`.
 * @param config - the resolved plugin configuration.
 * @returns the provider to register with `ctx.vcs`.
 */
function createProvider(ctx: Context, config: Config): VcsProvider {
  const limits: GitLimits = {
    graceMs: config.graceMs,
    stdoutMaxBytes: config.outputMaxBytes,
    stderrMaxBytes: Math.min(config.outputMaxBytes, 64_000),
  }

  /** Run a read-only report command and fail with git's own reason. */
  const report = async (
    operation: string,
    args: readonly string[],
    cwd: string,
    signal: AbortSignal | undefined,
  ): Promise<GitRunResult> => {
    const result = await runGit(ctx, args, cwd, signal, limits, true)
    if (result.exitCode !== 0) throw commandFailure(operation, args, result)
    return result
  }

  /** Run a command that changes history or the checkout, failing with git's reason. */
  const mutate = async (
    operation: string,
    args: readonly string[],
    cwd: string,
    signal: AbortSignal | undefined,
  ): Promise<GitRunResult> => {
    const result = await runGit(ctx, args, cwd, signal, limits, false)
    if (result.exitCode !== 0) throw commandFailure(operation, args, result)
    return result
  }

  /** Read one commit by revision. */
  const readCommit = async (
    cwd: string,
    revision: string,
    signal: AbortSignal | undefined,
  ): Promise<VcsCommitResult> => {
    const result = await report(
      'commit',
      ['log', '-1', `--format=%H${UNIT_SEPARATOR}%h${UNIT_SEPARATOR}%an${UNIT_SEPARATOR}%aI${UNIT_SEPARATOR}%s${RECORD_SEPARATOR}`, revision, '--'],
      cwd,
      signal,
    )
    const commit = parseLog(result.stdout)[0]
    if (commit === undefined) {
      throw new VcsError(`git reported no commit for ${revision}`, 'VCS_COMMAND_FAILED')
    }
    return { commit }
  }

  return {
    id: 'git' as VcsProviderId,

    async detect(cwd, signal) {
      const result = await runGit(ctx, ['rev-parse', '--show-toplevel'], cwd, signal, limits, true)
      if (result.exitCode !== 0) return null
      const root = result.stdout.trim()
      return root === '' ? null : root
    },

    async status(cwd, signal): Promise<VcsStatus> {
      const result = await report(
        'status',
        ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=no'],
        cwd,
        signal,
      )
      const parsed = parseStatus(result.stdout, config.statusMaxEntries)
      return { repositoryRoot: cwd, ...parsed }
    },

    async diff(cwd, request: VcsDiffRequest, signal): Promise<VcsDiff> {
      const args = ['diff', '--no-color', '--no-ext-diff', '--find-renames']
      if (request.range !== undefined) args.push(request.range)
      else if (request.staged === true) args.push('--cached')
      if (request.path !== undefined) args.push('--', request.path)
      const result = await report('diff', args, cwd, signal)
      const text = result.stdout
      if (text.length > config.diffMaxBytes) {
        return { text: text.slice(0, config.diffMaxBytes), truncated: true }
      }
      return { text, truncated: result.stdoutTruncated }
    },

    async log(cwd, request: VcsLogRequest, signal): Promise<VcsLog> {
      const requested = request.limit ?? config.logLimit
      const limit = Math.max(1, Math.min(requested, config.logLimitMax))
      const args = [
        'log',
        `--max-count=${String(limit)}`,
        `--format=%H${UNIT_SEPARATOR}%h${UNIT_SEPARATOR}%an${UNIT_SEPARATOR}%aI${UNIT_SEPARATOR}%s${RECORD_SEPARATOR}`,
      ]
      const result = await runGit(ctx, args, cwd, signal, limits, true)
      if (result.exitCode !== 0) {
        // A repository without commits has no history to report.
        if (/does not have any commits yet|unknown revision|bad default revision/i.test(result.output)) {
          return { commits: [] }
        }
        throw commandFailure('log', args, result)
      }
      return { commits: parseLog(result.stdout) }
    },

    async stage(cwd, paths, signal) {
      requirePaths(paths, 'stage')
      await mutate('stage', ['add', '--', ...paths], cwd, signal)
    },

    async unstage(cwd, paths, signal) {
      requirePaths(paths, 'unstage')
      const result = await runGit(ctx, ['restore', '--staged', '--', ...paths], cwd, signal, limits, false)
      if (result.exitCode === 0) return
      // A repository with no commit has no HEAD to restore from; drop the index
      // entries instead, which is the same outcome for an empty history.
      if (/could not resolve HEAD|ambiguous argument 'HEAD'/i.test(result.output)) {
        const fallback = await runGit(
          ctx,
          ['rm', '--cached', '--quiet', '--', ...paths],
          cwd,
          signal,
          limits,
          false,
        )
        if (fallback.exitCode === 0) return
        throw commandFailure('unstage', ['rm', '--cached'], fallback)
      }
      throw commandFailure('unstage', ['restore', '--staged'], result)
    },

    async commit(cwd, request: VcsCommitRequest, signal): Promise<VcsCommitResult> {
      if (request.message.trim() === '') {
        throw new VcsError('a commit needs a non-empty message', 'VCS_INVALID_REQUEST')
      }
      if (request.paths !== undefined && request.paths.length > 0) {
        requirePaths(request.paths, 'commit')
        await mutate('commit', ['add', '--', ...request.paths], cwd, signal)
      }
      const result = await runGit(
        ctx,
        ['commit', `--message=${request.message}`],
        cwd,
        signal,
        limits,
        false,
      )
      if (result.exitCode !== 0) {
        if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(result.output)) {
          throw new VcsError('there is nothing to commit in this checkout', 'VCS_INVALID_REQUEST')
        }
        throw commandFailure('commit', ['commit'], result)
      }
      return readCommit(cwd, 'HEAD', signal)
    },

    async listBranches(cwd, signal): Promise<readonly VcsBranch[]> {
      const result = await report(
        'listBranches',
        ['for-each-ref', '--format=%(refname:short)%09%(HEAD)', 'refs/heads'],
        cwd,
        signal,
      )
      return parseBranches(result.stdout)
    },

    async switchBranch(cwd, request: VcsSwitchRequest, signal): Promise<VcsSwitchResult> {
      const branch = request.name.trim()
      if (branch === '') {
        throw new VcsError('a branch switch needs a branch name', 'VCS_INVALID_REQUEST')
      }
      if (request.allowDirty !== true) {
        const dirty = await report(
          'switchBranch',
          ['status', '--porcelain', '--untracked-files=no'],
          cwd,
          signal,
        )
        const count = dirty.stdout.split('\n').filter(line => line.trim() !== '').length
        if (count > 0) {
          throw new VcsError(
            `${String(count)} path${count === 1 ? '' : 's'} have uncommitted changes; commit or stash them, or pass allowDirty`,
            'VCS_DIRTY_WORKTREE',
          )
        }
      }
      const created = request.create === true
      const args =
        created && request.from !== undefined
          ? ['switch', '--create', branch, request.from]
          : created
            ? ['switch', '--create', branch]
            : ['switch', branch]
      await mutate('switchBranch', args, cwd, signal)
      return { branch, created }
    },

    async deleteBranch(cwd, request: VcsDeleteBranchRequest, signal): Promise<void> {
      const branch = request.name.trim()
      if (branch === '') {
        throw new VcsError('a branch delete needs a branch name', 'VCS_INVALID_REQUEST')
      }
      await mutate('deleteBranch', ['branch', request.force === true ? '-D' : '-d', '--', branch], cwd, signal)
    },

    async remote(cwd, request: VcsRemoteRequest, signal): Promise<VcsRemoteResult> {
      const args =
        request.operation === 'fetch'
          ? ['fetch', ...(request.remote === undefined ? [] : [request.remote])]
          : [
            'push',
            ...(request.remote === undefined ? [] : [request.remote]),
            ...(request.branch === undefined ? [] : [request.branch]),
          ]
      const result = await mutate(request.operation, args, cwd, signal)
      return { output: result.output }
    },

    async merge(cwd, request: VcsMergeRequest, signal): Promise<VcsMergeResult> {
      if (request.abort === true) {
        const aborted = await mutate('merge', ['merge', '--abort'], cwd, signal)
        return { outcome: 'aborted', conflicts: [], output: aborted.output }
      }
      const ref = request.ref.trim()
      if (ref === '') {
        throw new VcsError('a merge needs a revision', 'VCS_INVALID_REQUEST')
      }
      const result = await runGit(ctx, ['merge', '--no-edit', ref], cwd, signal, limits, false)
      if (result.exitCode === 0) {
        const outcome = /already up[- ]to[- ]date/i.test(`${result.stdout}${result.stderr}`)
          ? 'up-to-date'
          : 'merged'
        return { outcome, conflicts: [], output: result.output }
      }
      const unmerged = await runGit(
        ctx,
        ['diff', '--name-only', '--diff-filter=U', '-z'],
        cwd,
        signal,
        limits,
        true,
      )
      const conflicts = unmerged.exitCode === 0 ? parsePaths(unmerged.stdout) : []
      if (conflicts.length > 0) {
        return { outcome: 'conflicted', conflicts, output: result.output }
      }
      throw commandFailure('merge', ['merge', '--no-edit', ref], result)
    },
  }
}

/**
 * Register the git provider with `ctx.vcs`.
 * @param ctx - the plugin context carrying `subprocess` and `vcs`.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = createProvider(ctx, config)
  ctx.effect(function* () {
    yield ctx.vcs.registerProvider(provider)
  }, 'vcs-git.registerProvider()')
}
