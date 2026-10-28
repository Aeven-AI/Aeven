/**
 * Service Definition for long-term memory: one registered provider serves recall,
 * turn capture, and inspection to every memory Consumer.
 *
 * @module @aeven/memory
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import type { SessionId } from '@aeven/session'
import type {
  LearnedProcedure,
  LearnedProceduresRequest,
  MemoryDetail,
  MemoryDomain,
  MemoryEnvironment,
  MemoryHit,
  MemoryItemId,
  MemoryPage,
  MemoryProfile,
  MemoryProvider,
  MemoryRecord,
  MemoryRecall,
  MemoryRecallRequest,
  MemoryScope,
  MemorySkill,
  MemoryTimelineEntry,
  MemoryTurn,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Long-term memory provider slot. */
    memory: Memory
  }
}

/**
 * Fold several ranked hit lists into one, keeping each memory once at its best score.
 * @param parts - one ranked list per query clause.
 * @returns one ranked list, best first.
 */
export function mergeRankedHits<T extends { readonly id: string; readonly score: number }>(
  parts: readonly (readonly T[])[],
): T[] {
  const best = new Map<string, T>()
  for (const hit of parts.flat()) {
    const seen = best.get(hit.id)
    if (seen === undefined || hit.score > seen.score) best.set(hit.id, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

/**
 * Model-facing memory tool names. Recalled context and hit snippets may direct the model to these tools
 * (with `memory_get` taking the `MemoryDetailKind` values); `@aeven/tool-memory` registers them.
 */
export const MEMORY_TOOL = {
  search: 'memory_search',
  get: 'memory_get',
  timeline: 'memory_timeline',
  environments: 'memory_environments',
  skills: 'memory_skills',
  skill: 'memory_skill',
  remember: 'memory_remember',
  rememberBulk: 'memory_remember_bulk',
} as const

/**
 * Where and when a recalled memory came from, as the model reads it beside the memory: the date it was recorded, or
 * that it was imported, with the source's own date when the import gave one.
 * @param hit - the recalled memory.
 * @param now - epoch milliseconds of the reading; when given, a recorded date is followed by how long ago it was, so
 * the model does not read a memory from two days ago as last night.
 * @returns a short label such as `recorded 2026-10-20` or `imported 2026-10-20, undated`; empty when nothing is known.
 */
export function memoryOriginLabel(hit: Pick<MemoryHit, 'origin' | 'recordedAt'>, now?: number): string {
  // The host's local calendar day, which is the person's: a UTC day labels a late-evening memory with the day before.
  const day = (time: number): string => {
    const date = new Date(time)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  if (hit.origin?.kind === 'import') {
    return `imported ${day(hit.origin.savedAt)}, ${hit.recordedAt === undefined ? 'undated' : `dated ${day(hit.recordedAt)}`}`
  }
  const time = hit.recordedAt ?? hit.origin?.savedAt
  if (time === undefined) return ''
  return now === undefined ? `recorded ${day(time)}` : `recorded ${day(time)}, ${elapsedLabel(time, now)}`
}

/**
 * Calendar days between two instants in the host's local zone, in words.
 * @param time - the earlier instant, epoch milliseconds.
 * @param now - the later instant, epoch milliseconds.
 * @returns `today`, `yesterday`, or a count of days, weeks, months, or years ago.
 */
function elapsedLabel(time: number, now: number): string {
  const midnight = (at: number): number => {
    const date = new Date(at)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  const days = Math.round((midnight(now) - midnight(time)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 730) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}

/** Opens the text and the summary of every learned-procedure memory, followed by its name and a colon. */
export const LEARNED_PROCEDURE_PREFIX = 'Learned procedure'

/** A learned-procedure memory text: the prefix, the kebab-case name, the description line, and the procedure. */
const LEARNED_TEXT = /^Learned procedure ([a-z0-9][a-z0-9-]*): ([^\n]*)(?:\n+([\s\S]*))?$/

/** A learned-procedure summary: the prefix and the name, before the condensed procedure. */
const LEARNED_SUMMARY = /^Learned procedure [a-z0-9][a-z0-9-]*:\s*/

/** Records one page of a learned-procedure listing reads. */
const PROCEDURE_PAGE = 200

/**
 * Read one memory as a learned procedure.
 * @param record - a listed memory.
 * @returns the procedure, or undefined when the memory's text is not a learned procedure.
 */
export function learnedProcedureOf(record: MemoryRecord): LearnedProcedure | undefined {
  const match = LEARNED_TEXT.exec(record.userText)
  if (match === null) return undefined
  const content = (match[3] ?? '').trim()
  return {
    id: record.id,
    name: match[1] ?? '',
    description: (match[2] ?? '').trim(),
    summary: record.summary.replace(LEARNED_SUMMARY, '').trim(),
    content,
    domain: record.domain,
    time: record.time,
    sessionId: record.sessionId,
    status: record.procedureStatus ?? 'candidate',
  }
}

/** Thrown when a memory operation runs while no provider is registered. */
/**
 * Account sync lease name of an account's memory maintenance: work that derives new memory from all stored memory,
 * such as skill crystallization and merging learned procedures. With account sync, one device runs it at a time.
 */
export const MEMORY_MAINTENANCE_LEASE = 'memory/maintenance'

export class MemoryUnavailableError extends Error {
  constructor() {
    super('No memory provider is registered')
    this.name = 'MemoryUnavailableError'
  }
}

/**
 * Derive the memory scope of the session an agent drives. Memory is per signed-in user, so a session
 * without an owning account has no scope and no memory.
 * @param agent - agent whose session owner, working directory, and model route apply.
 * @returns scope carrying the persisted request route, else the agent's configured route; undefined without an owner.
 */
export function memoryScopeOf(agent: Agent): MemoryScope | undefined {
  const session = agent.session
  const owner = session.header.owner
  if (owner === undefined) return undefined
  const config = session.requestHeader()?.config
  const provider = config?.provider ?? agent.options.provider
  const model = config?.model ?? agent.options.model
  const reasoningEffort = config?.reasoningEffort ?? agent.options.reasoningEffort
  return {
    owner,
    sessionId: session.id,
    ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
    ...provider === undefined || model === undefined ? {} : {
      route: { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } },
    },
  }
}

interface ActiveHolder {
  readonly start: () => void
  readonly stop: () => void
}

/** Slot holding the one memory provider of a Host composition. */
export default class Memory extends Service {
  private provider: MemoryProvider | undefined
  private readonly holders = new Set<ActiveHolder>()

  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  /**
   * Register the composition's memory provider; a second registration fails without replacing the first.
   * @param provider - implementation owned by the contributing fiber.
   * @returns idempotent disposer that empties the slot.
   */
  register(provider: MemoryProvider): () => void {
    if (this.provider !== undefined) throw new Error(`Memory provider already registered: ${this.provider.id}`)
    this.provider = provider
    for (const holder of this.holders) holder.start()
    return () => {
      if (this.provider !== provider) return
      this.provider = undefined
      for (const holder of this.holders) holder.stop()
    }
  }

  /** True while a provider is registered. */
  get active(): boolean {
    return this.provider !== undefined
  }

  /**
   * Keep a contribution registered exactly while a provider is registered, so a composition
   * without a provider shows the model no memory tools or guidance.
   * @param setup - registers the contribution and returns its disposer; runs on each provider registration.
   * @returns disposer that stops watching and disposes a live contribution.
   */
  whileActive(setup: () => () => void): () => void {
    let dispose: (() => void) | undefined
    const holder: ActiveHolder = {
      start: () => { dispose ??= setup() },
      stop: () => {
        const current = dispose
        dispose = undefined
        current?.()
      },
    }
    this.holders.add(holder)
    if (this.active) holder.start()
    return () => {
      this.holders.delete(holder)
      holder.stop()
    }
  }

  private current(): MemoryProvider {
    if (this.provider === undefined) throw new MemoryUnavailableError()
    return this.provider
  }

  /**
   * Retrieve memory relevant to a query within the request's hard budget.
   * @param request - query, scope, and foreground budget.
   * @returns ranked hits visible to the scope.
   */
  recall(request: MemoryRecallRequest): Promise<MemoryRecall> {
    return this.current().recall(request)
  }

  /**
   * Read the owner's profile and recorded dates from all of their person memories.
   * @param request - scope whose owner is profiled, and cancellation.
   * @returns the profile; its `text` is absent until the provider's first distillation finishes.
   */
  profile(request: Parameters<MemoryProvider['profile']>[0]): Promise<MemoryProfile> {
    return this.current().profile(request)
  }

  /**
   * Hand one completed turn to the provider for background learning.
   * @param turn - turn assembled from committed session events.
   */
  capture(turn: MemoryTurn): void {
    this.current().capture(turn)
  }

  /**
   * Release per-session provider state; resolves immediately while no provider is registered.
   * @param sessionId - session that is no longer live.
   * @returns after the provider released the session.
   */
  async closeSession(sessionId: SessionId): Promise<void> {
    await this.provider?.closeSession(sessionId)
  }

  /**
   * Set a learned procedure's maturity.
   * @param request - account id, the procedure's memory id, and the new status.
   * @returns true when a procedure of the owner was updated.
   */
  setProcedureStatus(request: Parameters<MemoryProvider['setProcedureStatus']>[0]): Promise<boolean> {
    return this.current().setProcedureStatus(request)
  }

  /**
   * Domain one captured turn was filed under; undefined while no provider is registered.
   * @param request - the session and its turn number.
   * @returns the turn's domain, or undefined when the provider has none for it.
   */
  async turnDomain(request: Parameters<MemoryProvider['turnDomain']>[0]): Promise<MemoryDomain | undefined> {
    return this.provider?.turnDomain(request)
  }

  /**
   * Read one memory item.
   * @param request - scope, item kind, and id.
   * @returns the item, or undefined when the scope holds no such item.
   */
  detail(request: Parameters<MemoryProvider['detail']>[0]): Promise<MemoryDetail | undefined> {
    return this.current().detail(request)
  }

  /**
   * Read the ordered traces of one episode.
   * @param request - scope, episode id, and maximum entry count.
   * @returns entries in capture order.
   */
  timeline(request: Parameters<MemoryProvider['timeline']>[0]): Promise<readonly MemoryTimelineEntry[]> {
    return this.current().timeline(request)
  }

  /**
   * List learned environment models.
   * @param request - scope, optional keyword filter, and maximum count.
   * @returns at most `limit` models.
   */
  environments(request: Parameters<MemoryProvider['environments']>[0]): Promise<readonly MemoryEnvironment[]> {
    return this.current().environments(request)
  }

  /**
   * List crystallized skills.
   * @param request - scope, optional status filter, and maximum count.
   * @returns at most `limit` skills.
   */
  skills(request: Parameters<MemoryProvider['skills']>[0]): Promise<readonly MemorySkill[]> {
    return this.current().skills(request)
  }

  /**
   * Load one skill and record its selection for the session's current task.
   * @param request - scope, skill id, and the selecting tool call.
   * @returns the skill, or undefined when the scope holds no such skill.
   */
  useSkill(request: Parameters<MemoryProvider['useSkill']>[0]): Promise<MemorySkill | undefined> {
    return this.current().useSkill(request)
  }

  /**
   * List the owner's memories, newest first.
   * @param request - scope, optional text query, and page bounds.
   * @returns one page and the total match count.
   */
  list(request: Parameters<MemoryProvider['list']>[0]): Promise<MemoryPage> {
    return this.current().list(request)
  }

  /**
   * List every learned procedure of the owner, newest first. Copies stored under one name are all listed.
   * @param request - owner, the workspace whose sessions may see them, and cancellation.
   * @returns the procedures.
   */
  async procedures(request: LearnedProceduresRequest): Promise<LearnedProcedure[]> {
    const procedures: LearnedProcedure[] = []
    for (let offset = 0; ; offset += PROCEDURE_PAGE) {
      const page = await this.list({
        owner: request.owner,
        query: LEARNED_PROCEDURE_PREFIX,
        ...request.cwd === undefined ? {} : { cwd: request.cwd },
        limit: PROCEDURE_PAGE,
        offset,
        signal: request.signal,
      })
      for (const record of page.records) {
        const procedure = learnedProcedureOf(record)
        if (procedure !== undefined) procedures.push(procedure)
      }
      if (page.records.length === 0 || offset + PROCEDURE_PAGE >= page.total) break
    }
    return procedures.sort((a, b) => b.time - a.time)
  }

  /**
   * Store one fact the user explicitly asked to be remembered.
   * @param request - scope and the fact in the user's words.
   * @returns the stored memory's id.
   */
  remember(request: Parameters<MemoryProvider['remember']>[0]): Promise<MemoryItemId> {
    return this.current().remember(request)
  }

  /**
   * Import already-distilled facts verbatim in one atomic batch, skipping facts the owner's memory already holds.
   * @param request - owning scope, ordered facts with their original time when known, their domain, and cancellation.
   * @returns ids of the facts written, in input order, and how many were skipped; rejects without writing any fact
   * on failure.
   */
  rememberMany(request: Parameters<MemoryProvider['rememberMany']>[0]): Promise<{ readonly ids: readonly MemoryItemId[]; readonly skipped: number }> {
    return this.current().rememberMany(request)
  }

  /**
   * Replace the summary of one of the owner's memories.
   * @param request - scope, memory id, and the corrected summary.
   * @returns the updated memory, or undefined when the owner has no such memory.
   */
  edit(request: Parameters<MemoryProvider['edit']>[0]): Promise<MemoryRecord | undefined> {
    return this.current().edit(request)
  }

  /**
   * Delete one of the owner's memories.
   * @param request - scope and memory id.
   * @returns true when a memory of this owner was deleted.
   */
  forget(request: Parameters<MemoryProvider['forget']>[0]): Promise<boolean> {
    return this.current().forget(request)
  }

  /**
   * Record a human judgment about one captured turn.
   * @param request - scope, turn number, polarity, and optional note.
   * @returns true when the judgment was recorded.
   */
  feedback(request: Parameters<MemoryProvider['feedback']>[0]): Promise<boolean> {
    return this.current().feedback(request)
  }
}
