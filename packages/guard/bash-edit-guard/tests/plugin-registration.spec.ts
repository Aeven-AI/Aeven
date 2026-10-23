/**
 * Registration behavior of @aeven/bash-edit-guard: the guard is one registry
 * contribution that disappears with its fiber, and a configuration the schema
 * rejects fails at load instead of silently guarding nothing.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import * as BashEditGuard from '@aeven/bash-edit-guard'
import { guardConfig, mountGuard } from './harness.ts'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('registry contribution', () => {
  it('removes the check when the guard fiber is disposed', async () => {
    const guard = await mountGuard()
    expect((await guard.run("sed -i 's/one/two/' src/index.ts", packageRoot)).isError).toBe(true)

    await guard.guard.dispose()

    expect((await guard.run("sed -i 's/one/two/' src/index.ts", packageRoot)).isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })
})

describe('config validation', () => {
  it('rejects a tool list that is not an array', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    await expect(ctx.plugin(BashEditGuard, Object.assign({}, guardConfig(), { tools: 'bash' })))
      .rejects.toThrow(/tools/)
  })

  it('rejects a source-extension list that is not an array', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    await expect(ctx.plugin(BashEditGuard, Object.assign({}, guardConfig(), { sourceExtensions: 1 })))
      .rejects.toThrow(/sourceExtensions/)
  })
})
