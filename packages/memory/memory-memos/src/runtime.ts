/** MemOS-backed {@link MemoryProvider}: namespaces, per-session capture ordering, and MemOS session lifecycle. */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { brandString } from '@aeven/brand'
import { LEARNED_PROCEDURE_PREFIX, MEMORY_TOOL, memoryOriginLabel, mergeRankedHits } from '@aeven/memory'
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
  MemoryProfile,
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
import type { ResolvedHome } from '@deepseek-ai/memos-local-plugin/core/config/paths.js'
import type { OwnerCores } from './cores.ts'
import { abortReason, MemoryDeadlineError, withDeadline } from './deadline.ts'
import { messageSentences, procedureMatch, queryClauses, taskWords, withoutExactIdentifiers } from './query.ts'
import { isLogMemory, LOG_TAG, parseRelevance, RELEVANCE_PROMPT, relevanceInput, type CandidateKind, type FilterCandidate, type RelevanceJudgment } from './filter.ts'
import type { LlmRouteContext } from './host-llm.ts'
import { recordedDates } from './dates.ts'
import type { PersonFact, PersonProfiles, ProfileDistill } from './profile.ts'
import { SUPERSEDED_TAG, traceDomain, withDomainTag, withSupersededTag, type ClassifyInput, type TurnDomain, type TurnJudgeContext, type TurnRevision } from './domain.ts'
import { normalizeNamespace } from '@deepseek-ai/memos-local-plugin/core/runtime/namespace.js'

/**
 * MemOS runtime paths under one account's memory directory.
 * @param root - the account's memory root.
 * @returns the home layout MemOS boots over.
 */
export function memosHome(root: string): ResolvedHome {
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
  /** Hosted workspace identity resolver; absent retains directory-based namespaces. */
  readonly workspaceId?: (scope: MemoryScope) => string | undefined
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
   * returns the model's answer within `timeoutMs` unless `signal` aborts it. The judgment gets what is left of the
   * recall's budget, capped by `timeoutMs` and at least `minMs` (itself capped by `timeoutMs`); an attempt
   * unanswered after `hedgeMs`, or failed before then, is sent once more and the first usable answer wins. Absent
   * delivers retrieval's ranking unjudged.
   */
  readonly relevance?: {
    readonly run: (system: string, user: string, timeoutMs: number, signal: AbortSignal) => Promise<string>
    readonly timeoutMs: number
    readonly hedgeMs: number
    readonly minMs: number
  }
  /**
   * Turn-start retrieval per sentence of the person's message: at most `sentences` sentences each add up to `hits`
   * of their top hits to the conversation query's. Absent runs the conversation query alone.
   */
  readonly sentenceRecall?: { readonly sentences: number; readonly hits: number }
  /** Most learned procedures a turn-start recall offers its relevance judgment beside the retrieved candidates. */
  readonly procedureCandidates?: number
  /**
   * Embeds a request and the procedures with the deployment's embedding model, so a procedure is chosen by meaning
   * and across languages: `embed` returns one L2-normalized vector per input, and a procedure is offered when its
   * cosine similarity to the request is `minMargin` above the median of the owner's procedures. Absent chooses by
   * shared words alone.
   */
  readonly procedureEmbedding?: {
    readonly embed: (owner: string, inputs: { text: string; role: 'query' | 'document' }[], signal: AbortSignal) => Promise<readonly Float32Array[]>
    readonly minMargin: number
  }
  /** True while an owner's memory index is being rebuilt, when its vectors are not comparable to new queries. */
  readonly rebuilding?: (owner: string) => boolean
  /**
   * The owners' person profiles and the distillation call that updates them on the asking session's route; absent
   * serves recorded dates without a profile text.
   */
  readonly profiles?: { readonly store: PersonProfiles; readonly distill: ProfileDistill }
  /**
   * Whether the owner's turn-start recall runs the relevance judgment. Answering false delivers every candidate,
   * learned procedures included, marked `unjudged`; absent judges whenever `relevance` is set.
   */
  readonly judgeRecall?: (owner: string) => boolean
  /**
   * File keeping one owner's last person-memory listing across restarts. With it, a profile read after a start serves
   * that listing at once and lists again in the background; without it, the first read waits for the listing.
   */
  readonly personFactsFile?: (owner: string) => string
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

/** Query of the retrieval {@link MemosMemory.prime} runs; any text loads the same index and pages. */
const PRIME_QUERY = 'warm'

/** Person traces one page of the recent-memory scan reads. */
const RECENT_PERSON_PAGE = 100

/** Learned procedures one turn-start recall reads to choose its procedure candidates from. */
const PROCEDURE_SCAN = 500

/** Milliseconds an owner's procedure list is served before it is read again. */
const PROCEDURE_LIST_TTL_MS = 600_000

/** Fewest procedures whose median similarity is a usable baseline. */
const PROCEDURE_MEDIAN_MIN = 6

/** One current learned procedure. */
interface ProcedureEntry {
  readonly trace: TraceDTO
  readonly name: string
  readonly description: string
}

/** The procedures one recall may offer and, when the request was embedded, each one's similarity to it by trace id. */
interface ProcedureScan {
  readonly entries: readonly ProcedureEntry[]
  readonly similarity?: ReadonlyMap<string, number>
}

/** Name and description of a learned procedure, from the first line of its text. */
const PROCEDURE_HEADER = new RegExp(String.raw`^${LEARNED_PROCEDURE_PREFIX} ([\w-]+): ([^\n]*)`, 'u')

/** Procedure names a word may appear in before it no longer tells procedures apart. */
const PROCEDURE_COMMON_NAMES = 3

/** Lowest {@link procedureMatch} score offered: one word of the name, or two of the description. */
const PROCEDURE_MATCH_MIN = 2

/** Person traces one page of a profile read lists. */
const PERSON_FACTS_PAGE = 1000

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

/** `api_logs` tool name of a turn-start relevance judgment's audit row. */
const JUDGMENT_LOG = 'recall_judgment'

/** How a relevance judgment ended: a usable answer, or why the recall fell back to retrieval's ranking. */
type JudgmentOutcome = 'judged' | 'unusable' | 'failed' | 'timeout' | 'no-time'

/** One request of a relevance judgment, timed from the judgment's start. */
interface JudgmentAttempt {
  readonly startMs: number
  ms?: number
  status: 'pending' | 'usable' | 'unusable' | 'failed' | 'cancelled'
}

/** A relevance judgment's requests and their result. */
type JudgmentRun =
  | { readonly judgment: RelevanceJudgment; readonly attempts: readonly JudgmentAttempt[] }
  | {
    readonly judgment?: undefined
    readonly reason: string
    readonly outcome: JudgmentOutcome
    readonly attempts: readonly JudgmentAttempt[]
  }

/** MemOS provider behind `ctx.memory`. */
export class MemosMemory implements MemoryProvider {
  readonly id = 'memos'
  private readonly sessions = new Map<SessionId, SessionState>()
  /** What each turn-start candidate is, from the trace its hit was read from; hits with no entry use their kind. */
  private readonly candidateKinds = new WeakMap<MemoryHit, CandidateKind>()
  /** Each owner's current person memories, as profile reads list them, and when they were listed. */
  private readonly personFacts = new Map<string, { readonly at: number; readonly facts: readonly PersonFact[] }>()
  /** Owners whose listing a write may have outdated; see {@link personFactsChanged}. */
  private readonly staleFacts = new Set<string>()
  /** A background listing waiting for or running after an owner's recalls; see {@link relistPersonFacts}. */
  private readonly relisting = new Map<string, Promise<void>>()
  /** A person-memory listing in flight per owner; reads that find no listing share it. */
  private readonly listingFacts = new Map<string, Promise<readonly PersonFact[]>>()
  /** Edits and forgets per owner; a listing that started before the latest one is neither kept nor saved. */
  private readonly factsEpochs = new Map<string, number>()
  /** Each owner's current procedures, read once and kept until a memory write or the list's age retires them. */
  private readonly procedureLists = new Map<string, { readonly at: number; readonly entries: Promise<readonly ProcedureEntry[]> }>()
  /** Each owner's procedure embeddings by trace id, with the text each was embedded from. */
  private readonly procedureVectors = new Map<string, Map<string, { readonly text: string; readonly vector: Float32Array }>>()
  /** Turn-start recalls still running, by owner. */
  private readonly recallsInFlight = new Map<string, Set<Promise<MemoryRecall>>>()
  private disposing: Promise<void> | undefined

  constructor(private readonly options: MemosMemoryOptions) {}

  /** One MemOS profile per owning account, so recall, capture, and reads never cross accounts. */
  private namespaceOf(scope: MemoryScope): RuntimeNamespace {
    const workspaceId = this.options.workspaceId?.(scope)
    return {
      ...workspaceId === undefined ? {} : { workspaceId },
      agentKind: MEMOS_AGENT,
      profileId: ownerProfile(scope.owner),
      profileLabel: scope.owner,
      ...scope.cwd === undefined ? {} : { workspacePath: scope.cwd },
      sessionKey: scope.sessionId,
    }
  }

  private projectOf(scope: MemoryScope): string | undefined {
    return this.options.workspaceId === undefined ? scope.cwd : this.options.workspaceId(scope)
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
    const running = this.recallHits(request)
    if (request.purpose === 'turn-start') this.trackRecall(request.scope.owner, running)
    const recall = await running
    this.noteServed(request.scope, recall.hits.flatMap(hit => hit.kind === 'trace' ? [{ id: hit.id, text: hit.snippet }] : []))
    return recall
  }

  async profile(request: Parameters<MemoryProvider['profile']>[0]): Promise<MemoryProfile> {
    const { scope } = request
    const facts = await this.read(request, () => this.currentPersonFacts(scope.owner, request.signal))
    const profiles = this.options.profiles
    if (profiles !== undefined) {
      const refresh = (): void => {
        profiles.store.refresh(scope.owner, facts, (system, user, timeoutMs) =>
          this.withRoute(scope.route, () => profiles.distill(system, user, timeoutMs)))
      }
      // The refresh is a long call on the same route; it starts after the owner's turn-start recalls settle, so it
      // does not run beside the relevance judgment the turn is waiting for.
      const running = this.recallsInFlight.get(scope.owner)
      if (running === undefined) refresh()
      else void Promise.allSettled([...running]).then(refresh)
    }
    const stored = profiles?.store.read(scope.owner)
    return {
      ...stored === undefined || !stored.text ? {} : { text: stored.text, updatedAt: stored.updatedAt },
      dates: recordedDates(facts, new Date().getFullYear()),
    }
  }

  /**
   * Load what an account's first recall on this Host would otherwise wait for: its database, the vector index and
   * full-text pages one retrieval reads, the query embedding, and the person-memory listing behind the profile.
   * The retrieval is the one an explicit memory search runs, with a fixed query and no session; its hits are
   * discarded and no model is called. MemOS records it as one `memos_search` audit row.
   * @param owner - account whose memory to load.
   * @param signal - cancels the load.
   * @returns after the retrieval and the listing finished.
   */
  async prime(owner: string, signal: AbortSignal): Promise<void> {
    const core = await this.options.cores.get(owner)
    signal.throwIfAborted()
    await core.searchMemory({
      agent: MEMOS_AGENT,
      namespace: { agentKind: MEMOS_AGENT, profileId: ownerProfile(owner), profileLabel: owner },
      query: PRIME_QUERY,
      reason: 'turn_start',
      contextHints: { __memosDeferLlmFilterToCaller: true },
      llmFilterMalformedRetries: 0,
    }, { signal })
    await this.currentPersonFacts(owner, signal)
  }

  /**
   * Every current person memory of the owner, regardless of age: superseded memories, logs, and learned procedures
   * are left out. A listing stays current until the owner's person memories change; a write marks it stale, and a
   * read then serves it at once while {@link relistPersonFacts} lists again after the owner's turn-start recalls
   * settled, so a listing never runs alongside a recall. An edit or forget drops the listing, and the next read waits
   * for a new one. The first read after a start serves the listing saved by the previous run, when there is one, as a
   * stale listing.
   */
  private async currentPersonFacts(owner: string, signal: AbortSignal): Promise<readonly PersonFact[]> {
    let cached = this.personFacts.get(owner)
    if (cached === undefined) {
      const restored = this.restorePersonFacts(owner)
      if (restored !== undefined) {
        cached = { at: 0, facts: restored }
        this.personFacts.set(owner, cached)
        this.staleFacts.add(owner)
      }
    }
    if (cached !== undefined) {
      if (this.staleFacts.has(owner)) this.relistPersonFacts(owner)
      return cached.facts
    }
    signal.throwIfAborted()
    return await this.listingOf(owner)
  }

  /** The owner's person-memory listing in flight, started when none is. */
  private listingOf(owner: string): Promise<readonly PersonFact[]> {
    const running = this.listingFacts.get(owner)
    if (running !== undefined) return running
    // A listing outlives the read that started it, so it carries no caller's signal.
    const started = this.listPersonFacts(owner, new AbortController().signal).finally(() => {
      if (this.listingFacts.get(owner) === started) this.listingFacts.delete(owner)
    })
    this.listingFacts.set(owner, started)
    return started
  }

  /**
   * Record that the owner's person memories may have changed: a turn was captured, a memory was remembered, or
   * another device's memories arrived. A listing already held is listed again in the background.
   * @param owner - the account.
   */
  personFactsChanged(owner: string): void {
    this.staleFacts.add(owner)
    if (this.personFacts.has(owner)) this.relistPersonFacts(owner)
  }

  /**
   * List the owner's person memories again once the owner's turn-start recalls settled, while reads keep serving the
   * stale listing. A write during the listing marks it stale again, and the next read lists once more.
   */
  private relistPersonFacts(owner: string): void {
    if (this.relisting.has(owner) || this.disposing) return
    const run = (async () => {
      let pending = this.recallsInFlight.get(owner)
      while (pending !== undefined && pending.size > 0) {
        await Promise.allSettled([...pending])
        pending = this.recallsInFlight.get(owner)
      }
      if (this.disposing || !this.staleFacts.has(owner)) return
      this.staleFacts.delete(owner)
      await this.listingOf(owner)
    })().catch((error: unknown) => {
      this.staleFacts.add(owner)
      this.options.warn(`listing person memories failed: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { this.relisting.delete(owner) })
    this.relisting.set(owner, run)
  }

  /**
   * Forget the owner's listing, in memory and on disk, after a person memory was edited or forgotten, so no later
   * read or start serves the old text.
   */
  private dropPersonFacts(owner: string): void {
    this.factsEpochs.set(owner, (this.factsEpochs.get(owner) ?? 0) + 1)
    this.listingFacts.delete(owner)
    this.personFacts.delete(owner)
    const file = this.options.personFactsFile?.(owner)
    if (file !== undefined) rmSync(file, { force: true })
  }

  /** The owner's last saved person-memory listing, or undefined when none was saved or the file is unreadable. */
  private restorePersonFacts(owner: string): readonly PersonFact[] | undefined {
    const file = this.options.personFactsFile?.(owner)
    if (file === undefined) return undefined
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      // ENOENT: nothing saved yet. Another read error is treated the same way: the next listing writes the file.
      return undefined
    }
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; facts?: unknown }
      if (parsed.version !== 1 || !Array.isArray(parsed.facts)) return undefined
      return (parsed.facts as unknown[]).filter((fact): fact is PersonFact => typeof fact === 'object' && fact !== null
        && typeof (fact as PersonFact).id === 'string' && typeof (fact as PersonFact).text === 'string'
        && typeof (fact as PersonFact).time === 'number' && typeof (fact as PersonFact).label === 'string')
    } catch {
      // A torn file from an interrupted write: listed again.
      return undefined
    }
  }

  /** Save the owner's listing for the next start; a failed write only costs that start a waiting listing. */
  private savePersonFacts(owner: string, facts: readonly PersonFact[]): void {
    const file = this.options.personFactsFile?.(owner)
    if (file === undefined) return
    const temporary = `${file}.${String(process.pid)}.tmp`
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      writeFileSync(temporary, JSON.stringify({ version: 1, facts }), { mode: 0o600 })
      renameSync(temporary, file)
    } catch (error) {
      rmSync(temporary, { force: true })
      this.options.warn(`saving the person-memory listing failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async listPersonFacts(owner: string, signal: AbortSignal): Promise<readonly PersonFact[]> {
    const epoch = this.factsEpochs.get(owner) ?? 0
    const core = await this.options.cores.get(owner)
    const facts: PersonFact[] = []
    for (let page = 0; ; page++) {
      signal.throwIfAborted()
      const traces = await core.listTraces({
        ownerAgentKind: MEMOS_AGENT,
        ownerProfileId: ownerProfile(owner),
        includeAllNamespaces: true,
        domains: ['person'],
        limit: PERSON_FACTS_PAGE,
        offset: page * PERSON_FACTS_PAGE,
      })
      for (const trace of traces) {
        const summary = (trace.summary ?? '').trim()
        if (!summary || trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX) || isLogMemory(trace.tags, summary)) continue
        if ((trace.tags ?? []).some(tag => tag.startsWith(SUPERSEDED_TAG))) continue
        const label = memoryOriginLabel({
          origin: originOf(trace),
          ...trace.tags?.includes(UNDATED_TAG) === true ? {} : { recordedAt: trace.ts },
        })
        facts.push({ id: trace.id, text: summary, time: trace.ts, label })
      }
      if (traces.length < PERSON_FACTS_PAGE) break
    }
    // An edit or forget during the listing may not be in it; the next read lists again.
    if ((this.factsEpochs.get(owner) ?? 0) !== epoch) return facts
    this.personFacts.set(owner, { at: Date.now(), facts })
    this.savePersonFacts(owner, facts)
    return facts
  }

  /** Hold a turn-start recall in {@link recallsInFlight} until it settles; its caller handles its outcome. */
  private trackRecall(owner: string, running: Promise<MemoryRecall>): void {
    let set = this.recallsInFlight.get(owner)
    if (set === undefined) {
      set = new Set()
      this.recallsInFlight.set(owner, set)
    }
    set.add(running)
    const owned = set
    const settle = (): void => {
      owned.delete(running)
      if (owned.size === 0 && this.recallsInFlight.get(owner) === owned) this.recallsInFlight.delete(owner)
    }
    void running.then(settle, settle)
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
    // The recent-memory scan reads only the trace table, so it runs beside the search and the first judgment rather
    // than after them; each reader awaits it where it needs the result and owns its rejection there.
    const recentScan = turnStart && request.recent !== undefined ? this.recentPersonTraces(request, deadlineAt) : undefined
    recentScan?.catch(() => undefined)
    // Read beside the search for the same reason; without a relevance judgment nothing would vet the procedures.
    const judged = this.options.relevance !== undefined && (this.options.judgeRecall?.(scope.owner) ?? true)
    const procedureScan = turnStart && this.options.relevance !== undefined && (this.options.procedureCandidates ?? 0) > 0
      ? this.procedureScan(request, deadlineAt)
      : undefined
    procedureScan?.catch(() => undefined)
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
      if (procedureScan !== undefined) hits = [...hits, ...this.procedureHits(request, hits, await procedureScan)]
      if (!judged && this.options.relevance !== undefined) {
        // No judgment decides whether a later turn is personal, so recent memories join only where they always do.
        const recent = recentScan === undefined || request.recent?.sharingOnly === true
          ? []
          : this.recentPersonHits(request, hits, await recentScan)
        return { hits: [...hits, ...recent], timedOut: false, unjudged: true }
      }
      if (request.recent?.sharingOnly !== true || recentScan === undefined) {
        const recent = recentScan === undefined ? [] : this.recentPersonHits(request, hits, await recentScan)
        return await this.judge(request, [...hits, ...recent], deadlineAt)
      }
      return await this.judgeSharingTurn(request, hits, recentScan, deadlineAt)
    } catch (error) {
      if (!(error instanceof MemoryDeadlineError)) throw error
      return { hits: [], timedOut: true }
    }
  }

  /**
   * Judge a later turn, whose recent memories count only when the turn is personal. The judgment without them and the
   * one with them run at once: the one with them is used when the first finds the person sharing and it is not
   * degraded, otherwise the first stands. Running them together gives the result of judging one after the other in
   * the time of the slower call.
   * @param request - the turn-start recall.
   * @param hits - the search's candidates.
   * @param recentScan - the person's recent memories.
   * @param deadlineAt - epoch milliseconds the whole recall must finish within.
   * @returns the chosen judgment.
   */
  private async judgeSharingTurn(
    request: MemoryRecallRequest,
    hits: readonly MemoryHit[],
    recentScan: Promise<readonly TraceDTO[]>,
    deadlineAt: number,
  ): Promise<MemoryRecall> {
    // A judgment never rejects: a failed or late one resolves to its fallback.
    const first = this.judge(request, hits, deadlineAt)
    let recent: MemoryHit[] = []
    try {
      recent = this.recentPersonHits(request, hits, await recentScan)
    } catch (error) {
      // The deadline elapsed during the scan; the first judgment runs on.
      if (!(error instanceof MemoryDeadlineError)) throw error
    }
    if (recent.length === 0) return await first
    const [without, withRecent] = await Promise.all([first, this.judge(request, [...hits, ...recent], deadlineAt)])
    const chosen = without.sharing === true && withRecent.degraded !== true ? withRecent : without
    this.state(request.scope).sharing = chosen.sharing === true
    return chosen
  }

  /**
   * The owner's current learned procedures, newest per name, read by their user-text prefix. The
   * list is kept per owner until a write changes a memory or {@link PROCEDURE_LIST_TTL_MS} passes, which covers
   * procedures another device synced in.
   * @param owner - account id.
   * @returns the procedures.
   */
  private procedureList(owner: string): Promise<readonly ProcedureEntry[]> {
    const known = this.procedureLists.get(owner)
    if (known !== undefined && Date.now() - known.at < PROCEDURE_LIST_TTL_MS) return known.entries
    const entries = (async (): Promise<readonly ProcedureEntry[]> => {
      const profile = ownerProfile(owner)
      const core = await this.options.cores.get(owner)
      const traces = await core.listTraces({
        ownerAgentKind: MEMOS_AGENT,
        ownerProfileId: profile,
        includeAllNamespaces: true,
        userTextPrefix: LEARNED_PROCEDURE_PREFIX,
        limit: PROCEDURE_SCAN,
        offset: 0,
      })
      const newest = new Map<string, ProcedureEntry>()
      for (const trace of traces) {
        if (trace.ownerProfileId !== profile || (trace.summary ?? '').trim() === '' || procedureStatusOf(trace.tags) === 'archived'
          || (trace.tags ?? []).some(tag => tag.startsWith(SUPERSEDED_TAG))) continue
        const header = PROCEDURE_HEADER.exec(trace.userText)
        if (header === null) continue
        const [, name = '', description = ''] = header
        const known = newest.get(name)
        if (known === undefined || known.trace.ts < trace.ts) newest.set(name, { trace, name, description })
      }
      return [...newest.values()]
    })()
    this.procedureLists.set(owner, { at: Date.now(), entries })
    entries.catch(() => {
      if (this.procedureLists.get(owner)?.entries === entries) this.procedureLists.delete(owner)
    })
    return entries
  }

  /**
   * How close each procedure is to the request, by the embedding model's cosine similarity. A procedure is embedded
   * once, from its name and description, and kept for the provider's lifetime; a turn embeds only its request.
   * @param owner - account id.
   * @param entries - the procedures to score.
   * @param asked - the person's message.
   * @param signal - cancels the embedding.
   * @returns the similarity by trace id, or undefined when this deployment embeds remotely.
   */
  private async procedureSimilarity(
    owner: string, entries: readonly ProcedureEntry[], asked: string, signal: AbortSignal,
  ): Promise<Map<string, number> | undefined> {
    const embed = this.options.procedureEmbedding?.embed
    if (embed === undefined || entries.length === 0) return undefined
    let vectors = this.procedureVectors.get(owner)
    if (vectors === undefined) {
      vectors = new Map()
      this.procedureVectors.set(owner, vectors)
    }
    const text = (entry: ProcedureEntry): string => `${entry.name.replaceAll('-', ' ')}: ${entry.description}`
    const missing = entries.filter(entry => vectors.get(entry.trace.id)?.text !== text(entry))
    const [query, documents] = await Promise.all([
      embed(owner, [{ text: asked, role: 'query' }], signal),
      missing.length === 0 ? [] : embed(owner, missing.map(entry => ({ text: text(entry), role: 'document' as const })), signal),
    ])
    for (const [index, entry] of missing.entries()) {
      const vector = documents[index]
      if (vector !== undefined) vectors.set(entry.trace.id, { text: text(entry), vector })
    }
    const current = new Set(entries.map(entry => entry.trace.id))
    for (const id of vectors.keys()) if (!current.has(id)) vectors.delete(id)
    const asking = query[0]
    if (asking === undefined) return undefined
    const scores = new Map<string, number>()
    for (const entry of entries) {
      const vector = vectors.get(entry.trace.id)?.vector
      if (vector === undefined || vector.length !== asking.length) continue
      let dot = 0
      for (let index = 0; index < vector.length; index++) dot += (vector[index] ?? 0) * (asking[index] ?? 0)
      scores.set(entry.trace.id, dot)
    }
    return scores
  }

  /**
   * The procedures a turn-start recall may offer, with how close each is to the request. The read does not depend on
   * the search, so recall starts it before the search and {@link procedureHits} removes what the search returned.
   * A failed or late embedding leaves the similarity out and the word match decides alone.
   * @returns the visible procedures, or throws {@link MemoryDeadlineError} at the deadline.
   */
  private async procedureScan(request: MemoryRecallRequest, deadlineAt: number): Promise<ProcedureScan> {
    const { scope } = request
    const late = `Memory recall exceeded ${request.timeoutMs}ms`
    const workspace = this.workspaceOf(scope.cwd)
    // Project procedures stay in their project, as project memories do.
    const entries = (await withDeadline(this.procedureList(scope.owner), deadlineAt, request.signal, late))
      .filter(entry => scope.cwd === undefined || traceDomain(entry.trace.tags, entry.trace.ownerWorkspaceId) !== 'project'
        || entry.trace.ownerWorkspaceId === workspace)
    try {
      const similarity = await withDeadline(
        this.procedureSimilarity(scope.owner, entries, request.request ?? request.query, request.signal), deadlineAt, request.signal, late,
      )
      return { entries, ...similarity === undefined ? {} : { similarity } }
    } catch (error) {
      if (!(error instanceof MemoryDeadlineError) && !request.signal.aborted) {
        this.options.warn(`procedure similarity failed for ${scope.sessionId}: ${error instanceof Error ? error.message : String(error)}`)
      }
      return { entries }
    }
  }

  /**
   * The procedure candidates, without the ones already among `hits`. Retrieval ranks a procedure among every memory
   * by how close its steps are to the person's words, which seldom brings it up; this offers the relevance judgment
   * the few whose kind of task the request is. A procedure qualifies when its similarity to the request stands
   * `minMargin` above the median of all the owner's procedures (the model's similarities sit in a narrow band, so no
   * fixed value separates a match), or when its name and description share words with the request and the
   * conversation before it. Closest first, then by shared words.
   * @param request - the turn-start recall request.
   * @param hits - the search hits the candidates must not repeat.
   * @param scanned - {@link procedureScan} for this request.
   * @returns at most `procedureCandidates` candidates.
   */
  private procedureHits(request: MemoryRecallRequest, hits: readonly MemoryHit[], scanned: ProcedureScan): MemoryHit[] {
    const seen = new Set<string>(hits.map(hit => hit.id))
    const { entries, similarity } = scanned
    const asked = `${request.context ?? ''}\n${request.request ?? request.query}`
    // A word in many names, such as the product most of the owner's procedures concern, tells none of them apart.
    const named = new Map<string, number>()
    for (const { name } of entries) for (const word of taskWords(name)) named.set(word, (named.get(word) ?? 0) + 1)
    const common = new Set([...named].filter(([, count]) => count > PROCEDURE_COMMON_NAMES).map(([word]) => word))
    const sorted = similarity === undefined ? [] : [...similarity.values()].sort((a, b) => a - b)
    // With few procedures the median is one of the candidates, so the margin says nothing.
    const floor = sorted.length < PROCEDURE_MEDIAN_MIN ? Number.POSITIVE_INFINITY
      : (sorted[Math.floor(sorted.length / 2)] ?? 0) + (this.options.procedureEmbedding?.minMargin ?? 0)
    return entries
      .map(({ trace, name, description }) => {
        const close = similarity?.get(trace.id) ?? 0
        return { trace, close: close >= floor ? close : 0, words: procedureMatch(asked, name, description, common) }
      })
      .filter(({ trace, close, words }) => (close > 0 || words >= PROCEDURE_MATCH_MIN) && !seen.has(trace.id))
      .sort((a, b) => b.close - a.close || b.words - a.words || b.trace.ts - a.trace.ts)
      .slice(0, this.options.procedureCandidates ?? 0)
      .map(({ trace }) => {
        const domain = traceDomain(trace.tags, trace.ownerWorkspaceId)
        const memory: MemoryHit = {
          kind: 'trace',
          id: brandString<MemoryItemId>(trace.id),
          domain,
          tier: 2,
          score: 0,
          snippet: recallSnippet(trace, domain) ?? '',
          recordedAt: trace.ts,
          procedureStatus: procedureStatusOf(trace.tags) ?? 'candidate',
          origin: originOf(trace),
        }
        this.candidateKinds.set(memory, kindOfTrace(trace.tags, trace.summary ?? '', trace.userText))
        return memory
      })
  }

  /**
   * The person's own memories from the last `request.recent.hours`, newest first and outside this session.
   * Superseded, corrected, imported, procedure, and log memories are left out: an imported fact is the person's
   * history, not something that just happened to them. The scan does not depend on the search, so recall starts it
   * before the search and {@link recentPersonHits} removes the traces the search already returned.
   * @returns the eligible traces, or throws {@link MemoryDeadlineError} at the deadline.
   */
  private async recentPersonTraces(request: MemoryRecallRequest, deadlineAt: number): Promise<TraceDTO[]> {
    const recent = request.recent
    if (recent === undefined || recent.hours <= 0 || recent.items <= 0) return []
    const { scope } = request
    const since = Date.now() - recent.hours * 3_600_000
    const core = await this.options.cores.get(scope.owner)
    const eligible = (trace: TraceDTO): boolean => trace.ts >= since && trace.sessionId !== scope.sessionId
      && (trace.summary ?? '').trim() !== '' && !trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)
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
        // Only the window is read: older person memories are never eligible.
        fromMs: since,
        limit: RECENT_PERSON_PAGE,
        offset: page * RECENT_PERSON_PAGE,
      }), deadlineAt, request.signal, `Memory recall exceeded ${request.timeoutMs}ms`)
      found.push(...traces.filter(eligible))
      if (traces.length < RECENT_PERSON_PAGE || traces.every(trace => trace.ts < since)) break
    }
    return found.sort((a, b) => b.ts - a.ts)
  }

  /**
   * The recent-memory candidates: the scanned traces not already among `hits`, sampled so the limit reaches every
   * recent conversation.
   * @param request - the turn-start recall request carrying the `recent` limits.
   * @param hits - the search hits the candidates must not repeat.
   * @param scanned - {@link recentPersonTraces} for this request.
   * @returns the candidates, sharing memories first.
   */
  private recentPersonHits(request: MemoryRecallRequest, hits: readonly MemoryHit[], scanned: readonly TraceDTO[]): MemoryHit[] {
    const recent = request.recent
    if (recent === undefined) return []
    const seen = new Set<string>(hits.map(hit => hit.id))
    const found = scanned.filter(trace => !seen.has(trace.id))
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
    // Retrieval may have used most of the recall budget; the judgment still gets its minimum window, because the
    // unjudged fallback costs the turn more than the wait does.
    const timeoutMs = Math.max(Math.min(relevance.timeoutMs, deadlineAt - now - 50), Math.min(relevance.minMs, relevance.timeoutMs))
    const user = relevanceInput(request.request ?? request.query, request.context ?? '', offered, now)
    const audit = {
      sessionId: request.scope.sessionId,
      candidates: candidates.length,
      inputChars: user.length,
      retrievalMs: now - (deadlineAt - request.timeoutMs),
      windowMs: timeoutMs,
    }
    const fallback = (reason: string, outcome: JudgmentOutcome, attempts: readonly JudgmentAttempt[]): MemoryRecall => {
      this.options.warn(`recall relevance judgment ${reason} for ${request.scope.sessionId}; delivering a mechanical fallback`)
      this.recordJudgment(request.scope.owner, audit, { outcome, reason, attempts }, Date.now() - now, false)
      const kept = candidates.filter((_, index) => offered[index]?.kind !== 'log' && offered[index]?.procedureStatus !== 'candidate').slice(0, 2)
      return { hits: kept, timedOut: false, degraded: true }
    }
    if (timeoutMs < 300) return fallback('had no time left', 'no-time', [])
    const run = await this.judgeAttempts(request, relevance, user, candidates.length, now + timeoutMs)
    if (run.judgment === undefined) return fallback(run.reason, run.outcome, run.attempts)
    const { judgment } = run
    const durationMs = Date.now() - now
    this.options.info(`recall judged ${request.scope.sessionId} in ${durationMs} ms: lead=${judgment.lead} kept ${judgment.keep.length} of ${candidates.length}`)
    this.recordJudgment(request.scope.owner, audit, { outcome: 'judged', kept: judgment.keep.length, lead: judgment.lead, attempts: run.attempts }, durationMs, true)
    const state = this.state(request.scope)
    state.sharing = judgment.sharing
    const hits = judgment.keep.flatMap(index => candidates[index] ?? [])
    return { hits, timedOut: false, lead: judgment.lead, sharing: judgment.sharing }
  }

  /**
   * Ask for the relevance judgment until one answer is usable or the window closes. The first request goes out at
   * once; a second identical one goes out after `hedgeMs`, or as soon as the first fails, while at least 300 ms of the
   * window remain. The first usable answer settles the run and cancels the other request. With `hedgeMs` 0 only one
   * request is sent.
   * @param request - the recall the judgment serves; its signal cancels every attempt.
   * @param relevance - the judgment's runner and limits.
   * @param user - the judgment's user message.
   * @param count - how many candidates the message offers.
   * @param endAt - epoch milliseconds the window closes.
   * @returns the usable judgment, or why there is none, with each attempt's outcome.
   */
  private judgeAttempts(
    request: MemoryRecallRequest,
    relevance: NonNullable<MemosMemoryOptions['relevance']>,
    user: string,
    count: number,
    endAt: number,
  ): Promise<JudgmentRun> {
    const startedAt = Date.now()
    const attempts: JudgmentAttempt[] = []
    const controllers: AbortController[] = []
    return new Promise((resolve) => {
      let settled = false
      let pending = 0
      let reason = 'returned no usable answer'
      let outcome: JudgmentOutcome = 'unusable'
      let hedge: ReturnType<typeof setTimeout> | undefined
      const finish = (run: JudgmentRun): void => {
        if (settled) return
        settled = true
        clearTimeout(hedge)
        clearTimeout(closing)
        request.signal.removeEventListener('abort', onAbort)
        for (const controller of controllers) controller.abort(new MemoryDeadlineError('Memory relevance judgment settled'))
        resolve(run)
      }
      const launch = (): boolean => {
        const remaining = endAt - Date.now()
        if (settled || attempts.length >= (relevance.hedgeMs > 0 ? 2 : 1) || remaining < 300) return false
        const controller = new AbortController()
        controllers.push(controller)
        const attempt: JudgmentAttempt = { startMs: Date.now() - startedAt, status: 'pending' }
        attempts.push(attempt)
        pending++
        const signal = AbortSignal.any([request.signal, controller.signal])
        void this.withRoute(request.scope.route, () => relevance.run(RELEVANCE_PROMPT, user, remaining, signal))
          .then(
            (answer) => {
              attempt.ms = Date.now() - startedAt - attempt.startMs
              const judgment = parseRelevance(answer, count)
              attempt.status = judgment === undefined ? 'unusable' : 'usable'
              if (judgment !== undefined) {
                finish({ judgment, attempts })
              } else if (!settled) {
                reason = 'returned no usable answer'
                outcome = 'unusable'
              }
            },
            (error: unknown) => {
              attempt.ms = Date.now() - startedAt - attempt.startMs
              attempt.status = settled ? 'cancelled' : 'failed'
              if (!settled) {
                reason = `failed (${describe(error)})`
                outcome = 'failed'
              }
            },
          )
          .finally(() => {
            pending--
            // A failed or unusable first answer is resent at once instead of waiting for the hedge.
            if (!settled && !launch() && pending === 0) finish({ reason, outcome, attempts })
          })
        return true
      }
      const onAbort = (): void => { finish({ reason: `failed (${describe(abortReason(request.signal))})`, outcome: 'failed', attempts }) }
      const closing = setTimeout(() => {
        finish({ reason: `failed (Memory relevance judgment exceeded ${endAt - startedAt}ms)`, outcome: 'timeout', attempts })
      }, Math.max(0, endAt - Date.now()))
      request.signal.addEventListener('abort', onAbort, { once: true })
      if (request.signal.aborted) {
        onAbort()
        return
      }
      launch()
      if (relevance.hedgeMs > 0) hedge = setTimeout(() => { launch() }, relevance.hedgeMs)
    })
  }

  /**
   * Append one judgment's audit row to the owner's MemOS `api_logs`, where the judgment's timing and outcome can be
   * read beside the core's own model calls. The row carries counts and timings, never memory text.
   */
  private recordJudgment(
    owner: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    durationMs: number,
    success: boolean,
  ): void {
    void this.options.cores.get(owner).then(
      (core) => { core.logApiCall({ toolName: JUDGMENT_LOG, input, output, durationMs, success }) },
      // The core failed to open, which the recall that ran on it already reported; the audit row is dropped.
      () => undefined,
    )
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
    // several topics retrieves each of them and merges. At turn start, each sentence of a message with several also
    // gets its own retrieval beside the conversation query. A single-topic query costs exactly one retrieval.
    const clauses = turnStart ? [] : queryClauses(request.query)
    const sentenceRecall = this.options.sentenceRecall
    const sentences = turnStart && sentenceRecall !== undefined && request.request !== undefined
      ? messageSentences(request.request, sentenceRecall.sentences)
      : []
    const search = clauses.length > 0
      ? Promise.all(clauses.map(retrieve)).then(mergeRankedHits)
      : sentences.length > 0 && sentenceRecall !== undefined
        ? Promise.all([retrieve(request.query), ...sentences.map(retrieve)])
          .then(([whole, ...parts]) => withSentenceHits(whole, parts, sentenceRecall.hits))
        : retrieve(request.query)
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
    const namespace = this.namespaceOf(scope)
    const workspace = normalizeNamespace(namespace, MEMOS_AGENT).workspaceId
    // One read for every trace hit: a read per hit queues each behind whatever else the account's core is doing.
    const traceIds = hits.flatMap(hit => hit.refKind === 'trace' ? [hit.refId] : [])
    const read = traceIds.length === 0 ? [] : await core.getTraces(traceIds, namespace)
    const traces = new Map(traceIds.map((id, index) => [id, read[index] ?? null]))
    const classified = hits.map((hit) => {
      const hitOrigin = this.hitOrigin(hit, traces, turnStart)
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
    })
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
  private hitOrigin(hit: RetrievalHitDTO, traces: ReadonlyMap<string, TraceDTO | null>, turnStart: boolean): {
    domain: MemoryDomain
    workspaceId: string | null | undefined
    summary?: string
    correction?: boolean
    superseded?: boolean
    procedureStatus?: ProcedureStatus
    candidateKind?: CandidateKind
    recordedAt?: number
    origin?: MemoryOrigin
  } {
    switch (hit.refKind) {
      case 'experience':
      case 'skill':
        return { domain: 'experience', workspaceId: hit.ownerWorkspaceId }
      case 'world-model':
        return { domain: 'world', workspaceId: hit.ownerWorkspaceId }
      case 'trace': {
        const trace = traces.get(hit.refId) ?? null
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
      this.personFactsChanged(turn.scope.owner)
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
        project: this.projectOf(scope),
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
        project: this.projectOf(turn.scope),
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
      await this.options.profiles?.store.dispose()
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
          body: exchangeBody(trace),
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
      ...request.since === undefined ? {} : { fromMs: request.since },
      ...request.domains === undefined ? {} : { domains: request.domains },
      ...request.cwd === undefined ? {} : { projectWorkspaceId: this.workspaceOf(request.cwd) ?? null },
      ...request.turns === true ? { groupByTurn: true } : {},
    }
    const [traces, total] = await this.read(request, () => Promise.all([
      core.listTraces({
        ...filter,
        limit: request.limit,
        offset: request.offset,
      }),
      core.countTraces(filter),
    ]))
    const owned = traces.filter(trace => trace.ownerProfileId === profile)
    return { records: (request.turns === true ? turnMessages(owned) : owned).map(toRecord), total }
  }

  async remember(request: Parameters<MemoryProvider['remember']>[0]): Promise<MemoryItemId> {
    this.procedureLists.delete(request.scope.owner)
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
      }, `${scope.sessionId}:remember:${now}`, rememberedDomain(request.domain, this.projectOf(scope)))
      return written
    })
    this.personFactsChanged(scope.owner)
    return brandString<MemoryItemId>(traceId)
  }

  async rememberMany(request: Parameters<MemoryProvider['rememberMany']>[0]): Promise<{ readonly ids: readonly MemoryItemId[]; readonly skipped: number }> {
    request.signal.throwIfAborted()
    const state = this.state(request.scope)
    return this.schedule(state, async () => {
      request.signal.throwIfAborted()
      const core = await this.options.cores.get(request.scope.owner)
      const domain = rememberedDomain(request.domain, this.projectOf(request.scope))
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
      this.personFactsChanged(request.scope.owner)
      return { ids: ids.map(id => brandString<MemoryItemId>(id)), skipped }
    })
  }

  async edit(request: Parameters<MemoryProvider['edit']>[0]): Promise<MemoryRecord | undefined> {
    this.procedureLists.delete(request.owner)
    this.dropPersonFacts(request.owner)
    const core = await this.options.cores.get(request.owner)
    if (await this.ownedTrace(core, request) === undefined) return undefined
    const updated = await this.read(request, () => core.updateTrace(request.id, { summary: request.summary }))
    // A listing that started between the first drop and the update may still hold the old text.
    this.dropPersonFacts(request.owner)
    return updated ? toRecord(updated) : undefined
  }

  async setProcedureStatus(request: Parameters<MemoryProvider['setProcedureStatus']>[0]): Promise<boolean> {
    this.procedureLists.delete(request.owner)
    const core = await this.options.cores.get(request.owner)
    const trace = await this.ownedTrace(core, request)
    if (trace === undefined || !trace.userText.startsWith(LEARNED_PROCEDURE_PREFIX)) return false
    const tags = [...(trace.tags ?? []).filter(tag => !tag.startsWith(PROCEDURE_TAG)), `${PROCEDURE_TAG}${request.status}`]
    await this.read(request, () => core.updateTrace(request.id, { tags }))
    return true
  }

  async forget(request: Parameters<MemoryProvider['forget']>[0]): Promise<boolean> {
    this.procedureLists.delete(request.owner)
    this.dropPersonFacts(request.owner)
    const core = await this.options.cores.get(request.owner)
    if (await this.ownedTrace(core, request) === undefined) return false
    const { deleted } = await this.read(request, () => core.deleteTrace(request.id))
    // A listing that started between the first drop and the delete may still hold the memory.
    this.dropPersonFacts(request.owner)
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

/**
 * What `memory_get` shows of one trace: the person's message and the assistant's reply, labelled as `memory_search`
 * labels them, so an earlier answer of the assistant is never read as a fact the person stated.
 * @param trace - the trace read.
 * @returns the labelled exchange, or the summary when the trace holds neither side.
 */
function exchangeBody(trace: TraceDTO): string {
  const user = trace.userText.trim()
  const agent = trace.agentText.trim()
  if (!user && !agent) return trace.summary ?? ''
  return [
    ...user ? [`User message: ${user}`] : [],
    ...agent ? [`Assistant answer: ${agent}`] : [],
  ].join('\n\n')
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
    origin: originOf(trace),
  }
}

/**
 * Keep, of each turn in a turn-grouped listing, the first trace that holds the person's message. The core returns
 * whole turns, newest turn first and each turn's traces in episode order; its tool-step traces carry no message.
 * @param traces - the turn-grouped traces.
 * @returns one trace per turn that holds a message, in the listing's turn order.
 */
function turnMessages(traces: readonly TraceDTO[]): TraceDTO[] {
  const seen = new Set<string>()
  const messages: TraceDTO[] = []
  for (const trace of traces) {
    if (trace.userText.trim().length === 0) continue
    const key = `${trace.episodeId}:${trace.turnId}`
    if (seen.has(key)) continue
    seen.add(key)
    messages.push(trace)
  }
  return messages
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
 * Add each sentence retrieval's best hits to the conversation query's hits. The conversation query keeps its whole
 * ranking; a sentence contributes at most `perSentence` of its top hits, so the candidates the relevance judgment
 * reads grow by a bounded amount.
 * @param whole - hits of the conversation query, in rank order.
 * @param parts - hits of each sentence retrieval, in rank order.
 * @param perSentence - top hits taken from each sentence retrieval.
 * @returns the conversation query's hits followed by the sentences' new ones.
 */
function withSentenceHits(whole: readonly MemoryHit[], parts: readonly (readonly MemoryHit[])[], perSentence: number): MemoryHit[] {
  const seen = new Set<MemoryItemId>(whole.map(hit => hit.id))
  const merged = [...whole]
  for (const part of parts) {
    for (const hit of part.slice(0, perSentence)) {
      if (seen.has(hit.id)) continue
      seen.add(hit.id)
      merged.push(hit)
    }
  }
  return merged
}

/**
 * Merge the result lists of a multi-topic explicit search, keeping each memory once at its best score.
 * @param parts - one ranked list per query clause.
 * @returns one ranked list, best first.
 */
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
