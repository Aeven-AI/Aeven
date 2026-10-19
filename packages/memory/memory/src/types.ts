/** Provider-neutral vocabulary for long-term memory recall, capture, and inspection. */
import type { Branded } from '@aeven/brand'
import type { SessionId } from '@aeven/session/types'
import type { JsonValue } from '@aeven/util-values'

/** Provider-owned identity of one stored memory item: a trace, policy, world model, skill, or episode. */
export type MemoryItemId = Branded<'MemoryItemId'>

/** Provider-owned identity of one captured task episode. */
export type MemoryEpisodeId = Branded<'MemoryEpisodeId'>

/** Model route whose provider and model run a memory provider's auxiliary LLM calls for one session. */
export interface MemoryLlmRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Session facts a provider partitions and attributes memory by. */
export interface MemoryScope {
  /** Account id of the signed-in user the session belongs to; memory is stored and read per owner. */
  readonly owner: string
  readonly sessionId: SessionId
  /** Working directory of the session, when it has one. */
  readonly cwd?: string
  /** Route for auxiliary LLM calls made on behalf of this session; absent means none is known yet. */
  readonly route?: MemoryLlmRoute
}

/**
 * What a memory is about, which decides where it is recalled. `person` and `project` memories come
 * from conversations; `world` is general knowledge about applications and environments; `experience`
 * is distilled know-how from earlier tasks.
 * - `person`: the user and the people the user tells about, recalled in every session of the owner.
 * - `project`: one workspace, recalled only in sessions of that workspace.
 * - `world` and `experience`: recalled in every session of the owner.
 */
export type MemoryDomain = 'person' | 'project' | 'world' | 'experience'

/** Kind of memory a recall hit refers to. */
export type MemoryHitKind = 'skill' | 'trace' | 'episode' | 'experience' | 'world-model'

/** One ranked recall result. */
export interface MemoryHit {
  readonly kind: MemoryHitKind
  readonly id: MemoryItemId
  readonly domain: MemoryDomain
  /** Provider retrieval tier, 1 (skills) through 3 (world models). */
  readonly tier: number
  readonly score: number
  readonly snippet: string
  /**
   * Epoch milliseconds the memory was recorded, when the provider knows it. Recall uses it to order
   * equally relevant memories and to retire a superseded statement in favour of the one that replaced it.
   * Absent for a memory with no recorded time, which then competes on score alone.
   */
  readonly recordedAt?: number
}

/** Per-tier result limits for one recall. */
export interface MemoryRecallLimits {
  readonly skills: number
  readonly traces: number
  readonly worldModels: number
}

/** One bounded recall. */
export interface MemoryRecallRequest {
  readonly scope: MemoryScope
  readonly query: string
  /** `turn-start` recalls context for a new direct-user turn; `tool` serves an explicit model lookup. */
  readonly purpose: 'turn-start' | 'tool'
  /** Restrict results to memory captured from `scope.sessionId`. */
  readonly sessionOnly?: boolean
  /** Per-tier limits; absent uses the provider's configured limits. */
  readonly limits?: MemoryRecallLimits
  /** Hard foreground budget in milliseconds; the provider resolves with `timedOut` instead of exceeding it. */
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

/** Result of one recall: hits the scope may see, ranked best first. */
export interface MemoryRecall {
  /** Hits visible to the scope: project memories of other workspaces are never returned. */
  readonly hits: readonly MemoryHit[]
  /** True when the foreground budget elapsed before retrieval completed. */
  readonly timedOut: boolean
}

/** One tool invocation observed during a captured turn. */
export interface MemoryToolCall {
  readonly callId: string
  readonly name: string
  /** JSON-normalized arguments, or the raw argument string when it was not valid JSON. */
  readonly input: unknown
  /** Text of the model-facing result; absent while the call has no result or the result has no text. */
  readonly output?: string
  /** Failure code when the call failed; absent on success or while the call has no result. */
  readonly errorCode?: string
  readonly startedAt?: number
  readonly endedAt?: number
}

/** Outcome evidence recorded during a turn; claims remain distinct from observed tool results. */
export interface MemoryOutcomeEvidence {
  /** Failed model requests for which a provider retry was scheduled. */
  readonly retryCodes: readonly string[]
  /** A direct-user correction, kept in the user's own words. */
  readonly correction?: string
  /** Assistant-reported verification and completed successful tool calls from the same turn; not a pass judgment. */
  readonly verification?: { readonly statement: string; readonly toolCallIds: readonly string[] }
  /** Objective of a goal durably marked complete during the turn. */
  readonly completedGoal?: string
}

/** One completed turn, assembled from the session log, for a provider to learn from. */
export interface MemoryTurn {
  readonly scope: MemoryScope
  readonly turn: number
  /** Direct-user text that entered the turn. */
  readonly userText: string
  readonly assistantText: string
  readonly reasoningText?: string
  readonly toolCalls: readonly MemoryToolCall[]
  readonly startedAt: number
  readonly endedAt: number
  /** `TurnEndReason.kind` of the logged `turn/end`. */
  readonly endReason: string
  /** Outcome evidence derived from committed session events. */
  readonly outcome?: MemoryOutcomeEvidence
}

/** Kind of memory item {@link MemoryProvider.detail} can read. */
export type MemoryDetailKind = 'trace' | 'policy' | 'world-model'

/** Bounded details of one memory item. */
export interface MemoryDetail {
  readonly kind: MemoryDetailKind
  readonly id: MemoryItemId
  readonly title: string
  readonly body: string
  /** Kind-specific facts, such as an episode id, a policy trigger, or a world-model version. */
  readonly facts: Readonly<Record<string, JsonValue>>
}

/** One trace in an episode timeline. */
export interface MemoryTimelineEntry {
  readonly id: MemoryItemId
  readonly time: number
  readonly userText: string
  readonly agentText: string
  readonly value?: number
  readonly tools: readonly { readonly name: string; readonly errorCode?: string }[]
}

/** One learned world or environment model. */
export interface MemoryEnvironment {
  readonly id: MemoryItemId
  readonly title: string
  readonly body: string
  readonly status: string
  readonly version: number
}

/** Lifecycle status of a crystallized skill. */
export type MemorySkillStatus = 'candidate' | 'active' | 'archived'

/** One crystallized skill. */
export interface MemorySkill {
  readonly id: MemoryItemId
  readonly name: string
  readonly status: MemorySkillStatus
  readonly guide: string
  readonly eta?: number
  readonly support?: number
  readonly gain?: number
}

/** One stored memory of the scope's owner, as listed for inspection. */
export interface MemoryRecord {
  readonly id: MemoryItemId
  readonly domain: MemoryDomain
  readonly time: number
  /** Short fact the provider distilled from the exchange; empty until distillation finishes. */
  readonly summary: string
  readonly userText: string
  readonly agentText: string
  readonly sessionId: SessionId
  readonly episodeId: MemoryEpisodeId
}

/** Page request for {@link MemoryProvider.list}. */
export interface MemoryListRequest {
  readonly owner: string
  /** Text filter; absent lists everything. */
  readonly query?: string
  /** Domains to list; absent lists every domain. */
  readonly domains?: readonly MemoryDomain[]
  /**
   * Workspace whose sessions may see the listed memories: project memory of any other workspace is left out, as
   * recall leaves it out. Absent lists the project memory of every workspace.
   */
  readonly cwd?: string
  readonly limit: number
  readonly offset: number
  readonly signal: AbortSignal
}

/** One page of the owner's memories. */
export interface MemoryPage {
  readonly records: readonly MemoryRecord[]
  /** Number of memories matching the query across all pages. */
  readonly total: number
}

/**
 * One learned procedure: a memory whose text is `Learned procedure <name>: <description>`, a blank line, and the
 * Markdown procedure, and whose summary is `Learned procedure <name>: <condensed procedure>`.
 */
export interface LearnedProcedure {
  readonly id: MemoryItemId
  /** Kebab-case name of the kind of task the procedure does. */
  readonly name: string
  /** One line: what the procedure does and when to use it. */
  readonly description: string
  /** The condensed procedure memory recall delivers, without the leading prefix and name. */
  readonly summary: string
  /** The full Markdown procedure. */
  readonly content: string
  readonly domain: MemoryDomain
  readonly time: number
  /** Session whose work the procedure was learned from or saved in. */
  readonly sessionId: SessionId
}

/** Request for the owner's learned procedures. */
export interface LearnedProceduresRequest {
  readonly owner: string
  /** Workspace whose sessions may see the procedures; see {@link MemoryListRequest.cwd}. */
  readonly cwd?: string
  readonly signal: AbortSignal
}

/** Direction of a human judgment about one turn. */
export type MemoryFeedbackPolarity = 'positive' | 'negative'

/**
 * A long-term memory implementation registered on `ctx.memory`.
 *
 * Read operations are foreground work bounded by the caller's signal. `capture`
 * and `closeSession` are ordered per session: a close runs after every capture
 * already accepted for that session.
 */
export interface MemoryProvider {
  /** Stable provider identity, shown in diagnostics. */
  readonly id: string
  /**
   * Retrieve memory relevant to a query within the request's hard budget.
   * @param request - query, scope, and foreground budget.
   * @returns ranked hits visible to the scope; a budget overrun resolves with `timedOut: true`.
   */
  recall(request: MemoryRecallRequest): Promise<MemoryRecall>
  /**
   * Accept one completed turn for background learning; failures are the provider's to log.
   * @param turn - turn assembled from committed session events.
   */
  capture(turn: MemoryTurn): void
  /**
   * Release per-session provider state after the session's accepted captures finish.
   * @param sessionId - session that is no longer live.
   * @returns after the provider released the session.
   */
  closeSession(sessionId: SessionId): Promise<void>
  /**
   * Read one memory item.
   * @param request - scope, item kind, and id.
   * @returns the item, or undefined when the scope holds no such item.
   */
  detail(request: {
    readonly scope: MemoryScope
    readonly kind: MemoryDetailKind
    readonly id: MemoryItemId
    readonly signal: AbortSignal
  }): Promise<MemoryDetail | undefined>
  /**
   * Read the ordered traces of one episode.
   * @param request - scope, episode id, and maximum entry count.
   * @returns entries in capture order, at most `limit`.
   */
  timeline(request: {
    readonly scope: MemoryScope
    readonly episodeId: MemoryEpisodeId
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly MemoryTimelineEntry[]>
  /**
   * List learned environment models.
   * @param request - scope, optional keyword filter, and maximum count.
   * @returns at most `limit` models.
   */
  environments(request: {
    readonly scope: MemoryScope
    readonly query?: string
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly MemoryEnvironment[]>
  /**
   * List crystallized skills.
   * @param request - scope, optional status filter, and maximum count.
   * @returns at most `limit` skills.
   */
  skills(request: {
    readonly scope: MemoryScope
    readonly status?: MemorySkillStatus
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly MemorySkill[]>
  /**
   * Load one skill and record that the session selected it for its current task.
   * @param request - scope, skill id, and the tool call that selected it.
   * @returns the skill, or undefined when the scope holds no such skill.
   */
  useSkill(request: {
    readonly scope: MemoryScope
    readonly id: MemoryItemId
    readonly callId: string
    readonly signal: AbortSignal
  }): Promise<MemorySkill | undefined>
  /**
   * List an owner's memories, newest first. Needs no session: the memory manager lists outside one.
   * With `domains`, the page, its offset, and `total` all count only memories in one of those domains.
   * @param request - account id, optional text query, optional domain filter, and page bounds.
   * @returns one page and the total match count.
   */
  list(request: MemoryListRequest): Promise<MemoryPage>
  /**
   * Store one memory: a fact the user explicitly asked to be remembered, or know-how learned from completed work.
   * @param request - scope, the text, and its domain: the user, the scope's project, an application or tool
   *   (`world`), or know-how from earlier tasks (`experience`).
   * @returns the stored memory's id, after it is durable.
   */
  remember(request: {
    readonly scope: MemoryScope
    readonly text: string
    readonly domain: MemoryDomain
    readonly signal: AbortSignal
  }): Promise<MemoryItemId>
  /**
   * Replace the summary of one of an owner's memories.
   * @param request - account id, memory id, and the corrected summary.
   * @returns the updated memory, or undefined when the owner has no such memory.
   */
  edit(request: {
    readonly owner: string
    readonly id: MemoryItemId
    readonly summary: string
    readonly signal: AbortSignal
  }): Promise<MemoryRecord | undefined>
  /**
   * Delete one of an owner's memories.
   * @param request - account id and memory id.
   * @returns true when a memory of this owner was deleted.
   */
  forget(request: { readonly owner: string; readonly id: MemoryItemId; readonly signal: AbortSignal }): Promise<boolean>
  /**
   * Record a human judgment about one captured turn of the scope's session.
   * @param request - scope, turn number, polarity, and optional note.
   * @returns true when the turn's memory was found and the judgment recorded.
   */
  feedback(request: {
    readonly scope: MemoryScope
    readonly turn: number
    readonly polarity: MemoryFeedbackPolarity
    readonly note?: string
  }): Promise<boolean>
}
