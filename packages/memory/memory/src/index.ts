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
  MemoryDetail,
  MemoryEnvironment,
  MemoryItemId,
  MemoryPage,
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
} as const

/** Thrown when a memory operation runs while no provider is registered. */
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
   * Store one fact the user explicitly asked to be remembered.
   * @param request - scope and the fact in the user's words.
   * @returns the stored memory's id.
   */
  remember(request: Parameters<MemoryProvider['remember']>[0]): Promise<MemoryItemId> {
    return this.current().remember(request)
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
