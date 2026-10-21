/** MemOS-backed {@link MemoryProvider}: namespaces, per-session capture ordering, and MemOS session lifecycle. */
import { brandString } from '@aeven/brand'
import { LEARNED_PROCEDURE_PREFIX, MEMORY_TOOL, memoryOriginLabel } from '@aeven/memory'
import type {
  MemoryDetail,
  MemoryDomain,
  MemoryEnvironment,
  MemoryEpisodeId,
  MemoryHit,
  MemoryItemId,
  MemoryLlmRoute,
  MemoryOrigin,
  MemoryPage,
  MemoryProvider,
  MemoryRecall,
  MemoryRecallLimits,
  MemoryRecallRequest,
  MemoryRecord,
  MemoryScope,
  MemorySkill,
  MemoryTimelineEntry,
  MemoryTurn,
  ProcedureStatus,
} from '@aeven/memory'
import type { SessionId } from '@aeven/session'
import type { JsonValue } from '@aeven/util-values'
import type { RetrievalHitDTO, RuntimeNamespace, SkillDTO, TraceDTO } from '@deepseek-ai/memos-local-plugin/agent-contract/dto.js'
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'
import type { OwnerCores } from './cores.ts'
import { MemoryDeadlineError, withDeadline } from './deadline.ts'
import { queryClauses, withoutExactIdentifiers } from './query.ts'
import { isLogMemory, LOG_TAG, parseRelevance, RELEVANCE_PROMPT, relevanceInput, type CandidateKind, type FilterCandidate } from './filter.ts'
import type { LlmRouteContext } from './host-llm.ts'
import { SUPERSEDED_TAG, traceDomain, withDomainTag, withSupersededTag, type ClassifyInput, type TurnDomain, type TurnJudgeContext, type TurnRevision } from './domain.ts'
import { normalizeNamespace } from '@deepseek-ai/memos-local-plugin/core/runtime/namespace.js'

/** MemOS agent kind. The embedded Viewer server keys its in-process host behavior on this value. */
export const MEMOS_AGENT = 'deepseek-harness'

/**
 * MemOS profile id of one account's memory.
 * @param owner - account id of the signed-in user.
 * @returns the profile id every scope of that owner maps to.
 */
export function ownerProfile(owner: string): string {
  // MemOS stores profile ids with `:` normalized to `-`; listing filters compare the stored form.
  return `user-${owner}`
}

/** Facts the runtime needs beyond the MemOS cores. */
export interface MemosMemoryOptions {
  /** One MemOS core per owning account, each over that account's own database. */
  readonly cores: OwnerCores
  readonly routes: LlmRouteContext
  /** MemOS's configured per-tier result limits for an explicit search. */
  readonly toolLimits: MemoryRecallLimits
  /**
   * Classifies a captured turn's domain on the owning session's route when no turn judgment exists;
   * absent leaves the capture-location fallback.
   */
  readonly classify?: (input: ClassifyInput) => Promise<TurnDomain | undefined>
  /** Turn-capture scope whose final-reply summarize request judges the turn; absent captures without judgment. */
  readonly judges?: TurnJudgeContext
  /**
   * The turn-start relevance judgment: `run` takes a system prompt and a user message on the current route and
   * returns the model's answer within `timeoutMs`, inside the recall's own budget. Absent delivers retrieval's
   * ranking unjudged.
   */
  readonly relevance?: {
    readonly run: (system: string, user: string, timeoutMs: number) => Promise<string>
    readonly timeoutMs: number
  }
  /** True while an owner's memory index is being rebuilt, when its vectors are not comparable to new queries. */
  readonly rebuilding?: (owner: string) => boolean
  readonly warn: (message: string) => void
  readonly info: (message: string) => void
}

/** Per-Aeven-session state; one Aeven session may span several MemOS sessions after episode routing. */
interface SessionState {
  /** Account whose core holds the session's MemOS sessions; set by the session's first scoped operation. */
  owner?: string
  readonly memorySessions: Set<string>
  route?: MemoryLlmRoute
  lastEpisode?: string
  /** MemOS trace and episode of each captured turn, for feedback and correction of that exchange. */
  readonly turns: Map<number, {
    readonly traceId: string
    readonly episodeId: string
    readonly domain: TurnDomain | undefined
  }>
  /** Assistant reply of the latest captured turn, which the next turn's judgment reads for its referent. */
  lastReply?: { readonly turn: number; readonly text: string }
  /**
   * Traces recall and `memory_get` gave the session since its last capture, oldest first, by id. The next capture
   * hands them to its judgment, which may rewrite one the exchange showed to be wrong or out of date.
   */
  readonly served: Map<string, string>
  /** The turn-start relevance judgment found the person sharing how they feel or what is happening to them. */
  sharing?: boolean
  pending?: Promise<void>
}

/**
 * Trace tag of a turn in which the person shared how they feel or what is happening to them, as the turn-start
 * relevance judgment found. A new session offers these first among the person's recent memories.
 */
const SHARING_TAG = 'person:sharing'

/** Most traces one capture offers its judgment for revision; older ones are dropped first. */
const SERVED_MEMORIES = 20

/**
 * Characters of the person's own message that automatic recall adds to a memory about them captured from a
 * conversation. A summary records the exchange, often the assistant's side of it; the person's words say what
 * they actually said and felt.
 */
const PERSON_WORDS_CHARS = 160

/** Person traces one page of the recent-memory scan reads. */
const RECENT_PERSON_PAGE = 100

/** Pages the recent-memory scan reads at most, which bounds its cost after a large import. */
const RECENT_PERSON_PAGES = 10

/** Characters of each served trace the judgment reads. */
const SERVED_MEMORY_CHARS = 400

/**
 * Most memories one captured turn may rewrite. A revision replaces what automatic recall states, so one exchange is
 * not allowed to rewrite a broad set of memories on its own judgment.
 */
const MAX_REVISIONS = 2

/** Prefix of the trace tag that records a revision, followed by the trace of the exchange that made it. */
const REVISED_TAG = 'revised:'

/** MemOS provider behind `ctx.memory`. */
export class MemosMemory implements MemoryProvider {
  readonly id = 'memos'
  private readonly sessions = new Map<SessionId, SessionState>()
  /** What each turn-start candidate is, from the trace its hit was read from; hits with no entry use their kind. */
  private readonly candidateKinds = new WeakMap<MemoryHit, CandidateKind>()
  private disposing: Promise<void> | undefined

  constructor(private readonly options: MemosMemoryOptions) {}

  /** One MemOS profile per owning account, so recall, capture, and reads never cross accounts. */
  private namespaceOf(scope: MemoryScope): RuntimeNamespace {
    return {
      agentKind: MEMOS_AGENT,
      profileId: ownerProfile(scope.owner),
      profileLabel: scope.owner,
      ...scope.cwd === undefined ? {} : { workspacePath: scope.cwd },
      sessionKey: scope.sessionId,
    }
  }

  private state(scope: MemoryScope): SessionState {
    let state = this.sessions.get(scope.sessionId)
    if (!state) {
      state = { owner: scope.owner, memorySessions: new Set(), turns: new Map(), served: new Map() }
      this.sessions.set(scope.sessionId, state)
    }
    return state
  }

  private withRoute<T>(route: MemoryLlmRoute | undefined, operation: () => T): T {
    return route === undefined ? operation() : this.options.routes.run(route, operation)
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecall> {
    const recall = await this.recallHits(request)
    this.noteServed(request.scope, recall.hits.flatMap(hit => hit.kind === 'trace' ? [{ id: hit.id, text: hit.snippet }] : []))
    return recall
  }

  /** Remember which traces the session was given, for the judgment of the turn that reads them. */
  private noteServed(scope: MemoryScope, memories: readonly { readonly id: string; readonly text: string }[]): void {
    if (memories.length === 0) return
    const served = this.state(scope).served
    for (const { id, text } of memories) {
      served.delete(id)
      served.set(id, text.replace(/\s+/gu, ' ').trim().slice(0, SERVED_MEMORY_CHARS))
    }
    for (const id of served.keys()) {
      if (served.size <= SERVED_MEMORIES) break
      served.delete(id)
    }
  }

  private async recallHits(request: MemoryRecallRequest): Promise<MemoryRecall> {
    const { scope } = request
    if (scope.route) this.state(scope).route = scope.route
    const deadlineAt = Date.now() + request.timeoutMs
    const turnStart = request.purpose === 'turn-start'
    if (turnStart && this.options.rebuilding?.(scope.owner) === true) {
      // New queries and the vectors still being rewritten come from different models; nothing they match is reliable.
      this.options.info(`recall skipped for ${scope.sessionId}: the memory index is being rebuilt`)
      return { hits: [], timedOut: false, degraded: true }
    }
    try {
      let hits = await this.search(request, deadlineAt, turnStart)
      // An explicit search runs no relevance judgment, so the core's per-tier top-K arrives as-is and each tier
      // pads the list with whatever it has: world models about CSS tokens and file preconditions beside the fact
      // that was asked for. Keep the hits that compete with the best result and drop the rest.
      if (!turnStart) return { hits: withoutDistantHits(hits), timedOut: false }
      if (hits.length === 0) {
        // MemOS turns every long identifier in a query into a hard eligibility filter, so a pasted
        // session id or commit hash drops all candidates. A turn-start query is a topic query; retry it
        // without those tokens rather than delivering no memory for the turn.
        const topic = withoutExactIdentifiers(request.query)
        if (topic !== request.query && topic.length > 0) hits = await this.search({ ...request, query: topic }, deadlineAt, turnStart)
      }
      const recent = request.recent === undefined ? [] : await this.recentPersonHits(request, hits, deadlineAt)
      return await this.judge(request, [...hits, ...recent], deadlineAt)
    } catch (error) {
      if (!(error instanceof MemoryDeadlineError)) throw error
      return { hits: [], timedOut: true }
    }
  }

  /**
   * The person's own memories from the last `request.recent.hours`, as candidates: newest first, outside this
   * session, and not already among `hits`. Superseded, corrected, imported, procedure, and log memories are left
   * out: an imported fact is the person's history, not something that just happened to them.
   */
  private async recentPersonHits(request: MemoryRecallRequest, hits: readonly MemoryHit[], deadlineAt: number): Promise<MemoryHit[]> {
    const recent = request.recent
    if (recent === undefined || recent.hours <= 0 || recent.items <= 0) return []
    const { scope } = request
    const since = Date.now() - recent.hours * 3_600_000
    const seen = new Set<string>(hits.map(hit => hit.id))
    const core = await this.options.cores.get(scope.owner)
    const eligible = (trace: TraceDTO): boolean => trace.ts >= since && trace.sessionId !== scope.sessionId
      && !seen.has(trace.id) && (trace.summary ?? '').trim() !== '' && !trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)
      && !(trace.tags ?? []).some(tag => tag === 'outcome:correction' || tag === IMPORT_TAG || tag.startsWith(SUPERSEDED_TAG))
      && !isLogMemory(trace.tags, trace.summary ?? '')
    // Read the whole window: a bulk import or one long conversation fills the newest rows, so the newest few memories
    // can all come from one place and say nothing about the rest of the person's day.
    const found: TraceDTO[] = []
    for (let page = 0; page < RECENT_PERSON_PAGES; page++) {
      const traces = await withDeadline(core.listTraces({
        ownerAgentKind: MEMOS_AGENT,
        ownerProfileId: ownerProfile(scope.owner),
        includeAllNamespaces: true,
        domains: ['person'],
        limit: RECENT_PERSON_PAGE,
        offset: page * RECENT_PERSON_PAGE,
      }), deadlineAt, request.signal, `Memory recall exceeded ${request.timeoutMs}ms`)
      found.push(...traces.filter(eligible))
      if (traces.length < RECENT_PERSON_PAGE || traces.every(trace => trace.ts < since)) break
    }
    found.sort((a, b) => b.ts - a.ts)
    // What the person said about how they are doing comes first. The rest samples every conversation in rounds: each
    // conversation's newest memory first, newest conversations first, then each one's second newest, so the limit
    // reaches every recent conversation before it takes more from one.
    const sampled: TraceDTO[] = found.filter(trace => trace.tags?.includes(SHARING_TAG) === true)
    const bySession = new Map<string, TraceDTO[]>()
    for (const trace of found) {
      if (trace.tags?.includes(SHARING_TAG) === true) continue
      const list = bySession.get(trace.sessionId) ?? []
      list.push(trace)
      bySession.set(trace.sessionId, list)
    }
    for (let round = 0; round < recent.perSession; round++) {
      for (const list of bySession.values()) {
        const trace = list[round]
        if (trace !== undefined) sampled.push(trace)
      }
    }
    return sampled
      .slice(0, recent.items)
      .map((trace) => {
        const memory: MemoryHit = {
          kind: 'trace',
          id: brandString<MemoryItemId>(trace.id),
          domain: 'person',
          tier: 2,
          score: 0,
          snippet: recallSnippet(trace, 'person') ?? '',
          recordedAt: trace.ts,
          origin: originOf(trace),
        }
        this.candidateKinds.set(memory, kindOfTrace(trace.tags, trace.summary ?? '', trace.userText))
        return memory
      })
  }

  /**
   * Keep the candidates the relevance judgment chooses, in its order. Without a judge every candidate stays; when the
   * judgment fails or runs out of time, at most two mechanically ranked candidates stay and the recall is degraded.
   */
  private async judge(request: MemoryRecallRequest, candidates: readonly MemoryHit[], deadlineAt: number): Promise<MemoryRecall> {
    const relevance = this.options.relevance
    if (candidates.length === 0 || relevance === undefined) return { hits: candidates, timedOut: false }
    const now = Date.now()
    const offered: FilterCandidate[] = candidates.map(hit => ({
      kind: this.candidateKinds.get(hit) ?? kindOfHit(hit),
      domain: hit.domain,
      ...hit.recordedAt === undefined ? {} : { recordedAt: hit.recordedAt },
      ...hit.procedureStatus === undefined ? {} : { procedureStatus: hit.procedureStatus },
      text: hit.snippet,
    }))
    const timeoutMs = Math.min(relevance.timeoutMs, deadlineAt - now - 50)
    const fallback = (reason: string): MemoryRecall => {
      this.options.warn(`recall relevance judgment ${reason} for ${request.scope.sessionId}; delivering a mechanical fallback`)
      const kept = candidates.filter((_, index) => offered[index]?.kind !== 'log' && offered[index]?.procedureStatus !== 'candidate').slice(0, 2)
      return { hits: kept, timedOut: false, degraded: true }
    }
    if (timeoutMs < 300) return fallback('had no time left')
    const user = relevanceInput(request.request ?? request.query, request.context ?? '', offered, now)
    let answer: string
    try {
      answer = await this.withRoute(request.scope.route, () => relevance.run(RELEVANCE_PROMPT, user, timeoutMs))
    } catch (error) {
      return fallback(`failed (${describe(error)})`)
    }
    const judgment = parseRelevance(answer, candidates.length)
    if (judgment === undefined) return fallback('returned no usable answer')
    const { sessionId } = request.scope
    this.options.info(`recall judged ${sessionId}: lead=${judgment.lead} kept ${judgment.keep.length} of ${candidates.length}`)
    const state = this.state(request.scope)
    state.sharing = judgment.sharing
    const hits = judgment.keep.flatMap(index => candidates[index] ?? [])
    return { hits, timedOut: false, lead: judgment.lead, sharing: judgment.sharing }
  }

  /**
   * One MemOS retrieval, hydrated and filtered for its caller.
   * @param request - the caller's recall request; `query` is sent verbatim.
   * @param deadlineAt - epoch milliseconds the whole recall must finish within.
   * @param turnStart - true for automatic turn-start recall, which differs in limits, filtering, and session scoping.
   * @returns the visible hits, or throws {@link MemoryDeadlineError} at the deadline.
   */
  private async search(request: MemoryRecallRequest, deadlineAt: number, turnStart: boolean): Promise<MemoryHit[]> {
    const { scope } = request
    const limits = turnStart ? request.limits : request.limits ?? this.options.toolLimits
    const callOptions = { signal: request.signal, ...turnStart ? {} : { foreground: true } }
    const retrieve = async (query: string): Promise<MemoryHit[]> => {
      const core = await this.options.cores.get(scope.owner)
      const result = await this.withRoute(scope.route, () => core.searchMemory({
        agent: MEMOS_AGENT,
        namespace: this.namespaceOf(scope),
        ...turnStart || request.sessionOnly === true ? { sessionId: scope.sessionId } : {},
        query,
        // MemOS exposes the defer-filter hint only through its turn-start retrieval path. Its filter never runs:
        // automatic recall is judged by Aeven's relevance judgment, which knows each candidate's domain, age, and
        // kind, and an explicit search is narrowed by {@link withoutDistantHits} instead, since the model chose
        // the query and pays for the answer in its own context.
        reason: 'turn_start',
        contextHints: {
          __memosDeferLlmFilterToCaller: true,
          ...scope.cwd === undefined ? {} : { cwd: scope.cwd },
        },
        deadlineAt,
        llmFilterMalformedRetries: 0,
        ...limits === undefined ? {} : {
          topK: { tier1: limits.skills, tier2: limits.traces, tier3: limits.worldModels },
        },
      }, callOptions))
      return await this.visibleHits(core, scope, result.hits, turnStart)
    }
    // One embedding of a query that names four things sits far from all four, so an explicit search that names
    // several topics retrieves each of them and merges. A single-topic query, which is every turn-start query
    // and most explicit ones, still costs exactly one retrieval.
    const clauses = turnStart ? [] : queryClauses(request.query)
    const search = clauses.length === 0
      ? retrieve(request.query)
      : Promise.all(clauses.map(retrieve)).then(mergeHits)
    // A provider can be temporarily non-cancellable (for example while a local ONNX model loads),
    // so the deadline is enforced here as well as inside the core; it also bounds the account's first core open.
    return withDeadline(search, deadlineAt, request.signal, `Memory recall exceeded ${request.timeoutMs}ms`)
  }

  /** MemOS workspace key of a working directory, as MemOS stamps it on captured memory. */
  private workspaceOf(cwd: string | undefined): string | undefined {
    return cwd === undefined ? undefined : normalizeNamespace({ workspacePath: cwd }, MEMOS_AGENT).workspaceId
  }

  /**
   * Classify each hit's domain and drop project memory of other workspaces; MemOS retrieval does not
   * filter by workspace, so this is where project memory stays in its project.
   */
  private async visibleHits(
    core: MemoryCore,
    scope: MemoryScope,
    hits: readonly RetrievalHitDTO[],
    turnStart: boolean,
  ): Promise<MemoryHit[]> {
    const workspace = this.workspaceOf(scope.cwd)
    const namespace = this.namespaceOf(scope)
    const classified = await Promise.all(hits.map(async (hit) => {
      const hitOrigin = await this.hitOrigin(core, hit, namespace, turnStart)
      const { domain, workspaceId, summary, correction, superseded, procedureStatus, candidateKind, recordedAt, origin } = hitOrigin
      const memory: MemoryHit = {
        kind: hit.refKind,
        id: brandString<MemoryItemId>(hit.refId),
        domain,
        tier: hit.tier,
        score: hit.score,
        // A trace's distilled summary states the remembered fact; the raw exchange is the fallback.
        snippet: summary || toAevenToolReferences(hit.snippet),
        ...recordedAt === undefined ? {} : { recordedAt },
        ...procedureStatus === undefined ? {} : { procedureStatus },
        ...origin === undefined ? {} : { origin },
      }
      if (candidateKind !== undefined) this.candidateKinds.set(memory, candidateKind)
      return { memory, workspaceId, correction, superseded, archived: procedureStatus === 'archived' }
    }))
    return classified
      .filter(({ memory, workspaceId, correction, superseded, archived }) =>
        (!turnStart || (!correction && !superseded && !archived))
        && (memory.domain !== 'project' || (workspace !== undefined && workspaceId === workspace)))
      .map(({ memory }) => memory)
  }

  /**
   * Automatic recall states the distilled summary, because it is injected on every turn; an explicit search
   * returns the whole trace, so a fact the distillation dropped is still reachable. A learned procedure carries its
   * status: automatic recall never delivers an `archived` one and offers a `candidate` to the relevance judgment as
   * unproven.
   */
  private async hitOrigin(core: MemoryCore, hit: RetrievalHitDTO, namespace: RuntimeNamespace, turnStart: boolean): Promise<{
    domain: MemoryDomain
    workspaceId: string | null | undefined
    summary?: string
    correction?: boolean
    superseded?: boolean
    procedureStatus?: ProcedureStatus
    candidateKind?: CandidateKind
    recordedAt?: number
    origin?: MemoryOrigin
  }> {
    switch (hit.refKind) {
      case 'experience':
      case 'skill':
        return { domain: 'experience', workspaceId: hit.ownerWorkspaceId }
      case 'world-model':
        return { domain: 'world', workspaceId: hit.ownerWorkspaceId }
      case 'trace': {
        const trace = await core.getTrace(hit.refId, namespace)
        const workspaceId = trace?.ownerWorkspaceId ?? hit.ownerWorkspaceId
        const domain = traceDomain(trace?.tags, workspaceId)
        const summary = trace === null ? undefined : turnStart ? recallSnippet(trace, domain) : traceSnippet(trace)
        return {
          domain,
          workspaceId,
          correction: trace?.tags?.includes('outcome:correction') ?? false,
          superseded: trace?.tags?.some(tag => tag.startsWith(SUPERSEDED_TAG)) ?? false,
          ...trace !== null && trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)
            ? { procedureStatus: procedureStatusOf(trace.tags) ?? 'candidate' }
            : {},
          ...trace === null ? {} : { candidateKind: kindOfTrace(trace.tags, trace.summary ?? '', trace.userText) },
          ...summary ? { summary } : {},
          // An undated import's trace time is when it was imported, which says nothing about when it happened.
          ...trace === null || trace.tags?.includes(UNDATED_TAG) === true ? {} : { recordedAt: trace.ts },
          ...trace === null ? {} : { origin: originOf(trace) },
        }
      }
      case 'episode':
        return { domain: traceDomain(undefined, hit.ownerWorkspaceId), workspaceId: hit.ownerWorkspaceId }
    }
  }

  capture(turn: MemoryTurn): void {
    if (this.disposing) return
    const state = this.state(turn.scope)
    if (turn.scope.route) state.route = turn.scope.route
    // Taken now, at the turn's end: the next turn's recall must not join this turn's judgment.
    const served = [...state.served].map(([id, text]) => ({ id, text }))
    state.served.clear()
    const sharing = state.sharing === true
    state.sharing = false
    void this.schedule(state, async () => {
      const captured = await this.captureTurn(state, turn, `${turn.scope.sessionId}:${turn.turn}`, undefined, served)
      state.turns.set(turn.turn, { traceId: captured.traceId, episodeId: captured.episodeId, domain: captured.domain })
      state.lastReply = { turn: turn.turn, text: turn.assistantText }
      if (captured.corrects) await this.supersedePrevious(state, turn, captured.traceId)
      await this.revise(turn.scope, served, captured.revisions, captured.traceId)
      if (sharing) await this.markSharing(turn.scope, captured.traceId)
    }).catch((error: unknown) => {
      this.options.warn(`background write failed for session ${turn.scope.sessionId}: ${describe(error)}`)
    })
  }

  /**
   * Record that a correction replaced what the turn before it stated. A correction answers the exchange it
   * follows, so that exchange's trace stops being current; the tag names its replacement, and automatic recall
   * leaves it out while explicit search still returns it as history. Independently remembered facts stay current:
   * a turn-level judgment identifies no particular fact in a batch as replaced.
   *
   * This runs at capture, after the turn ended, so it costs the request path nothing. A correction whose
   * preceding turn was never captured, or which replaced the same trace twice, writes nothing.
   * @param state - the session's capture state, holding the trace each earlier turn produced.
   * @param turn - the turn that carried the correction.
   * @param replacementTraceId - the trace the correction itself produced.
   */
  private async supersedePrevious(state: SessionState, turn: MemoryTurn, replacementTraceId: string): Promise<void> {
    const previous = state.turns.get(turn.turn - 1)
    if (previous === undefined) return
    const core = await this.options.cores.get(turn.scope.owner)
    const traceId = previous.traceId
    if (traceId === replacementTraceId) return
    try {
      const trace = await core.getTrace(traceId, this.namespaceOf(turn.scope))
      if (trace === null) return
      await core.updateTrace(traceId, {
        tags: withSupersededTag(trace.tags, replacementTraceId),
      })
    } catch (error) {
      this.options.warn(`supersede failed for ${traceId}: ${describe(error)}`)
    }
  }

  /**
   * Rewrite memories the captured exchange showed to be wrong or out of date. The judgment states each one as now
   * known, so automatic recall delivers the checked statement instead of the stale one; the trace keeps its original
   * exchange and gains a tag naming the exchange that revised it. Learned procedures are revised by the capability
   * learner, never here.
   * @param scope - the session that captured the exchange.
   * @param served - the traces the judgment read, in the order it numbered them.
   * @param revisions - the judgment's revisions, by index into `served`.
   * @param revisingTraceId - the trace of the exchange that made them.
   */
  private async revise(
    scope: MemoryScope,
    served: readonly { readonly id: string; readonly text: string }[],
    revisions: readonly TurnRevision[],
    revisingTraceId: string,
  ): Promise<void> {
    if (revisions.length === 0) return
    const core = await this.options.cores.get(scope.owner)
    const namespace = this.namespaceOf(scope)
    for (const { index, statement } of revisions.slice(0, MAX_REVISIONS)) {
      const id = served[index]?.id
      if (id === undefined || id === revisingTraceId) continue
      try {
        const trace = await core.getTrace(id, namespace)
        if (trace === null || trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)) continue
        await core.updateTrace(id, { summary: statement, tags: [...new Set([...trace.tags ?? [], `${REVISED_TAG}${revisingTraceId}`])] })
        this.options.info(`revised memory ${id} from ${revisingTraceId}`)
      } catch (error) {
        this.options.warn(`revision of ${id} failed: ${describe(error)}`)
      }
    }
  }

  /** Tag a captured turn in which the person shared how they feel, so later sessions offer it first. */
  private async markSharing(scope: MemoryScope, traceId: string): Promise<void> {
    try {
      const core = await this.options.cores.get(scope.owner)
      const trace = await core.getTrace(traceId, this.namespaceOf(scope))
      if (trace === null) return
      await core.updateTrace(traceId, { tags: [...new Set([...trace.tags ?? [], SHARING_TAG])] })
    } catch (error) {
      this.options.warn(`sharing tag failed for ${traceId}: ${describe(error)}`)
    }
  }

  /**
   * Run one write after every write already accepted for the session. The caller sees the task's own
   * outcome; a failed task never blocks the ones queued after it.
   */
  private schedule<T>(state: SessionState, task: () => Promise<T>): Promise<T> {
    const run = (state.pending ?? Promise.resolve()).then(task)
    const settled = run.then(() => undefined, () => undefined)
    state.pending = settled
    void settled.then(() => {
      if (state.pending === settled) delete state.pending
    })
    return run
  }

  private async captureTurn(
    state: SessionState,
    turn: MemoryTurn,
    turnKey: string,
    domain?: TurnDomain,
    served: readonly { readonly id: string; readonly text: string }[] = [],
  ): Promise<{
    traceId: string
    episodeId: string
    corrects: boolean
    domain: TurnDomain | undefined
    revisions: readonly TurnRevision[]
  }> {
    const { scope } = turn
    const core = await this.options.cores.get(scope.owner)
    const namespace = this.namespaceOf(scope)
    let memorySessionId: string = scope.sessionId
    let episodeId: string | undefined
    try {
      const prepareTurn = core.prepareTurn?.bind(core)
      if (!prepareTurn) throw new Error('MemoryCore does not expose prepareTurn')
      const prepared = await this.withRoute(scope.route, () => prepareTurn({
        agent: MEMOS_AGENT,
        namespace,
        sessionId: memorySessionId,
        turnKey,
        userText: turn.userText,
        contextHints: { __memosBackgroundLifecycle: true, turn: turn.turn, ...scope.cwd === undefined ? {} : { cwd: scope.cwd } },
        ts: turn.startedAt,
      }))
      memorySessionId = prepared.sessionId
      episodeId = prepared.episodeId
      state.memorySessions.add(memorySessionId)
    } catch (error) {
      this.options.warn(`turn routing failed for session ${scope.sessionId}; opening a lazy episode: ${describe(error)}`)
    }
    if (!state.memorySessions.has(memorySessionId)) {
      memorySessionId = await core.openSession({ agent: MEMOS_AGENT, sessionId: memorySessionId, namespace, meta: { namespace } })
      state.memorySessions.add(memorySessionId)
    }
    episodeId ??= await core.openEpisode({ sessionId: memorySessionId, userMessage: turn.userText })
    state.lastEpisode = episodeId

    for (const tool of turn.toolCalls) {
      if (tool.endedAt === undefined) continue
      const endedAt = tool.endedAt
      try {
        this.withRoute(scope.route, () => {
          core.recordToolOutcome({
            sessionId: memorySessionId,
            episodeId,
            tool: tool.name,
            success: tool.errorCode === undefined,
            ...tool.errorCode === undefined ? {} : { errorCode: tool.errorCode },
            durationMs: Math.max(0, endedAt - (tool.startedAt ?? endedAt)),
            ts: endedAt,
          })
        })
      } catch (error) {
        this.options.warn(`recordToolOutcome failed for ${tool.name}: ${describe(error)}`)
      }
    }

    const turnEnd = () => this.withRoute(scope.route, () => core.onTurnEnd({
      agent: MEMOS_AGENT,
      namespace,
      sessionId: memorySessionId,
      episodeId,
      agentText: turn.assistantText,
      ...turn.reasoningText === undefined ? {} : { agentThinking: turn.reasoningText },
      toolCalls: turn.toolCalls.map(tool => ({
        name: tool.name,
        input: tool.input,
        toolCallId: tool.callId,
        ...tool.output === undefined ? {} : { output: tool.output },
        ...tool.errorCode === undefined ? {} : { errorCode: tool.errorCode },
        ...tool.startedAt === undefined ? {} : { startedAt: tool.startedAt },
        ...tool.endedAt === undefined ? {} : { endedAt: tool.endedAt },
      })),
      contextHints: {
        turn: turn.turn,
        turnEndReason: turn.endReason,
        ...scope.cwd === undefined ? {} : { cwd: scope.cwd },
        ...turn.outcome === undefined ? {} : { outcomeEvidence: turn.outcome },
      },
      ts: turn.endedAt,
    }))
    const previousReply = state.lastReply?.turn === turn.turn - 1 ? state.lastReply.text : undefined
    const { result, judgment } = this.options.judges
      ? await this.options.judges.run({
        project: scope.cwd,
        previousReply,
        memories: served.map(memory => memory.text),
        now: turn.endedAt,
      }, turnEnd)
      : { result: await turnEnd(), judgment: undefined }
    this.options.info(`captured session=${scope.sessionId} turn=${turn.turn} trace=${result.traceId}`)
    const filed = await this.annotateTrace(core, turn, result.traceId, domain ?? judgment?.domain, judgment?.log === true)
    if (turn.outcome?.completedGoal !== undefined) {
      try {
        await this.withRoute(scope.route, () => core.submitFeedback({
          channel: 'implicit',
          polarity: 'positive',
          magnitude: 1,
          traceId: result.traceId,
          episodeId,
          rationale: `Goal completed: ${turn.outcome?.completedGoal}`,
        }))
      } catch (error) {
        this.options.warn(`goal outcome feedback failed for ${result.traceId}: ${describe(error)}`)
      }
    }
    const revisions = judgment?.revisions ?? []
    return { traceId: result.traceId, episodeId, corrects: judgment?.corrects ?? false, domain: filed, revisions }
  }

  /**
   * Record the turn's domain and outcome evidence on its trace. `explicit` is the caller's or the turn
   * judgment's domain; without it the classifier runs, and without a classified domain the
   * capture-location fallback applies at read time.
   * @returns the domain the trace was filed under, or undefined when none was classified.
   */
  private async annotateTrace(
    core: MemoryCore,
    turn: MemoryTurn,
    traceId: string,
    explicit: TurnDomain | undefined,
    log = false,
  ): Promise<TurnDomain | undefined> {
    try {
      const trace = await core.getTrace(traceId, this.namespaceOf(turn.scope))
      if (!trace) return undefined
      const domain = explicit ?? await this.withRoute(turn.scope.route, () => this.options.classify?.({
        userText: turn.userText,
        assistantText: turn.assistantText,
        summary: trace.summary ?? '',
        project: turn.scope.cwd,
      }))
      const tags = domain === undefined ? [...(trace.tags ?? [])] : withDomainTag(trace.tags, domain)
      if (log) tags.push(LOG_TAG)
      if (turn.outcome?.retryCodes.length) tags.push('outcome:retried')
      if (turn.outcome?.correction) tags.push('outcome:correction')
      if (turn.outcome?.verification) tags.push('outcome:verification-reported')
      if (turn.outcome?.completedGoal) tags.push('outcome:goal-completed')
      const evidence = [
        ...turn.outcome?.retryCodes.length ? [`Model retries: ${turn.outcome.retryCodes.join(', ')}`] : [],
        ...turn.outcome?.correction ? [`User correction: ${turn.outcome.correction.slice(0, 300)}`] : [],
        ...turn.outcome?.verification ? [`Assistant reported verification: ${turn.outcome.verification.statement}`] : [],
        ...turn.outcome?.completedGoal ? [`Goal marked complete: ${turn.outcome.completedGoal.slice(0, 300)}`] : [],
      ]
      if (domain === undefined && evidence.length === 0 && !log) return undefined
      await core.updateTrace(traceId, {
        tags: [...new Set(tags)],
        ...evidence.length === 0 ? {} : { summary: [trace.summary || trace.userText, ...evidence].join('\n') },
      })
      return domain
    } catch (error) {
      this.options.warn(`trace annotation failed for ${traceId}: ${describe(error)}`)
      return undefined
    }
  }

  async turnDomain(request: { readonly sessionId: SessionId; readonly turn: number }): Promise<MemoryDomain | undefined> {
    const state = this.sessions.get(request.sessionId)
    if (!state) return undefined
    // Captures run in the session's queue, so reading through it waits for the turn's own capture.
    return this.schedule(state, () => Promise.resolve(state.turns.get(request.turn)?.domain))
  }

  async closeSession(sessionId: SessionId): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return
    await this.schedule(state, async () => {
      // A session holds MemOS sessions only after a capture opened its owner's core.
      if (state.memorySessions.size === 0 || state.owner === undefined) return
      const core = await this.options.cores.get(state.owner)
      for (const memorySessionId of state.memorySessions) {
        try {
          await this.withRoute(state.route, () => core.closeSession(memorySessionId))
        } catch (error) {
          this.options.warn(`closeSession failed for ${memorySessionId}: ${describe(error)}`)
        }
      }
      state.memorySessions.clear()
    })
    if (this.sessions.get(sessionId) === state && state.pending === undefined) this.sessions.delete(sessionId)
  }

  /**
   * Stop accepting captures, drain every session queue, close MemOS sessions, and shut every opened core down.
   * @returns after the cores shut down.
   */
  dispose(): Promise<void> {
    this.disposing ??= (async () => {
      await Promise.all([...this.sessions.keys()].map(sessionId => this.closeSession(sessionId)))
      await this.options.cores.shutdown()
    })()
    return this.disposing
  }

  async detail(request: Parameters<MemoryProvider['detail']>[0]): Promise<MemoryDetail | undefined> {
    const namespace = this.namespaceOf(request.scope)
    const id = request.id
    const core = await this.options.cores.get(request.scope.owner)
    switch (request.kind) {
      case 'trace': {
        const trace = await this.read(request, () => core.getTrace(id, namespace))
        if (!trace) return undefined
        this.noteServed(request.scope, [{ id: trace.id, text: trace.summary || trace.userText }])
        return {
          kind: 'trace',
          id,
          title: withOriginLabel(trace.summary || trace.userText, trace),
          body: trace.agentText || trace.summary || trace.userText,
          facts: facts({
            episodeId: trace.episodeId,
            time: trace.ts,
            value: trace.value,
            userText: trace.userText,
            reflection: trace.reflection,
            tools: trace.toolCalls.map(tool => tool.errorCode ? `${tool.name} (${tool.errorCode})` : tool.name),
          }),
        }
      }
      case 'policy': {
        const policy = await this.read(request, () => core.getPolicy(id, namespace))
        if (!policy) return undefined
        return {
          kind: 'policy',
          id,
          title: policy.title,
          body: policy.procedure,
          facts: facts({
            trigger: policy.trigger,
            verification: policy.verification,
            boundary: policy.boundary,
            gain: policy.gain,
            support: policy.support,
            status: policy.status,
          }),
        }
      }
      case 'world-model': {
        const model = await this.read(request, () => core.getWorldModel(id, namespace))
        if (!model) return undefined
        return {
          kind: 'world-model',
          id,
          title: model.title,
          body: model.body,
          facts: facts({ policyIds: model.policyIds, status: model.status, version: model.version }),
        }
      }
    }
  }

  async timeline(request: Parameters<MemoryProvider['timeline']>[0]): Promise<readonly MemoryTimelineEntry[]> {
    const namespace = this.namespaceOf(request.scope)
    const core = await this.options.cores.get(request.scope.owner)
    const traces = await this.read(request, () => core.timeline({ episodeId: request.episodeId, namespace }))
    return traces.slice(0, request.limit).map(trace => ({
      id: brandString<MemoryItemId>(trace.id),
      time: trace.ts,
      userText: trace.userText,
      agentText: trace.agentText,
      ...typeof trace.value === 'number' ? { value: trace.value } : {},
      tools: trace.toolCalls.map(tool => ({ name: tool.name, ...tool.errorCode ? { errorCode: tool.errorCode } : {} })),
    }))
  }

  async environments(request: Parameters<MemoryProvider['environments']>[0]): Promise<readonly MemoryEnvironment[]> {
    const core = await this.options.cores.get(request.scope.owner)
    const models = await this.read(request, () => core.listWorldModels({
      limit: request.limit,
      ...request.query ? { q: request.query } : {},
      namespace: this.namespaceOf(request.scope),
    }))
    return models.map(model => ({
      id: brandString<MemoryItemId>(model.id),
      title: model.title,
      body: model.body,
      status: model.status,
      version: model.version,
    }))
  }

  async skills(request: Parameters<MemoryProvider['skills']>[0]): Promise<readonly MemorySkill[]> {
    const core = await this.options.cores.get(request.scope.owner)
    const skills = await this.read(request, () => core.listSkills({
      ...request.status === undefined ? {} : { status: request.status },
      limit: request.limit,
      namespace: this.namespaceOf(request.scope),
    }))
    return skills.map(toSkill)
  }

  async useSkill(request: Parameters<MemoryProvider['useSkill']>[0]): Promise<MemorySkill | undefined> {
    const episodeId = this.sessions.get(request.scope.sessionId)?.lastEpisode
    const core = await this.options.cores.get(request.scope.owner)
    const skill = await this.read(request, () => core.getSkill(request.id, {
      recordUse: true,
      recordTrial: true,
      sessionId: request.scope.sessionId,
      ...episodeId === undefined ? {} : { episodeId },
      toolCallId: request.callId,
      namespace: this.namespaceOf(request.scope),
    }))
    return skill ? toSkill(skill) : undefined
  }

  async list(request: Parameters<MemoryProvider['list']>[0]): Promise<MemoryPage> {
    const profile = ownerProfile(request.owner)
    const core = await this.options.cores.get(request.owner)
    // Owner memories are private to the owner's namespace, which the core's own default namespace
    // cannot see; listing therefore spans the database's namespaces and keeps the owner's rows.
    const filter = {
      ownerAgentKind: MEMOS_AGENT,
      ownerProfileId: profile,
      includeAllNamespaces: true,
      ...request.query ? { q: request.query } : {},
      ...request.domains === undefined ? {} : { domains: request.domains },
      ...request.cwd === undefined ? {} : { projectWorkspaceId: this.workspaceOf(request.cwd) ?? null },
    }
    const [traces, total] = await this.read(request, () => Promise.all([
      core.listTraces({
        ...filter,
        limit: request.limit,
        offset: request.offset,
      }),
      core.countTraces(filter),
    ]))
    return { records: traces.filter(trace => trace.ownerProfileId === profile).map(toRecord), total }
  }

  async remember(request: Parameters<MemoryProvider['remember']>[0]): Promise<MemoryItemId> {
    request.signal.throwIfAborted()
    const { scope } = request
    const state = this.state(scope)
    const now = Date.now()
    const traceId = await this.schedule(state, async () => {
      const { traceId: written } = await this.captureTurn(state, {
        scope,
        turn: 0,
        userText: request.text,
        assistantText: 'Noted.',
        toolCalls: [],
        startedAt: now,
        endedAt: now,
        endReason: 'completed',
      }, `${scope.sessionId}:remember:${now}`, rememberedDomain(request.domain, scope.cwd))
      return written
    })
    return brandString<MemoryItemId>(traceId)
  }

  async rememberMany(request: Parameters<MemoryProvider['rememberMany']>[0]): Promise<{ readonly ids: readonly MemoryItemId[]; readonly skipped: number }> {
    request.signal.throwIfAborted()
    const state = this.state(request.scope)
    return this.schedule(state, async () => {
      request.signal.throwIfAborted()
      const core = await this.options.cores.get(request.scope.owner)
      const domain = rememberedDomain(request.domain, request.scope.cwd)
      const { ids, skipped } = await core.rememberFacts({
        namespace: this.namespaceOf(request.scope),
        sessionId: request.scope.sessionId,
        facts: request.facts.map(fact => ({
          text: fact.text,
          tags: [`domain:${domain}`, IMPORT_TAG, ...fact.recordedAt === undefined ? [UNDATED_TAG] : []],
          ...fact.recordedAt === undefined ? {} : { ts: fact.recordedAt },
        })),
        signal: request.signal,
      })
      return { ids: ids.map(id => brandString<MemoryItemId>(id)), skipped }
    })
  }

  async edit(request: Parameters<MemoryProvider['edit']>[0]): Promise<MemoryRecord | undefined> {
    const core = await this.options.cores.get(request.owner)
    if (await this.ownedTrace(core, request) === undefined) return undefined
    const updated = await this.read(request, () => core.updateTrace(request.id, { summary: request.summary }))
    return updated ? toRecord(updated) : undefined
  }

  async setProcedureStatus(request: Parameters<MemoryProvider['setProcedureStatus']>[0]): Promise<boolean> {
    const core = await this.options.cores.get(request.owner)
    const trace = await this.ownedTrace(core, request)
    if (trace === undefined || !trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)) return false
    const tags = [...(trace.tags ?? []).filter(tag => !tag.startsWith(PROCEDURE_TAG)), `${PROCEDURE_TAG}${request.status}`]
    await this.read(request, () => core.updateTrace(request.id, { tags }))
    return true
  }

  async forget(request: Parameters<MemoryProvider['forget']>[0]): Promise<boolean> {
    const core = await this.options.cores.get(request.owner)
    if (await this.ownedTrace(core, request) === undefined) return false
    const { deleted } = await this.read(request, () => core.deleteTrace(request.id))
    return deleted
  }

  async feedback(request: Parameters<MemoryProvider['feedback']>[0]): Promise<boolean> {
    const state = this.sessions.get(request.scope.sessionId)
    const captured = state?.turns.get(request.turn)
    if (!state || !captured) return false
    const core = await this.options.cores.get(request.scope.owner)
    await this.schedule(state, () => this.withRoute(request.scope.route ?? state.route, () => core.submitFeedback({
      channel: 'explicit',
      polarity: request.polarity,
      magnitude: 1,
      traceId: captured.traceId,
      episodeId: captured.episodeId,
      ...request.note === undefined ? {} : { rationale: request.note },
    })))
    return true
  }

  /**
   * Read a trace only when it belongs to the request's owner. MemOS deletes and updates by id alone,
   * so ownership is checked here before either, even inside the owner's own database.
   */
  private async ownedTrace(
    core: MemoryCore,
    request: { readonly owner: string; readonly id: MemoryItemId; readonly signal: AbortSignal },
  ): Promise<TraceDTO | undefined> {
    const profile = ownerProfile(request.owner)
    const namespace = { agentKind: MEMOS_AGENT, profileId: profile, profileLabel: request.owner }
    const trace = await this.read(request, () => core.getTrace(request.id, namespace))
    return trace?.ownerProfileId === profile ? trace : undefined
  }

  private async read<T>(request: { readonly scope?: MemoryScope; readonly signal: AbortSignal }, operation: () => Promise<T>): Promise<T> {
    request.signal.throwIfAborted()
    const result = await this.withRoute(request.scope?.route, operation)
    request.signal.throwIfAborted()
    return result
  }
}

/**
 * What automatic recall states for one trace: its distilled summary, followed for a memory about the person captured
 * from a conversation by the person's own message, clipped, since the summary may record mostly the assistant's side.
 * @param trace - the recalled trace.
 * @param domain - the trace's domain.
 * @returns the text recall offers, or undefined when the trace has no summary yet.
 */
function recallSnippet(trace: TraceDTO, domain: MemoryDomain): string | undefined {
  const summary = trace.summary ?? undefined
  if (!summary || domain !== 'person' || trace.tags?.includes(IMPORT_TAG) === true || trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)) return summary
  const words = trace.userText.replace(/\s+/gu, ' ').trim()
  if (!words || summary.includes(words)) return summary
  const clipped = words.length <= PERSON_WORDS_CHARS ? words : `${words.slice(0, PERSON_WORDS_CHARS - 1).replace(/\s+\S*$/u, '')}…`
  return `${summary} In their words: "${clipped}"`
}

/**
 * What an explicit search returns for one trace: the distilled summary, the captured message it was distilled
 * from, then the session's own record of what it did and answered. The message is what a summary can drop, and a
 * search is where an agent goes when the summary it was given does not hold what it needs.
 * @param trace - the trace the search matched.
 * @returns the trace's readable text, in the order a reader needs it.
 */
function traceSnippet(trace: TraceDTO): string {
  const tools = trace.toolCalls.map((tool) => {
    const input = tool.input === undefined ? '' : JSON.stringify(tool.input)
    const output = tool.output === undefined ? '' : ` => ${JSON.stringify(tool.output)}`
    return `${tool.name} ${input}${output}${tool.errorCode ? ` (${tool.errorCode})` : ''}`
  })
  return [
    trace.summary?.trim(),
    ...trace.userText.trim() ? [`User message: ${trace.userText.trim()}`] : [],
    ...tools.length === 0 ? [] : [`Tool record: ${tools.join('; ')}`],
    ...trace.agentText.trim() ? [`Assistant answer: ${trace.agentText.trim()}`] : [],
  ].filter(Boolean).join('\n')
}

const MEMOS_TOOLS: Readonly<Record<string, string>> = {
  memos_search: MEMORY_TOOL.search,
  memos_get: MEMORY_TOOL.get,
  memos_timeline: MEMORY_TOOL.timeline,
  memos_environment: MEMORY_TOOL.environments,
  memos_skill_list: MEMORY_TOOL.skills,
  memos_skill_get: MEMORY_TOOL.skill,
}

/**
 * Rewrite the MemOS tool references in rendered context to the Aeven memory tools.
 * @param context - MemOS `injectedContext`.
 * @returns context whose follow-up hints name tools the model can call.
 */
export function toAevenToolReferences(context: string): string {
  return context
    .replace(/\bmemos_(?:skill_get|skill_list|timeline|environment|search|get)\b/g, tool => MEMOS_TOOLS[tool] ?? tool)
    .replaceAll('kind="world_model"', 'kind="world-model"')
}

/** Tag of a fact that was imported rather than learned from a conversation. */
const IMPORT_TAG = 'source:import'

/**
 * How a trace entered the store: bulk-saved facts carry {@link IMPORT_TAG}; every other trace was captured from a
 * conversation.
 */
function originOf(trace: TraceDTO): MemoryOrigin {
  return { kind: trace.tags?.includes(IMPORT_TAG) === true ? 'import' : 'conversation', savedAt: trace.ts }
}

/** A trace's text followed by where and when it came from, as `memory_get` shows it. */
function withOriginLabel(text: string, trace: TraceDTO): string {
  const label = memoryOriginLabel({
    origin: originOf(trace),
    ...trace.tags?.includes(UNDATED_TAG) === true ? {} : { recordedAt: trace.ts },
  })
  return label ? `${text} (${label})` : text
}

/** Tag of an imported fact whose original time is unknown; its trace time is the import time, not its age. */
const UNDATED_TAG = 'imported:undated'

/** Tag prefix of a learned procedure's status, as in `procedure:active`. */
const PROCEDURE_TAG = 'procedure:'

/**
 * Status a trace's tags give a learned procedure.
 * @param tags - the trace's tags.
 * @returns the status, or undefined when none is tagged.
 */
function procedureStatusOf(tags: readonly string[] | undefined): ProcedureStatus | undefined {
  const status = tags?.find(tag => tag.startsWith(PROCEDURE_TAG))?.slice(PROCEDURE_TAG.length)
  return status === 'candidate' || status === 'active' || status === 'archived' ? status : undefined
}

/**
 * What a trace is to the relevance judgment.
 * @param tags - the trace's tags.
 * @param summary - its summary.
 * @param userText - its request text.
 * @returns the candidate kind.
 */
function kindOfTrace(tags: readonly string[] | undefined, summary: string, userText: string): CandidateKind {
  if (userText.startsWith(LEARNED_PROCEDURE_PREFIX)) return 'procedure'
  if (isLogMemory(tags, summary)) return 'log'
  return tags?.includes('lightweight_memory') === true ? 'fact' : 'exchange'
}

/**
 * What a hit read without its trace is to the relevance judgment.
 * @param hit - the hit.
 * @returns the candidate kind.
 */
function kindOfHit(hit: MemoryHit): CandidateKind {
  switch (hit.kind) {
    case 'skill':
      return 'skill'
    case 'episode':
      return 'episode'
    case 'trace':
      return 'exchange'
    default:
      return 'knowledge'
  }
}

function toRecord(trace: TraceDTO): MemoryRecord {
  const procedureStatus = procedureStatusOf(trace.tags)
  return {
    ...procedureStatus === undefined ? {} : { procedureStatus },
    id: brandString<MemoryItemId>(trace.id),
    domain: traceDomain(trace.tags, trace.ownerWorkspaceId),
    time: trace.ts,
    summary: trace.summary ?? '',
    userText: trace.userText,
    agentText: trace.agentText,
    sessionId: brandString<SessionId>(trace.sessionId),
    episodeId: brandString<MemoryEpisodeId>(trace.episodeId),
  }
}

/**
 * Domain a remembered memory is filed under. `world` and `experience` are kept as asked. A project memory needs a
 * workspace; without one, or with no domain stated, it is about the user.
 * @param domain - requested domain.
 * @param cwd - the session's workspace, when it has one.
 * @returns the domain to store.
 */
function rememberedDomain(domain: TurnDomain | undefined, cwd: string | undefined): TurnDomain {
  if (domain === 'world' || domain === 'experience') return domain
  return domain === 'project' && cwd !== undefined ? 'project' : 'person'
}

/**
 * Score a hit must reach, as a fraction of the best hit's score, to survive an explicit search.
 *
 * The core scores each tier separately, so a top skill or world model can sit far below the trace that
 * actually answers the query while still being first in its own tier. Two thirds keeps every generator
 * that genuinely competes and removes the ones that are merely the best of a weak tier.
 */
const DISTANT_HIT_RATIO = 0.67

/**
 * Drop the hits that do not compete with the best result of an explicit search.
 *
 * An explicit search returns the core's per-tier top-K and runs no relevance judgment, because the model
 * chose the query itself. That leaves the list padded: a query for one fact comes back with that fact and
 * then a world model, a skill, and a learned procedure that each led their own tier. The caller pays for
 * all of it in context and has to tell the answer from the noise, so the weak tiers are dropped here.
 *
 * @param hits - ranked hits, best first.
 * @returns the hits within {@link DISTANT_HIT_RATIO} of the best score; the list unchanged when no hit scores.
 */
function withoutDistantHits(hits: readonly MemoryHit[]): MemoryHit[] {
  let best = 0
  for (const hit of hits) best = Math.max(best, hit.score)
  if (best <= 0) return [...hits]
  const floor = best * DISTANT_HIT_RATIO
  return hits.filter(hit => hit.score >= floor)
}

/**
 * Merge the result lists of a multi-topic explicit search, keeping each memory once at its best score.
 * @param parts - one ranked list per query clause.
 * @returns one ranked list, best first.
 */
function mergeHits(parts: readonly (readonly MemoryHit[])[]): MemoryHit[] {
  const best = new Map<MemoryItemId, MemoryHit>()
  for (const hit of parts.flat()) {
    const seen = best.get(hit.id)
    if (seen === undefined || hit.score > seen.score) best.set(hit.id, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

function toSkill(skill: SkillDTO): MemorySkill {
  return {
    id: brandString<MemoryItemId>(skill.id),
    name: skill.name,
    status: skill.status,
    guide: skill.invocationGuide,
    ...typeof skill.eta === 'number' ? { eta: skill.eta } : {},
    ...typeof skill.support === 'number' ? { support: skill.support } : {},
    ...typeof skill.gain === 'number' ? { gain: skill.gain } : {},
  }
}

type FactValue = string | number | boolean | readonly string[] | null | undefined

/** Drop absent and empty facts so the result is lossless JSON. */
function facts(input: Record<string, FactValue>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = typeof value === 'object' ? [...value] : value
  }
  return out
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
