/**
 * The memory manager Remote: what Aeven has learned about the signed-in user, their projects, and their
 * work, with View, Correct, and Forget. Every operation acts for the caller of the running request and
 * never reaches another user's memories or procedures.
 *
 * @module @aeven/api-memory-manager
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/session-query'
import { LEARNED_PROCEDURE_PREFIX, learnedProcedureOf } from '@aeven/memory'
import type {} from '@aeven/memory-invariants'
import type { InvariantId } from '@aeven/memory-invariants/types'
import type { LearnedProcedure, MemoryItemId, MemoryRecord } from '@aeven/memory/types'
import type {
  ManagedInvariantChange,
  ManagedInvariantsPage,
  ManagedMemory,
  ManagedMemoryPage,
  ManagedMemoryQuery,
  ManagedProcedure,
  ManagedProcedureDetail,
  ManagedProceduresPage,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Memory manager Remote controller. */
    memoryManagerController: MemoryManagerController
  }
}

/** Service configuration. */
export interface Config {
  /** Budget of one memory provider read or write, in milliseconds. */
  timeoutMs: number
  /** Largest memory page one request may ask for. */
  maxPageSize: number
}

/** The signed-in user's memories, standing facts, and learned procedures. */
export default class MemoryManagerController extends TypertRemoteService {
  static inject = ['typert', 'memory', 'identityUsers', 'sessionQuery']

  static Config: z<Config> = z.object({
    timeoutMs: z.natural().min(1).default(15_000),
    maxPageSize: z.natural().min(1).default(200),
  })

  /**
   * @param ctx - Host context carrying memory, identity, and session query.
   * @param config - provider budget and page bound.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'memoryManagerController', { namespace: 'memoryManager' })
  }

  /**
   * List the caller's memories, newest first.
   * @param request - optional text and domain filters, and page bounds.
   * @returns the page, or `available: false` when no memory provider runs.
   */
  @Remote
  async memories(request: ManagedMemoryQuery): Promise<ManagedMemoryPage> {
    const owner = this.owner()
    if (!this.ctx.memory.active) return { available: false }
    const page = await this.ctx.memory.list({
      owner,
      ...request.query ? { query: request.query } : {},
      ...request.domains ? { domains: request.domains } : {},
      limit: Math.min(Math.max(request.limit, 1), this.config.maxPageSize),
      offset: Math.max(request.offset, 0),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })
    const workspaces = await this.workspaces(owner)
    return { available: true, memories: page.records.map(record => managedMemory(record, workspaces)), total: page.total }
  }

  /**
   * Replace the summary of one of the caller's memories.
   * @param id - memory id.
   * @param summary - corrected summary.
   * @returns the updated memory, or undefined when the caller has no such memory.
   */
  @Remote
  async editMemory(id: MemoryItemId, summary: string): Promise<ManagedMemory | undefined> {
    const owner = this.owner()
    const text = summary.trim()
    if (!text) throw new Error('a memory needs text')
    const updated = await this.ctx.memory.edit({ owner, id, summary: text, signal: AbortSignal.timeout(this.config.timeoutMs) })
    return updated === undefined ? undefined : managedMemory(updated, await this.workspaces(owner))
  }

  /**
   * Delete one of the caller's memories.
   * @param id - memory id.
   * @returns true when a memory of the caller was deleted.
   */
  @Remote
  forgetMemory(id: MemoryItemId): Promise<boolean> {
    return this.ctx.memory.forget({ owner: this.owner(), id, signal: AbortSignal.timeout(this.config.timeoutMs) })
  }

  /**
   * List the statements the caller confirmed as always true, with the budget they render under.
   * @returns the document, or `available: false` when this Host serves none.
   */
  @Remote
  invariants(): ManagedInvariantsPage {
    const owner = this.owner()
    const service = this.ctx.get('memoryInvariants')
    return service === undefined ? { available: false } : { available: true, ...service.read(owner) }
  }

  /**
   * Promote one statement into every request of the caller. Promoting a statement that already stands refreshes
   * how current it is instead of spending the block twice.
   * @param text - the statement the caller confirmed.
   * @returns what changed, with the reason when the block has no room for the statement.
   */
  @Remote
  addInvariant(text: string): ManagedInvariantChange {
    const owner = this.owner()
    const service = this.ctx.get('memoryInvariants')
    return service === undefined ? { available: false } : { available: true, ...service.add(owner, text) }
  }

  /**
   * Replace the text of one of the caller's standing facts, keeping its place in the block.
   * @param id - identifier of the statement to replace.
   * @param text - the replacement statement.
   * @returns what changed, with the reason when the id or the text was refused.
   */
  @Remote
  editInvariant(id: InvariantId, text: string): ManagedInvariantChange {
    const owner = this.owner()
    const service = this.ctx.get('memoryInvariants')
    return service === undefined ? { available: false } : { available: true, ...service.edit(owner, id, text) }
  }

  /**
   * Drop one of the caller's standing facts, which frees its share of the block.
   * @param id - identifier of the statement to drop.
   * @returns what changed, with the reason when the caller has no such statement.
   */
  @Remote
  removeInvariant(id: InvariantId): ManagedInvariantChange {
    const owner = this.owner()
    const service = this.ctx.get('memoryInvariants')
    return service === undefined ? { available: false } : { available: true, ...service.remove(owner, id) }
  }

  /**
   * List the caller's learned procedures, newest first, one per name.
   * @returns the procedures without their text, or `available: false` when no memory provider runs.
   */
  @Remote
  async procedures(): Promise<ManagedProceduresPage> {
    const owner = this.owner()
    if (!this.ctx.memory.active) return { available: false }
    const workspaces = await this.workspaces(owner)
    return { available: true, procedures: (await this.latest(owner)).map(procedure => managedProcedure(procedure, workspaces)) }
  }

  /**
   * Read one of the caller's learned procedures with its condensed and full text.
   * @param id - memory id of the procedure.
   * @returns the procedure, or undefined when the caller has no such procedure.
   */
  @Remote
  async procedure(id: MemoryItemId): Promise<ManagedProcedureDetail | undefined> {
    const owner = this.owner()
    const procedure = (await this.latest(owner)).find(item => item.id === id)
    return procedure === undefined ? undefined : managedProcedureDetail(procedure, await this.workspaces(owner))
  }

  /**
   * Replace the condensed procedure memory recall delivers for one of the caller's learned procedures.
   * @param id - memory id of the procedure.
   * @param summary - the corrected condensed procedure, without the procedure's name.
   * @returns the updated procedure, or undefined when the caller has no such procedure.
   */
  @Remote
  async editProcedure(id: MemoryItemId, summary: string): Promise<ManagedProcedureDetail | undefined> {
    const owner = this.owner()
    const text = summary.trim()
    if (!text) throw new Error('a procedure needs its steps')
    const procedure = (await this.latest(owner)).find(item => item.id === id)
    if (procedure === undefined) return undefined
    const updated = await this.ctx.memory.edit({
      owner,
      id,
      summary: `${LEARNED_PROCEDURE_PREFIX} ${procedure.name}: ${text}`,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })
    const parsed = updated === undefined ? undefined : learnedProcedureOf(updated)
    return parsed === undefined ? undefined : managedProcedureDetail(parsed, await this.workspaces(owner))
  }

  /** The newest procedure under each name, newest first. */
  private async latest(owner: string): Promise<LearnedProcedure[]> {
    const procedures = await this.ctx.memory.procedures({ owner, signal: AbortSignal.timeout(this.config.timeoutMs) })
    const names = new Set<string>()
    return procedures.filter((procedure) => {
      if (names.has(procedure.name)) return false
      names.add(procedure.name)
      return true
    })
  }

  private owner(): string {
    const owner = this.ctx.identityUsers.actingUser()?.id
    if (owner === undefined) throw new Error('the memory manager needs a signed-in user')
    return owner
  }

  /** Working directory of each of the owner's sessions, by session id. */
  private async workspaces(owner: string): Promise<ReadonlyMap<string, string>> {
    const sessions = await this.ctx.sessionQuery.listSessions(AbortSignal.timeout(this.config.timeoutMs))
    const workspaces = new Map<string, string>()
    for (const { header } of sessions) {
      if (header.owner === owner && header.cwd !== undefined) workspaces.set(header.id, header.cwd)
    }
    return workspaces
  }
}

function managedMemory(record: MemoryRecord, workspaces: ReadonlyMap<string, string>): ManagedMemory {
  const workspace = workspaces.get(record.sessionId)
  return {
    id: record.id,
    domain: record.domain,
    time: record.time,
    summary: record.summary,
    userText: record.userText,
    sessionId: record.sessionId,
    ...workspace === undefined ? {} : { workspace },
  }
}

function managedProcedure(procedure: LearnedProcedure, workspaces: ReadonlyMap<string, string>): ManagedProcedure {
  const workspace = workspaces.get(procedure.sessionId)
  return {
    id: procedure.id,
    name: procedure.name,
    description: procedure.description,
    domain: procedure.domain,
    time: procedure.time,
    sessionId: procedure.sessionId,
    ...workspace === undefined ? {} : { workspace },
  }
}

function managedProcedureDetail(procedure: LearnedProcedure, workspaces: ReadonlyMap<string, string>): ManagedProcedureDetail {
  return { ...managedProcedure(procedure, workspaces), summary: procedure.summary, content: procedure.content }
}
