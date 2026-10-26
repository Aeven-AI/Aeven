/**
 * Prompt-cache warming for a session that waits inside a tool call. Opt-in per
 * provider: an entry in `providers` names how long that provider's cached prefix
 * lives, and the warmer replays the session's last conversation request with a
 * one-token output cap on that interval, so the tool result the loop appends
 * next still lands on a cached prefix. Every warm is logged with the usage the
 * provider reported, and the plugin never warms while a session waits for a
 * human.
 * @module @aeven/llm-cache-warm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { LlmRuntime } from '@aeven/llm'
import type { ToolDispatchExecution } from '@aeven/tools'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { CacheWarmer } from './warmer.ts'
import type { ProviderSchedule, WarmerSettings } from './warmer.ts'

export { CacheWarmer, CACHE_WARM_TIMEOUT_CODE } from './warmer.ts'
export type { ProviderSchedule, WarmerPorts, WarmerSettings } from './warmer.ts'
export type { CacheWarmResultEventData, CacheWarmRoute, CacheWarmStartEventData } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'llm-cache-warm'

/** The model runtime the warm requests go through. */
export const inject = ['llm']

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /** Log-only record of one prompt-cache warm request, written before dispatch. */
    'cache-warm/start': import('./types.ts').CacheWarmStartEventData
    /** Log-only outcome of one prompt-cache warm request, with the usage the provider billed. */
    'cache-warm/result': import('./types.ts').CacheWarmResultEventData
  }
}

/** Plugin configuration; every field is changeable from `cordis.yml`. */
export interface Config {
  /** Per-provider warming schedule, keyed by provider name; a provider absent here is never warmed. */
  providers: Record<string, ProviderSchedule>
  /** Tool names whose block is a human wait rather than model work. */
  excludeTools: string[]
  /** Prefix size below which a cache miss costs less than a warm. */
  minPrefixChars: number
  /** Warms allowed in flight across all sessions. */
  maxConcurrentPings: number
  /** Warm dispatches allowed per UTC day. */
  dailyPingBudget: number
  /** Cap on one warm request's lifetime. */
  pingTimeoutMs: number
  /** Warms per tool call when the provider entry sets no cap. */
  maxPings: number
  /** Journal each warm as a `cache-warm/start` event and dispatch nothing. */
  dryRun: boolean
}

/** Validated schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(z.object({
    intervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).required(),
    maxPings: z.natural().min(1),
  })).default({}),
  excludeTools: z.array(z.string()).default(['ask_user_question']),
  minPrefixChars: z.natural().min(0).default(12000),
  maxConcurrentPings: z.natural().min(1).default(2),
  dailyPingBudget: z.natural().min(1).default(300),
  pingTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(90000),
  maxPings: z.natural().min(1).default(5),
  dryRun: z.boolean().default(false),
})

/**
 * Mount the warmer on the LLM and tool waterfalls.
 * @param ctx - the plugin context; the LLM runtime is its only required service.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger(name)
  const settings: WarmerSettings = {
    dryRun: config.dryRun,
    providers: config.providers,
    excludeTools: config.excludeTools,
    minPrefixChars: config.minPrefixChars,
    maxConcurrentPings: config.maxConcurrentPings,
    dailyPingBudget: config.dailyPingBudget,
    pingTimeoutMs: config.pingTimeoutMs,
    maxPings: config.maxPings,
  }
  const llm = ctx.get('llm') as LlmRuntime
  const warmer = new CacheWarmer({
    stream: options => llm.stream(options),
    now: () => Date.now(),
    warn: (message, ...args) => { logger.warn(message, ...args) },
  }, settings)
  ctx.effect(() => () => { warmer.dispose() })

  ctx.on('llm/stream', (options, next) => {
    warmer.capture(options)
    return next()
  })

  ctx.on('tools/execute', async (exec: ToolDispatchExecution, next) => {
    const session = exec.agent?.session
    if (session === undefined) return next()
    warmer.beginBlock(session, exec.name, exec.signal)
    try {
      return await next()
    } finally {
      warmer.endBlock(session)
    }
  })

  ctx.on('session/disposed', (session) => {
    warmer.forget(session.id)
  })
}
