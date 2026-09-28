/**
 * The memory manager Remote: what Aeven has learned about the signed-in user, their projects, and their
 * work, with View, Correct, and Forget. Every operation acts for the caller of the running request and
 * never reaches another user's memories or capabilities.
 *
 * @module @aeven/api-memory-manager
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/session-query'
import type {} from '@aeven/memory'
import type { Capability, CapabilityRecord, JudgedExecution } from '@aeven/capability'
import type { MemoryItemId, MemoryRecord } from '@aeven/memory/types'
import type {
  ManagedCapability,
  ManagedCapabilityDetail,
  ManagedCapabilityEdit,
  ManagedCapabilityStatusChange,
  ManagedMemory,
  ManagedMemoryPage,
  ManagedMemoryQuery,
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

/** The signed-in user's memories and learned capabilities. */
export default class MemoryManagerController extends TypertRemoteService {
  static inject = ['typert', 'memory', 'capabilities', 'identityUsers', 'sessionQuery']

  static Config: z<Config> = z.object({
    timeoutMs: z.natural().min(1).default(15_000),
    maxPageSize: z.natural().min(1).default(200),
  })

  /**
   * @param ctx - Host context carrying memory, capabilities, identity, and session query.
   * @param config - provider budget and page bound.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'memoryManagerController', { namespace: 'memoryManager' })
  }

  /**
   * List the caller's memories, newest first.
   * @param request - optional text filter and page bounds.
   * @returns the page, or `available: false` when no memory provider runs.
   */
  @Remote
  async memories(request: ManagedMemoryQuery): Promise<ManagedMemoryPage> {
    const owner = this.owner()
    if (!this.ctx.memory.active) return { available: false }
    const page = await this.ctx.memory.list({
      owner,
      ...request.query ? { query: request.query } : {},
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
   * List the caller's learned capabilities with the run counts of their current revisions.
   * @returns capabilities sorted by name.
   */
  @Remote
  async capabilities(): Promise<ManagedCapability[]> {
    const owner = this.owner()
    const records = await this.ctx.capabilities.list(owner)
    return await Promise.all(records.map(async record => managedCapability(record, await this.ctx.capabilities.evidence(owner, record.name))))
  }

  /**
   * Read one of the caller's capabilities with its procedure, history, and executions.
   * @param name - capability name.
   * @returns the capability, or undefined when the caller has none by that name.
   */
  @Remote
  async capability(name: string): Promise<ManagedCapabilityDetail | undefined> {
    const owner = this.owner()
    const capability = await this.ctx.capabilities.get(owner, name)
    return capability === undefined ? undefined : this.detail(owner, capability)
  }

  /**
   * Replace the description and procedure of one of the caller's capabilities. A trusted capability
   * whose procedure changes must verify the new revision before it is trusted again.
   * @param name - capability name.
   * @param edit - new description and procedure.
   * @returns the updated capability.
   */
  @Remote
  async editCapability(name: string, edit: ManagedCapabilityEdit): Promise<ManagedCapabilityDetail> {
    const owner = this.owner()
    const current = await this.ctx.capabilities.get(owner, name)
    if (current === undefined) throw new Error(`no capability named ${name}`)
    if (!edit.description.trim() || !edit.content.trim()) throw new Error('a capability needs a description and a procedure')
    const saved = await this.ctx.capabilities.save(owner, { name, description: edit.description, content: edit.content }, {
      status: current.status,
      source: 'user',
      sessionId: undefined,
    })
    return this.detail(owner, saved)
  }

  /**
   * Retire one of the caller's capabilities, or put a retired or unconfirmed one in use; its evidence
   * then decides between learned, trusted, needs-validation, and degraded.
   * @param name - capability name.
   * @param status - `retired` or `learned`.
   * @returns the updated capability.
   */
  @Remote
  async setCapabilityStatus(name: string, status: ManagedCapabilityStatusChange): Promise<ManagedCapabilityDetail> {
    const owner = this.owner()
    return this.detail(owner, await this.ctx.capabilities.setStatus(owner, name, status, undefined))
  }

  /**
   * Delete one of the caller's capabilities with its files and history.
   * @param name - capability name.
   * @returns true when a capability was deleted.
   */
  @Remote
  deleteCapability(name: string): Promise<boolean> {
    return this.ctx.capabilities.remove(this.owner(), name)
  }

  private owner(): string {
    const owner = this.ctx.identityUsers.actingUser()?.id
    if (owner === undefined) throw new Error('the memory manager needs a signed-in user')
    return owner
  }

  /** Working directory of each of the owner's sessions, by session id. */
  private async workspaces(owner: string): Promise<ReadonlyMap<string, string>> {
    const sessions = await this.ctx.sessionQuery.listSessions(AbortSignal.timeout(this.config.timeoutMs))
    return new Map(sessions.flatMap(({ header }) => header.owner === owner && header.cwd !== undefined ? [[header.id as string, header.cwd]] : []))
  }

  private async detail(owner: string, capability: Capability): Promise<ManagedCapabilityDetail> {
    const judged = await this.ctx.capabilities.evidence(owner, capability.name)
    return {
      ...managedCapability(capability, judged),
      content: capability.content,
      provenance: capability.provenance,
      executions: judged.toReversed().map(item => ({
        id: item.execution.id,
        revision: item.execution.revision,
        sessionId: item.execution.sessionId,
        endedAt: item.execution.endedAt,
        verdict: item.verdict,
        ...item.correction === undefined ? {} : { correction: item.correction },
        ...item.rating === undefined ? {} : { rating: item.rating },
        ...item.execution.report?.notes === undefined ? {} : { notes: item.execution.report.notes },
      })),
    }
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

function managedCapability(record: CapabilityRecord, judged: readonly JudgedExecution[]): ManagedCapability {
  const current = judged.filter(item => item.execution.revision === record.revision)
  const lastRunAt = judged.at(-1)?.execution.endedAt
  return {
    name: record.name,
    description: record.description,
    status: record.status,
    revision: record.revision,
    ...record.trustedRevision === undefined ? {} : { trustedRevision: record.trustedRevision },
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    files: record.files,
    runs: {
      total: current.length,
      succeeded: current.filter(item => item.verdict === 'verified' || item.verdict === 'succeeded').length,
      failed: current.filter(item => item.verdict === 'failed').length,
      ...lastRunAt === undefined ? {} : { lastRunAt },
    },
  }
}
