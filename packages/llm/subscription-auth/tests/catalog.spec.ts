import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asRouteModel,
  extractLiveModels,
  extractModelIds,
  fetchLiveModelIds,
  fetchLiveModels,
  materializeLiveModel,
  mergeLiveCatalog,
  preferredGrokBuildModelFrom,
  thinkingLevelMapFromLiveEfforts,
} from '../src/catalog.ts'
import { DEFAULT_GROK_BUILD_MODEL, GROK_BUILD_ROUTE } from '../src/ids.ts'
import { grokBuildBaselineModels } from '../src/provider.ts'

const catalog = grokBuildBaselineModels()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('extractModelIds', () => {
  it('reads OpenAI-shaped data arrays', () => {
    expect(extractModelIds({ data: [{ id: 'grok-4.6' }, { id: 'grok-4.5' }, { object: 'model' }] })).toEqual([
      'grok-4.6',
      'grok-4.5',
    ])
  })

  it('accepts a bare string list and a models field', () => {
    expect(extractModelIds(['grok-4.6', 'grok-4.6'])).toEqual(['grok-4.6'])
    expect(extractModelIds({ models: [{ id: 'grok-4.20-multi-agent' }] })).toEqual(['grok-4.20-multi-agent'])
  })

  it('returns an empty list for unrecognized envelopes', () => {
    expect(extractModelIds({ unexpected: true })).toEqual([])
  })
})

describe('mergeLiveCatalog', () => {
  it('keeps the baseline catalog when live ids are missing', () => {
    expect(mergeLiveCatalog(catalog, undefined).map(model => model.id)).toEqual(catalog.map(model => model.id))
    expect(mergeLiveCatalog(catalog, []).map(model => model.id)).toEqual(catalog.map(model => model.id))
  })

  it('narrows to live ids and inherits baseline metadata', () => {
    const merged = mergeLiveCatalog(catalog, ['grok-4.5', 'grok-4.6'])
    expect(merged.map(model => model.id)).toEqual(['grok-4.5', 'grok-4.6'])
    const known = merged.find(model => model.id === 'grok-4.5')
    const extra = merged.find(model => model.id === 'grok-4.6')
    expect(known?.api).toBe('openai-responses')
    expect(extra?.api).toBe('openai-responses')
    expect(extra?.name).toBe('Grok 4.6')
    expect(extra?.reasoning).toBe(true)
    expect(extra?.input).toEqual(['text', 'image'])
    expect(extra?.thinkingLevelMap?.off).toBeNull()
    expect(extra?.thinkingLevelMap?.xhigh).toBe('xhigh')
    expect(known?.input).toEqual(['text', 'image'])
    expect(known?.thinkingLevelMap?.xhigh).toBeNull()
  })

  it('applies live reasoning_efforts so xhigh is not inherited from a 4.5 template', () => {
    const thinkingLevelMap = thinkingLevelMapFromLiveEfforts([
      { id: 'xhigh', value: 'xhigh' },
      { id: 'high', value: 'high' },
      { id: 'medium', value: 'medium' },
      { id: 'low', value: 'low' },
    ])
    const merged = mergeLiveCatalog(
      catalog,
      ['grok-4.6'],
      [
        {
          id: 'grok-4.6',
          reasoning: true,
          ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
        },
      ],
    )
    expect(merged[0]?.thinkingLevelMap).toMatchObject({
      off: null,
      xhigh: 'xhigh',
      high: 'high',
      medium: 'medium',
      low: 'low',
      max: null,
    })
  })
})

describe('materializeLiveModel', () => {
  it('uses the composer template for fast/composer ids', () => {
    const model = materializeLiveModel('grok-composer-2.5-fast', catalog)
    expect(model.reasoning).toBe(false)
    expect(model.contextWindow).toBe(200_000)
  })

  it('defaults unknown ids to the grok-4.6 template on the grok-build route', () => {
    const model = materializeLiveModel('grok-9-future', catalog)
    expect(model.provider).toBe(GROK_BUILD_ROUTE)
    expect(model.api).toBe('openai-responses')
    expect(model.name).toBe('Grok 9 Future')
    expect(model.input).toEqual(['text', 'image'])
    expect(model.thinkingLevelMap?.xhigh).toBe('xhigh')
  })

  it('keeps grok-4.5 descendants on the no-xhigh template', () => {
    const model = materializeLiveModel('grok-4.5-preview', catalog)
    expect(model.thinkingLevelMap?.xhigh).toBeNull()
    expect(model.thinkingLevelMap?.high).toBe('high')
  })

  it('inherits the baseline catalog when the caller supplies none', () => {
    const model = materializeLiveModel(DEFAULT_GROK_BUILD_MODEL)
    expect(model.id).toBe(DEFAULT_GROK_BUILD_MODEL)
    expect(model.name).toBe('Grok 4.6')
    expect(model.provider).toBe(GROK_BUILD_ROUTE)
  })

  it('titles a live composer id from the composer template', () => {
    const model = materializeLiveModel('grok-composer-9-fast', catalog)
    expect(model.id).toBe('grok-composer-9-fast')
    expect(model.name).toBe('Grok Composer 9 Fast')
    expect(model.reasoning).toBe(false)
    expect(model.contextWindow).toBe(200_000)
    expect(model.input).toEqual(['text'])
  })

  it('falls back to the default template when a fast id has no composer template', () => {
    const withoutComposer = catalog.filter(model => model.id !== 'grok-composer-2.5-fast')
    const model = materializeLiveModel('grok-fast-9', withoutComposer)
    const fallback = catalog.find(candidate => candidate.id === DEFAULT_GROK_BUILD_MODEL)
    expect(model.id).toBe('grok-fast-9')
    expect(model.name).toBe('Grok Fast 9')
    expect(model.contextWindow).toBe(fallback?.contextWindow)
    expect(model.reasoning).toBe(fallback?.reasoning)
  })

  it('falls back to the default template when a 4.5 id has no 4.5 template', () => {
    const without45 = catalog.filter(model => model.id !== 'grok-4.5')
    const model = materializeLiveModel('grok-4.5-preview', without45)
    expect(model.id).toBe('grok-4.5-preview')
    expect(model.thinkingLevelMap?.xhigh).toBe('xhigh')
  })

  it('inherits the first catalog entry when the default template is absent', () => {
    const only45 = catalog.filter(model => model.id === 'grok-4.5')
    const model = materializeLiveModel('grok-9-future', only45)
    expect(model.id).toBe('grok-9-future')
    expect(model.thinkingLevelMap?.xhigh).toBeNull()
    expect(model.contextWindow).toBe(only45[0]?.contextWindow)
  })

  it('refuses an unknown id when the baseline catalog is empty', () => {
    expect(() => materializeLiveModel('grok-9-future', [])).toThrow('grok-build: baseline catalog is empty')
  })

  it('collapses a separator run in an unknown id rather than inventing a segment', () => {
    const model = materializeLiveModel('grok--9_future', catalog)
    expect(model.name).toBe('Grok  9 Future')
    expect(model.id).toBe('grok--9_future')
  })

  it('overlays only the descriptor fields the live row declared', () => {
    const template = materializeLiveModel('grok-4.6', catalog)
    const overlaid = materializeLiveModel('grok-4.6', catalog, {
      id: 'grok-4.6',
      name: 'Grok 4.6 (live)',
      contextWindow: 123_456,
    })
    expect(overlaid.name).toBe('Grok 4.6 (live)')
    expect(overlaid.contextWindow).toBe(123_456)
    expect(overlaid.reasoning).toBe(template.reasoning)
    expect(overlaid.thinkingLevelMap).toEqual(template.thinkingLevelMap)
  })

  it('carries live reasoning metadata onto the materialized model', () => {
    const model = materializeLiveModel('grok-4.6', catalog, {
      id: 'grok-4.6',
      reasoning: false,
      thinkingLevelMap: { off: null },
    })
    expect(model.reasoning).toBe(false)
    expect(model.thinkingLevelMap).toEqual({ off: null })
  })
})

describe('thinkingLevelMapFromLiveEfforts', () => {
  it('pins undeclared extended levels to null so xhigh is opt-in', () => {
    expect(
      thinkingLevelMapFromLiveEfforts([
        { id: 'high', value: 'high' },
        { id: 'medium', value: 'medium' },
        { id: 'low', value: 'low' },
      ]),
    ).toMatchObject({ xhigh: null, max: null, high: 'high' })
  })

  it('ignores malformed, unsupported, and value-only effort rows', () => {
    const map = thinkingLevelMapFromLiveEfforts([
      'high',
      { id: 'extremely-high', value: 'extremely-high' },
      { id: 42, value: 42 },
      { value: 'xhigh' },
      { id: 'high', value: 'high' },
    ])
    expect(map).toMatchObject({ off: null, high: 'high', xhigh: 'xhigh' })
    expect(map?.minimal).toBeNull()
    expect(map?.max).toBeNull()
  })

  it('returns undefined when no row declares a usable level', () => {
    expect(thinkingLevelMapFromLiveEfforts(['high', {}, { id: 'off', value: 'off' }])).toBeUndefined()
    expect(thinkingLevelMapFromLiveEfforts([])).toBeUndefined()
  })
})

describe('extractLiveModels', () => {
  it('reads reasoning_efforts from a models-v2 row', () => {
    const [model] = extractLiveModels({
      data: [
        {
          id: 'grok-4.6',
          name: 'Grok 4.6',
          context_window: 500000,
          supports_reasoning_effort: true,
          reasoning_efforts: [
            { id: 'xhigh', value: 'xhigh' },
            { id: 'high', value: 'high' },
          ],
        },
      ],
    })
    expect(model).toMatchObject({
      id: 'grok-4.6',
      name: 'Grok 4.6',
      contextWindow: 500000,
      reasoning: true,
    })
    expect(model?.thinkingLevelMap?.xhigh).toBe('xhigh')
  })

  it('records an explicit reasoning opt-out and a bare reasoning opt-in', () => {
    const [optedIn, optedOut] = extractLiveModels({
      data: [
        { id: 'grok-4.6', supports_reasoning_effort: true },
        { id: 'grok-composer-2.5-fast', supports_reasoning_effort: false },
      ],
    })
    expect(optedIn).toEqual({ id: 'grok-4.6', reasoning: true })
    expect(optedOut).toEqual({ id: 'grok-composer-2.5-fast', reasoning: false })
  })
})

describe('fetchLiveModels', () => {
  it('parses a streamed models-v2 response', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":[{"id":"grok-4.6",'))
        controller.enqueue(new TextEncoder().encode('"reasoning_efforts":[{"id":"xhigh"}]}]}'))
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )
    await expect(fetchLiveModels('example-token')).resolves.toMatchObject([
      { id: 'grok-4.6', reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } },
    ])
  })

  it('cancels a streamed body as soon as it crosses the 4 MiB ceiling', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3 * 1024 * 1024))
        controller.enqueue(new Uint8Array(2 * 1024 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(/4 MiB read ceiling/)
    expect(cancelled).toBe(true)
  })

  it('preserves cancellation when an aborted response stream fails', async () => {
    const cancellation = new AbortController()
    cancellation.abort()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('aborted'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )
    await expect(fetchLiveModels('example-token', cancellation.signal)).rejects.toThrow(
      'Live model listing was cancelled',
    )
  })

  it('rejects an oversized content-length before reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('ignored', {
            status: 200,
            headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
          }),
      ),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(/4 MiB read ceiling/)
  })

  it('keeps the read ceiling when an oversized stream refuses to cancel', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3 * 1024 * 1024))
        controller.enqueue(new Uint8Array(2 * 1024 * 1024))
      },
      cancel() {
        throw new Error('cancel refused')
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(/4 MiB read ceiling/)
  })

  it('keeps the declared-length ceiling when the body refuses to cancel', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error('cancel refused')
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
          }),
      ),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(/4 MiB read ceiling/)
  })

  it('reports a stream that fails before any ceiling check', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('socket reset'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(
      'Grok Build model listing response could not be read',
    )
  })

  it('treats a bodyless response as an empty listing body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(/invalid JSON \(HTTP 204\)/)
  })

  it('reports an unreachable listing with the proxy hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(/unreachable/)
  })

  it('reports cancellation when the listing request fails on an aborted signal', async () => {
    const cancellation = new AbortController()
    cancellation.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('aborted')
      }),
    )
    await expect(fetchLiveModels('example-token', cancellation.signal)).rejects.toThrow(
      'Live model listing was cancelled',
    )
  })

  it('names the vendor error code a failed listing reported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'model_not_found' }), { status: 404 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(
      'Grok Build model listing failed (HTTP 404): model_not_found',
    )
  })

  it('omits the code when the failed listing body carries none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 500 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow('Grok Build model listing failed (HTTP 500)')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 503 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow('Grok Build model listing failed (HTTP 503)')
  })

  it('reports a successful listing that names no model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    )
    await expect(fetchLiveModels('example-token')).rejects.toThrow(
      'Grok Build model listing contained no model ids',
    )
  })
})

describe('fetchLiveModelIds', () => {
  it('projects the live listing onto its ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'grok-4.6' }, { id: 'grok-4.5' }, { id: 'grok-4.6' }] }), {
            status: 200,
          }),
      ),
    )
    await expect(fetchLiveModelIds('example-token')).resolves.toEqual(['grok-4.6', 'grok-4.5'])
  })
})

describe('asRouteModel', () => {
  it('keeps an already-routed model and moves any other provider onto the route', () => {
    const routed = catalog.find(model => model.id === DEFAULT_GROK_BUILD_MODEL)
    if (routed === undefined) throw new Error('baseline catalog lost its default model')
    expect(asRouteModel(routed)).toBe(routed)

    const foreign = { ...routed, provider: 'openai' }
    const moved = asRouteModel(foreign)
    expect(moved.provider).toBe(GROK_BUILD_ROUTE)
    expect(moved.id).toBe(routed.id)
    expect(moved.name).toBe(routed.name)
    expect(foreign.provider).toBe('openai')
  })
})

describe('preferredGrokBuildModelFrom', () => {
  it('prefers grok-4.6, then the first listed model', () => {
    expect(preferredGrokBuildModelFrom([{ id: 'grok-4.6' }, { id: 'grok-4.5' }])).toBe('grok-4.6')
    expect(preferredGrokBuildModelFrom([{ id: 'grok-4.5' }])).toBe('grok-4.5')
  })

  it('falls back to the default id when the account lists no model', () => {
    expect(preferredGrokBuildModelFrom([])).toBe(DEFAULT_GROK_BUILD_MODEL)
  })
})
