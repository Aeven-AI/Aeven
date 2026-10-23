/**
 * The least Host composition a memory Consumer needs: the memory slot over a scripted provider, the prompt registry,
 * and the agent registry one fake agent dispatches its pre-step through.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@aeven/agent'
import { createUserMessage } from '@aeven/llm'
import type { UserMessage } from '@aeven/llm'
import Memory from '@aeven/memory'
import type { MemoryProvider, MemoryRecall, MemoryRecallRequest } from '@aeven/memory'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@aeven/session'
import SystemPrompt from '@aeven/system-prompt'
import * as memoryContext from '@aeven/memory-context'
import type { Config } from '@aeven/memory-context'

/** A memory provider that answers each recall with the next scripted result and records every request. */
export class ScriptedProvider {
  readonly id = 'scripted'
  /** Every recall the Consumer requested, in call order. */
  readonly requests: MemoryRecallRequest[] = []
  private readonly scripted: MemoryRecall[] = []

  /** What the next recall resolves with. */
  answer(recall: MemoryRecall): void {
    this.scripted.push(recall)
  }

  recall(request: MemoryRecallRequest): Promise<MemoryRecall> {
    this.requests.push(request)
    return Promise.resolve(this.scripted.shift() ?? { hits: [], timedOut: false })
  }
}

/** One session, its scripted provider, and the step its turns run through. */
export interface MemoryHarness {
  readonly ctx: Context
  readonly provider: ScriptedProvider
  readonly session: Session
  /** Run one turn's first step and return the messages the pre-step decision adds. */
  readonly step: (turn: number, text?: string) => Promise<readonly UserMessage[]>
}

function session(): Session {
  const id = SessionId('memory-context-session')
  return Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: Date.now(),
    isSeeded: false,
    owner: 'owner-1',
  })
}

function sessionAgent(owner: Session): Agent {
  return {
    id: owner.id,
    options: {},
    session: owner,
    inbox: new Inbox(owner, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('memory-context must return its recalled block in the pre-step decision') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/**
 * The consumer's configuration with the plugin's own schema defaults, plus the spec's overrides.
 * @param overrides - the fields a spec sets.
 * @returns a complete configuration the consumer accepts.
 */
export function resolveConfig(overrides: Partial<Config> = {}): Config {
  return Object.assign({}, memoryContext.Config(), overrides)
}

/**
 * Mount the Consumer over a scripted provider.
 * @param overrides - Consumer configuration fields a spec sets; the rest take their schema defaults.
 * @returns the mounted context, the provider, the session, and its step.
 */
export async function harness(overrides: Partial<Config> = {}): Promise<MemoryHarness> {
  const config: Config = resolveConfig(overrides)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Memory)
  const provider = new ScriptedProvider()
  ctx.memory.register(provider as unknown as MemoryProvider)
  await ctx.plugin(memoryContext, config)

  const owner = session()
  const agent = sessionAgent(owner)
  return {
    ctx,
    provider,
    session: owner,
    step: async (turn, text = 'I am exhausted today') => {
      const proposed = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
      const decision = await agentEvents(ctx, agent).waterfall(
        'agent/pre-step',
        { messages: [proposed], turn, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
      )
      return decision.kind === 'enter' ? decision.messages.filter(message => message !== proposed) : []
    },
  }
}

/**
 * The text of one message.
 * @param message - message the step added.
 * @returns its text blocks joined.
 */
export function textOf(message: UserMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}
