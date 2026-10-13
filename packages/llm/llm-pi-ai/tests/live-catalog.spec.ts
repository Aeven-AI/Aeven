/**
 * Live model-list refresh: mapping one published document entry onto a pi-ai
 * model, the additive merge that protects tuned snapshot entries, and the
 * fetch's failure behavior — a route whose document is unreachable, slow, or
 * malformed keeps serving the installed catalog.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { catalogModels } from '../src/catalog.ts'
import { KNOWN_ROUTES, knownRoute } from '../src/known-routes.ts'
import { DEFAULT_CATALOG_REFRESH_TIMEOUT_MS, resolveProfiles } from '../src/config.ts'
import { fetchLiveAdditions, liveAdditions, liveModel } from '../src/live-catalog.ts'
import type { LiveCatalogRoute } from '../src/live-catalog.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise((resolve) => { server.close(resolve) })))
})

/**
 * Serve one model document over HTTP. The shared `mock-server` helper always
 * answers 200 as an event stream, and this reads a plain JSON body.
 * @param behavior - status, body, and an optional delay before responding.
 * @returns the listening origin.
 */
async function documentServer(behavior: { status?: number; body: string; delayMs?: number }): Promise<string> {
  const server = createServer((_request, response) => {
    const send = (): void => {
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      response.end(behavior.body)
    }
    if (behavior.delayMs === undefined) send()
    else setTimeout(send, behavior.delayMs)
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${String(address.port)}`
}

const ROUTE: LiveCatalogRoute = {
  provider: 'openrouter',
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultContextWindow: 262_144,
  defaultMaxTokens: 32_768,
  format: 'openrouter',
  requireTags: [],
}

/** One published entry in the shape OpenRouter's `GET /models` returns. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'deepseek/deepseek-v4-flash-vision-exp',
    name: 'DeepSeek: DeepSeek V4 Flash Vision Exp',
    context_length: 1_048_576,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    pricing: { prompt: '0.00000022', completion: '0.00000066', input_cache_read: '0.000000007' },
    top_provider: { context_length: 1_048_576, max_completion_tokens: 384_000 },
    supported_parameters: ['reasoning', 'reasoning_effort', 'tools'],
    ...overrides,
  }
}

describe('liveModel', () => {
  it('maps a published entry onto the route protocol, endpoint, capacities, and modalities', () => {
    const model = liveModel(entry(), ROUTE)

    expect(model).toMatchObject({
      id: 'deepseek/deepseek-v4-flash-vision-exp',
      name: 'DeepSeek: DeepSeek V4 Flash Vision Exp',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      provider: 'openrouter',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_048_576,
      maxTokens: 384_000,
    })
    // Per-token decimal strings become pi-ai's per-million numbers.
    expect(model?.cost).toEqual({ input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 })
  })

  it('offers reasoning levels only to an entry that advertises reasoning', () => {
    const thinking = liveModel(entry(), ROUTE)
    expect(thinking?.reasoning).toBe(true)
    expect(thinking?.thinkingLevelMap).toMatchObject({ low: 'low', medium: 'medium', high: 'high' })

    const plain = liveModel(entry({ supported_parameters: ['tools'] }), ROUTE)
    expect(plain?.reasoning).toBe(false)
    expect(plain?.thinkingLevelMap).toBeUndefined()
    // Nothing the document does not express is guessed onto the model.
    expect(plain?.compat).toBeUndefined()
  })

  it('falls back to the route capacities and keeps only modalities pi-ai accepts', () => {
    const model = liveModel(entry({
      context_length: null,
      top_provider: undefined,
      architecture: { input_modalities: ['text', 'audio', 'video'] },
    }), ROUTE)

    expect(model?.contextWindow).toBe(262_144)
    expect(model?.maxTokens).toBe(32_768)
    expect(model?.input).toEqual(['text'])
  })

  it('reads a whole-window completion cap as no cap in the openrouter layout too', () => {
    const wholeWindow = liveModel(entry({ top_provider: { context_length: 262_144, max_completion_tokens: 262_144 } }), ROUTE)

    expect(wholeWindow).toMatchObject({ contextWindow: 262_144, maxTokens: 32_768 })
  })

  it('always declares text, even for an entry that publishes only other modalities', () => {
    const model = liveModel(entry({ architecture: { input_modalities: ['image'] } }), ROUTE)
    expect(model?.input).toEqual(['text', 'image'])
  })

  it('reads no cost from a document that publishes prices unusably', () => {
    const missing = liveModel(entry({ pricing: undefined }), ROUTE)
    expect(missing?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

    // Both layouts publish prices, one as decimal strings and one as numbers,
    // so only a value that is neither reads as no price at all.
    const unparsable = liveModel(
      entry({ pricing: { prompt: 'free', completion: { amount: 12 }, input_cache_read: null } }),
      ROUTE,
    )
    expect(unparsable?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('falls back to text when the document states no modality list at all', () => {
    expect(liveModel(entry({ architecture: undefined }), ROUTE)?.input).toEqual(['text'])
    expect(liveModel(entry({ architecture: { input_modalities: 'text' } }), ROUTE)?.input).toEqual(['text'])
  })

  it('reads no reasoning from a document that states no parameter list', () => {
    expect(liveModel(entry({ supported_parameters: undefined }), ROUTE)?.reasoning).toBe(false)
    expect(liveModel(entry({ supported_parameters: 'reasoning' }), ROUTE)?.reasoning).toBe(false)
  })

  it('accepts an entry advertising reasoning under the include_reasoning spelling', () => {
    expect(liveModel(entry({ supported_parameters: ['include_reasoning'] }), ROUTE)?.reasoning).toBe(true)
  })

  it('refuses an entry with no usable id', () => {
    expect(liveModel(entry({ id: undefined }), ROUTE)).toBeUndefined()
    expect(liveModel(entry({ id: '' }), ROUTE)).toBeUndefined()
  })

  it('names an entry by its id when the document states no name', () => {
    const model = liveModel(entry({ name: undefined }), ROUTE)
    expect(model?.name).toBe('deepseek/deepseek-v4-flash-vision-exp')
  })
})

describe('liveAdditions', () => {
  it('adds only ids the installed catalog does not describe', () => {
    const document = {
      data: [entry({ id: 'a/one' }), entry({ id: 'b/two' }), entry({ id: 'c/three' })],
    }

    const added = liveAdditions(document, new Set(['b/two']), ROUTE)

    // The tuned snapshot entry is never replaced by its published counterpart.
    expect(added.map(model => model.id)).toEqual(['a/one', 'c/three'])
  })

  it('keeps the first occurrence of a duplicated published id', () => {
    const document = { data: [entry({ id: 'a/one', name: 'First' }), entry({ id: 'a/one', name: 'Second' })] }

    const added = liveAdditions(document, new Set(), ROUTE)

    expect(added).toHaveLength(1)
    expect(added[0]?.name).toBe('First')
  })

  it('skips unusable entries without failing the whole document', () => {
    const document = { data: [entry({ id: undefined }), entry({ id: 'a/one' })] }

    expect(liveAdditions(document, new Set(), ROUTE).map(model => model.id)).toEqual(['a/one'])
  })

  it('refuses a document with no data array', () => {
    expect(() => liveAdditions({}, new Set(), ROUTE)).toThrow('has no "data" array')
    expect(() => liveAdditions(null, new Set(), ROUTE)).toThrow('has no "data" array')
    expect(() => liveAdditions({ data: 'nope' }, new Set(), ROUTE)).toThrow('has no "data" array')
  })
})

describe('fetchLiveAdditions', () => {
  it('fetches and materializes the published document', async () => {
    const origin = await documentServer({ body: JSON.stringify({ data: [entry({ id: 'a/one' })] }) })

    const added = await fetchLiveAdditions(`${origin}/models`, 5000, new Set(), ROUTE)

    expect(added.map((model: Model<Api>) => model.id)).toEqual(['a/one'])
  })

  it('rejects a non-OK response so the route keeps the installed catalog', async () => {
    const origin = await documentServer({ status: 503, body: 'unavailable' })

    await expect(fetchLiveAdditions(`${origin}/models`, 5000, new Set(), ROUTE))
      .rejects.toThrow('HTTP 503')
  })

  it('aborts a document that outlives the configured timeout', async () => {
    const origin = await documentServer({ delayMs: 500, body: JSON.stringify({ data: [] }) })

    await expect(fetchLiveAdditions(`${origin}/models`, 20, new Set(), ROUTE)).rejects.toThrow()
  })

  it('stops on caller cancellation', async () => {
    const origin = await documentServer({ delayMs: 500, body: JSON.stringify({ data: [] }) })
    const controller = new AbortController()
    const pending = fetchLiveAdditions(`${origin}/models`, 5000, new Set(), ROUTE, controller.signal)
    controller.abort()

    await expect(pending).rejects.toThrow()
  })
})

describe('route materialization', () => {
  it('serves added models beside the installed catalog, customizable by the same keys', () => {
    const installed = catalogModels('openrouter')
    expect(installed.size).toBeGreaterThan(0)
    const addedId = 'deepseek/deepseek-v4-flash-vision-exp'
    // The premise of the whole refresh: this id is live upstream and absent here.
    expect(installed.has(addedId)).toBe(false)
    const liveModels = new Map([['openrouter', liveAdditions({ data: [entry()] }, new Set(installed.keys()), ROUTE)]])

    const resolved = resolveProfiles({ openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } }, liveModels)
    const models = resolved.get('openrouter')?.piProvider.getModels() ?? []

    expect(models.map(model => model.id)).toContain(addedId)
    // The installed catalog keeps serving alongside it.
    expect(models.length).toBe(installed.size + 1)
  })

  it('keeps the installed entry when an added model collides with a shipped id', () => {
    const installed = catalogModels('openrouter')
    const collidingId = [...installed.keys()][0]!
    const shipped = installed.get(collidingId)!
    // Reaching resolution with a colliding id is what the merge guard is for;
    // `liveAdditions` would normally have dropped it one layer earlier.
    const colliding = liveModel(entry({ id: collidingId, name: 'Published name' }), ROUTE)!

    const resolved = resolveProfiles(
      { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } },
      new Map([['openrouter', [colliding]]]),
    )
    const models = resolved.get('openrouter')?.piProvider.getModels() ?? []

    expect(models).toHaveLength(installed.size)
    expect(models.find(model => model.id === collidingId)?.name).toBe(shipped.name)
  })

  it('leaves the installed catalog untouched when no refresh resolved', () => {
    const installed = catalogModels('openrouter')

    const resolved = resolveProfiles({ openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } })

    expect(resolved.get('openrouter')?.piProvider.getModels()).toHaveLength(installed.size)
  })

  it('never replaces a tuned installed entry with its published counterpart', () => {
    const installed = catalogModels('openrouter')
    const tunedId = [...installed.keys()][0]!
    const tuned = installed.get(tunedId)!
    const document = { data: [entry({ id: tunedId, name: 'Published name', context_length: 7 })] }

    const added = liveAdditions(document, new Set(installed.keys()), ROUTE)
    expect(added).toHaveLength(0)

    const resolved = resolveProfiles(
      { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } },
      new Map([['openrouter', added]]),
    )
    const served = (resolved.get('openrouter')?.piProvider.getModels() ?? []).find(model => model.id === tunedId)
    expect(served?.name).toBe(tuned.name)
    expect(served?.contextWindow).toBe(tuned.contextWindow)
  })
})

describe('catalogRefresh configuration', () => {
  it('resolves a written block and defaults its timeout', () => {
    const resolved = resolveProfiles({
      openrouter: {
        apiKeyEnv: 'OPENROUTER_API_KEY',
        catalogRefresh: { url: 'https://openrouter.ai/api/v1/models' },
      },
    })

    // The route's own capacity fallbacks are resolved here too, so the
    // refresh never re-derives a default this layer already chose.
    expect(resolved.get('openrouter')?.catalogRefresh).toEqual({
      url: 'https://openrouter.ai/api/v1/models',
      format: 'openrouter',
      requireTags: [],
      timeoutMs: DEFAULT_CATALOG_REFRESH_TIMEOUT_MS,
      defaultContextWindow: 262_144,
      defaultMaxTokens: 32_768,
    })
  })

  it('keeps an explicit timeout', () => {
    const resolved = resolveProfiles({
      openrouter: {
        apiKeyEnv: 'OPENROUTER_API_KEY',
        catalogRefresh: { url: 'https://openrouter.ai/api/v1/models', timeoutMs: 250 },
      },
    })

    expect(resolved.get('openrouter')?.catalogRefresh?.timeoutMs).toBe(250)
  })

  it('leaves a route that configures no refresh without one', () => {
    const resolved = resolveProfiles({ openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } })

    expect(resolved.get('openrouter')?.catalogRefresh).toBeUndefined()
  })

  it('refuses a written block that names no url', () => {
    expect(() => resolveProfiles({
      openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY', catalogRefresh: { timeoutMs: 250 } },
    })).toThrow('must name the url of its model document')
  })
})

/** The DeepInfra layout: an OpenAI listing whose extras live under `metadata`. */
function openAiEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'Qwen/Qwen3.5-27B',
    object: 'model',
    metadata: {
      context_length: 262_144,
      max_tokens: 262_144,
      tags: ['chat', 'reasoning', 'reasoning_effort', 'vision'],
      pricing: { input_tokens: 0.0000001, output_tokens: 0.0000004 },
    },
    ...overrides,
  }
}

const OPENAI_ROUTE: LiveCatalogRoute = {
  provider: 'deepinfra',
  api: 'openai-completions',
  baseUrl: 'https://api.deepinfra.com/v1/openai',
  defaultContextWindow: 262_144,
  defaultMaxTokens: 32_768,
  format: 'openai-models',
  requireTags: ['chat'],
}

describe('the openai-models layout', () => {
  it('reads capacities, modalities, and reasoning from the metadata block', () => {
    const model = liveModel(openAiEntry(), OPENAI_ROUTE)

    expect(model).toMatchObject({
      id: 'Qwen/Qwen3.5-27B',
      // No name field in this layout, so the id is the label.
      name: 'Qwen/Qwen3.5-27B',
      contextWindow: 262_144,
      // This layout publishes max_tokens as a copy of context_length, which is
      // no output ceiling, so the route's own fallback answers for the model.
      maxTokens: 32_768,
      reasoning: true,
      input: ['text', 'image'],
    })
    expect(model?.thinkingLevelMap).toMatchObject({ low: 'low', medium: 'medium', high: 'high' })
  })

  it('keeps a published cap that fits inside the entry window', () => {
    const model = liveModel(
      openAiEntry({ metadata: { context_length: 262_144, max_tokens: 131_072, tags: ['chat'] } }),
      OPENAI_ROUTE,
    )

    expect(model).toMatchObject({ contextWindow: 262_144, maxTokens: 131_072 })
  })

  it('judges a published cap against the route window when the entry states none', () => {
    const model = liveModel(openAiEntry({ metadata: { max_tokens: 262_144, tags: ['chat'] } }), OPENAI_ROUTE)

    expect(model).toMatchObject({ contextWindow: 262_144, maxTokens: 32_768 })
  })

  it('takes the vendor catalog cap when the document states none that can be one', () => {
    // DeepInfra serves `anthropic/claude-opus-5` with a 1,000,000-token window
    // and no output cap of its own; the vendor's entry states 128,000, and the
    // host refuses 128,001.
    const route = { ...OPENAI_ROUTE, vendorOutputCap: (id: string) => (id === 'Qwen/Qwen3.5-27B' ? 128_000 : undefined) }
    const entryWithWindow = openAiEntry({
      id: 'Qwen/Qwen3.5-27B',
      metadata: { context_length: 1_000_000, max_tokens: 1_000_000, tags: ['chat'] },
    })

    expect(liveModel(entryWithWindow, route)).toMatchObject({ contextWindow: 1_000_000, maxTokens: 128_000 })
    // A vendored cap the route cannot use leaves the route default answering.
    expect(liveModel(entryWithWindow, { ...route, vendorOutputCap: () => 1_000_000 }))
      .toMatchObject({ maxTokens: 32_768 })
    // The document's own usable cap still outranks the vendor's.
    expect(liveModel(
      openAiEntry({ metadata: { context_length: 262_144, max_tokens: 131_072, tags: ['chat'] } }),
      { ...route, vendorOutputCap: () => 128_000 },
    )).toMatchObject({ maxTokens: 131_072 })
  })

  it('reads text-only, non-reasoning entries without inventing capability', () => {
    const model = liveModel(openAiEntry({ metadata: { context_length: 8192, tags: ['chat'] } }), OPENAI_ROUTE)

    expect(model).toMatchObject({ contextWindow: 8192, reasoning: false, input: ['text'] })
    expect(model?.compat).toBeUndefined()
    expect(model?.thinkingLevelMap).toBeUndefined()
  })

  it('offers no effort selector to a model that reasons without an effort control', () => {
    const model = liveModel(openAiEntry({ metadata: { tags: ['chat', 'reasoning'] } }), OPENAI_ROUTE)

    expect(model?.reasoning).toBe(true)
    expect(model?.compat).toMatchObject({ thinkingFormat: 'openrouter' })
    expect(model?.thinkingLevelMap).toBeUndefined()
  })

  it('falls back to the route capacities when the metadata block sizes nothing', () => {
    const model = liveModel(openAiEntry({ metadata: { tags: ['chat'] } }), OPENAI_ROUTE)

    expect(model).toMatchObject({ contextWindow: 262_144, maxTokens: 32_768 })
  })

  it('skips entries missing a required tag, and entries with no tags at all', () => {
    expect(liveModel(openAiEntry({ metadata: { tags: ['image-gen'] } }), OPENAI_ROUTE)).toBeUndefined()
    expect(liveModel(openAiEntry({ metadata: undefined }), OPENAI_ROUTE)).toBeUndefined()
    expect(liveModel(openAiEntry({ metadata: { tags: 'chat' } }), OPENAI_ROUTE)).toBeUndefined()
  })

  it('materializes only the tagged entries of a mixed document', () => {
    const document = {
      data: [
        openAiEntry({ id: 'a/chat' }),
        openAiEntry({ id: 'b/image', metadata: { tags: ['image-gen'] } }),
        openAiEntry({ id: 'c/embed', metadata: { tags: ['embed'] } }),
      ],
    }

    expect(liveAdditions(document, new Set(), OPENAI_ROUTE).map(model => model.id)).toEqual(['a/chat'])
  })

  it('reads per-token prices from the metadata pricing block', () => {
    const cost = liveModel(openAiEntry(), OPENAI_ROUTE)?.cost
    // Per-token numbers scaled to per-million; binary floating point makes the
    // product inexact, which is why this compares approximately.
    expect(cost?.input).toBeCloseTo(0.1, 10)
    expect(cost?.output).toBeCloseTo(0.4, 10)
    expect(cost).toMatchObject({ cacheRead: 0, cacheWrite: 0 })
  })
})

describe('known routes', () => {
  it('completes a credential-only profile into a working route', () => {
    const known = knownRoute('deepinfra')
    if (known === undefined) throw new Error('deepinfra is not a known route')
    const added = liveAdditions({ data: [openAiEntry()] }, new Set(), OPENAI_ROUTE)

    // Exactly what the Models page stores: a credential and nothing else.
    const resolved = resolveProfiles(
      { deepinfra: { apiKeyEnv: 'DEEPINFRA_API_KEY' } },
      new Map([['deepinfra', added]]),
    )
    const route = resolved.get('deepinfra')

    expect(route?.displayName).toBe('DeepInfra')
    expect(route?.api).toBe(known.api)
    expect(route?.baseURL).toBe(known.baseURL)
    expect(route?.catalogRefresh).toMatchObject({
      url: known.catalogRefresh.url,
      format: 'openai-models',
      requireTags: ['chat'],
    })
    expect(route?.piProvider.getModels().map(model => model.id)).toEqual(['Qwen/Qwen3.5-27B'])
  })

  it('lets a profile override the defaults it inherits', () => {
    const resolved = resolveProfiles({
      deepinfra: {
        apiKeyEnv: 'MY_KEY',
        displayName: 'My Gateway',
        baseURL: 'https://proxy.internal/v1',
        models: [{ id: 'pinned', name: 'Pinned', contextWindow: 4096, maxTokens: 512 }],
      },
    })
    const route = resolved.get('deepinfra')

    expect(route?.displayName).toBe('My Gateway')
    expect(route?.baseURL).toBe('https://proxy.internal/v1')
    expect(route?.piProvider.getModels().map(model => model.id)).toEqual(['pinned'])
  })

  it('resolves empty while its first refresh is outstanding, rather than refusing the route', () => {
    // A known route's models come only from the document, and resolution runs
    // before the first fetch answers. Refusing here would mean the route never
    // registers and the refresh never gets to fill it.
    const resolved = resolveProfiles({ deepinfra: { apiKeyEnv: 'DEEPINFRA_API_KEY' } })

    expect(resolved.get('deepinfra')?.piProvider.getModels()).toEqual([])
  })

  it('still refuses a declared route that configures no refresh and lists no models', () => {
    expect(() => resolveProfiles({
      'acme-gateway': { api: 'openai-completions', baseURL: 'https://acme.example/v1' },
    })).toThrow('resolves no models')
  })

  it('names deepinfra among the routes this package can configure', () => {
    expect(Object.keys(KNOWN_ROUTES)).toContain('deepinfra')
    expect(knownRoute('not-a-provider')).toBeUndefined()
  })
})
