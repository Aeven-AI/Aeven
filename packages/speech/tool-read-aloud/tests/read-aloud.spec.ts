/** The model-facing `read_aloud` tool: schema, result text, card title, and fiber-owned registration. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@aeven/llm'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import { afterEach, expect, it } from 'vitest'
import * as readAloud from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

let callCounter = 0

/** Mount the real tool registry and the plugin under test. */
async function mounted() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = ctx.plugin(readAloud)
  await fiber
  return { ctx, fiber }
}

/** Run one `read_aloud` call through the registry's validation and execution path. */
function call(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`call-${++callCounter}`),
    name: 'read_aloud',
    arguments: args,
  })
}

it('exports a function plugin with the tool injection and no default export', () => {
  expect('default' in readAloud).toBe(false)
  expect(readAloud.name).toBe('tool-read-aloud')
  expect(readAloud.inject).toEqual(['tools'])
})

it('registers one tool that requires the boolean switch', async () => {
  const { ctx } = await mounted()
  const schema = ctx.tools.schemas().find(entry => entry.name === 'read_aloud')
  expect(schema?.description).toContain('Turn spoken read-aloud of your replies on or off for this session.')
  const parameters = schema?.parameters as { properties: { enabled: { type: string } }; required: string[] }
  expect(parameters.properties.enabled.type).toBe('boolean')
  expect(parameters.required).toEqual(['enabled'])
})

it('answers with the switch it was given for both on and off', async () => {
  const { ctx } = await mounted()
  const on = await call(ctx, { enabled: true })
  expect(on).toMatchObject({ isError: false, value: { enabled: true } })
  expect(on.content).toEqual([{ type: 'text', text: 'Read-aloud is on: your next replies are spoken as they stream.' }])
  const off = await call(ctx, { enabled: false })
  expect(off).toMatchObject({ isError: false, value: { enabled: false } })
  expect(off.content).toEqual([{ type: 'text', text: 'Read-aloud is off: replies are no longer spoken.' }])
})

it('refuses a call that omits the switch', async () => {
  const { ctx } = await mounted()
  const refused = await call(ctx, {})
  expect(refused.isError).toBe(true)
})

it('titles the pending card by the direction it switches', async () => {
  const { ctx } = await mounted()
  // oxlint-disable-next-line typescript/unbound-method -- the presenter is a stored function, not a method of ctx.tools
  const present = ctx.tools.get('read_aloud')!.presentCall!
  expect(present({ enabled: true })).toEqual({ card: 'generic', title: 'Read replies aloud', kind: 'other' })
  expect(present({ enabled: false })).toEqual({ card: 'generic', title: 'Stop reading aloud', kind: 'other' })
})

it('withdraws the tool with the fiber that registered it', async () => {
  const { ctx, fiber } = await mounted()
  expect(ctx.tools.get('read_aloud')).toBeDefined()
  await fiber.dispose()
  expect(ctx.tools.get('read_aloud')).toBeUndefined()
})
