/**
 * The staleness nudge. Reading a plan back (the `todo:plan` runtime context) makes it readable; a
 * real session showed that is not enough — an agent held its own plan in context for 96 consecutive
 * steps and never wrote again, because a snapshot it has already read reads as background. This
 * covers the salience half: a fresh notice, at a step threshold, only while the plan is unfinished.
 *
 * The fold is exercised through real session events, and the listener through the real agent loop,
 * so both the counting and the injection run the same paths production does.
 */

import { defineTool } from '@aeven/tools'
import { createUserMessage } from '@aeven/llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session, type SessionEvent } from '@aeven/session'
import type { Agent } from '@aeven/agent'
import AgentLoop from '@aeven/agent-loop'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import SessionProjectionRegistry from '@aeven/session-projection'
import type { TodoItem } from '@aeven/tool-todo'
import * as ToolTodo from '@aeven/tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Keeps one turn alive for a step without touching any todo state. */
const PING = defineTool({
  name: 'ping',
  description: 'keeps the turn alive for one step',
  parameters: { text: { type: 'string' } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return args.text ?? ''
  },
})

/** Steps each scenario lets pass without a write (one ping per step after the first). */
function pings(count: number): ReturnType<typeof toolCallResponse>[] {
  return Array.from({ length: count }, (_, index) => toolCallResponse(`p${String(index)}`, 'ping', { text: 'tick' }))
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  ctx.tools.register(PING)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Every staleness notice this package injected into one agent's log. */
function nudges(agent: Agent): SessionEvent[] {
  return agent.session.snapshotEvents().filter(event =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'tool-todo')
}

/** The text of the single injected notice. */
function nudgeText(agent: Agent): string {
  const found = nudges(agent)
  expect(found).toHaveLength(1)
  const [block] = (found[0] as Extract<SessionEvent, { type: 'user/message' }>).data.content
  return block?.type === 'text' ? block.text : ''
}

async function run(adapter: MockAdapter, id: string): Promise<Agent> {
  const ctx = await harness(adapter)
  const agent = ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
  return agent
}

const OPEN_PLAN: TodoItem[] = [{ content: 'keep going', status: 'in_progress' }]

describe('todo staleness nudge', () => {
  it('stays silent until the first threshold, then names the step count and the open plan', async () => {
    // One write, then eight more steps: the ninth step after the write is the first that is due.
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(9),
      textResponse('done'),
    ]), 'nudge-fires')

    const text = nudgeText(agent)
    expect(text).toContain('has not changed for 8 steps')
    expect(text).toContain('1 of its 1 tasks are still open')
    expect(text).toContain('- [in_progress] keep going')
  })

  it('injects nothing while the plan is still fresh', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(2),
      textResponse('done'),
    ]), 'nudge-fresh')
    expect(nudges(agent)).toHaveLength(0)
  })

  it('injects nothing once every task is completed', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'shipped', status: 'completed' }] }),
      ...pings(9),
      textResponse('done'),
    ]), 'nudge-complete')
    expect(nudges(agent)).toHaveLength(0)
  })

  it('injects nothing when no plan was ever written', async () => {
    const agent = await run(new MockAdapter([...pings(9), textResponse('done')]), 'nudge-noplan')
    expect(nudges(agent)).toHaveLength(0)
  })

  it('does not repeat before the repeat interval has passed', async () => {
    // Firing once at step 9 leaves the cadence at 32, so 40 further steps stay quiet.
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(40),
      textResponse('done'),
    ]), 'nudge-norepeat')
    expect(nudges(agent)).toHaveLength(1)
  })

  it('repeats once the interval has passed again', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(42),
      textResponse('done'),
    ]), 'nudge-repeat')
    expect(nudges(agent)).toHaveLength(2)
  })
})

describe('todoStale fold', () => {
  /** A real agent whose session this spec drives by hand, so every fold branch is reached. */
  async function foldBench(id: string): Promise<{ ctx: Context; session: Session }> {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const agent = ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
    return { ctx, session: agent.session }
  }

  const stateOf = (ctx: Context, session: Session): unknown =>
    ctx.sessionProjections.stateOf(session, 'todoStale')

  const mark = (session: Session, plugin: string): void => {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'mark' }],
      source: { kind: 'plugin', plugin },
    }), { surfaceOp: 'append' })
  }

  it('counts committed step boundaries and resets on a write', async () => {
    const { ctx, session } = await foldBench('fold-count')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/start', { turn: 1, step: 2 })
    expect(stateOf(ctx, session)).toEqual({ stepsSinceWrite: 2, remindedAt: null })

    session.append('todo/write', { todos: OPEN_PLAN })
    expect(stateOf(ctx, session)).toEqual({ stepsSinceWrite: 0, remindedAt: null })

    session.append('step/start', { turn: 1, step: 3 })
    expect(stateOf(ctx, session)).toEqual({ stepsSinceWrite: 1, remindedAt: null })
  })

  it('folds its own notice as the cadence mark, so a restart does not re-nudge', async () => {
    const { ctx, session } = await foldBench('fold-mark')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/start', { turn: 1, step: 2 })
    mark(session, 'tool-todo')
    expect(stateOf(ctx, session)).toEqual({ stepsSinceWrite: 2, remindedAt: 2 })
  })

  it("ignores another plugin's message and leaves unrelated events alone", async () => {
    const { ctx, session } = await foldBench('fold-ignore')
    session.append('turn/start', { turn: 1 })
    const before = stateOf(ctx, session)
    mark(session, 'other-plugin')
    expect(stateOf(ctx, session)).toBe(before)
  })
})
