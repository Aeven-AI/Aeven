import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { CodexFetch } from '../src/codex-http.ts'
import {
  citeableHttpUrl,
  createCodexSearchProvider,
  externalWebAccess,
  mapCodexSearchResponse,
} from '../src/codex-search.ts'

function jwtWithAccount(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockFetch(impl?: CodexFetch): Mock<CodexFetch> {
  return impl === undefined ? vi.fn<CodexFetch>() : vi.fn(impl)
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('unexpected real network')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('externalWebAccess', () => {
  it('maps only the verified live/cached/indexed values', () => {
    expect(externalWebAccess('live')).toBe(true)
    expect(externalWebAccess('cached')).toBe(false)
    expect(externalWebAccess('indexed')).toBe('indexed')
  })
})

describe('citeableHttpUrl', () => {
  it('accepts only http(s) URLs without credentials', () => {
    expect(citeableHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(citeableHttpUrl('http://example.com/a')).toBe('http://example.com/a')
    expect(citeableHttpUrl('')).toBeUndefined()
    expect(citeableHttpUrl(42)).toBeUndefined()
    expect(citeableHttpUrl('mailto:someone@example.com')).toBeUndefined()
    expect(citeableHttpUrl('https://user:secret@example.com/a')).toBeUndefined()
    expect(citeableHttpUrl('not-a-url')).toBeUndefined()
  })
})

describe('mapCodexSearchResponse', () => {
  it('keeps de-duplicated http(s) text_result URLs and ignores other types', () => {
    const mapped = mapCodexSearchResponse({
      output: 'summary',
      results: [
        { type: 'text_result', url: 'https://example.com/a', title: 'A', snippet: 'one' },
        { type: 'image_result', url: 'https://example.com/img' },
        { type: 'text_result', url: 'ftp://example.com/bad' },
        { type: 'text_result', url: 'https://example.com/a' },
        { type: 'text_result', url: 'https://example.com/b' },
        { type: 'unknown_future_result', url: 'https://example.com/future' },
        { type: 'text_result', url: 'not-a-url' },
      ],
    })
    expect(mapped).toEqual({
      content: 'summary',
      truncated: false,
      sources: [{ url: 'https://example.com/a', title: 'A', snippet: 'one' }, { url: 'https://example.com/b' }],
    })
  })

  it('honours maxResults without inventing titles', () => {
    const mapped = mapCodexSearchResponse(
      {
        output: '',
        results: [
          { type: 'text_result', url: 'https://example.com/1' },
          { type: 'text_result', url: 'https://example.com/2' },
        ],
      },
      1,
    )
    expect(mapped.content).toBeUndefined()
    expect(mapped.sources).toEqual([{ url: 'https://example.com/1' }])
    expect(mapped.truncated).toBe(true)
  })

  it('rejects invalid maxResults instead of treating them as unlimited', () => {
    const payload = {
      output: 'x',
      results: [
        { type: 'text_result', url: 'https://example.com/1' },
        { type: 'text_result', url: 'https://example.com/2' },
      ],
    }
    expect(() => mapCodexSearchResponse(payload, 0)).toThrow(/maxResults/)
    expect(() => mapCodexSearchResponse(payload, -1)).toThrow(/maxResults/)
    expect(() => mapCodexSearchResponse(payload, Number.POSITIVE_INFINITY)).toThrow(/maxResults/)
    expect(() => mapCodexSearchResponse(payload, Number.NaN)).toThrow(/maxResults/)
  })

  it('keeps an absent results list and rejects a malformed envelope', () => {
    expect(mapCodexSearchResponse({ output: 'x' })).toEqual({ content: 'x', sources: [], truncated: false })
    expect(() => mapCodexSearchResponse(null)).toThrow(/without string output/)
    expect(() => mapCodexSearchResponse({ output: 42 })).toThrow(/without string output/)
    expect(() => mapCodexSearchResponse({ output: 'x', results: 'nope' })).toThrow(/non-array results/)
  })
})

describe('createCodexSearchProvider', () => {
  it('POSTs the verified search body with injected auth', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        output: 'ok',
        results: [{ type: 'text_result', url: 'https://example.com/doc' }],
      }),
    )
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-search') }),
        invalidate: async () => {},
      },
      fetchImpl,
      model: 'gpt-5.4',
      mode: 'indexed',
      contextSize: 'high',
      maxOutputTokens: 512,
      resolveRequestId: () => 'req-1',
      sleep: async () => {},
    })
    expect(provider.id).toBe('codex-oauth-search')
    expect(provider.available()).toBe(true)
    const result = await provider.search({ query: 'dsh plugin' })
    expect(result.sources.map(source => source.url)).toEqual(['https://example.com/doc'])
    const [url, init = {}] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://chatgpt.com/backend-api/codex/alpha/search')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      id: 'req-1',
      model: 'gpt-5.4',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'dsh plugin' }] }],
      commands: { search_query: [{ q: 'dsh plugin' }] },
      settings: {
        search_context_size: 'high',
        allowed_callers: ['direct'],
        external_web_access: 'indexed',
      },
      max_output_tokens: 512,
    })
    expect(new Headers(init.headers).get('chatgpt-account-id')).toBe('acct-search')
  })

  it('resolves the visible model at call time after catalog or login changes', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { output: 'ok', results: [] }))
    let model = ''
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-live-model') }),
        invalidate: async () => {},
      },
      fetchImpl,
      model: () => model,
      resolveRequestId: () => 'req-live',
    })
    expect(provider.available()).toBe(false)
    model = 'gpt-5.4-live'
    expect(provider.available()).toBe(true)
    await provider.search({ query: 'dsh' })
    const [, init = {}] = fetchImpl.mock.calls[0] ?? []
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-5.4-live' })
  })

  it('rejects an empty query without calling the network', async () => {
    const fetchImpl = mockFetch()
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      model: 'gpt-5.4',
    })
    await expect(provider.search({ query: '   ' })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects invalid maxResults before calling the network', async () => {
    const fetchImpl = mockFetch()
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      model: 'gpt-5.4',
    })
    await expect(provider.search({ query: 'dsh', maxResults: 0 })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(provider.search({ query: 'dsh', maxResults: Number.NaN })).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('generates a request id and defaults to live/medium settings', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { output: 'ok', results: [] }))
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-search') }),
        invalidate: async () => {},
      },
      fetchImpl,
      model: 'gpt-5.4',
      originator: 'dsh-search-test',
      userAgent: 'dsh-search-test',
      sleep: async () => {},
    })
    await expect(provider.search({ query: 'dsh' })).resolves.toEqual({ content: 'ok', sources: [], truncated: false })
    const [, init = {}] = fetchImpl.mock.calls[0] ?? []
    const body = JSON.parse(init.body as string) as {
      id: string
      settings: Record<string, unknown>
      max_output_tokens: number
    }
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
    expect(body.settings).toEqual({
      search_context_size: 'medium',
      allowed_callers: ['direct'],
      external_web_access: true,
    })
    expect(body.max_output_tokens).toBe(1024)
    const headers = new Headers(init.headers)
    expect(headers.get('originator')).toBe('dsh-search-test')
    expect(headers.get('user-agent')).toBe('dsh-search-test')

    const aborted = new AbortController()
    aborted.abort()
    await expect(provider.search({ query: 'dsh' }, aborted.signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('defaults to the global fetch when none is injected', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { output: 'ok', results: [] }))
    vi.stubGlobal('fetch', fetchImpl)
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-search') }),
        invalidate: async () => {},
      },
      model: 'gpt-5.4',
    })
    await expect(provider.search({ query: 'dsh' })).resolves.toEqual({ content: 'ok', sources: [], truncated: false })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('refuses to search while the visible model is unset', async () => {
    const fetchImpl = mockFetch()
    const provider = createCodexSearchProvider({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-search') }),
        invalidate: async () => {},
      },
      fetchImpl,
      model: '   ',
    })
    expect(provider.available()).toBe(false)
    await expect(provider.search({ query: 'dsh' })).rejects.toThrow(/not configured/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses to search without a positive integer output-token budget', async () => {
    const fetchImpl = mockFetch()
    for (const maxOutputTokens of [0, 1.5]) {
      const provider = createCodexSearchProvider({
        auth: {
          resolve: async () => ({ accessToken: jwtWithAccount('acct-search') }),
          invalidate: async () => {},
        },
        fetchImpl,
        model: 'gpt-5.4',
        maxOutputTokens,
      })
      expect(provider.available()).toBe(false)
      await expect(provider.search({ query: 'dsh' })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
