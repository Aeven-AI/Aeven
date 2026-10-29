/**
 * Out-of-process ACP subagent backend. Each child has its own process, session, model, and
 * tools, so it shares no Cordis context and advertises no parent-enforced start capabilities;
 * the ONE thing it reads off `request.parent` is the session whose workspace decides where the
 * child starts (see {@link resolveCwd}). That is this device's directory for the workspace: the
 * `cwd` the session header recorded names the device that wrote the log, so it is never used,
 * and a workspace with no folder on this device refuses with
 * `WorkingDirectoryUnavailableError`. This plugin uses named exports only; a default would hide
 * its loader metadata (see `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @aeven/subagent-acp
 */

import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@aeven/subagent'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { sessionDirectory } from '@aeven/working-directory'
import { acpConfigurationFailure, type AcpRunSpec, DEFAULT_DISPOSE_EOF_GRACE_MS, DEFAULT_DISPOSE_GRACE_MS, type PermissionPolicy, startAcpRun } from './run.ts'

export const name = 'subagent-acp'
export const inject = ['subagents', 'subprocess']

/** Config: how to spawn and drive the child ACP agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `acp`). */
  providerName: string
  /** The executable to spawn for each run (the child ACP agent). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Working directory override for the child process and its ACP session.
   * Must be non-empty; a relative path resolves against the harness launch
   * directory at load, and the result must be an existing directory. When
   * omitted, each child starts in this device's directory for its delegating
   * parent session's workspace — starting one from a parent session that
   * records no directory fails, and a parent workspace with no folder on this
   * device refuses.
   */
  cwd?: string
  /**
   * How to auto-answer the child's `session/request_permission` prompts:
   * `reject` (default — decline every prompt) or `allow` (approve via the first
   * `allow_once` or `allow_always` option). No prompt is surfaced to a human.
   */
  permission: PermissionPolicy
  /**
   * Extra environment variables for the child process — e.g. the child
   * harness's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed
   * copy of the parent env, so an explicit key here reaches the child while
   * ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Failure-observation and termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('acp'),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  permission: z.union(['allow', 'reject'] as const).default('reject'),
  env: z.dict(z.string()).default({}),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** A process grace must fit every Node timer that observes or terminates the child. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-acp: ${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** The shape after schemastery applied the defaults (cwd has none). */
type ResolvedConfig = Required<Omit<Config, 'cwd'>> & Pick<Config, 'cwd'>

/**
 * Whether `path` names an existing directory the harness can ENTER. The
 * search-permission probe matters: `statSync().isDirectory()` is true for a
 * mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
 */
function isDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    // statSync/accessSync throw only filesystem access errors here
    // (ENOENT/EACCES/ENOTDIR/…), and every one of them means the path cannot
    // serve as the child's cwd.
    return false
  }
}

/**
 * Assert `cwd` can actually host the child: absolute (it doubles as the ACP
 * session workspace, and a relative path would be re-anchored to the server
 * process's launch directory) and an existing directory (fail here, before the
 * process boundary, instead of as an ambiguous spawn ENOENT).
 * @param label - which source supplied the value, for the diagnostic.
 * @param cwd - the candidate working directory.
 * @returns `cwd`, validated.
 */
function assertUsableCwd(label: string, cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw new Error(`subagent-acp: ${label} must be an absolute path: ${cwd}`)
  }
  if (!isDirectory(cwd)) {
    throw new Error(`subagent-acp: ${label} is not an accessible directory: ${cwd}`)
  }
  return cwd
}

/**
 * Resolve the child's working directory: the deployment `cwd` override when
 * configured (already validated at load), else the parent session's directory
 * on this device (validated here, its earliest resolvable point). Fails loud
 * when the parent session records none — falling back to the harness process
 * cwd would silently bind the child to the server's launch directory instead
 * of the delegating session's workspace (one server process serves many
 * sessions, each with its own cwd).
 * @param configured - the load-validated `cwd` override, or `undefined` to inherit the parent session's directory.
 * @param parentCwd - this device's directory for the parent session's workspace, or `undefined` when that session records none.
 * @returns the absolute child working directory.
 */
function resolveCwd(configured: string | undefined, parentCwd: string | undefined): string {
  if (configured !== undefined) return configured
  if (parentCwd === undefined) {
    throw new Error('subagent-acp: no working directory for the child — configure `cwd` or delegate from a parent session that has one')
  }
  return assertUsableCwd('parent session cwd', parentCwd)
}

/**
 * The ACP provider. Advertises NO start-time capabilities: an out-of-process
 * child cannot honor `agentOptions`/`outputSchema`/`maxDepth`/`toolFilter`/
 * `persona` (the service rejects a request needing any before `start` runs).
 */
class AcpProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: false,
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  }
  // Context contract: an out-of-process ACP child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /**
   * @throws {WorkingDirectoryUnavailableError} when the parent session's workspace has no folder on this device — that capability's refusal, not an ACP configuration failure.
   */
  start(request: ResolvedSubagentStartRequest) {
    if (request.signal.aborted) {
      throw new Error('subagent request was aborted before the ACP child started')
    }
    // Resolved ahead of the failure mapping below: a workspace with no folder
    // here is the working-directory capability's refusal, so it reaches the
    // caller as itself rather than reclassified as a configuration failure.
    const parentCwd = sessionDirectory(this.ctx, request.parent.session)
    let cwd: string
    try {
      cwd = resolveCwd(this.config.cwd, parentCwd)
    } catch (error: unknown) {
      const failure = acpConfigurationFailure(error)
      this.ctx.logger.warn(`subagent-acp "${this.name}": child start failed: %o`, error)
      throw failure
    }
    const spec: AcpRunSpec = {
      command: this.config.command,
      args: this.config.args,
      cwd,
      permission: this.config.permission,
      env: this.config.env,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`subagent-acp "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startAcpRun(request, spec)
  }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveFinite('disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('disposeGraceMs', resolved.disposeGraceMs)
  // `path.resolve('')` is the process cwd — an empty string would silently
  // reintroduce the launch-directory fallback this resolution removed.
  if (resolved.cwd === '') {
    throw new Error('subagent-acp: config cwd must not be empty — omit the key to inherit the parent session cwd')
  }
  // Interpret a relative configured cwd against the harness launch directory
  // ONCE, at load, and fail a misconfigured directory here — not per start.
  const validated: ResolvedConfig = resolved.cwd === undefined
    ? resolved
    : { ...resolved, cwd: assertUsableCwd('config cwd', resolve(resolved.cwd)) }
  ctx.subagents.registerProvider(new AcpProvider(validated.providerName, ctx, validated))
}
