/**
 * Service Definition for the `ctx.shell` capability seam, covering foreground commands and background process
 * handles. Job ids, ownership, polling, and notices belong to
 * `@aeven/jobs`, keeping executors independent of sessions.
 * @module @aeven/shell
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@aeven/sandbox'
import type { ShellDetachedRun, ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunOutcome, ShellRunResult } from './types.ts'

/**
 * Settings namespace of this capability, owned here rather than by either
 * executor family because it names the capability, not an implementation: a
 * host composes exactly one provider of `ctx.shell` (the win32 layer swaps the
 * POSIX rows for the pwsh ones, and mounting both fails loud on a duplicate
 * service registration), so the providers share one namespace without ever
 * registering it twice, and a settings document carried between platforms
 * keeps resolving on both.
 */
export const SHELL_SETTINGS_NAMESPACE = 'shell'

export { AVN_ENV_PREFIX } from './types.ts'
export type {
  ShellDetachedRun,
  ShellExecRequest,
  ShellExecSpec,
  ShellProcess,
  ShellProcessRead,
  ShellProcessStatus,
  ShellRunOutcome,
  ShellRunResult,
  ShellSandboxInfo,
  CollectedOutput,
  AvnEnvironment,
  AvnEnvironmentKey,
} from './types.ts'
export { parseExitStatus } from './render.ts'
export type { ParsedExitStatus } from './render.ts'

/**
 * Narrow a {@link ShellRunOutcome} to the handed-back handle case.
 * @param outcome - the value `ctx.shell.run` settled with.
 * @returns true when the command outlived its detach threshold and still runs.
 */
export function isDetachedRun(outcome: ShellRunOutcome): outcome is ShellDetachedRun {
  return 'detached' in outcome
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shell: ShellExecutor
  }
}

/**
 * Abstract bash execution service. Subclass, implement the abstract methods,
 * and load the subclass as a plugin — it registers as `ctx.shell` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - {@link run} rejects only for infrastructure failures. Nonzero exits,
 *   timeout kills, and abort kills resolve with a {@link ShellRunResult}.
 * - {@link run} always waits and ignores `detachAfterMs`; {@link runDetachable}
 *   honours it and hands back a {@link ShellDetachedRun} when the command
 *   outlives it. The command keeps running: the caller owns the handle, no
 *   timeout applies after the handoff, and output produced before it stays
 *   readable from byte 0. A timeout or abort that comes first still kills the
 *   command and settles normally.
 * - {@link start} returns immediately; no timeout applies to background
 *   processes. `done` settles at process close and never rejects; spawn
 *   failures settle as `killed` with the error on stderr.
 * - {@link ShellProcess.readOutput} is incremental: consecutive reads never
 *   repeat output. Lossy reads report truncation and available spill files.
 * - A still-running background process is stopped and awaited when its
 *   owning composition tears down. With the subprocess seam that
 *   boundary is `ctx.subprocess` disposal, so a background process survives
 *   an executor-only reload.
 */
export abstract class ShellExecutor extends Service {
  constructor(ctx: Context) {
    super(ctx, 'shell')
  }

  /**
   * The sandbox mode this executor applies by default, or `undefined` when it
   * does not sandbox commands.
   * @returns the configured default sandbox mode, when supported.
   */
  get sandboxMode(): SandboxMode | undefined {
    return undefined
  }

  /**
   * Apply implementation-owned defaults and caps to a request before execution.
   * @param request - the caller's request; omitted fields get this
   *   implementation's defaults, capped fields are clamped.
   * @returns the fully-specified spec to hand to {@link run}/{@link start}.
   */
  abstract resolve(request: ShellExecRequest): ShellExecSpec

  /**
   * Run a command in the foreground and wait for it; resolves when it finishes.
   * The spec's `detachAfterMs` is ignored — only {@link runDetachable} honours it.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the outcome; nonzero exits, timeout kills, and abort kills
   *   resolve with a descriptive result rather than reject.
   */
  abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

  /**
   * Run a command in the foreground, honouring the spec's `detachAfterMs`: a
   * command that outlives it resolves with a live handle the caller owns
   * instead of settling. The default provider behaviour waits, exactly like
   * {@link run}, so an executor that cannot hand work back needs no override.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the settled result, or a {@link ShellDetachedRun} when the
   *   threshold elapsed first.
   */
  async runDetachable(spec: ShellExecSpec): Promise<ShellRunOutcome> {
    return await this.run({ ...spec, detachAfterMs: undefined })
  }

  /**
   * Start a background process and return its handle immediately.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the live process handle (reads, kill, quiescence promise).
   */
  abstract start(spec: ShellExecSpec): ShellProcess
}

export default ShellExecutor
