/**
 * What mounting this plugin contributes to `ctx.llm`: the provider identity a
 * selector shows, the configurable-provider entry, the catalog a discovery
 * consumer is offered, and what disposal withdraws.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ReasoningEffortId } from '@aeven/llm'
import { DEFAULT_MAX_TOKENS } from '@aeven/llm-deepseek'
import * as LlmAeven from '../src/index.ts'
import { DEFAULT_API_KEY_ENV, DEFAULT_API_URL, NS, PROVIDER } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.unstubAllEnvs()
})

/** Mount the LLM runtime and this plugin on a fresh context. */
async function mountContext(): Promise<Context> {
  const mounted = new Context()
  await mounted.plugin(LlmRuntime)
  await mounted.plugin(LlmAeven, {})
  return mounted
}

describe('aeven-cloud route registration', () => {
  it('publishes the route as Aeven and answers discovery from the shipped catalog', async () => {
    ctx = await mountContext()

    // The Aeven brand is the one fact the reused DeepSeek transport cannot
    // supply, because it answers every route it owns with its own name.
    expect(ctx.llm.listProviders()).toEqual([{ id: PROVIDER, name: 'Aeven' }])
    expect(ctx.llm.listConfigurableProviders()).toEqual([
      { provider: PROVIDER, displayName: 'Aeven', settingsNs: NS, settingsPath: [] },
    ])

    // Discovery answers from the shipped catalog rather than fetching an
    // entitlement-scoped listing, so a selector offers both entries to every
    // account and the paid model is learned from the refusal.
    expect(await ctx.llm.discoverModels(NS, { provider: PROVIDER })).toEqual([
      { id: 'Aeven-1.0-Flash', name: 'Aeven Flash', contextWindow: 1_000_000, maxTokens: 384_000 },
      { id: 'Aeven-1.0-Pro', name: 'Aeven Pro', contextWindow: 1_000_000, maxTokens: 384_000 },
    ])
  })

  it('reports each shipped model with its own context window, cap, and modalities', async () => {
    ctx = await mountContext()

    const flash = await ctx.llm.resolveModelInfo(PROVIDER, 'Aeven-1.0-Flash')
    expect(flash).toMatchObject({
      provider: PROVIDER,
      id: 'Aeven-1.0-Flash',
      name: 'Aeven Flash',
      inputModalities: ['text', 'image'],
      context: { contextWindow: 1_000_000 },
      defaultMaxTokens: 384_000,
      reasoning: { defaultEffort: ReasoningEffortId('high') },
    })

    // The two entries differ in exactly one capability: only Flash reads images.
    const pro = await ctx.llm.resolveModelInfo(PROVIDER, 'Aeven-1.0-Pro')
    expect(pro).toMatchObject({ id: 'Aeven-1.0-Pro', inputModalities: ['text'] })
  })

  it('withdraws the route, its directory entry, and its discovery answer on unload', async () => {
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmAeven, {})

    await fiber.dispose()

    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    await expect(ctx.llm.discoverModels(NS, { provider: PROVIDER })).rejects.toMatchObject({
      code: 'NO_DISCOVERY',
    })
  })

  it('exposes exactly the function-plugin slots a composition resolves', () => {
    // The Loader reads these slots off the module namespace, and a default
    // export alongside them makes it discard them instead.
    expect(LlmAeven.name).toBe('llm-aeven')
    expect(LlmAeven.inject).toEqual(['llm'])
    expect(LlmAeven.apply).toBeTypeOf('function')
    expect(LlmAeven.Config).toBeTypeOf('function')
    expect(LlmAeven).not.toHaveProperty('default')
  })

  it('ships the documented entry defaults', () => {
    expect(LlmAeven.Config({})).toMatchObject({
      apiUrl: DEFAULT_API_URL,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      thinking: 'enabled',
      reasoningEffort: 'high',
      maxTokens: DEFAULT_MAX_TOKENS,
      models: LlmAeven.DEFAULT_MODELS.map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
    })
  })
})
