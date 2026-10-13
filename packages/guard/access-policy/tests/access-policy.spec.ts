/**
 * Real-composition coverage for @aeven/tool-call-access-policy: the plugin mounts beside the tool
 * registry and a session access policy, and a guarded call is refused or admitted according to the
 * mode, with the registration gone once its fiber is disposed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@aeven/llm'
import type { SandboxExecutionPolicy, SandboxMode } from '@aeven/sandbox'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolExecutionResult } from '@aeven/tools'
import * as accessPolicy from '@aeven/tool-call-access-policy'

const signal = new AbortController().signal

/** Text of the single content block an execution result carries. */
function textOf(result: ToolExecutionResult): string {
  const block = result.content[0]
  return block !== undefined && block.type === 'text' ? block.text : ''
}

/** Mount the registry, a fixed session access mode, and the policy under test. */
async function setup(mode: SandboxMode): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode } as unknown as SandboxExecutionPolicy) } as never)
  await ctx.plugin(accessPolicy)
  return ctx
}

/** Register two tools: one on the default deny list and one off it. */
function registerTools(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'preview_click', description: 'effectful', parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'clicked' }]),
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'read_file', description: 'read', parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'contents' }]),
  }))
}

/** Dispatch one registered tool. */
function call(ctx: Context, name: string): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ callId: ToolCallId('c1'), name, arguments: {}, signal })
}

describe('@aeven/tool-call-access-policy', () => {
  it('denies a listed tool while the session mode forbids effects', async () => {
    const ctx = await setup('read-only')
    registerTools(ctx)
    const result = await call(ctx, 'preview_click')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('preview_click')
    expect(textOf(result)).toContain('read-only')
  })

  it('executes the same tool under a permissive mode', async () => {
    const ctx = await setup('workspace-write')
    registerTools(ctx)
    const result = await call(ctx, 'preview_click')
    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe('clicked')
  })

  it('admits a tool that is not listed', async () => {
    const ctx = await setup('read-only')
    registerTools(ctx)
    const result = await call(ctx, 'read_file')
    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe('contents')
  })

  it('removes the check when the registering fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' as SandboxMode }) } as never)
    const fiber = await ctx.plugin(accessPolicy)
    registerTools(ctx)
    expect((await call(ctx, 'preview_click')).isError).toBe(true)
    await fiber.dispose()
    const result = await call(ctx, 'preview_click')
    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe('clicked')
  })
})
