/** The `working_directory` tool: read, change, and refusal paths. */

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import SessionProjectionRegistry from '@aeven/session-projection'
import { Session, SessionId } from '@aeven/session'
import type { Session as SessionType } from '@aeven/session'
import type { Agent } from '@aeven/agent'
import { ToolCallId } from '@aeven/llm'
import WorkingDirectoryService from '@aeven/working-directory'

import * as tool from '../src/index.ts'

const signal = new AbortController().signal

/**
 * A parent agent carrying a real session, so a logged change is observable.
 * @param cwd - the session header's working directory.
 * @returns the agent stand-in over a genuine session.
 */
function agentIn(cwd: string): Agent & { session: SessionType } {
  const header = { id: SessionId('wd-1'), version: 0, createdAt: Date.now(), isSeeded: false, ...cwd === '' ? {} : { cwd } }
  const session = Session.create(SessionId('wd-1'), undefined, header)
  return { id: SessionId('wd-1'), session } as unknown as Agent & { session: SessionType }
}

/**
 * Compose the tool over a real tool runtime and the working-directory service.
 * @returns the composed context.
 */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(WorkingDirectoryService)
  await ctx.plugin(tool)
  return ctx
}

let counter = 0
/**
 * Execute `working_directory` through the runtime.
 * @param ctx - composed context.
 * @param args - tool arguments.
 * @param agent - calling agent, or omitted for a non-agent caller.
 * @returns the tool result.
 */
function call(ctx: Context, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`wd-call-${String(++counter)}`),
    name: 'working_directory',
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

describe('tool-working-directory', () => {
  it('registers working_directory with an optional path', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'working_directory')
    expect(schema).toBeDefined()
    const properties = (schema?.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(properties)).toEqual(['path'])
  })

  it('reports the session directory when no path is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-wdt-'))
    const ctx = await setup()
    const result = await call(ctx, {}, agentIn(root))
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({ cwd: root, changed: false })
    expect(text(result)).toContain(root)
  })

  it('enters a relative directory and reports the absolute result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-wdt-'))
    await mkdir(join(root, 'sub'))
    const ctx = await setup()
    const agent = agentIn(root)
    const result = await call(ctx, { path: 'sub' }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({ cwd: join(root, 'sub'), changed: true })
    expect(text(result)).toContain('now')
    expect(ctx.workingDirectory.of(agent.session)).toBe(join(root, 'sub'))
  })

  it('refuses a path that does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-wdt-'))
    const ctx = await setup()
    const agent = agentIn(root)
    const result = await call(ctx, { path: 'missing' }, agent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not exist')
    expect(ctx.workingDirectory.of(agent.session)).toBe(root)
  })

  it('refuses a caller with no session', async () => {
    const ctx = await setup()
    const result = await call(ctx, {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('owning agent session')
  })

  it('refuses to report a directory a session without one does not have', async () => {
    const ctx = await setup()
    const result = await call(ctx, {}, agentIn(''))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no working directory')
  })
})
