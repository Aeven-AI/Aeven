/**
 * The staleness nudge. Reading a plan back (the `todo:plan` runtime context) makes it readable; a
 * real session showed that is not enough — an agent held its own plan in context for 96 consecutive
 * steps and never wrote again, because a snapshot it has already read reads as background. This
 * covers the salience half: a fresh notice, only while the plan is unfinished, raised when work has
 * accumulated past the cadence or the moment a background job the agent owns settles — the one unit
 * of work the log cannot count.
 *
 * The fold is exercised through real session events, and the listener through the real agent loop,
 * so both the counting and the injection run the same paths production does.
 */

import { defineTool } from '@aeven/tools'
import { createUserMessage, ToolCallId } from '@aeven/llm'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId, type Session, type SessionEvent } from '@aeven/session'
import type { Agent } from '@aeven/agent'
import type { JobDoneListener, JobSnapshot } from '@aeven/jobs'
import AgentLoop from '@aeven/agent-loop'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import SessionProjectionRegistry from '@aeven/session-projection'
import type { TodoItem } from '@aeven/tool-todo'
import * as ToolTodo from '@aeven/tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** The settlement seam this package reads, driven by hand: the only member of `ctx.jobs` it uses. */
class SettleProbe extends Service {
  private readonly listeners = new Set<JobDoneListener>()

  constructor(ctx: Context) {
    super(ctx, 'jobs')
  }

  onJobDone(listener: JobDoneListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Deliver one settlement exactly as the registry would, owner and all. */
  settle(owner: Agent | undefined, label = 'read the ledger'): void {
    const snapshot = { label } as JobSnapshot
    for (const listener of this.listeners) listener(snapshot, owner)
  }
}

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

/** Settles one background job for the calling agent — `own: false` settles an unowned one. */
function delegate(probe: SettleProbe) {
  return defineTool({
    name: 'delegate',
    description: 'settles one background job for the calling agent',
    parameters: { own: { type: 'boolean', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      probe.settle(args.own ? exec.agent : undefined)
      return 'settled'
    },
  })
}

/** Steps each scenario lets pass without a write (one ping per step after the first). */
function pings(count: number): ReturnType<typeof toolCallResponse>[] {
  return Array.from({ length: count }, (_, index) => toolCallResponse(`p${String(index)}`, 'ping', { text: 'tick' }))
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SettleProbe)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  ctx.tools.register(PING)
  ctx.tools.register(delegate(ctx.get('jobs') as unknown as SettleProbe))
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

/** The notice's model-facing text and its transcript summary. */
function notice(agent: Agent): { text: string; summary: string } {
  const found = nudges(agent)
  expect(found).toHaveLength(1)
  const message = (found[0] as Extract<SessionEvent, { type: 'user/message' }>).data
  const [block] = message.content
  const source = message.source
  return {
    text: block?.type === 'text' ? block.text : '',
    summary: source.kind === 'plugin' && source.form === 'notice' ? source.summary ?? '' : '',
  }
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
  it('stays silent until the interval has passed, then restates the open plan with its age', async () => {
    // One write, then twelve more completed calls: the step after the twelfth is the first that is due.
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(12),
      textResponse('done'),
    ]), 'nudge-fires')

    const found = notice(agent)
    expect(found.text).toContain('has not changed for 12 tool calls')
    expect(found.text).toContain('while 1 of its 1 tasks are still open')
    expect(found.text).toContain('- [in_progress] keep going')
    expect(found.summary).toBe('todo plan unchanged across 12 tool calls')
  })

  it('injects nothing while the plan is still fresh', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(11),
      textResponse('done'),
    ]), 'nudge-fresh')
    expect(nudges(agent)).toHaveLength(0)
  })

  it('injects nothing once every task is completed', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'shipped', status: 'completed' }] }),
      ...pings(12),
      textResponse('done'),
    ]), 'nudge-complete')
    expect(nudges(agent)).toHaveLength(0)
  })

  it('injects nothing when no plan was ever written', async () => {
    const agent = await run(new MockAdapter([...pings(12), textResponse('done')]), 'nudge-noplan')
    expect(nudges(agent)).toHaveLength(0)
  })

  it('does not repeat before the interval has passed again', async () => {
    // Firing once at twelve leaves the cadence at twelve, so twenty-three calls stay quiet.
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(23),
      textResponse('done'),
    ]), 'nudge-norepeat')
    expect(nudges(agent)).toHaveLength(1)
  })

  it('repeats once the interval has passed again, carrying the new age', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      ...pings(24),
      textResponse('done'),
    ]), 'nudge-repeat')
    const found = nudges(agent)
    expect(found).toHaveLength(2)
    const second = (found[1] as Extract<SessionEvent, { type: 'user/message' }>).data
    const block = second.content[0]
    expect(block?.type === 'text' ? block.text : '').toContain('has not changed for 24 tool calls')
  })

  it('nudges the step after a background job settles, ahead of the cadence', async () => {
    // One delegated call is one unit of work, far short of the cadence: only the
    // settlement can raise this notice, and it lands on the very next step.
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      toolCallResponse('c2', 'delegate', { own: true }),
      textResponse('done'),
    ]), 'nudge-settled')

    const found = notice(agent)
    expect(found.summary).toBe('todo plan unreconciled since read the ledger settled')
    expect(found.text).toContain('has not been updated since the background work you started settled')
    expect(found.text).toContain('- [in_progress] keep going')
  })

  it('ignores a settlement no agent owns', async () => {
    const agent = await run(new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: OPEN_PLAN }),
      toolCallResponse('c2', 'delegate', { own: false }),
      textResponse('done'),
    ]), 'nudge-unowned')
    expect(nudges(agent)).toHaveLength(0)
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

  const call = (session: Session, tool: string, index: number): void => {
    session.append('tool/call', {
      turn: 1,
      step: index,
      callId: ToolCallId(`call-${String(index)}`),
      name: tool,
      arguments: '{}',
    })
  }

  const mark = (session: Session, plugin: string): void => {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'mark' }],
      source: { kind: 'plugin', plugin },
    }), { surfaceOp: 'append' })
  }

  it('counts completed tool calls other than its own, and resets on a write', async () => {
    const { ctx, session } = await foldBench('fold-count')
    session.append('turn/start', { turn: 1 })
    call(session, 'bash', 1)
    call(session, 'edit', 2)
    expect(stateOf(ctx, session)).toEqual({ workSinceWrite: 2, remindedAt: null })

    // The plan's own call is not work: a write must not age the plan it wrote.
    call(session, 'todo_write', 3)
    expect(stateOf(ctx, session)).toEqual({ workSinceWrite: 2, remindedAt: null })

    session.append('todo/write', { todos: OPEN_PLAN })
    expect(stateOf(ctx, session)).toEqual({ workSinceWrite: 0, remindedAt: null })

    call(session, 'bash', 4)
    expect(stateOf(ctx, session)).toEqual({ workSinceWrite: 1, remindedAt: null })
  })

  it('folds its own notice as the cadence mark, so a restart does not re-nudge', async () => {
    const { ctx, session } = await foldBench('fold-mark')
    session.append('turn/start', { turn: 1 })
    call(session, 'bash', 1)
    call(session, 'edit', 2)
    mark(session, 'tool-todo')
    expect(stateOf(ctx, session)).toEqual({ workSinceWrite: 2, remindedAt: 2 })
  })

  it("ignores another plugin's message and leaves unrelated events alone", async () => {
    const { ctx, session } = await foldBench('fold-ignore')
    session.append('turn/start', { turn: 1 })
    const before = stateOf(ctx, session)
    mark(session, 'other-plugin')
    expect(stateOf(ctx, session)).toBe(before)
  })
})
