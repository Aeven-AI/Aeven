/**
 * MemOS memory provider: runs one MemOS local core per account in the Host process, each over that
 * account's own database, and sends their auxiliary LLM calls through `ctx.llm`.
 *
 * @module @aeven/memory-memos
 */
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { accountDirectoryName } from '@aeven/home-paths'
import type {} from '@aeven/llm'
import type {} from '@aeven/memory'
import { loadConfig, resolveHome, type ResolvedConfig } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import type { ResolvedHome } from '@deepseek-ai/memos-local-plugin/core/config/paths.js'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import { OwnerCores } from './cores.ts'
import { createHostLlmBridge, LlmRouteContext, type MemoryLanguage } from './host-llm.ts'
import { splitSharedMemory } from './migrate.ts'
import { MEMOS_AGENT, MemosMemory } from './runtime.ts'
import { classifyTurnDomain, TurnJudgeContext } from './domain.ts'

export const name = 'memory-memos'
export const inject = ['memory', 'llm']

/** Provider configuration. */
export interface Config {
  /** Absolute MemOS runtime root holding the `config.yaml` every account's core uses; `MEMOS_HOME` overrides it. */
  home: string
  /** Absolute directory of per-account subtrees; each account's MemOS data lives in `<account>/memory`. */
  accounts: string
  /** Route MemOS auxiliary LLM calls through the owning session's `ctx.llm` route when `config.yaml` names no provider. */
  hostLlm: boolean
  /** How long one route's reasoning capability stays cached, in milliseconds. */
  capabilityTtlMs: number
  /**
   * Language of stored summaries and learned knowledge written through the Host bridge; `auto` detects
   * English or Chinese from each request's text.
   */
  language: MemoryLanguage
  /**
   * Classify each captured turn as person, project, or world memory and detect corrections on the session's route; needs `hostLlm`.
   * The judgment rides on MemOS's summarize request for the turn's final reply, with one short classification call as the fallback.
   */
  classifyDomains: boolean
  /** Bound on one fallback domain classification call, in milliseconds. */
  classifyTimeoutMs: number
  /** Number of trace candidates MemOS ranks for turn-start recall before Aeven orders them. */
  candidateTraces: number
  /**
   * Longest request or reply text one stored memory keeps; longer text keeps its beginning and end. A learned
   * procedure is stored as one request text, so this bounds the procedure `memory_get` can read back.
   */
  maxTextChars: number
}

export const Config: z<Config> = z.object({
  home: z.string().min(1).required(),
  accounts: z.string().min(1).required(),
  hostLlm: z.boolean().default(true),
  capabilityTtlMs: z.natural().min(1000).default(600_000),
  language: z.union(['auto', 'en', 'zh'] as const).default('auto'),
  classifyDomains: z.boolean().default(true),
  classifyTimeoutMs: z.natural().min(1000).default(15_000),
  candidateTraces: z.natural().min(1).default(20),
  maxTextChars: z.natural().min(200).max(64_000).default(16_000),
})

/** MemOS core configuration with the Host bridge selected when `config.yaml` leaves the LLM provider empty. */
function withHostLlm(config: ResolvedConfig, enabled: boolean): ResolvedConfig {
  if (!enabled || config.llm.provider.trim()) return config
  return { ...config, llm: { ...config.llm, provider: 'host' } }
}

/**
 * Startup and periodic recovery run outside any session, so with the Host bridge they have no route to call.
 * The lightweight pipeline runs no LLM recovery stages, so it keeps recovery on.
 */
function autoRecoveryEnabled(config: ResolvedConfig): boolean {
  return config.llm.provider.trim().toLowerCase() !== 'host' || config.algorithm.lightweightMemory.enabled
}

/**
 * MemOS runtime paths of one account. Built here rather than through `resolveHome`, whose `MEMOS_HOME`
 * override would point every account at the same database.
 */
function accountHome(accounts: string, owner: string): ResolvedHome {
  const root = join(accounts, accountDirectoryName(owner), 'memory')
  return {
    root,
    configFile: join(root, 'config.yaml'),
    dataDir: join(root, 'data'),
    dbFile: join(root, 'data', 'memos.db'),
    skillsDir: join(root, 'skills'),
    logsDir: join(root, 'logs'),
    daemonDir: join(root, 'daemon'),
  }
}

/**
 * Boot MemOS and register it as the memory provider.
 * @param ctx - Host context with the memory slot and LLM runtime.
 * @param config - validated provider configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!isAbsolute(config.home)) throw new Error(`memory-memos home must be absolute: ${config.home}`)
  if (!isAbsolute(config.accounts)) throw new Error(`memory-memos accounts must be absolute: ${config.accounts}`)
  const logger = ctx.logger('memory-memos')
  const home = resolveHome(MEMOS_AGENT, config.home)
  const loaded = await loadConfig(home, MEMOS_AGENT)
  for (const warning of loaded.warnings) logger.warn(warning)
  const configured = withHostLlm(loaded.config, config.hostLlm)
  const memosConfig = {
    ...configured,
    algorithm: {
      ...configured.algorithm,
      retrieval: { ...configured.algorithm.retrieval, tier2TopK: config.candidateTraces },
      capture: { ...configured.algorithm.capture, maxTextChars: config.maxTextChars },
    },
  }
  const routes = new LlmRouteContext()
  const judges = config.hostLlm && config.classifyDomains ? new TurnJudgeContext() : undefined
  const bridge = config.hostLlm ? createHostLlmBridge(ctx.llm, routes, config.capabilityTtlMs, config.language, judges) : null
  const recovery = autoRecoveryEnabled(memosConfig)
  splitSharedMemory({
    sharedDbFile: home.dbFile,
    accountDbFile: owner => accountHome(config.accounts, owner).dbFile,
    info: (message) =>{  logger.info(message) },
    warn: (message) =>{  logger.warn(message) },
  })
  const cores = new OwnerCores(async (owner) => {
    const accountRoot = accountHome(config.accounts, owner)
    mkdirSync(accountRoot.dataDir, { recursive: true, mode: 0o700 })
    const core = await bootstrapMemoryCore({
      agent: MEMOS_AGENT,
      // Every read and write passes its owner's namespace; this default labels the core's own requests.
      namespace: { agentKind: MEMOS_AGENT, profileId: 'aeven', profileLabel: 'Aeven' },
      home: accountRoot,
      config: memosConfig,
      hostLlmBridge: bridge,
      autoRecovery: recovery,
      initLogging: false,
    })
    await core.init()
    return core
  })
  const memory = new MemosMemory({
    cores,
    routes,
    toolLimits: {
      skills: configured.algorithm.retrieval.tier1TopK,
      traces: configured.algorithm.retrieval.tier2TopK,
      worldModels: configured.algorithm.retrieval.tier3TopK,
    },
    ...bridge && judges ? { judges, classify: input => classifyTurnDomain(bridge, input, config.classifyTimeoutMs) } : {},
    warn: (message) =>{  logger.warn(message) },
    info: (message) =>{  logger.debug(message) },
  })

  logger.info(`ready (accounts=${config.accounts}, hostLlm=${String(config.hostLlm)}, autoRecovery=${String(recovery)})`)

  ctx.effect(() => {
    const unregister = ctx.memory.register(memory)
    const unwatch = bridge ? ctx.on('llm/adapters-updated', () =>{  bridge.invalidateModelCapabilities() }) : () => {}
    return async () => {
      unwatch()
      unregister()
      await memory.dispose()
    }
  }, 'memory-memos.provider')
}
