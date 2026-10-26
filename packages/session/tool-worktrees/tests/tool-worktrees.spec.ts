/** The `create_worktree` tool over real git and the real capability. */

import { execFile } from 'node:child_process'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import SessionProjectionRegistry from '@aeven/session-projection'
import SubprocessLocal from '@aeven/subprocess-local'
import { Session, SessionId } from '@aeven/session'
import type { Session as SessionType } from '@aeven/session'
import type { Agent } from '@aeven/agent'
import { ToolCallId } from '@aeven/llm'
import WorkingDirectoryService from '@aeven/working-directory'
import Worktrees from '@aeven/worktrees'

import * as tool from '../src/index.ts'

const run = promisify(execFile)
const signal = new AbortController().signal
const created: string[] = []

/**
 * Create a repository with one commit and a session working in it.
 * @returns the repository root and the agent stand-in over that session.
 */
async function repository(): Promise<{ root: string; agent: Agent & { session: SessionType } }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'avn-wtt-')))
  created.push(root)
  await run('git', ['init', '-q', '-b', 'main'], { cwd: root })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await run('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# repo\n')
  await run('git', ['add', '.'], { cwd: root })
  await run('git', ['commit', '-q', '-m', 'initial'], { cwd: root })
  const session = Session.create(SessionId('wtt-1'), undefined, {
    id: SessionId('wtt-1'), version: 0, createdAt: Date.now(), isSeeded: false, cwd: root,
  })
  return { root, agent: { id: SessionId('wtt-1'), session } as unknown as Agent & { session: SessionType } }
}

/**
 * Compose the tool over the real runtime, subprocess provider, capability, and working directory.
 * @returns the composed context.
 */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(WorkingDirectoryService)
  await ctx.plugin(Worktrees, { directory: '.aeven/worktrees', branchPrefix: 'avn/', graceMs: 5000 })
  await ctx.plugin(tool)
  return ctx
}

let counter = 0
/**
 * Execute `create_worktree` through the runtime.
 * @param ctx - composed context.
 * @param args - tool arguments.
 * @param agent - calling agent, or omitted for a non-agent caller.
 * @returns the tool result.
 */
function call(ctx: Context, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`wtt-call-${String(++counter)}`),
    name: 'create_worktree',
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

/**
 * Read every text block of a result.
 * @param result - tool result.
 * @returns the concatenated text.
 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(created.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('tool-worktrees', () => {
  it('registers create_worktree with optional name and from', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'create_worktree')
    expect(schema).toBeDefined()
    const properties = (schema?.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(properties)).toEqual(['name', 'from'])
  })

  it('creates the checkout, moves the session, and says where it is', async () => {
    const { root, agent } = await repository()
    const ctx = await setup()
    const result = await call(ctx, { name: 'task-a' }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({
      path: join(root, '.aeven/worktrees/task-a'),
      branch: 'avn/task-a',
      repositoryRoot: root,
    })
    expect(existsSync(join(root, '.aeven/worktrees/task-a'))).toBe(true)
    expect(ctx.workingDirectory.of(agent.session)).toBe(join(root, '.aeven/worktrees/task-a'))
    expect(text(result)).toContain('avn/task-a')
  })

  it('generates a name when none is given', async () => {
    const { agent } = await repository()
    const ctx = await setup()
    const result = await call(ctx, {}, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { path: string; branch: string }
    expect(value.branch.startsWith('avn/work-')).toBe(true)
    expect(existsSync(value.path)).toBe(true)
  })

  it('refuses a caller with no session', async () => {
    const ctx = await setup()
    const result = await call(ctx, { name: 'nobody' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('owning agent session')
  })

  it('surfaces a duplicate name as a failure the model can read', async () => {
    const { agent } = await repository()
    const ctx = await setup()
    await call(ctx, { name: 'twice' }, agent)
    const result = await call(ctx, { name: 'twice' }, agent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('worktrees: git worktree failed')
  })
})
