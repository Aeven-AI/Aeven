import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import AgentLoop from '@aeven/agent-loop'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import { SessionId } from '@aeven/session'
import type { SessionEvent } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import JsonlSessionPersistence from '@aeven/session-persistence-jsonl'
import SubagentService from '@aeven/subagent'
import * as SubagentFork from '@aeven/subagent-fork-in-process'
import * as SubagentSpawn from '@aeven/subagent-spawn-in-process'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { TeamId, TeamTaskId } from '../src/index.ts'
import type { TeamTaskSnapshot } from '../src/index.ts'
import { teamProjectionDefinition } from '../src/projection.ts'
import type { TeamProjectionState } from '../src/projection.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Board state folded from the root log through the same definition the service registers. */
function durable(agent: Agent): TeamProjectionState {
  let projected = teamProjectionDefinition.init(agent.session.header)
  for (const event of agent.session.snapshotEvents()) projected = teamProjectionDefinition.apply(projected, event)
  return projected
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0] = [], maxTasks = 256, persistence = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'avn-team-'))
  roots.push(storageRoot)
  if (persistence) await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, { maxTasks })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const root = ctx.agentLoop.create(SessionId('root'), { provider: 'mock', model: 'mock' })
  return { ctx, root }
}

/** Start one continuable child that stays running until the test drains its tree. */
async function child(ctx: Context, parent: Agent): Promise<Agent> {
  const started = await ctx.subagents.startContinuable({
    provider: 'spawn',
    label: 'worker',
    request: { prompt: [{ type: 'text', text: 'work' }], parent },
    signal: SIGNAL,
  })
  return await vi.waitFor(() => {
    const live = ctx.agents.get(started.childId)
    expect(live?.status).toBe('running')
    return live!
  })
}

const task = (subject: string, extra: { blockedBy?: TeamTaskId[]; writeScopes?: string[] } = {}) =>
  ({ subject, description: `${subject} details`, ...extra })

describe('shared task board', () => {
  it('creates, lists, and reads tasks with sequential ids and readiness', async () => {
    const { ctx, root } = await setup()
    const first = await ctx.agentTeams.createTask(root, task('first'))
    const second = await ctx.agentTeams.createTask(root, task('second', { blockedBy: [first.id] }))
    expect(first).toMatchObject({ id: 'task-1', revision: 1, status: 'pending', ready: true, blockedBy: [] })
    expect(second).toMatchObject({ id: 'task-2', ready: false, blockedBy: ['task-1'] })
    expect(ctx.agentTeams.listTasks(root).map(view => view.id)).toEqual(['task-1', 'task-2'])
    expect(ctx.agentTeams.getTask(root, second.id)).toEqual(second)
    expect(() => ctx.agentTeams.getTask(root, TeamTaskId('task-9'))).toThrow(expect.objectContaining({ code: 'TEAM_TASK_NOT_FOUND' }))
  })

  it('shares one board across the tree and gives each root its own', async () => {
    const { ctx, root } = await setup(['hang', 'hang'])
    try {
      const worker = await child(ctx, root)
      const grandchild = await child(ctx, worker)
      const created = await ctx.agentTeams.createTask(grandchild, task('deep'))
      expect(ctx.agentTeams.listTasks(root)).toEqual([created])
      expect(ctx.agentTeams.listTasks(worker)).toEqual([created])
      expect(root.session.ownEvents().filter(event => event.type === 'team/task')).toHaveLength(1)
      expect(worker.session.ownEvents().filter(event => event.type === 'team/task')).toHaveLength(0)

      const other = ctx.agentLoop.create(SessionId('other-root'), { provider: 'mock', model: 'mock' })
      expect(ctx.agentTeams.listTasks(other)).toEqual([])
    } finally {
      await ctx.subagents.drainContinuableDescendants([root])
    }
  })

  it('claims only ready tasks and unblocks dependents on completion', async () => {
    const { ctx, root } = await setup(['hang'])
    try {
      const worker = await child(ctx, root)
      const first = await ctx.agentTeams.createTask(root, task('first'))
      const second = await ctx.agentTeams.createTask(root, task('second', { blockedBy: [first.id] }))
      await expect(ctx.agentTeams.updateTask(worker, { taskId: second.id, expectedRevision: 1, action: 'claim' }))
        .rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })
      const claimed = await ctx.agentTeams.updateTask(worker, { taskId: first.id, expectedRevision: 1, action: 'claim' })
      expect(claimed).toMatchObject({ status: 'in_progress', ownerId: worker.id, revision: 2 })
      await ctx.agentTeams.updateTask(worker, { taskId: first.id, expectedRevision: 2, action: 'complete' })
      expect(ctx.agentTeams.getTask(root, second.id).ready).toBe(true)
    } finally {
      await ctx.subagents.drainContinuableDescendants([root])
    }
  })

  it('rejects a stale revision instead of overwriting newer work', async () => {
    const { ctx, root } = await setup()
    const created = await ctx.agentTeams.createTask(root, task('contended'))
    await ctx.agentTeams.updateTask(root, { taskId: created.id, expectedRevision: 1, action: 'claim' })
    await expect(ctx.agentTeams.updateTask(root, { taskId: created.id, expectedRevision: 1, action: 'release' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
  })

  it('lets only the owner or the root change a claimed task, and only the root reassign it', async () => {
    const { ctx, root } = await setup(['hang', 'hang'])
    try {
      const owner = await child(ctx, root)
      const peer = await child(ctx, root)
      const created = await ctx.agentTeams.createTask(root, task('owned'))
      await ctx.agentTeams.updateTask(owner, { taskId: created.id, expectedRevision: 1, action: 'claim' })
      await expect(ctx.agentTeams.updateTask(peer, { taskId: created.id, expectedRevision: 2, action: 'claim' }))
        .rejects.toMatchObject({ code: 'TEAM_TASK_ALREADY_CLAIMED' })
      await expect(ctx.agentTeams.updateTask(peer, { taskId: created.id, expectedRevision: 2, action: 'complete' }))
        .rejects.toMatchObject({ code: 'TEAM_TASK_UNAUTHORIZED' })
      await expect(ctx.agentTeams.updateTask(owner, { taskId: created.id, expectedRevision: 2, action: 'reassign', owner: peer.id }))
        .rejects.toMatchObject({ code: 'TEAM_ROOT_REQUIRED' })
      await expect(ctx.agentTeams.updateTask(root, { taskId: created.id, expectedRevision: 2, action: 'reassign', owner: SessionId('stranger') }))
        .rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
      const moved = await ctx.agentTeams.updateTask(root, { taskId: created.id, expectedRevision: 2, action: 'reassign', owner: peer.id })
      expect(moved).toMatchObject({ ownerId: peer.id, status: 'in_progress', revision: 3 })
      const released = await ctx.agentTeams.updateTask(root, { taskId: created.id, expectedRevision: 3, action: 'reassign' })
      expect(released.ownerId).toBeUndefined()
      expect(released.status).toBe('pending')
    } finally {
      await ctx.subagents.drainContinuableDescendants([root])
    }
  })

  it('warns about overlapping write scopes of in-progress tasks without blocking', async () => {
    const { ctx, root } = await setup()
    const busy = await ctx.agentTeams.createTask(root, task('busy', { writeScopes: ['./src/app/'] }))
    await ctx.agentTeams.updateTask(root, { taskId: busy.id, expectedRevision: 1, action: 'claim' })
    const overlapping = await ctx.agentTeams.createTask(root, task('overlapping', { writeScopes: ['src/app/page.tsx'] }))
    const separate = await ctx.agentTeams.createTask(root, task('separate', { writeScopes: ['src/application'] }))
    expect(busy.writeScopes).toEqual(['src/app'])
    expect(overlapping.writeScopeWarnings).toEqual(['write scopes overlap with task-1'])
    expect(separate.writeScopeWarnings).toEqual([])
    await expect(ctx.agentTeams.createTask(root, task('escape', { writeScopes: ['../outside'] })))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_WRITE_SCOPE' })
  })

  it('edits, rewires, reopens, and deletes tasks under graph rules', async () => {
    const { ctx, root } = await setup()
    const first = await ctx.agentTeams.createTask(root, task('first'))
    const second = await ctx.agentTeams.createTask(root, task('second', { blockedBy: [first.id] }))
    await expect(ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 1, action: 'set_dependencies', blockedBy: [second.id] }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_DEPENDENCY_CYCLE' })
    await expect(ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 1, action: 'delete' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_HAS_DEPENDENTS' })
    const edited = await ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 1, action: 'edit', subject: 'renamed' })
    expect(edited.subject).toBe('renamed')
    await ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 2, action: 'claim' })
    await ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 3, action: 'complete' })
    const reopened = await ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 4, action: 'reopen' })
    expect(reopened).toMatchObject({ status: 'pending', revision: 5 })
    await ctx.agentTeams.updateTask(root, { taskId: second.id, expectedRevision: 1, action: 'set_dependencies', blockedBy: [] })
    const deleted = await ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 5, action: 'delete' })
    expect(deleted.status).toBe('deleted')
    expect(ctx.agentTeams.listTasks(root).map(view => view.id)).toEqual(['task-2'])
    expect(ctx.agentTeams.getTask(root, first.id).status).toBe('deleted')
    await expect(ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 6, action: 'reopen' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_DELETED' })
  })

  it('refuses unknown tasks, invalid transitions, and malformed input', async () => {
    const { ctx, root } = await setup()
    const first = await ctx.agentTeams.createTask(root, task('first'))
    const update = (request: Omit<Parameters<typeof ctx.agentTeams.updateTask>[1], 'taskId'> & { taskId?: TeamTaskId }) =>
      ctx.agentTeams.updateTask(root, { taskId: first.id, ...request })
    await expect(update({ taskId: TeamTaskId('task-9'), expectedRevision: 1, action: 'claim' })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(update({ expectedRevision: 1, action: 'release' })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    await expect(update({ expectedRevision: 1, action: 'complete' })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    await expect(update({ expectedRevision: 1, action: 'reopen' })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    await expect(update({ expectedRevision: 1, action: 'edit' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(update({ expectedRevision: 1, action: 'set_dependencies' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(update({ expectedRevision: 1, action: 'set_dependencies', blockedBy: [first.id] }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_DEPENDENCY_CYCLE' })
    await expect(ctx.agentTeams.createTask(root, task('twice', { blockedBy: [first.id, first.id] })))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.createTask(root, task('missing', { blockedBy: [TeamTaskId('task-9')] })))
      .rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(ctx.agentTeams.createTask(root, { subject: '  ', description: 'blank' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.createTask(root, { subject: 'x'.repeat(201), description: 'long' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const described = await update({ expectedRevision: 1, action: 'edit', description: 'only the details' })
    expect(described).toMatchObject({ subject: 'first', description: 'only the details' })
    const claimed = await update({ expectedRevision: 2, action: 'claim' })
    const released = await update({ expectedRevision: claimed.revision, action: 'release' })
    expect(released).toMatchObject({ status: 'pending', revision: 4 })
    expect(released.ownerId).toBeUndefined()
    await update({ expectedRevision: 4, action: 'claim' })
    await update({ expectedRevision: 5, action: 'complete' })
    await expect(update({ expectedRevision: 6, action: 'reassign', owner: root.id })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })

    const blocker = await ctx.agentTeams.createTask(root, task('blocker'))
    const blocked = await ctx.agentTeams.createTask(root, task('blocked', { blockedBy: [blocker.id] }))
    await expect(ctx.agentTeams.updateTask(root, { taskId: blocked.id, expectedRevision: 1, action: 'reassign', owner: root.id }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })
    await ctx.agentTeams.updateTask(root, { taskId: blocked.id, expectedRevision: 1, action: 'set_dependencies', blockedBy: [] })
    await ctx.agentTeams.updateTask(root, { taskId: blocker.id, expectedRevision: 1, action: 'delete' })
    await expect(ctx.agentTeams.createTask(root, task('after delete', { blockedBy: [blocker.id] })))
      .rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
  })

  it('applies concurrent commands for one root in arrival order', async () => {
    const { ctx, root } = await setup()
    const created = await Promise.all([1, 2, 3].map(index => ctx.agentTeams.createTask(root, task(`parallel ${index}`))))
    expect(created.map(view => view.id)).toEqual(['task-1', 'task-2', 'task-3'])
  })

  it('reports a change whose persistence was not confirmed', async () => {
    const { ctx, root } = await setup([], 256, false)
    await expect(ctx.agentTeams.createTask(root, task('unsaved'))).rejects.toMatchObject({ code: 'TEAM_TASK_PERSISTENCE_UNCONFIRMED' })
    expect(ctx.agentTeams.listTasks(root).map(view => view.subject)).toEqual(['unsaved'])
  })

  it('refuses commands once the root log holds an invalid task record', async () => {
    const { ctx, root } = await setup()
    root.session.append('team/task', {
      version: 1,
      teamId: TeamId(root.id),
      task: { id: TeamTaskId('task-1'), revision: 2, subject: 's', description: 'd', status: 'pending', blockedBy: [], writeScopes: [] },
    })
    expect(() => ctx.agentTeams.listTasks(root)).toThrow('team task "task-1" must begin at revision 1')
  })

  it('refuses a new id once the numeric id space is exhausted', async () => {
    const { ctx, root } = await setup()
    const record = (id: string) => ({
      version: 1 as const,
      teamId: TeamId(root.id),
      task: { id: TeamTaskId(id), revision: 1, subject: id, description: id, status: 'pending' as const, blockedBy: [], writeScopes: [] },
    })
    root.session.append('team/task', record('imported'))
    root.session.append('team/task', record(`task-${Number.MAX_SAFE_INTEGER}`))
    expect(durable(root).nextTaskNumber).toBe(Number.MAX_SAFE_INTEGER)
    await expect(ctx.agentTeams.createTask(root, task('overflow'))).rejects.toMatchObject({ code: 'TEAM_TASK_LIMIT' })
  })

  it('enforces the configured task limit', async () => {
    const { ctx, root } = await setup([], 1)
    await ctx.agentTeams.createTask(root, task('only'))
    await expect(ctx.agentTeams.createTask(root, task('extra'))).rejects.toMatchObject({ code: 'TEAM_TASK_LIMIT' })
  })

  it('rebuilds the board from the root log', async () => {
    const { ctx, root } = await setup()
    const first = await ctx.agentTeams.createTask(root, task('first'))
    await ctx.agentTeams.updateTask(root, { taskId: first.id, expectedRevision: 1, action: 'claim' })
    await ctx.agentTeams.createTask(root, task('second'))
    const replayed = durable(root)
    expect(replayed.failure).toBeUndefined()
    expect(replayed.nextTaskNumber).toBe(3)
    expect(replayed.tasks.map(entry => [entry.id, entry.revision, entry.status]))
      .toEqual([['task-1', 2, 'in_progress'], ['task-2', 1, 'pending']])
  })
})

describe('task-board projection', () => {
  const header = { id: SessionId('root') } as Parameters<typeof teamProjectionDefinition.init>[0]
  const snapshot = (revision: number): TeamTaskSnapshot => ({
    id: TeamTaskId('task-1'), revision, subject: 's', description: 'd', status: 'pending', blockedBy: [], writeScopes: [],
  })
  const event = (data: unknown): SessionEvent => ({ type: 'team/task', seq: 0, time: 0, data } as unknown as SessionEvent)

  it('ignores task records of another board, such as a fork-inherited parent board', () => {
    const state = teamProjectionDefinition.init(header)
    const next = teamProjectionDefinition.apply(state, event({ version: 1, teamId: TeamId('parent'), task: snapshot(1) }))
    expect(next).toBe(state)
  })

  it('records the first invalid record and keeps the last valid tasks', () => {
    let state = teamProjectionDefinition.init(header)
    state = teamProjectionDefinition.apply(state, event({ version: 1, teamId: TeamId('root'), task: snapshot(1) }))
    const gap = teamProjectionDefinition.apply(state, event({ version: 1, teamId: TeamId('root'), task: snapshot(3) }))
    expect(gap.failure).toBe('team task "task-1" revision is not contiguous')
    expect(gap.tasks).toBe(state.tasks)
    expect(teamProjectionDefinition.apply(gap, event({ version: 1, teamId: TeamId('root'), task: snapshot(2) }))).toBe(gap)
    expect(teamProjectionDefinition.apply(state, event({ version: 2, teamId: TeamId('root'), task: snapshot(2) })).failure)
      .toBe('unsupported team/task event version 2')
    expect(teamProjectionDefinition.apply(state, event({ version: 1, teamId: TeamId('root'), task: { id: 'task-1' } })).failure)
      .toBe('persisted team/task payload is invalid')
  })

  it('rejects replayed dependency graphs that are self-blocking, repeated, or missing', () => {
    const blockedBy = (ids: string[]) => ({ ...snapshot(1), blockedBy: ids.map(TeamTaskId) })
    const withBlocker = teamProjectionDefinition.apply(
      teamProjectionDefinition.init(header),
      event({ version: 1, teamId: TeamId('root'), task: { ...snapshot(1), id: TeamTaskId('task-2') } }),
    )
    for (const [ids, failure] of [
      [['task-1'], 'team task "task-1" cannot block itself'],
      [['task-2', 'task-2'], 'team task "task-1" repeats blocker "task-2"'],
      [['task-3'], 'blocker task "task-3" for "task-1" is missing or deleted'],
    ] as const) {
      expect(teamProjectionDefinition.apply(withBlocker, event({ version: 1, teamId: TeamId('root'), task: blockedBy([...ids]) })).failure)
        .toBe(failure)
    }
  })

  it('rejects a first record that does not start at revision 1', () => {
    const state = teamProjectionDefinition.init(header)
    expect(teamProjectionDefinition.apply(state, event({ version: 1, teamId: TeamId('root'), task: snapshot(2) })).failure)
      .toBe('team task "task-1" must begin at revision 1')
  })
})
