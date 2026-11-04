import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import AgentLoop from '@aeven/agent-loop'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import { ToolCallId } from '@aeven/llm'
import { SessionId } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import JsonlSessionPersistence from '@aeven/session-persistence-jsonl'
import SubagentService from '@aeven/subagent'
import * as SubagentSpawn from '@aeven/subagent-spawn-in-process'
import TeamService from '@aeven/agent-team'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TestSessionQuery } from '../../agent-team/tests/test-session-query.ts'
import * as toolTeam from '../src/index.ts'

const SIGNAL = new AbortController().signal
const TOOL_NAMES = ['team_task_create', 'team_task_get', 'team_task_list', 'team_task_update']
const roots: string[] = []
const contexts: Context[] = []
let callNumber = 0

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

async function setup(script: ConstructorParameters<typeof MockAdapter>[0] = []) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'avn-tool-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TeamService, { maxTasks: 256 })
  const fiber = await ctx.plugin(toolTeam)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const root = ctx.agentLoop.create(SessionId('tool-team-root'), { provider: 'mock', model: 'mock' })
  return { ctx, root, fiber }
}

function execute(ctx: Context, agent: Agent | undefined, name: string, args: unknown) {
  return ctx.tools.execute({
    callId: ToolCallId(`team-call-${++callNumber}`),
    name,
    arguments: args,
    signal: SIGNAL,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function json(result: Awaited<ReturnType<typeof execute>>): Record<string, unknown> {
  expect(result.isError).toBe(false)
  return JSON.parse(text(result)) as Record<string, unknown>
}

describe('task-board tools', () => {
  it('registers the four tools for every agent and removes them with the plugin', async () => {
    const { ctx, fiber } = await setup()
    expect(TOOL_NAMES.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
    await fiber.dispose()
    expect(TOOL_NAMES.some(name => ctx.tools.get(name) !== undefined)).toBe(false)
  })

  it('runs the create, claim, and complete workflow from a subagent', async () => {
    const { ctx, root } = await setup(['hang'])
    try {
      const started = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: 'worker',
        request: { prompt: [{ type: 'text', text: 'work' }], parent: root },
        signal: SIGNAL,
      })
      const worker = await vi.waitFor(() => {
        const live = ctx.agents.get(started.childId)
        expect(live?.status).toBe('running')
        return live!
      })
      const created = json(await execute(ctx, root, 'team_task_create', {
        subject: 'Write the parser',
        description: 'Parse the config file.',
        write_scopes: ['src/parser'],
      }))
      expect(created).toMatchObject({ id: 'task-1', revision: 1, ready: true, writeScopes: ['src/parser'] })
      const claimed = json(await execute(ctx, worker, 'team_task_update', { task_id: 'task-1', expected_revision: 1, action: 'claim' }))
      expect(claimed).toMatchObject({ status: 'in_progress', ownerId: worker.id })
      json(await execute(ctx, worker, 'team_task_update', { task_id: 'task-1', expected_revision: 2, action: 'complete' }))
      expect(json(await execute(ctx, root, 'team_task_get', { task_id: 'task-1' }))).toMatchObject({ status: 'completed', revision: 3 })
    } finally {
      await ctx.subagents.drainContinuableDescendants([root])
    }
  })

  it('filters and pages the task list', async () => {
    const { ctx, root } = await setup()
    for (const subject of ['a', 'b', 'c']) json(await execute(ctx, root, 'team_task_create', { subject, description: subject }))
    json(await execute(ctx, root, 'team_task_create', { subject: 'd', description: 'd', blocked_by: ['task-1'] }))
    json(await execute(ctx, root, 'team_task_update', { task_id: 'task-2', expected_revision: 1, action: 'claim' }))
    const page = json(await execute(ctx, root, 'team_task_list', { limit: 2 }))
    expect((page.tasks as { id: string }[]).map(task => task.id)).toEqual(['task-1', 'task-2'])
    expect(page.nextCursor).toBe(2)
    const rest = json(await execute(ctx, root, 'team_task_list', { cursor: 2 }))
    expect((rest.tasks as { id: string }[]).map(task => task.id)).toEqual(['task-3', 'task-4'])
    expect(rest.nextCursor).toBeUndefined()
    const ids = async (args: Record<string, unknown>) =>
      (json(await execute(ctx, root, 'team_task_list', args)).tasks as { id: string }[]).map(task => task.id)
    expect(await ids({ status: 'in_progress' })).toEqual(['task-2'])
    expect(await ids({ owner: root.id })).toEqual(['task-2'])
    expect(await ids({ owner: 'unowned', ready: false })).toEqual(['task-4'])
    expect(await ids({ ready: true })).toEqual(['task-1', 'task-3'])
    for (const args of [{ cursor: -1 }, { limit: 0 }, { limit: 101 }]) {
      expect((await execute(ctx, root, 'team_task_list', args)).isError).toBe(true)
    }
  })

  it('passes edits, dependencies, and reassignment through to the board', async () => {
    const { ctx, root } = await setup()
    json(await execute(ctx, root, 'team_task_create', { subject: 'first', description: 'first' }))
    json(await execute(ctx, root, 'team_task_create', { subject: 'second', description: 'second' }))
    const edited = json(await execute(ctx, root, 'team_task_update', {
      task_id: 'task-2', expected_revision: 1, action: 'edit', subject: 'renamed', description: 'new details', write_scopes: ['docs'],
    }))
    expect(edited).toMatchObject({ subject: 'renamed', description: 'new details', writeScopes: ['docs'] })
    const rewired = json(await execute(ctx, root, 'team_task_update', {
      task_id: 'task-2', expected_revision: 2, action: 'set_dependencies', blocked_by: ['task-1'],
    }))
    expect(rewired.blockedBy).toEqual(['task-1'])
    const assigned = json(await execute(ctx, root, 'team_task_update', {
      task_id: 'task-1', expected_revision: 1, action: 'reassign', owner: root.id,
    }))
    expect(assigned).toMatchObject({ ownerId: root.id, status: 'in_progress' })
  })

  it('reports board refusals and a missing calling agent as tool errors', async () => {
    const { ctx, root } = await setup()
    json(await execute(ctx, root, 'team_task_create', { subject: 'only', description: 'only' }))
    const stale = await execute(ctx, root, 'team_task_update', { task_id: 'task-1', expected_revision: 7, action: 'claim' })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('stale team task "task-1" revision 7')
    for (const name of TOOL_NAMES) {
      const orphan = await execute(ctx, undefined, name, { subject: 's', description: 'd', task_id: 'task-1', expected_revision: 1, action: 'claim' })
      expect(orphan.isError).toBe(true)
      expect(text(orphan)).toContain(`${name} requires a calling agent`)
    }
  })
})
