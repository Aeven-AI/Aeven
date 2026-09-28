/**
 * MemOS memory provider: runs the MemOS local core in the Host process, sends its auxiliary LLM calls
 * through `ctx.llm`, and optionally serves the MemOS Viewer on a loopback port.
 *
 * @module @aeven/memory-memos
 */
import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/llm'
import type {} from '@aeven/memory'
import { loadConfig, resolveHome, type ResolvedConfig } from '@memtensor/memos-local-plugin/dist/core/config/index.js'
import { bootstrapMemoryCore } from '@memtensor/memos-local-plugin/dist/core/index.js'
import { memoryBuffer } from '@memtensor/memos-local-plugin/dist/core/logger/index.js'
import { startHttpServer } from '@memtensor/memos-local-plugin/dist/server/http.js'
import type { ServerHandle } from '@memtensor/memos-local-plugin/dist/server/types.js'
import { createHostLlmBridge, LlmRouteContext, type MemoryLanguage } from './host-llm.ts'
import { MEMOS_AGENT, MemosMemory } from './runtime.ts'
import { classifyTurnDomain } from './domain.ts'

export const name = 'memory-memos'
export const inject = ['memory', 'llm']

/** Provider configuration. */
export interface Config {
  /** Absolute MemOS runtime root holding `config.yaml`, `data/memos.db`, and `skills/`; `MEMOS_HOME` overrides it. */
  home: string
  /** Route MemOS auxiliary LLM calls through the owning session's `ctx.llm` route when `config.yaml` names no provider. */
  hostLlm: boolean
  /** How long one route's reasoning capability stays cached, in milliseconds. */
  capabilityTtlMs: number
  /** Language of stored summaries and learned knowledge written through the Host bridge; `auto` detects English or Chinese from each request's text. */
  language: MemoryLanguage
  /** Classify each captured turn as person, project, or world memory with one short call on the session's route; needs `hostLlm`. */
  classifyDomains: boolean
  /** Bound on one domain classification call, in milliseconds. */
  classifyTimeoutMs: number
  /** Number of trace candidates MemOS ranks for turn-start recall before Aeven orders them. */
  candidateTraces: number
  /** Serve the MemOS Viewer and its read/write memory API. */
  viewer: boolean
  /** Viewer listener port. */
  viewerPort: number
  /** Viewer bind address; only `localhost` and IPv4 `127.*` are accepted. */
  viewerHost: string
}

export const Config: z<Config> = z.object({
  home: z.string().min(1).required(),
  hostLlm: z.boolean().default(true),
  capabilityTtlMs: z.natural().min(1000).default(600_000),
  language: z.union(['auto', 'en', 'zh'] as const).default('auto'),
  classifyDomains: z.boolean().default(true),
  classifyTimeoutMs: z.natural().min(1000).default(15_000),
  candidateTraces: z.natural().min(1).default(20),
  viewer: z.boolean().default(true),
  viewerPort: z.natural().min(1).max(65_535).default(18_801),
  viewerHost: z.string().default('127.0.0.1'),
})

/** The Viewer has no authentication until the user sets a password, so it only binds loopback. */
function isLoopback(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === 'localhost' || (isIP(normalized) === 4 && normalized.startsWith('127.'))
}

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

function viewerAssets(): string {
  const manifest = createRequire(import.meta.url).resolve('@memtensor/memos-local-plugin/package.json')
  return join(dirname(manifest), 'viewer', 'dist')
}

/**
 * Boot MemOS and register it as the memory provider.
 * @param ctx - Host context with the memory slot and LLM runtime.
 * @param config - validated provider configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!isAbsolute(config.home)) throw new Error(`memory-memos home must be absolute: ${config.home}`)
  if (config.viewer && !isLoopback(config.viewerHost)) {
    throw new Error(`memory-memos viewerHost must be loopback: ${config.viewerHost}`)
  }
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
    },
  }
  const routes = new LlmRouteContext()
  const bridge = config.hostLlm ? createHostLlmBridge(ctx.llm, routes, config.capabilityTtlMs, config.language) : null
  const recovery = autoRecoveryEnabled(memosConfig)
  const core = await bootstrapMemoryCore({
    agent: MEMOS_AGENT,
    // Every read and write passes its owner's namespace; this default only labels the Viewer's own requests.
    namespace: { agentKind: MEMOS_AGENT, profileId: 'aeven', profileLabel: 'Aeven' },
    home,
    config: memosConfig,
    hostLlmBridge: bridge,
    autoRecovery: recovery,
    initLogging: false,
  })
  await core.init()
  const memory = new MemosMemory({
    core,
    routes,
    toolLimits: {
      skills: configured.algorithm.retrieval.tier1TopK,
      traces: configured.algorithm.retrieval.tier2TopK,
      worldModels: configured.algorithm.retrieval.tier3TopK,
    },
    ...bridge && config.classifyDomains ? { classify: input => classifyTurnDomain(bridge, input, config.classifyTimeoutMs) } : {},
    warn: message => logger.warn(message),
    info: message => logger.debug(message),
  })

  let viewer: ServerHandle | undefined
  if (config.viewer) {
    try {
      viewer = await startHttpServer(
        { core, home, logTail: () => memoryBuffer().tail({ limit: 200 }) },
        { port: config.viewerPort, host: config.viewerHost, staticRoot: viewerAssets(), agent: MEMOS_AGENT, closeActiveSseOnShutdown: true },
      )
      logger.info(`viewer live at ${viewer.url}`)
    } catch (error) {
      // Memory stays usable without its Viewer; a busy port is the common cause.
      logger.warn(`viewer unavailable on ${config.viewerHost}:${config.viewerPort}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  logger.info(`ready (home=${home.root}, hostLlm=${String(config.hostLlm)}, autoRecovery=${String(recovery)})`)

  ctx.effect(() => {
    const unregister = ctx.memory.register(memory)
    const unwatch = bridge ? ctx.on('llm/adapters-updated', () => bridge.invalidateModelCapabilities()) : () => {}
    return async () => {
      unwatch()
      unregister()
      await viewer?.close()
      await memory.dispose()
    }
  }, 'memory-memos.provider')
}
