/** MemOS-backed {@link MemoryProvider}: namespaces, per-session capture ordering, and MemOS session lifecycle. */
import { brandString } from '@aeven/brand'
import { MEMORY_TOOL } from '@aeven/memory'
import type {
  MemoryDetail,
  MemoryDomain,
  MemoryEnvironment,
  MemoryEpisodeId,
  MemoryHit,
  MemoryItemId,
  MemoryLlmRoute,
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
} from '@aeven/memory'
import type { SessionId } from '@aeven/session'
import type { JsonValue } from '@aeven/util-values'
import type { RetrievalHitDTO, RuntimeNamespace, SkillDTO, TraceDTO } from '@memtensor/memos-local-plugin/dist/agent-contract/dto.js'
import type { MemoryCore } from '@memtensor/memos-local-plugin/dist/agent-contract/memory-core.js'
import { MemoryDeadlineError, withDeadline } from './deadline.ts'
import { withoutExactIdentifiers } from './query.ts'
import type { LlmRouteContext } from './host-llm.ts'
import { SUPERSEDED_TAG, traceDomain, withDomainTag, withSupersededTag, type ClassifyInput, type TurnDomain, type TurnJudgeContext } from './domain.ts'
import { normalizeNamespace } from '@memtensor/memos-local-plugin/dist/core/runtime/namespace.js'

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

/** Facts the runtime needs beyond the MemOS core. */
export interface MemosMemoryOptions {
  readonly core: MemoryCore
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
  readonly warn: (message: string) => void
  readonly info: (message: string) => void
}

/** Per-Aeven-session state; one Aeven session may span several MemOS sessions after episode routing. */
interface SessionState {
  readonly memorySessions: Set<string>
  route?: MemoryLlmRoute
  lastEpisode?: string
  /**
   * MemOS trace and episode of each captured turn, for feedback on that turn, and the traces `remember` wrote
   * during it, which a correction of the turn supersedes with it.
   */
  readonly turns: Map<number, { readonly traceId: string; readonly episodeId: string; readonly remembered: readonly string[] }>
  /** Traces `remember` wrote since the last captured turn; that turn's capture claims them. */
  readonly remembered: string[]
  /** Assistant reply of the latest captured turn, which the next turn's judgment reads for its referent. */
  lastReply?: { readonly turn: number; readonly text: string }
  pending?: Promise<void>
}

/** MemOS provider behind `ctx.memory`. */
export class MemosMemory implements MemoryProvider {
  readonly id = 'memos'
  private readonly sessions = new Map<SessionId, SessionState>()
  private disposing: Promise<void> | undefined

  constructor(private readonly options: MemosMemoryOptions) {}

  private get core(): MemoryCore {
    return this.options.core
  }

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

  private state(sessionId: SessionId): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { memorySessions: new Set(), turns: new Map(), remembered: [] }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private withRoute<T>(route: MemoryLlmRoute | undefined, operation: () => T): T {
    return route === undefined ? operation() : this.options.routes.run(route, operation)
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecall> {
    const { scope } = request
    if (scope.route) this.state(scope.sessionId).route = scope.route
    const deadlineAt = Date.now() + request.timeoutMs
    const turnStart = request.purpose === 'turn-start'
    try {
      const hits = await this.search(request, deadlineAt, turnStart)
      if (!turnStart || hits.length > 0) return { hits, timedOut: false }
      // MemOS turns every long identifier in a query into a hard eligibility filter, so a pasted
      // session id or commit hash drops all candidates. A turn-start query is a topic query; retry it
      // without those tokens rather than delivering no memory for the turn.
      const topic = withoutExactIdentifiers(request.query)
      if (topic === request.query || topic.length === 0) return { hits, timedOut: false }
      return { hits: await this.search({ ...request, query: topic }, deadlineAt, turnStart), timedOut: false }
    } catch (error) {
      if (!(error instanceof MemoryDeadlineError)) throw error
      return { hits: [], timedOut: true }
    }
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
    const search = this.withRoute(scope.route, () => this.core.searchMemory({
      agent: MEMOS_AGENT,
      namespace: this.namespaceOf(scope),
      ...turnStart || request.sessionOnly === true ? { sessionId: scope.sessionId } : {},
      query: request.query,
      // MemOS exposes the defer-filter hint only through its turn-start retrieval path.
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
    }, { signal: request.signal, ...turnStart ? {} : { foreground: true } }))
    // A provider can be temporarily non-cancellable (for example while a local ONNX model loads),
    // so the deadline is enforced here as well as inside the core.
    return withDeadline(Promise.resolve(search).then(result => this.visibleHits(scope, result.hits, turnStart)), deadlineAt, request.signal, `Memory recall exceeded ${request.timeoutMs}ms`)
  }

  /** MemOS workspace key of the scope's working directory, as MemOS stamps it on captured memory. */
  private workspaceOf(scope: MemoryScope): string | undefined {
    return scope.cwd === undefined ? undefined : normalizeNamespace({ workspacePath: scope.cwd }, MEMOS_AGENT).workspaceId
  }

  /**
   * Classify each hit's domain and drop project memory of other workspaces; MemOS retrieval does not
   * filter by workspace, so this is where project memory stays in its project.
   */
  private async visibleHits(scope: MemoryScope, hits: readonly RetrievalHitDTO[], turnStart: boolean): Promise<MemoryHit[]> {
    const workspace = this.workspaceOf(scope)
    const namespace = this.namespaceOf(scope)
    const classified = await Promise.all(hits.map(async (hit) => {
      const { domain, workspaceId, summary, correction, superseded, recordedAt } = await this.hitOrigin(hit, namespace, turnStart)
      const memory: MemoryHit = {
        kind: hit.refKind,
        id: brandString<MemoryItemId>(hit.refId),
        domain,
        tier: hit.tier,
        score: hit.score,
        // A trace's distilled summary states the remembered fact; the raw exchange is the fallback.
        snippet: summary || toAevenToolReferences(hit.snippet),
        ...recordedAt === undefined ? {} : { recordedAt },
      }
      return { memory, workspaceId, correction, superseded }
    }))
    return classified
      .filter(({ memory, workspaceId, correction, superseded }) =>
        (!turnStart || (!correction && !superseded)) && (memory.domain !== 'project' || (workspace !== undefined && workspaceId === workspace)))
      .map(({ memory }) => memory)
  }

  /**
   * Automatic recall states the distilled summary, because it is injected on every turn; an explicit search
   * returns the whole trace, so a fact the distillation dropped is still reachable.
   */
  private async hitOrigin(hit: RetrievalHitDTO, namespace: RuntimeNamespace, turnStart: boolean): Promise<{
    domain: MemoryDomain
    workspaceId: string | null | undefined
    summary?: string
    correction?: boolean
    superseded?: boolean
    recordedAt?: number
  }> {
    switch (hit.refKind) {
      case 'experience':
      case 'skill':
        return { domain: 'experience', workspaceId: hit.ownerWorkspaceId }
      case 'world-model':
        return { domain: 'world', workspaceId: hit.ownerWorkspaceId }
      case 'trace': {
        const trace = await this.core.getTrace(hit.refId, namespace)
        const workspaceId = trace?.ownerWorkspaceId ?? hit.ownerWorkspaceId
        const domain = traceDomain(trace?.tags, workspaceId)
        const summary = trace === null ? undefined : turnStart ? trace.summary : traceSnippet(trace)
        return {
          domain,
          workspaceId,
          correction: trace?.tags?.includes('outcome:correction') ?? false,
          superseded: trace?.tags?.some(tag => tag.startsWith(SUPERSEDED_TAG)) ?? false,
          ...summary ? { summary } : {},
          ...trace === null ? {} : { recordedAt: trace.ts },
        }
      }
      case 'episode':
        return { domain: traceDomain(undefined, hit.ownerWorkspaceId), workspaceId: hit.ownerWorkspaceId }
    }
  }

  capture(turn: MemoryTurn): void {
    if (this.disposing) return
    const state = this.state(turn.scope.sessionId)
    if (turn.scope.route) state.route = turn.scope.route
    void this.schedule(state, async () => {
      const remembered = state.remembered.splice(0)
      const captured = await this.captureTurn(state, turn, `${turn.scope.sessionId}:${turn.turn}`)
      state.turns.set(turn.turn, { traceId: captured.traceId, episodeId: captured.episodeId, remembered })
      state.lastReply = { turn: turn.turn, text: turn.assistantText }
      if (turn.outcome?.correction !== undefined || captured.corrects) await this.supersedePrevious(state, turn, captured.traceId)
    }).catch((error: unknown) => {
      this.options.warn(`background write failed for session ${turn.scope.sessionId}: ${describe(error)}`)
    })
  }

  /**
   * Record that a correction replaced what the turn before it stated. A correction answers the exchange it
   * follows, so that trace and the facts `remember` wrote during that turn stop being current; the tag names
   * their replacement, and automatic recall then leaves them out while explicit search still returns them as history.
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
    for (const traceId of [previous.traceId, ...previous.remembered]) {
      if (traceId === replacementTraceId) continue
      try {
        const trace = await this.core.getTrace(traceId, this.namespaceOf(turn.scope))
        if (trace === null) continue
        await this.core.updateTrace(traceId, {
          tags: withSupersededTag(trace.tags, replacementTraceId),
        })
      } catch (error) {
        this.options.warn(`supersede failed for ${traceId}: ${describe(error)}`)
      }
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
  ): Promise<{ traceId: string; episodeId: string; corrects: boolean }> {
    const { scope } = turn
    const namespace = this.namespaceOf(scope)
    let memorySessionId: string = scope.sessionId
    let episodeId: string | undefined
    try {
      const prepareTurn = this.core.prepareTurn?.bind(this.core)
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
      memorySessionId = await this.core.openSession({ agent: MEMOS_AGENT, sessionId: memorySessionId, namespace, meta: { namespace } })
      state.memorySessions.add(memorySessionId)
    }
    episodeId ??= await this.core.openEpisode({ sessionId: memorySessionId, userMessage: turn.userText })
    state.lastEpisode = episodeId

    for (const tool of turn.toolCalls) {
      if (tool.endedAt === undefined) continue
      const endedAt = tool.endedAt
      try {
        this.withRoute(scope.route, () => {
          this.core.recordToolOutcome({
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

    const turnEnd = () => this.withRoute(scope.route, () => this.core.onTurnEnd({
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
      ? await this.options.judges.run({ project: scope.cwd, previousReply }, turnEnd)
      : { result: await turnEnd(), judgment: undefined }
    this.options.info(`captured session=${scope.sessionId} turn=${turn.turn} trace=${result.traceId}`)
    await this.annotateTrace(turn, result.traceId, domain ?? judgment?.domain)
    if (turn.outcome?.completedGoal !== undefined) {
      try {
        await this.withRoute(scope.route, () => this.core.submitFeedback({
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
    return { traceId: result.traceId, episodeId, corrects: judgment?.corrects ?? false }
  }

  /**
   * Record the turn's domain and outcome evidence on its trace. `explicit` is the caller's or the turn
   * judgment's domain; without it the classifier runs, and without a classified domain the
   * capture-location fallback applies at read time.
   */
  private async annotateTrace(turn: MemoryTurn, traceId: string, explicit: TurnDomain | undefined): Promise<void> {
    try {
      const trace = await this.core.getTrace(traceId, this.namespaceOf(turn.scope))
      if (!trace) return
      const domain = explicit ?? await this.withRoute(turn.scope.route, () => this.options.classify?.({
        userText: turn.userText,
        assistantText: turn.assistantText,
        summary: trace.summary ?? '',
        project: turn.scope.cwd,
      }))
      const tags = domain === undefined ? [...(trace.tags ?? [])] : withDomainTag(trace.tags, domain)
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
      if (domain === undefined && evidence.length === 0) return
      await this.core.updateTrace(traceId, {
        tags: [...new Set(tags)],
        ...evidence.length === 0 ? {} : { summary: [trace.summary || trace.userText, ...evidence].join('\n') },
      })
    } catch (error) {
      this.options.warn(`trace annotation failed for ${traceId}: ${describe(error)}`)
    }
  }

  async closeSession(sessionId: SessionId): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return
    await this.schedule(state, async () => {
      for (const memorySessionId of state.memorySessions) {
        try {
          await this.withRoute(state.route, () => this.core.closeSession(memorySessionId))
        } catch (error) {
          this.options.warn(`closeSession failed for ${memorySessionId}: ${describe(error)}`)
        }
      }
      state.memorySessions.clear()
    })
    if (this.sessions.get(sessionId) === state && state.pending === undefined) this.sessions.delete(sessionId)
  }

  /**
   * Stop accepting captures, drain every session queue, close MemOS sessions, and shut the core down.
   * @returns after the core shut down.
   */
  dispose(): Promise<void> {
    this.disposing ??= (async () => {
      await Promise.all([...this.sessions.keys()].map(sessionId => this.closeSession(sessionId)))
      await this.core.shutdown()
    })()
    return this.disposing
  }

  async detail(request: Parameters<MemoryProvider['detail']>[0]): Promise<MemoryDetail | undefined> {
    const namespace = this.namespaceOf(request.scope)
    const id = request.id
    switch (request.kind) {
      case 'trace': {
        const trace = await this.read(request, () => this.core.getTrace(id, namespace))
        if (!trace) return undefined
        return {
          kind: 'trace',
          id,
          title: trace.summary || trace.userText,
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
        const policy = await this.read(request, () => this.core.getPolicy(id, namespace))
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
        const model = await this.read(request, () => this.core.getWorldModel(id, namespace))
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
    const traces = await this.read(request, () => this.core.timeline({ episodeId: request.episodeId, namespace }))
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
    const models = await this.read(request, () => this.core.listWorldModels({
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
    const skills = await this.read(request, () => this.core.listSkills({
      ...request.status === undefined ? {} : { status: request.status },
      limit: request.limit,
      namespace: this.namespaceOf(request.scope),
    }))
    return skills.map(toSkill)
  }

  async useSkill(request: Parameters<MemoryProvider['useSkill']>[0]): Promise<MemorySkill | undefined> {
    const episodeId = this.sessions.get(request.scope.sessionId)?.lastEpisode
    const skill = await this.read(request, () => this.core.getSkill(request.id, {
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
    // Owner memories are private to the owner's namespace, which the core's own default namespace
    // cannot see; listing therefore spans namespaces and the owner filter is the isolation.
    const filter = {
      ownerAgentKind: MEMOS_AGENT,
      ownerProfileId: profile,
      includeAllNamespaces: true,
      ...request.query ? { q: request.query } : {},
    }
    if (request.domains === undefined) {
      const [traces, total] = await this.read(request, () => Promise.all([
        this.core.listTraces({ ...filter, limit: request.limit, offset: request.offset }),
        this.core.countTraces(filter),
      ]))
      return { records: traces.filter(trace => trace.ownerProfileId === profile).map(toRecord), total }
    }
    // A domain is a trace tag with a workspace fallback, which the core cannot filter on, so every matching
    // trace is read in `limit`-sized chunks to place the requested page and count the domain's total.
    const chunk = Math.max(request.limit, 1)
    const domains = new Set(request.domains)
    const records: MemoryRecord[] = []
    let total = 0
    for (let offset = 0; ; offset += chunk) {
      const traces = await this.read(request, () => this.core.listTraces({ ...filter, limit: chunk, offset }))
      for (const trace of traces) {
        if (trace.ownerProfileId !== profile) continue
        const record = toRecord(trace)
        if (!domains.has(record.domain)) continue
        if (total >= request.offset && records.length < request.limit) records.push(record)
        total++
      }
      if (traces.length < chunk) return { records, total }
    }
  }

  async remember(request: Parameters<MemoryProvider['remember']>[0]): Promise<MemoryItemId> {
    request.signal.throwIfAborted()
    const { scope } = request
    const state = this.state(scope.sessionId)
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
      }, `${scope.sessionId}:remember:${now}`, request.domain === 'project' && scope.cwd !== undefined ? 'project' : 'person')
      // Recorded inside the queued write, so the capture of the turn in progress, queued after it, claims it.
      state.remembered.push(written)
      return written
    })
    return brandString<MemoryItemId>(traceId)
  }

  async edit(request: Parameters<MemoryProvider['edit']>[0]): Promise<MemoryRecord | undefined> {
    if (await this.ownedTrace(request) === undefined) return undefined
    const updated = await this.read(request, () => this.core.updateTrace(request.id, { summary: request.summary }))
    return updated ? toRecord(updated) : undefined
  }

  async forget(request: Parameters<MemoryProvider['forget']>[0]): Promise<boolean> {
    if (await this.ownedTrace(request) === undefined) return false
    const { deleted } = await this.read(request, () => this.core.deleteTrace(request.id))
    return deleted
  }

  async feedback(request: Parameters<MemoryProvider['feedback']>[0]): Promise<boolean> {
    const state = this.sessions.get(request.scope.sessionId)
    const captured = state?.turns.get(request.turn)
    if (!state || !captured) return false
    await this.schedule(state, () => this.withRoute(request.scope.route ?? state.route, () => this.core.submitFeedback({
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
   * Read a trace only when it belongs to the scope's owner. MemOS deletes and updates by id alone,
   * so ownership is checked here before either.
   */
  private async ownedTrace(
    request: { readonly owner: string; readonly id: MemoryItemId; readonly signal: AbortSignal },
  ): Promise<TraceDTO | undefined> {
    const profile = ownerProfile(request.owner)
    const namespace = { agentKind: MEMOS_AGENT, profileId: profile, profileLabel: request.owner }
    const trace = await this.read(request, () => this.core.getTrace(request.id, namespace))
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

function toRecord(trace: TraceDTO): MemoryRecord {
  return {
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
