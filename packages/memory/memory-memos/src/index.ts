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
import { REINDEX_VERSION, reindexIfEmbeddingChanged } from './reindex.ts'

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
  /**
   * Run MemOS's learning pipeline — reward scoring, policy induction, world models, skill crystallization, and
   * feedback — on each closed episode; false keeps the lightweight capture-and-recall pipeline. Overrides
   * `algorithm.lightweightMemory.enabled` in `config.yaml`. Each stage spends auxiliary calls on the owning session's route.
   */
  learning: boolean
  /**
   * Local embedding model behind vector recall, applied when `config.yaml` keeps MemOS's `local` embedding
   * provider; it overrides that file's `embedding.model`, prefixes, `device`, `dtype`, and `maxInputTokens`. Changing the model,
   * a prefix, or the piece size re-embeds each account's stored memory once, in the background, when its core opens.
   */
  embedding: EmbeddingConfig
  /** Vectors re-embedded per batch when an account's memory is re-indexed. */
  reindexBatchSize: number
  /**
   * Separate episodes whose traces must support a pattern before MemOS induces a policy from it
   * (`l2Induction.minEpisodesForInduction`); one episode is a single example, not a pattern.
   */
  minEpisodesForInduction: number
  /** Recall `candidate` policies beside `active` ones (`retrieval.includeCandidatePolicies`). */
  candidatePolicies: boolean
  /** MemOS Skills one recall delivers at most (`retrieval.tier1TopK`). */
  skillsPerTurn: number
  /**
   * Learned value a remembered or imported fact ranks with at least (`retrieval.rememberedFactValue`). Such a fact
   * never takes part in a rewarded task, so its own value stays 0 and rewarded conversation traces, tool-step logs
   * included, would always outrank it.
   */
  rememberedFactValue: number
  /**
   * Longest the turn-start relevance judgment may take, in milliseconds, inside the recall's own budget; when it fails
   * or runs out, at most two mechanically ranked memories are delivered and the recall is marked degraded.
   */
  relevanceTimeoutMs: number
}

/** Local embedding model settings. */
export interface EmbeddingConfig {
  /** Hugging Face model id loaded through transformers.js. */
  model: string
  /** Prepended to every recall query; E5 models require `query: `. */
  queryPrefix: string
  /** Prepended to every stored text; E5 models require `passage: `. */
  documentPrefix: string
  /** transformers.js execution device, such as `cpu`, `coreml`, or `webgpu`. */
  device: string
  /** transformers.js weight precision, such as `q8`, `fp16`, or `fp32`. */
  dtype: string
  /**
   * Estimated tokens per embedded piece; MemOS splits a longer text into pieces and pools their vectors. Keep it
   * within the model's input window (512 for E5), or the model truncates each piece.
   */
  maxInputTokens: number
  /**
   * Cosine cutoffs on this model's scale. A model's similarity scale is its own: E5 scores unrelated texts
   * around 0.8 where MiniLM scores them near 0.1, so MemOS's defaults admit everything under E5. The defaults
   * map MemOS's MiniLM values to E5 by matching the share of memory pairs each cutoff keeps.
   */
  similarity: SimilarityConfig
}

/** Embedding-scale cosine cutoffs applied to MemOS's algorithm configuration. */
export interface SimilarityConfig {
  /** Minimum query-to-memory cosine for a recalled trace (`retrieval.minTraceSim`). */
  trace: number
  /** Minimum query-to-episode-goal cosine (`retrieval.episodeGoalMinSim`). */
  episodeGoal: number
  /** Minimum cosine to attach a new trace to an existing policy (`l2Induction.minSimilarity`). */
  policyAssociation: number
  /** Minimum cosine to merge feedback into an existing policy (`feedback.mergeSimilarity`). */
  policyMerge: number
  /** Minimum cosine for two policies to share a world model (`l3Abstraction.clusterMinSimilarity`). */
  policyCluster: number
}

export const Config: z<Config> = z.object({
  home: z.string().min(1).required(),
  accounts: z.string().min(1).required(),
  hostLlm: z.boolean().default(true),
  capabilityTtlMs: z.natural().min(1000).default(600_000),
  language: z.union(['auto', 'en', 'zh'] as const).default('auto'),
  classifyDomains: z.boolean().default(true),
  classifyTimeoutMs: z.natural().min(1000).default(15_000),
  candidateTraces: z.natural().min(1).default(40),
  maxTextChars: z.natural().min(200).max(64_000).default(16_000),
  learning: z.boolean().default(true),
  embedding: z.object({
    model: z.string().min(1).default('Xenova/multilingual-e5-small'),
    queryPrefix: z.string().default('query: '),
    documentPrefix: z.string().default('passage: '),
    device: z.string().min(1).default('cpu'),
    dtype: z.string().min(1).default('q8'),
    maxInputTokens: z.natural().min(64).default(512),
    similarity: z.object({
      trace: z.number().min(0).max(1).default(0.84),
      episodeGoal: z.number().min(0).max(1).default(0.86),
      policyAssociation: z.number().min(0).max(1).default(0.94),
      policyMerge: z.number().min(0).max(1).default(0.93),
      policyCluster: z.number().min(0).max(1).default(0.91),
    }).default({ trace: 0.84, episodeGoal: 0.86, policyAssociation: 0.94, policyMerge: 0.93, policyCluster: 0.91 }),
  }).default({
    model: 'Xenova/multilingual-e5-small',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    device: 'cpu',
    dtype: 'q8',
    maxInputTokens: 512,
    similarity: { trace: 0.84, episodeGoal: 0.86, policyAssociation: 0.94, policyMerge: 0.93, policyCluster: 0.91 },
  }),
  reindexBatchSize: z.natural().min(1).max(500).default(100),
  minEpisodesForInduction: z.natural().min(1).max(20).default(2),
  candidatePolicies: z.boolean().default(false),
  skillsPerTurn: z.natural().max(100).default(1),
  rememberedFactValue: z.number().min(0).max(1).default(0.5),
  relevanceTimeoutMs: z.natural().min(300).default(4000),
})

/** MemOS core configuration with the Host bridge selected when `config.yaml` leaves the LLM provider empty. */
function withHostLlm(config: ResolvedConfig, enabled: boolean): ResolvedConfig {
  if (!enabled || config.llm.provider.trim()) return config
  return { ...config, llm: { ...config.llm, provider: 'host' } }
}

/** MemOS core configuration with Aeven's local embedding model applied when `config.yaml` keeps the local provider. */
function withLocalEmbedding(config: ResolvedConfig, embedding: EmbeddingConfig): ResolvedConfig {
  if (config.embedding.provider !== 'local') return config
  const { similarity, ...model } = embedding
  const { algorithm } = config
  return {
    ...config,
    embedding: { ...config.embedding, ...model },
    algorithm: {
      ...algorithm,
      retrieval: { ...algorithm.retrieval, minTraceSim: similarity.trace, episodeGoalMinSim: similarity.episodeGoal },
      l2Induction: { ...algorithm.l2Induction, minSimilarity: similarity.policyAssociation },
      feedback: { ...algorithm.feedback, mergeSimilarity: similarity.policyMerge },
      l3Abstraction: { ...algorithm.l3Abstraction, clusterMinSimilarity: similarity.policyCluster },
    },
  }
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
  const configured = withLocalEmbedding(withHostLlm(loaded.config, config.hostLlm), config.embedding)
  const fingerprint = {
    version: REINDEX_VERSION,
    provider: configured.embedding.provider,
    model: configured.embedding.model,
    queryPrefix: configured.embedding.queryPrefix,
    documentPrefix: configured.embedding.documentPrefix,
    maxInputTokens: configured.embedding.maxInputTokens,
  }
  const memosConfig = {
    ...configured,
    algorithm: {
      ...configured.algorithm,
      lightweightMemory: { ...configured.algorithm.lightweightMemory, enabled: !config.learning },
      retrieval: {
        ...configured.algorithm.retrieval,
        tier1TopK: config.skillsPerTurn,
        tier2TopK: config.candidateTraces,
        includeCandidatePolicies: config.candidatePolicies,
        rememberedFactValue: config.rememberedFactValue,
      },
      l2Induction: { ...configured.algorithm.l2Induction, minEpisodesForInduction: config.minEpisodesForInduction },
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
  // Accounts whose index is being rebuilt; their turn-start recall is skipped until the rebuild finishes.
  const rebuilding = new Set<string>()
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
    // The open does not wait for the rebuild; turn-start recall is skipped for the owner until it finishes.
    rebuilding.add(owner)
    void reindexIfEmbeddingChanged({
      core,
      dataDir: accountRoot.dataDir,
      fingerprint,
      batchSize: config.reindexBatchSize,
      info: (message) =>{  logger.info(message) },
      warn: (message) =>{  logger.warn(message) },
    }).catch((error: unknown) => {
      logger.warn(`memory re-embedding could not record its result: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => {
      rebuilding.delete(owner)
    })
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
    ...bridge === null ? {} : {
      relevance: {
        run: async (system: string, user: string, timeoutMs: number) => (await bridge.complete({
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0,
          maxTokens: 400,
          timeoutMs,
          op: 'aeven.recall.relevance',
        })).text,
        timeoutMs: config.relevanceTimeoutMs,
      },
    },
    rebuilding: owner => rebuilding.has(owner),
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
