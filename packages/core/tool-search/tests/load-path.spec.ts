/**
 * Real Loader-path guard for a namespace plugin: a default export would make
 * `unwrapExports` collapse the namespace and drop `inject` and `Config`, so the
 * preset's `config:` block would never be validated. See postmortem 0001.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import * as toolSearch from '@aeven/tool-search'

describe('avn-tool-search real-load-path guard', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolSearch).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolSearch) as Record<string, unknown>
    expect(unwrapped).toBe(toolSearch)
    expect(unwrapped.name).toBe('tool-search')
    expect(unwrapped.inject).toEqual(['tools', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('validates the shipped config shape and registers tool_search through the unwrapped module', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolSearch) as Parameters<Context['plugin']>[0]
    const fiber = await ctx.plugin(unwrapped, {
      defer: ['mcp__*', 'grok_imagine_*'],
      groups: [{ title: 'Image and video generation', tools: ['grok_imagine_*'] }],
    })

    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('tool_search')
    expect(() => toolSearch.Config({ groups: [{ title: '', tools: [] }] })).toThrow()
    expect(toolSearch.Config({})).toEqual({ defer: ['mcp__*'], groups: [], maxResults: 8, maxRequestTools: 128 })
    await fiber.dispose()
  })
})
