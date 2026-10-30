/**
 * Service Definition for the version-control capability seam (`ctx.vcs`): a
 * provider registry and the checkout operations every consumer calls, so a
 * caller reads branch, changes, and history through one normalized report
 * instead of parsing an engine's terminal output.
 *
 * A provider reserves a branded id atomically: {@link Vcs.registerProvider}
 * validates and conflict-checks before mutating, so a rejected registration
 * publishes nothing, and its disposer withdraws the whole provider. Selection
 * asks each registered provider whether it owns the directory and never depends
 * on registration order for a directory only one provider accepts.
 *
 * Every operation resolves the repository first and runs against its root, so a
 * caller may pass any directory inside a checkout. Failures surface as
 * {@link VcsError} with a stable code rather than engine text to parse.
 * @module @aeven/vcs
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@aeven/llm'
import type { VcsProviderId } from './brand.ts'
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
  VcsRemoteRequest,
  VcsRemoteResult,
  VcsService,
  VcsStatus,
  VcsSwitchRequest,
  VcsSwitchResult,
} from './types.ts'

export type { VcsProviderId } from './brand.ts'
export type {
  VcsBranch,
  VcsChange,
  VcsChangeKind,
  VcsCommit,
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
  VcsRemoteRequest,
  VcsRemoteResult,
  VcsService,
  VcsStatus,
  VcsSwitchRequest,
  VcsSwitchResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vcs: VcsService
  }
}

/**
 * Structured version-control failure. Extends {@link HarnessError} with a stable
 * `code` callers route on instead of parsing the message: `VCS_INVALID_PROVIDER`,
 * `VCS_CONFLICT`, `VCS_UNAVAILABLE`, `VCS_NOT_A_REPOSITORY`, `VCS_DIRTY_WORKTREE`,
 * `VCS_INVALID_REQUEST`, `VCS_COMMAND_FAILED`, `VCS_CONFLICT_STATE`, `VCS_DISPOSED`.
 */
export class VcsError extends HarnessError {}

/** `ctx.vcs`. Holds the registered providers; each owns one engine's operations. */
export class Vcs extends Service implements VcsService {
  private readonly providers = new Map<VcsProviderId, VcsProvider>()

  constructor(ctx: Context) {
    super(ctx, 'vcs')
  }

  registerProvider(provider: VcsProvider): () => void {
    // Validate and conflict-check everything BEFORE any mutation: a rejected
    // registration must publish nothing.
    if (provider.id.trim() === '') {
      throw new VcsError('a VCS provider id must be a non-empty string', 'VCS_INVALID_PROVIDER')
    }
    if (this.providers.has(provider.id)) {
      throw new VcsError(`a VCS provider with id "${provider.id}" is already registered`, 'VCS_CONFLICT')
    }

    const dispose = this.ctx.effect(function* (this: Vcs) {
      this.providers.set(provider.id, provider)
      yield () => {
        this.providers.delete(provider.id)
      }
    }.bind(this), 'vcs.registerProvider()')
    // ctx.effect's disposer resolves after the withdrawal; the provider API is a
    // synchronous fire-and-forget disposer.
    return () => void dispose()
  }

  async repository(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ provider: VcsProvider; repositoryRoot: string }> {
    if (this.providers.size === 0) {
      throw new VcsError('no VCS provider is registered', 'VCS_UNAVAILABLE')
    }
    for (const provider of this.providers.values()) {
      const repositoryRoot = await provider.detect(cwd, signal)
      if (repositoryRoot !== null) return { provider, repositoryRoot }
    }
    throw new VcsError(`${cwd} is not inside a repository any VCS provider handles`, 'VCS_NOT_A_REPOSITORY')
  }

  async status(cwd: string, signal?: AbortSignal): Promise<VcsStatus> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.status(repositoryRoot, signal)
  }

  async diff(cwd: string, request: VcsDiffRequest, signal?: AbortSignal): Promise<VcsDiff> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.diff(repositoryRoot, request, signal)
  }

  async log(cwd: string, request: VcsLogRequest, signal?: AbortSignal): Promise<VcsLog> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.log(repositoryRoot, request, signal)
  }

  async stage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    await provider.stage(repositoryRoot, paths, signal)
  }

  async unstage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    await provider.unstage(repositoryRoot, paths, signal)
  }

  async commit(cwd: string, request: VcsCommitRequest, signal?: AbortSignal): Promise<VcsCommitResult> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.commit(repositoryRoot, request, signal)
  }

  async listBranches(cwd: string, signal?: AbortSignal): Promise<readonly VcsBranch[]> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.listBranches(repositoryRoot, signal)
  }

  async switchBranch(cwd: string, request: VcsSwitchRequest, signal?: AbortSignal): Promise<VcsSwitchResult> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.switchBranch(repositoryRoot, request, signal)
  }

  async deleteBranch(cwd: string, request: VcsDeleteBranchRequest, signal?: AbortSignal): Promise<void> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    await provider.deleteBranch(repositoryRoot, request, signal)
  }

  async remote(cwd: string, request: VcsRemoteRequest, signal?: AbortSignal): Promise<VcsRemoteResult> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.remote(repositoryRoot, request, signal)
  }

  async merge(cwd: string, request: VcsMergeRequest, signal?: AbortSignal): Promise<VcsMergeResult> {
    const { provider, repositoryRoot } = await this.repository(cwd, signal)
    return provider.merge(repositoryRoot, request, signal)
  }
}

export default Vcs
