/**
 * Out-of-process SDK subagent backend. Each child is a complete DeepSeek
 * Aeven runtime in its own process — own named profile and patch composition,
 * session, model route, and tools — driven over stdio JSON-RPC through the
 * TypeScript SDK client, so it shares no Cordis context. It accepts the
 * provider/model/reasoning/maxTokens subset of `agentOptions`; other start
 * features remain unsupported. The ONE thing it reads off `request.parent` is
 * the session whose workspace decides where the child starts: this device's
 * directory for it, never the `cwd` its header recorded, with a workspace that
 * has no folder here refusing through `WorkingDirectoryUnavailableError`. This
 * plugin uses named exports only; a default would hide its loader metadata (see
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @aeven/subagent-avn-sdk
 */

import type { Context } from '@deepseek-ai/cordis'
import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { AgentOptions } from '@aeven/agent'
import type { SubagentCapabilities, SubagentProvider, SubagentStartRequest } from '@aeven/subagent'
import { assertPositiveFinite, NO_START_CAPABILITIES, resolveChildCwd, validateConfiguredCwd } from '@aeven/subagent'
import { sessionDirectory } from '@aeven/working-directory'
import {
  DEFAULT_DISPOSE_EOF_GRACE_MS,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  sdkConfigurationFailure,
  startSdkRun,
  type SdkRunSpec,
} from './run.ts'

export const name = 'subagent-avn-sdk'
export const inject = ['subagents']

/** Config: how to spawn and drive the child SDK runtime process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `avn-sdk`). */
  providerName: string
  /** Explicit avn CLI module, resolved and checked at plugin load; omission uses the SDK dependency. */
  avnBin?: string
  /** Named child profile (default `sdk`). */
  profile: string
  /** Ordered per-launch profile patch files, resolved and checked at plugin load. */
  patches: string[]
  /** Absolute isolated Aeven home for every nested child process. */
  avnHome: string
  /**
   * Working directory override for the child process and its SDK session
   * workspace. Must be non-empty; a relative path resolves against the
   * harness launch directory at load, and the result must be an existing
   * directory. When omitted, each child starts in this device's directory for
   * its delegating parent session's workspace — starting one from a parent
   * session that records no directory fails, and a parent workspace with no
   * folder on this device refuses.
   */
  cwd?: string
  /** Provider route the child runtime initializes with (default `deepseek-official`). */
  provider: string
  /** Model the child runtime initializes with (default `deepseek-v4-flash`). */
  model: string
  /** Optional per-request output-token cap for the child runtime. */
  maxTokens?: number
  /**
   * Extra environment variables for the child process — e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed copy of the parent
   * env, so an explicit key here reaches the child while ambient secrets do
   * not leak implicitly.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs?: number
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal.
   */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('avn-sdk'),
  avnBin: z.string(),
  profile: z.string().default('sdk'),
  patches: z.array(z.string()).default([]),
  avnHome: z.string().required(),
  cwd: z.string(),
  provider: z.string().default('deepseek-official'),
  model: z.string().default('deepseek-v4-flash'),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  env: z.dict(z.string()).default({}),
  shutdownTimeoutMs: z.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** The shape after schemastery applied the defaults (`cwd` and `maxTokens` have none). */
type ResolvedConfig = Required<Omit<Config, 'cwd' | 'maxTokens' | 'avnBin'>> & Pick<Config, 'cwd' | 'maxTokens' | 'avnBin'>

/** Resolve one configured runtime file against the harness launch directory and require a regular file. */
function resolveConfiguredFile(field: string, value: string): string {
  const path = resolve(value)
  try {
    if (statSync(path).isFile()) return path
  } catch {
    // The diagnostic below owns missing, inaccessible, and non-file paths uniformly.
  }
  throw new TypeError(`subagent-avn-sdk ${field} must name an existing file: ${path}`)
}

/** AVN SDK can apply Agent route options while the other start features remain child-owned. */
const SDK_START_CAPABILITIES: SubagentCapabilities = Object.freeze({
  ...NO_START_CAPABILITIES,
  agentOptions: true,
})

/** Merge the request's supported route fields over this provider instance's defaults. */
function resolveSdkRoute(config: ResolvedConfig, requested: AgentOptions | undefined): Pick<
  SdkRunSpec,
  'provider' | 'model' | 'reasoningEffort' | 'maxTokens'
> {
  const maxTokens = requested?.maxTokens ?? config.maxTokens
  return {
    provider: requested?.provider ?? config.provider,
    model: requested?.model ?? config.model,
    ...requested?.reasoningEffort === undefined ? {} : { reasoningEffort: requested.reasoningEffort },
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

/**
 * The SDK provider. It resolves Agent route options into the child runtime's
 * process-wide handshake; output schema, depth, tool filter, and persona stay
 * unsupported because their ownership does not cross this process boundary.
 */
class SdkSubagentProvider implements SubagentProvider {
  readonly capabilities = SDK_START_CAPABILITIES
  readonly agentRouteDefaults: Readonly<{ provider: string; model: string }>
  // Context contract: an out-of-process SDK child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: ResolvedConfig) {
    this.agentRouteDefaults = Object.freeze({ provider: config.provider, model: config.model })
  }

  /**
   * @throws {WorkingDirectoryUnavailableError} when the parent session's workspace has no folder on
   * this device and no `cwd` override is configured.
   */
  start(request: SubagentStartRequest) {
    if (request.signal.aborted) {
      throw new Error('subagent request was aborted before the SDK child started')
    }
    // An explicit configuration outranks the session, so only an unconfigured
    // child consults the capability; its refusal for a workspace with no folder
    // here reaches the caller as itself, ahead of the failure mapping below.
    const parentCwd = this.config.cwd === undefined
      ? sessionDirectory(this.ctx, request.parent.session)
      : undefined
    let cwd: string
    try {
      cwd = resolveChildCwd('subagent-avn-sdk', this.config.cwd, parentCwd)
    } catch (error: unknown) {
      const failure = sdkConfigurationFailure(error)
      this.ctx.logger.warn(`subagent-avn-sdk "${this.name}": child start failed: %o`, error)
      throw failure
    }
    const route = resolveSdkRoute(this.config, request.agentOptions)
    const spec: SdkRunSpec = {
      ...this.config.avnBin === undefined ? {} : { avnBin: this.config.avnBin },
      profile: this.config.profile,
      patches: this.config.patches,
      avnHome: this.config.avnHome,
      cwd,
      ...route,
      env: this.config.env,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`subagent-avn-sdk "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startSdkRun(request, spec)
  }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveFinite('subagent-avn-sdk', 'shutdownTimeoutMs', resolved.shutdownTimeoutMs)
  assertPositiveFinite('subagent-avn-sdk', 'disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('subagent-avn-sdk', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.maxTokens !== undefined && (!Number.isSafeInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) {
    throw new TypeError('subagent-avn-sdk maxTokens must be a positive safe integer')
  }
  if (!isAbsolute(resolved.avnHome)) throw new TypeError('subagent-avn-sdk avnHome must be an absolute path')
  const launchPaths: ResolvedConfig = {
    ...resolved,
    patches: resolved.patches.map((path, index) => resolveConfiguredFile(`patches[${String(index)}]`, path)),
    ...resolved.avnBin === undefined ? {} : { avnBin: resolveConfiguredFile('avnBin', resolved.avnBin) },
  }
  // Interpret a relative configured cwd against the harness launch directory
  // ONCE, at load, and fail a misconfigured directory here — not per start.
  const configuredCwd = validateConfiguredCwd('subagent-avn-sdk', resolved.cwd)
  const validated: ResolvedConfig = configuredCwd === undefined
    ? launchPaths
    : { ...launchPaths, cwd: configuredCwd }
  ctx.subagents.registerProvider(new SdkSubagentProvider(validated.providerName, ctx, validated))
}
