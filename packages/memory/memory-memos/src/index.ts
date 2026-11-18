/**
 * MemOS memory provider: runs one MemOS local core per account in the Host process, each over that
 * account's own database, and sends their auxiliary LLM calls through `ctx.llm`.
 *
 * @module @aeven/memory-memos
 */
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { accountDirectoryName } from '@aeven/home-paths'
import { LeaseHolder } from '@aeven/sync'
import type {} from '@aeven/credentials'
import type {} from '@aeven/llm'
import type {} from '@aeven/workspace'
import type {} from '@aeven/settings'
import { MEMORY_MAINTENANCE_LEASE, type MemoryScope } from '@aeven/memory'
import { loadConfig, resolveHome, type ResolvedConfig } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import type { ResolvedHome } from '@deepseek-ai/memos-local-plugin/core/config/paths.js'
import { createEmbedder, createEmbedderWithProvider } from '@deepseek-ai/memos-local-plugin/core/embedding/embedder.js'
import type { Embedder } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import { CoreWorkerPool } from './core-pool.ts'
import { OwnerCores } from './cores.ts'
import { HostedEmbeddings } from './embedding.ts'
import { createHostLlmBridge, LlmRouteContext, type MemoryLanguage } from './host-llm.ts'
import { splitSharedMemory } from './migrate.ts'
import { MEMOS_AGENT, MemosMemory, memosHome } from './runtime.ts'
import { PersonProfiles } from './profile.ts'
import { classifyTurnDomain, TurnJudgeContext } from './domain.ts'
import { REINDEX_VERSION, reindexIfEmbeddingChanged } from './reindex.ts'
import { MemorySyncMirror, type MemorySyncTuning } from './sync.ts'

/** Settings namespace of each account's recall preferences; Settings → General writes it. */
export const MEMORY_RECALL_SETTINGS_NAMESPACE = 'memory-recall'

/** One account's recall preferences. */
export interface MemoryRecallSettings {
  /**
   * Whether a relevance judgment, one more model call before each answer, picks which recalled memories the turn
   * receives. Off delivers every candidate and lets the answering model decide, which starts the answer sooner.
   */
  judge: boolean
}

const MemoryRecallSettingsSchema: z<MemoryRecallSettings> = z.object({
  judge: z.boolean().default(false),
})

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
  /** How this device publishes memory changes to the account's other devices while account sync serves it. */
  sync: MemorySyncTuning
  /**
   * Open an account's memory as soon as its sync vault is served here, instead of at its first session, so the
   * memory its other devices hold is in place before the account's first turn. A Host that serves an account's
   * browser sessions sets it; a device the user signs in to opens memory with its first session either way.
   */
  openOnSync: boolean
  /**
   * Load an account's memory when it signs in on this Host, instead of during its first turn: the first recall
   * after a start otherwise opens the database, builds the vector index, and lists the person memories inside
   * its own time limit, and delivers nothing when they take longer. Only an account that already has a memory
   * database is loaded. A personal device sets it; a Host serving many accounts would hold every signed-in
   * account's index in memory.
   */
  warmOnSignIn: boolean
  /** Use account workspace ids for project memory on a hosted Host; desktop keeps directory-based namespaces. */
  workspaceIdentity: boolean
  /**
   * Where the local embedding model runs. `worker` loads it in one worker thread when the provider starts and
   * embeds there, so neither the load nor an embedding batch occupies the Host's event loop; `host` loads it in
   * the Host process at the first embedding.
   */
  embeddingExecution: 'host' | 'worker'
  /**
   * Worker threads that run the MemOS cores. Each account's core, with its database connection and in-memory
   * vector index, lives on one worker, so search, ranking, and capture never occupy the Host's event loop and
   * accounts on different workers run in parallel. `0` runs every core in the Host process.
   */
  coreWorkers: number
  /** How long a core worker waits for the Host's maintenance verdict before it skips that maintenance run. */
  coreGateTimeoutMs: number
  /**
   * Core calls whose session route is kept for the LLM requests their work issues after the call returned, such as
   * a turn's capture. Work of a call dropped from this window fails its LLM requests as work outside a session does.
   */
  coreCallContexts: number
  /** Delay between an account's sign-in and the load `warmOnSignIn` starts, so a Host start serves its window first. */
  warmDelayMs: number
  /** Unfinished embedding requests accepted per account. */
  embeddingQueuePerAccount: number
  /** Unfinished embedding requests accepted across the Host. */
  embeddingQueueTotal: number
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
   * Trace tags that rank with at least `rememberedFactValue` (`retrieval.rememberedFactTags`). A fact the turn
   * judgment filed under the person or a project carries its conversation's reward, which is lowest exactly when the
   * person had to correct the assistant, so it ranks like a remembered fact.
   */
  rememberedFactTags: string[]
  /**
   * Sentences of the person's message that get their own turn-start retrieval beside the conversation query; 0 runs
   * the conversation query alone. A message that opens on one subject and asks about another is otherwise matched
   * only to memories of its first subject.
   */
  sentenceRetrievals: number
  /** Top hits each sentence retrieval adds to the candidates the relevance judgment reads. */
  sentenceHits: number
  /**
   * Most learned procedures a turn-start recall offers the relevance judgment beside what retrieval found, chosen by
   * how close their name and description are to the request (see `procedureMinMargin`) or by the words they share
   * with it. Procedures are few among all memories and are written as steps, so retrieval on the person's words
   * seldom returns them. `0` offers none.
   */
  procedureCandidates: number
  /**
   * How far above the median similarity of the owner's procedures a procedure's cosine similarity to the request
   * must stand to be offered. The embedding model's similarities sit in a narrow band, so the cutoff is relative;
   * `multilingual-e5-small` puts a matching procedure 0.036 to 0.11 above the median and an unrelated one within
   * 0.03. Used with the local embedding provider; other providers choose by shared words alone.
   */
  procedureMinMargin: number
  /**
   * Longest the turn-start relevance judgment may take, in milliseconds, inside the recall's own budget; when it fails
   * or runs out, at most two mechanically ranked memories are delivered and the recall is marked degraded.
   */
  relevanceTimeoutMs: number
  /**
   * Milliseconds after which an unanswered relevance judgment is sent a second time with the same prompt; the first
   * usable answer is kept and the other request is cancelled. A judgment that fails earlier is resent at once while
   * time remains. `0` sends one request only.
   */
  relevanceHedgeMs: number
  /**
   * Shortest window the relevance judgment gets, in milliseconds, even when retrieval used most of the recall budget;
   * the recall then finishes up to this long after its budget. Capped by `relevanceTimeoutMs`; `0` gives the judgment
   * only what retrieval left.
   */
  relevanceMinMs: number
  /**
   * Person profile distilled from all of the owner's person memories regardless of age, delivered at the start of
   * every conversation; needs `hostLlm`. Recorded dates are delivered whether or not it is enabled.
   */
  profile: ProfileConfig
}

/** Person profile settings. */
export interface ProfileConfig {
  /** Distill and deliver the profile. */
  enabled: boolean
  /** Longest profile, in characters. */
  maxChars: number
  /** Memories folded into the profile per distillation call. */
  batchFacts: number
  /** Shortest interval between two checks of one owner for memories newer than the profile, in milliseconds. */
  refreshMs: number
  /** Longest one distillation call may take, in milliseconds. */
  timeoutMs: number
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
  sync: z.object({
    drainMs: z.natural().min(100).default(2_000),
    drainBatch: z.natural().min(1).default(500),
    applyPauseMs: z.natural().default(16),
    outboxLimit: z.natural().min(1).default(200),
    maintenanceTtlMs: z.natural().min(1_000).default(180_000),
    maintenanceRenewMs: z.natural().min(100).default(60_000),
  }).default({
    drainMs: 2_000, drainBatch: 500, applyPauseMs: 16, outboxLimit: 200,
    maintenanceTtlMs: 180_000, maintenanceRenewMs: 60_000,
  }),
  openOnSync: z.boolean().default(false),
  warmOnSignIn: z.boolean().default(false),
  workspaceIdentity: z.boolean().default(false),
  embeddingExecution: z.union(['host', 'worker'] as const).default('host'),
  coreWorkers: z.natural().default(0),
  coreGateTimeoutMs: z.natural().min(1).default(1_000),
  coreCallContexts: z.natural().min(1).default(4_096),
  warmDelayMs: z.natural().default(0),
  embeddingQueuePerAccount: z.natural().min(1).default(8),
  embeddingQueueTotal: z.natural().min(1).default(128),
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
  rememberedFactTags: z.array(z.string().min(1)).default(['lightweight_memory', 'domain:person', 'domain:project']),
  sentenceRetrievals: z.natural().max(8).default(3),
  sentenceHits: z.natural().min(1).max(40).default(8),
  procedureCandidates: z.natural().max(20).default(3),
  procedureMinMargin: z.number().min(0).max(1).default(0.035),
  relevanceTimeoutMs: z.natural().min(300).default(4000),
  relevanceHedgeMs: z.natural().default(2000),
  relevanceMinMs: z.natural().default(3500),
  profile: z.object({
    enabled: z.boolean().default(true),
    maxChars: z.natural().min(500).max(20_000).default(6000),
    batchFacts: z.natural().min(10).max(500).default(150),
    refreshMs: z.natural().min(10_000).default(600_000),
    timeoutMs: z.natural().min(5000).default(180_000),
  }).default({ enabled: true, maxChars: 6000, batchFacts: 150, refreshMs: 600_000, timeoutMs: 180_000 }),
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
  return memosHome(join(accounts, accountDirectoryName(owner), 'memory'))
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
  // `config.yaml` is optional, so MemOS's missing-file notice is not a fault here.
  for (const warning of loaded.warnings) if (loaded.fromDisk || !warning.startsWith('config file not found')) logger.warn(warning)
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
        rememberedFactTags: config.rememberedFactTags,
      },
      l2Induction: { ...configured.algorithm.l2Induction, minEpisodesForInduction: config.minEpisodesForInduction },
      capture: { ...configured.algorithm.capture, maxTextChars: config.maxTextChars },
    },
  }
  // Each person's own choice on a Host that serves many people.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(MEMORY_RECALL_SETTINGS_NAMESPACE, MemoryRecallSettingsSchema, { perAccount: true })
  })
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
  // Maintenance that derives new memory from all of an account's memory runs on one of its devices at a time.
  const maintenance = new Map<string, LeaseHolder>()
  const mayMaintain = (owner: string): boolean => {
    const holder = maintenance.get(owner)
    if (holder !== undefined) return holder.held()
    const state = ctx.get('sync')?.status(owner).state
    return state === undefined || state === 'disabled' || state === 'starting'
  }

  const embeddings = config.embeddingExecution === 'worker' && configured.embedding.provider === 'local'
    ? new HostedEmbeddings({ perAccount: config.embeddingQueuePerAccount, total: config.embeddingQueueTotal })
    : undefined
  void embeddings?.warm(config.embedding.model, config.embedding.device, config.embedding.dtype)
  // Recall embeds requests and procedures itself, because the core keeps its embedder to itself. Only the local
  // model is used: it shares the loaded model with the cores, while a remote provider would add a network call to
  // every turn. With the worker each account embeds through its own queue, as its core does.
  const procedureEmbedders = new Map<string, Embedder>()
  const procedureEmbedder = configured.embedding.provider !== 'local' ? undefined : (owner: string): Embedder => {
    const key = embeddings === undefined ? '' : owner
    let embedder = procedureEmbedders.get(key)
    if (embedder === undefined) {
      const embedding = { ...configured.embedding, dimensions: 0, openRouter: configured.embedding.openRouter ?? false }
      embedder = embeddings === undefined ? createEmbedder(embedding) : createEmbedderWithProvider(embedding, embeddings.forOwner(owner))
      procedureEmbedders.set(key, embedder)
    }
    return embedder
  }
  const pool = config.coreWorkers === 0 ? undefined : new CoreWorkerPool({
    workers: config.coreWorkers,
    gateTimeoutMs: config.coreGateTimeoutMs,
    contexts: config.coreCallContexts,
    bridge,
    inContext: () => routes.current() !== undefined,
    ...embeddings === undefined ? {} : { embeddings: owner => embeddings.forOwner(owner) },
    mayMaintain,
    lost: (owners) => { for (const owner of owners) cores.forget(owner) },
    warn: (message) => { logger.warn(message) },
  })
  // Every read and write passes its owner's namespace; this default labels the core's own requests.
  const namespace = { agentKind: MEMOS_AGENT, profileId: 'aeven', profileLabel: 'Aeven' }
  const cores: OwnerCores = new OwnerCores(async (owner) => {
    const accountRoot = accountHome(config.accounts, owner)
    mkdirSync(accountRoot.dataDir, { recursive: true, mode: 0o700 })
    const core = pool !== undefined
      ? await pool.open(owner, {
        agent: MEMOS_AGENT, namespace, home: accountRoot, config: memosConfig,
        hostLlm: bridge !== null, hostEmbeddings: embeddings !== undefined, autoRecovery: recovery,
      })
      : await bootstrapMemoryCore({
        agent: MEMOS_AGENT,
        namespace,
        home: accountRoot,
        config: memosConfig,
        hostLlmBridge: bridge,
        ...embeddings === undefined ? {} : { embeddingProvider: embeddings.forOwner(owner) },
        autoRecovery: recovery,
        maintenanceGate: () => mayMaintain(owner),
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
    ...config.workspaceIdentity ? { workspaceId: (scope: MemoryScope) => {
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined) throw new Error('memory-memos: workspace identity requires a workspace registry')
      const placement = registry.placeSession(scope.sessionId)
      if (placement.state !== 'filed') return undefined
      if (placement.workspace.owner !== undefined && placement.workspace.owner !== scope.owner) {
        throw new Error('memory-memos: workspace belongs to another account')
      }
      return placement.workspace.id
    } } : {},
    toolLimits: {
      skills: configured.algorithm.retrieval.tier1TopK,
      traces: configured.algorithm.retrieval.tier2TopK,
      worldModels: configured.algorithm.retrieval.tier3TopK,
    },
    ...bridge && judges ? { judges, classify: input => classifyTurnDomain(bridge, input, config.classifyTimeoutMs) } : {},
    ...bridge === null ? {} : {
      relevance: {
        run: async (system: string, user: string, timeoutMs: number, signal: AbortSignal) => (await bridge.complete({
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0,
          maxTokens: 400,
          timeoutMs,
          signal,
          op: 'aeven.recall.relevance',
        })).text,
        timeoutMs: config.relevanceTimeoutMs,
        hedgeMs: config.relevanceHedgeMs,
        minMs: config.relevanceMinMs,
      },
    },
    judgeRecall: owner => (ctx.get('settings')?.cachedValueFor(MEMORY_RECALL_SETTINGS_NAMESPACE, owner) as MemoryRecallSettings | undefined)?.judge === true,
    ...config.sentenceRetrievals > 0 ? { sentenceRecall: { sentences: config.sentenceRetrievals, hits: config.sentenceHits } } : {},
    procedureCandidates: config.procedureCandidates,
    ...procedureEmbedder === undefined ? {} : {
      procedureEmbedding: {
        embed: (owner, inputs, signal) => procedureEmbedder(owner).embedMany(inputs, { signal }),
        minMargin: config.procedureMinMargin,
      },
    },
    rebuilding: owner => rebuilding.has(owner),
    ...bridge === null || !config.profile.enabled ? {} : {
      profiles: {
        store: new PersonProfiles({
          file: owner => join(accountHome(config.accounts, owner).dataDir, 'profile.json'),
          maxChars: config.profile.maxChars,
          batchFacts: config.profile.batchFacts,
          refreshMs: config.profile.refreshMs,
          timeoutMs: config.profile.timeoutMs,
          warn: (message) =>{  logger.warn(message) },
          info: (message) =>{  logger.info(message) },
        }),
        distill: async (system: string, user: string, timeoutMs: number) => (await bridge.complete({
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0,
          // One token per character bounds any profile text; the stored text is still cut to `maxChars`.
          maxTokens: config.profile.maxChars,
          timeoutMs,
          op: 'aeven.memory.profile',
        })).text,
      },
    },
    personFactsFile: owner => join(accountHome(config.accounts, owner).dataDir, 'person-facts.json'),
    warn: (message) =>{  logger.warn(message) },
    info: (message) =>{  logger.debug(message) },
  })

  logger.info(`ready (accounts=${config.accounts}, hostLlm=${String(config.hostLlm)}, autoRecovery=${String(recovery)})`)

  // Each account's memory follows it to every device its sync vault holds, once that vault is served here and
  // the account's database exists.
  const mirrors = new Map<string, MemorySyncMirror>()
  /** Accounts whose documents started over; their next mirror publishes every row again. */
  const republish = new Set<string>()
  // Accounts whose memory `openOnSync` is creating; the mirror starts once their database exists.
  const opening = new Set<string>()
  const mirror = (owner: string): void => {
    const sync = ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === undefined || state === 'disabled' || state === 'starting') return
    if (!maintenance.has(owner)) {
      const timing = { ttlMs: config.sync.maintenanceTtlMs, renewMs: config.sync.maintenanceRenewMs }
      const holder = new LeaseHolder(sync, owner, MEMORY_MAINTENANCE_LEASE, timing)
      maintenance.set(owner, holder)
      holder.start()
    }
    const dbFile = accountHome(config.accounts, owner).dbFile
    if (mirrors.has(owner)) return
    if (!existsSync(dbFile)) {
      if (config.openOnSync && !opening.has(owner)) {
        opening.add(owner)
        void cores.get(owner).then(() => { mirror(owner) }, (error: unknown) => {
          logger.warn(`memory sync: opening an account's memory failed: ${String(error)}`)
        }).finally(() => { opening.delete(owner) })
      }
      return
    }
    const warn = (message: string): void => { logger.warn(message) }
    const created = new MemorySyncMirror(owner, dbFile, sync, config.embedding.model, config.sync, warn, (table) => {
      // Another device's person memories may differ from the listing profile reads serve.
      if (table === 'traces') memory.personFactsChanged(owner)
    })
    mirrors.set(owner, created)
    try {
      created.start(republish.delete(owner))
    } catch (error) {
      logger.warn(`memory sync: starting for an account failed: ${String(error)}`)
    }
  }
  ctx.on('sync/status', mirror)
  // The account's shard ids changed with its key: the mirror is rebuilt once the account syncs again.
  ctx.on('sync/reset', (owner) => {
    const stale = mirrors.get(owner)
    if (stale === undefined) return
    mirrors.delete(owner)
    republish.add(owner)
    void stale.dispose().then(() => { mirror(owner) }, (error: unknown) => {
      logger.warn(`memory sync: stopping for an account failed: ${String(error)}`)
    })
  })
  ctx.on('sync/document', (owner, id) => { mirrors.get(owner)?.documentChanged(id) })
  ctx.effect(() => async () => {
    await Promise.all([...mirrors.values()].map(created => created.dispose()))
    mirrors.clear()
    await Promise.all([...maintenance.values()].map(holder => holder.dispose()))
    maintenance.clear()
  }, 'memory-memos.sync')

  if (config.warmOnSignIn) {
    // One load per account per run; a failed load is retried at the account's next sign-in.
    const warmed = new Set<string>()
    const stop = new AbortController()
    ctx.effect(() => () => { stop.abort() }, 'memory-memos.warm')
    ctx.on('credentials/session-updated', (_ref, user) => {
      if (warmed.has(user) || !existsSync(accountHome(config.accounts, user).dbFile)) return
      warmed.add(user)
      const load = (): void => {
        memory.prime(user, stop.signal).catch((error: unknown) => {
          warmed.delete(user)
          if (!stop.signal.aborted) logger.warn(`loading an account's memory at sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      if (config.warmDelayMs === 0) {
        load()
        return
      }
      const timer = setTimeout(load, config.warmDelayMs)
      // A pending load never keeps the Host alive, and stopping the provider cancels it.
      timer.unref()
      stop.signal.addEventListener('abort', () => { clearTimeout(timer) }, { once: true })
    })
  }

  ctx.effect(() => {
    const unregister = ctx.memory.register(memory)
    const unwatch = bridge ? ctx.on('llm/adapters-updated', () =>{  bridge.invalidateModelCapabilities() }) : () => {}
    return async () => {
      unwatch()
      unregister()
      await embeddings?.close()
      await memory.dispose()
      await pool?.close()
    }
  }, 'memory-memos.provider')
}
