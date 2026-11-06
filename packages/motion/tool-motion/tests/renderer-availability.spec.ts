import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import * as ToolMotion from '@aeven/tool-motion'

const MOTION_TOOLS = ['render_motion', 'show_motion']

/**
 * Mount tool-motion beside the services every composition provides, without a motion renderer.
 * @returns the root context and a reader for the registered motion tool names.
 */
async function mountWithoutRenderer(): Promise<{ ctx: Context; motionTools: () => string[] }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('attachments', {})
  ctx.provide('fs', {})
  const fiber = ctx.plugin(ToolMotion, { maxStills: 8 })
  await fiber.await()
  return {
    ctx,
    motionTools: () => ctx.tools.schemas().map(tool => tool.name).filter(name => MOTION_TOOLS.includes(name)).sort(),
  }
}

describe('tool-motion without a motion renderer', () => {
  it('activates with every injected service present and contributes no tool', async () => {
    const { ctx, motionTools } = await mountWithoutRenderer()

    expect(ToolMotion.inject).not.toContain('motion')
    expect(ToolMotion.inject.every(name => ctx.get(name) !== undefined)).toBe(true)
    expect(motionTools()).toEqual([])
  })

  it('registers both tools when a renderer mounts and removes them when it unmounts', async () => {
    const { ctx, motionTools } = await mountWithoutRenderer()

    const renderer = ctx.plugin({
      name: 'motion-renderer-double',
      apply: (rendererCtx: Context) => {
        rendererCtx.provide('motion', {})
      },
    })
    await renderer.await()
    expect(motionTools()).toEqual(MOTION_TOOLS)

    await renderer.dispose()
    expect(motionTools()).toEqual([])
  })
})
