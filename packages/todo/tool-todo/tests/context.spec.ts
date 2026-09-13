/**
 * The `todo:plan` runtime-context contribution. tool-todo does not only project
 * the standing plan to the UI: it hands the same folded list back to the model
 * as runtime context. Without it the model's only record of its own list is the
 * `todo_write` arguments in its transcript, which compaction replaces with a
 * lossy summary, so a long turn or a compacted session drifts from the list the
 * UI renders. Empty text contributes nothing, so an absent or empty list adds
 * neither a snapshot nor tokens.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderContextSections, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'

interface Bench {
  ctx: Context
  session: Session
  agent: Agent
}

async function harness(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  const session = ctx.sessions.create()
  const agent = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

/** The model-visible snapshot for one agent's next step, as the agent loop renders it. */
async function snapshot(bench: Bench, owning = true): Promise<string> {
  const assembly = await bench.ctx.systemPrompt.assemble(
    owning ? { agent: bench.agent, scope: bench.agent } : {},
  )
  return renderContextSnapshot(assembly)
}

describe('todo:plan runtime context', () => {
  it('hands the standing plan back to the model', async () => {
    const bench = await harness()
    const todos: TodoItem[] = [
      { content: 'ship the fix', status: 'completed' },
      { content: 'run the suite', status: 'in_progress' },
      { content: 'write it up', status: 'pending' },
    ]
    bench.session.append('turn/start', { turn: 1 })
    bench.session.append('todo/write', { todos })
    const text = await snapshot(bench)
    expect(text).toContain('Your current todo list (1/3 completed)')
    expect(text).toContain('- [completed] ship the fix')
    expect(text).toContain('- [in_progress] run the suite')
    expect(text).toContain('- [pending] write it up')
  })

  it('keeps the plan readable to the model on a later turn — the drift this prevents', async () => {
    const bench = await harness()
    const todos: TodoItem[] = [{ content: 'a', status: 'in_progress' }]
    bench.session.append('turn/start', { turn: 1 })
    bench.session.append('todo/write', { todos })
    bench.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    bench.session.append('turn/start', { turn: 2 })
    // The dock's turn-scoped lifetime clears `todos` here; the read-back keeps
    // the agent's own working plan, so a resumed task never loses it.
    expect(await snapshot(bench)).toContain('- [in_progress] a')
  })

  it('re-renders the contribution when the plan changes', async () => {
    const bench = await harness()
    bench.session.append('turn/start', { turn: 1 })
    bench.session.append('todo/write', { todos: [{ content: 'a', status: 'pending' }] })
    expect(await snapshot(bench)).toContain('(0/1 completed)')
    bench.session.append('todo/write', { todos: [{ content: 'a', status: 'completed' }] })
    expect(await snapshot(bench)).toContain('(1/1 completed)')
  })

  it('contributes nothing before the first write', async () => {
    const bench = await harness()
    bench.session.append('turn/start', { turn: 1 })
    expect(await snapshot(bench)).toBe('')
  })

  it('contributes nothing for an empty list', async () => {
    const bench = await harness()
    bench.session.append('turn/start', { turn: 1 })
    bench.session.append('todo/write', { todos: [] })
    expect(await snapshot(bench)).toBe('')
  })

  it('contributes nothing to an assembly with no owning agent', async () => {
    const bench = await harness()
    bench.session.append('turn/start', { turn: 1 })
    bench.session.append('todo/write', { todos: [{ content: 'a', status: 'pending' }] })
    expect(await snapshot(bench, false)).toBe('')
    expect(renderContextSections(await bench.ctx.systemPrompt.assemble({}))).toEqual([])
  })
})
