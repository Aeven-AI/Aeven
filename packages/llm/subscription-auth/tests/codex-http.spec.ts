import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  assertCodexBackendUrl,
  type CodexFetch,
  chatgptAccountIdFromAccessToken,
  chatgptPlanTypeFromAccessToken,
  codexAuthFromSession,
  createCodexHttpClient,
  parseRetryAfterMs,
  providerDetail,
} from '../src/codex-http.ts'

function jwtWithAccount(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

function jwtWithAuthClaim(claim: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': claim })).toString('base64url')
  return `${header}.${payload}.sig`
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** One stream read result; `value` may be explicitly undefined to pin that branch. */
type FakeReadResult = { done: boolean; value?: Uint8Array | undefined }

/** Response whose body is a hand-written reader, so read/cancel failures stay under test control. */
function streamResponse(reader: {
  read(): Promise<FakeReadResult>
  cancel(reason?: unknown): Promise<void>
}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: { getReader: () => reader },
  } as unknown as Response
}

/** Argument-less call sites assert the request fails before the network boundary. */
function mockFetch(impl: CodexFetch = async () => expect.unreachable('no request must be made')): Mock<CodexFetch> {
  return vi.fn(impl)
}

function mockFetchSequence(impls: CodexFetch[]): Mock<CodexFetch> {
  const queue = [...impls]
  return vi.fn(async (input: string, init?: RequestInit) => {
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected extra fetch')
    return next(input, init)
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('unexpected real network')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatgptAccountIdFromAccessToken', () => {
  it('returns the full JWT chatgpt_account_id claim without truncation', () => {
    const accountId = 'acct_full-account-id-does-not-get-sliced'
    expect(chatgptAccountIdFromAccessToken(jwtWithAccount(accountId))).toBe(accountId)
  })

  it('rejects a non-JWT or claim-less token', () => {
    expect(chatgptAccountIdFromAccessToken('not-a-jwt')).toBeUndefined()
    expect(chatgptAccountIdFromAccessToken(jwtWithAccount(''))).toBeUndefined()
  })

  it('ignores a token whose payload is not an object carrying an auth claim', () => {
    const encoded = (payload: string): string => `header.${Buffer.from(payload).toString('base64url')}.sig`
    expect(chatgptAccountIdFromAccessToken(encoded('[1,2,3]'))).toBeUndefined()
    expect(chatgptAccountIdFromAccessToken(encoded('"not-an-object"'))).toBeUndefined()
    expect(chatgptAccountIdFromAccessToken(encoded('{"https://api.openai.com/auth":"not-an-object"}'))).toBeUndefined()
    expect(chatgptAccountIdFromAccessToken('header.!!!.sig')).toBeUndefined()
  })
})

describe('chatgptPlanTypeFromAccessToken', () => {
  it('reads the chatgpt_plan_type claim when the token carries one', () => {
    expect(chatgptPlanTypeFromAccessToken(jwtWithAuthClaim({ chatgpt_plan_type: 'plus' }))).toBe('plus')
    expect(chatgptPlanTypeFromAccessToken(jwtWithAuthClaim({ chatgpt_account_id: 'acct' }))).toBeUndefined()
    expect(chatgptPlanTypeFromAccessToken('not-a-jwt')).toBeUndefined()
  })
})

describe('codexAuthFromSession', () => {
  it('reports no access when the wrapped session has no usable token', async () => {
    const missing = codexAuthFromSession({
      resolveAccessToken: async () => undefined,
      invalidateAccessToken: async () => {},
    })
    const blank = codexAuthFromSession({ resolveAccessToken: async () => '', invalidateAccessToken: async () => {} })
    await expect(missing.resolve()).resolves.toBeUndefined()
    await expect(blank.resolve()).resolves.toBeUndefined()
  })

  it('invalidates through the wrapped session', async () => {
    const session = {
      resolveAccessToken: async () => jwtWithAccount('acct-adapter'),
      invalidateAccessToken: vi.fn(async () => {}),
    }
    const auth = codexAuthFromSession(session)
    await expect(auth.resolve()).resolves.toEqual({ accessToken: jwtWithAccount('acct-adapter') })
    await auth.invalidate()
    expect(session.invalidateAccessToken).toHaveBeenCalledOnce()
  })
})

describe('assertCodexBackendUrl', () => {
  it('accepts only private chatgpt.com /backend-api URLs', () => {
    expect(assertCodexBackendUrl('https://chatgpt.com/backend-api/wham/usage').pathname).toBe(
      '/backend-api/wham/usage',
    )
    expect(() => assertCodexBackendUrl('https://api.openai.com/v1/images')).toThrow(/private ChatGPT backend/)
    expect(() => assertCodexBackendUrl('https://chatgpt.com/backend-api')).toThrow(/backend-api paths/)
    expect(() => assertCodexBackendUrl('http://chatgpt.com/backend-api/wham/usage')).toThrow(/private ChatGPT backend/)
  })

  it('rejects custom ports and userinfo', () => {
    expect(() => assertCodexBackendUrl('https://chatgpt.com:8443/backend-api/wham/usage')).toThrow(
      /private ChatGPT backend/,
    )
    expect(() => assertCodexBackendUrl('https://user:pass@chatgpt.com/backend-api/wham/usage')).toThrow(
      /private ChatGPT backend/,
    )
    expect(assertCodexBackendUrl('https://chatgpt.com:443/backend-api/wham/usage').hostname).toBe('chatgpt.com')
  })

  it('rejects a URL that cannot be parsed at all', () => {
    expect(() => assertCodexBackendUrl('not a url')).toThrow(/URL is invalid/)
  })
})

describe('providerDetail', () => {
  it('runs every provider body through safeMessage', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart'
    expect(providerDetail({ error: `expired ${jwt}` })).toBe('expired [redacted token]')
    expect(providerDetail(`Bearer secret-token ${jwt}`)).toBe('Bearer [redacted] [redacted token]')
  })

  it('returns undefined for a blank or non-object provider body', () => {
    expect(providerDetail('   ')).toBeUndefined()
    expect(providerDetail(42)).toBeUndefined()
    expect(providerDetail({ error: { code: 'bad_request' } })).toBeUndefined()
    expect(providerDetail({ error: { message: 7 } })).toBeUndefined()
  })

  it('prefers the nested error.message and falls back to the top-level message', () => {
    expect(providerDetail({ error: { message: 'nested detail' } })).toBe('nested detail')
    expect(providerDetail({ error: { code: 'x' }, message: 'top-level detail' })).toBe('top-level detail')
  })
})

describe('createCodexHttpClient', () => {
  it('sends Bearer plus the full JWT account claim', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }))
    const accessToken = jwtWithAccount('acct-from-jwt-full')
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken, accountId: 'truncated' }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    const [url, init = {}] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`)
    expect(headers.get('chatgpt-account-id')).toBe('acct-from-jwt-full')
    expect(init.redirect).toBe('error')
  })

  it('ignores caller Authorization, chatgpt-account-id, and Accept overrides', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }))
    const accessToken = jwtWithAccount('acct-locked')
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers: {
        Authorization: 'Bearer attacker',
        'chatgpt-account-id': 'attacker-acct',
        Accept: 'text/plain',
        'cache-control': 'no-store',
      },
    })
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`)
    expect(headers.get('chatgpt-account-id')).toBe('acct-locked')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('cache-control')).toBe('no-store')
  })

  it('invalidates and refreshes exactly once on 401', async () => {
    const first = jwtWithAccount('acct-old')
    const second = jwtWithAccount('acct-new')
    let token = first
    const invalidate = vi.fn(async () => {
      token = second
    })
    const fetchImpl = mockFetchSequence([
      async () => jsonResponse(401, { error: 'expired' }),
      async () => jsonResponse(200, { ok: true }),
    ])
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: token }),
        invalidate,
      },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const secondHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers)
    expect(secondHeaders.get('chatgpt-account-id')).toBe('acct-new')
  })

  it('maps a retried 401 5xx through the bounded server retry budget', async () => {
    const fetchImpl = mockFetchSequence([
      async () => jsonResponse(401, { error: 'expired' }),
      async () => jsonResponse(503, { error: 'busy' }),
      async () => jsonResponse(200, { ok: true }),
    ])
    const sleep = vi.fn(async () => {})
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep,
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('maps a retried 401 transport failure through the bounded transport budget', async () => {
    const fetchImpl = mockFetchSequence([
      async () => jsonResponse(401, { error: 'expired' }),
      async () => {
        throw new Error('socket reset')
      },
      async () => jsonResponse(200, { ok: true }),
    ])
    const sleep = vi.fn(async () => {})
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep,
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('redacts provider bodies on the post-refresh 401 AUTH error', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepart'
    const fetchImpl = mockFetchSequence([
      async () => jsonResponse(401, { error: 'expired' }),
      async () => jsonResponse(401, { error: `still bad ${jwt}` }),
    ])
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('second 401 must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('AUTH')
        expect((error as Error).message).toContain('[redacted token]')
        expect((error as Error).message).not.toContain(jwt)
      },
    )
  })

  it('rejects a Content-Length above maxBytes without reading the body', async () => {
    const cancel = vi.fn(async () => {})
    const fetchImpl = mockFetch(async () => {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json', 'content-length': '999999' }),
        body: {
          getReader() {
            throw new Error('body must not be read when Content-Length exceeds maxBytes')
          },
          cancel,
        },
      }
      return response as unknown as Response
    })
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(
      client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', maxBytes: 16 }),
    ).rejects.toMatchObject({ code: 'SERVER' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('enforces a running maxBytes cap while streaming the body', async () => {
    const fetchImpl = mockFetch(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"pad":"'))
          controller.enqueue(new TextEncoder().encode('x'.repeat(64)))
          controller.enqueue(new TextEncoder().encode('"}'))
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(
      client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', maxBytes: 16 }),
    ).rejects.toMatchObject({ code: 'SERVER' })
  })

  it('cancels a streaming reader when the caller aborts mid-body', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Leave the first read pending until the AbortSignal cancels it.
      },
      cancel(reason) {
        cancel(reason)
      },
    })
    const fetchImpl = mockFetch(
      async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
    })
    const controller = new AbortController()
    const pending = client.requestJson({
      url: 'https://chatgpt.com/backend-api/wham/usage',
      signal: controller.signal,
    })
    await vi.waitFor(() =>{  expect(fetchImpl).toHaveBeenCalledOnce() })
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('enforces a per-attempt wall-clock timeout at the fetch boundary', async () => {
    const fetchImpl = mockFetch(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!(signal instanceof AbortSignal)) throw new Error('missing timeout signal')
          const onAbort = (): void =>{  reject(new DOMException('timed out', 'AbortError')) }
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }),
    )
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      requestTimeoutMs: 5,
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('maps 403 to QUOTA without retrying', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(403, { error: 'not entitled' }))
    const invalidate = vi.fn(async () => {})
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate,
      },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('403 must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('QUOTA')
        expect((error as { failure?: { status?: number } }).failure?.status).toBe(403)
        expect((error as Error).message).toMatch(/cannot use this Codex capability/)
      },
    )
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('maps 429 to RATE_LIMIT and parses Retry-After', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(429, { message: 'slow down' }, { 'retry-after': '12' }))
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('429 must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('RATE_LIMIT')
        expect((error as { failure?: { providerRetryAfterMs?: number } }).failure?.providerRetryAfterMs).toBe(12_000)
      },
    )
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('retries limited 5xx then succeeds', async () => {
    const fetchImpl = mockFetchSequence([
      async () => jsonResponse(503, { error: 'busy' }),
      async () => jsonResponse(502, { error: 'bad gateway' }),
      async () => jsonResponse(200, { ok: true }),
    ])
    const sleep = vi.fn(async () => {})
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep,
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after the limited 5xx budget', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(500, { error: 'down' }))
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
      maxServerRetries: 2,
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).rejects.toMatchObject({
      code: 'SERVER',
      failure: { status: 500 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('adapts an OAuthProviderSession-shaped resolver', async () => {
    const session = {
      resolveAccessToken: vi.fn(async () => jwtWithAccount('from-session')),
      invalidateAccessToken: vi.fn(async () => {}),
    }
    const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }))
    const client = createCodexHttpClient({ auth: codexAuthFromSession(session), fetchImpl, sleep: async () => {} })
    await client.requestJson({
      url: 'https://chatgpt.com/backend-api/codex/alpha/search',
      method: 'POST',
      body: { q: 'x' },
    })
    expect(session.resolveAccessToken).toHaveBeenCalledOnce()
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('chatgpt-account-id')).toBe('from-session')
  })

  it('reports a failed sign-in refresh as a missing credential', async () => {
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => {
          throw new Error('refresh endpoint unavailable')
        },
        invalidate: async () => {},
      },
      fetchImpl: mockFetch(),
      sleep: async () => {},
    })
    await client.resolveAccess().then(
      () => expect.unreachable('a failed refresh must not resolve'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('MISSING_CREDENTIAL')
        expect((error as Error).message).toMatch(/could not refresh its sign-in/)
      },
    )
  })

  it('requires a non-empty access token before any request', async () => {
    const none = createCodexHttpClient({
      auth: { resolve: async () => undefined, invalidate: async () => {} },
      fetchImpl: mockFetch(),
      sleep: async () => {},
    })
    const blank = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: '   ' }), invalidate: async () => {} },
      fetchImpl: mockFetch(),
      sleep: async () => {},
    })
    await expect(none.resolveAccess()).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await expect(blank.resolveAccess()).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('falls back to the resolved account id when the token carries no claim', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const bare = `${header}.${Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url')}.sig`
    const client = createCodexHttpClient({
      auth: {
        resolve: async () => ({ accessToken: bare, accountId: 'acct-from-resolver' }),
        invalidate: async () => {},
      },
      fetchImpl: mockFetch(),
      sleep: async () => {},
    })
    await expect(client.resolveAccess()).resolves.toEqual({ accessToken: bare, accountId: 'acct-from-resolver' })
  })

  it('rejects a token with neither an account claim nor a resolved account id', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const bare = `${header}.${Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url')}.sig`
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: bare }), invalidate: async () => {} },
      fetchImpl: mockFetch(),
      sleep: async () => {},
    })
    await client.resolveAccess().then(
      () => expect.unreachable('an account-less token must not resolve'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('INVALID_CREDENTIAL')
      },
    )
  })

  it('treats a bodyless 200 response as an empty JSON object', async () => {
    const fetchImpl = mockFetch(async () => new Response(null, { status: 200 }))
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-empty') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({})
  })

  it('maps an unprocessable JSON body to SERVER', async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response('<html>gateway</html>', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-json') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('invalid JSON must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('SERVER')
        expect((error as Error).message).toMatch(/unprocessable JSON response/)
      },
    )
  })

  it('skips an undefined stream value and still rejects an oversized body', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed')
    })
    const reads: FakeReadResult[] = [
      { done: false, value: undefined },
      { done: false, value: new Uint8Array(64) },
      { done: true },
    ]
    const fetchImpl = mockFetch(async () =>
      streamResponse({ read: async () => reads.shift() ?? { done: true }, cancel }),
    )
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-stream') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(
      client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', maxBytes: 16 }),
    ).rejects.toMatchObject({ code: 'SERVER' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('maps an unexpected body-stream failure to TRANSPORT', async () => {
    const fetchImpl = mockFetch(async () =>
      streamResponse({
        read: async () => {
          throw new Error('stream broke')
        },
        cancel: async () => {},
      }),
    )
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-stream') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('a broken stream must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('TRANSPORT')
        expect((error as Error).message).toMatch(/could not be read \(stream broke\)/)
      },
    )
  })

  it('maps an AbortError-shaped body-stream failure to TIMEOUT', async () => {
    const fetchImpl = mockFetch(async () =>
      streamResponse({
        read: async () => {
          const failure = new Error('reader aborted')
          failure.name = 'AbortError'
          throw failure
        },
        cancel: async () => {},
      }),
    )
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-stream') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
  })

  it('maps a DOMException body-stream failure according to its name', async () => {
    const failing = (failure: DOMException) =>
      createCodexHttpClient({
        auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-stream') }), invalidate: async () => {} },
        fetchImpl: mockFetch(async () =>
          streamResponse({
            read: async () => {
              throw failure
            },
            cancel: async () => {},
          }),
        ),
        sleep: async () => {},
      })
    await expect(
      failing(new DOMException('reader aborted', 'AbortError')).requestJson({
        url: 'https://chatgpt.com/backend-api/wham/usage',
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(
      failing(new DOMException('reader failed', 'NotSupportedError')).requestJson({
        url: 'https://chatgpt.com/backend-api/wham/usage',
      }),
    ).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('cancels a body reader that is aborted before the first read', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed')
    })
    const fetchImpl = mockFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => {
              if (name === 'content-length') controller.abort(new Error('stop'))
              return null
            },
          },
          body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), cancel }) },
        }) as unknown as Response,
    )
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-abort') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(
      client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('uses the built-in backoff when no sleep is injected', async () => {
    const fetchImpl = mockFetchSequence([
      async () => jsonResponse(503, { error: 'busy' }),
      async () => jsonResponse(200, { ok: true }),
    ])
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-backoff') }), invalidate: async () => {} },
      fetchImpl,
      maxServerRetries: 1,
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts the built-in backoff wait when the caller aborts', async () => {
    const controller = new AbortController()
    const fetchImpl = mockFetch(async () => {
      setTimeout(() => {
        controller.abort(new Error('stop'))
      }, 0)
      return jsonResponse(503, { error: 'busy' })
    })
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-backoff') }), invalidate: async () => {} },
      fetchImpl,
      maxServerRetries: 2,
    })
    await expect(
      client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('fails immediately when the caller aborts while a 5xx response is processed', async () => {
    const controller = new AbortController()
    const json = new TextEncoder().encode('{"error":"busy"}')
    const body = {
      getReader: () => {
        let reads = 0
        return {
          read: async (): Promise<FakeReadResult> => {
            reads += 1
            if (reads === 1) return { done: false, value: json }
            // Two microtask hops land the abort after the body read completed but
            // before the client waits out its 5xx backoff.
            queueMicrotask(() => {
              queueMicrotask(() => {
                controller.abort(new Error('stop'))
              })
            })
            return { done: true }
          },
          cancel: async () => {},
        }
      },
    }
    const fetchImpl = mockFetch(
      async () => ({ ok: false, status: 503, headers: new Headers(), body }) as unknown as Response,
    )
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-backoff') }), invalidate: async () => {} },
      fetchImpl,
      maxServerRetries: 2,
    })
    await expect(
      client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('falls back to the global fetch when none is injected', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchImpl)
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-global') }), invalidate: async () => {} },
      sleep: async () => {},
    })
    await expect(client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })).resolves.toEqual({
      ok: true,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a non-positive request timeout', () => {
    const auth = { resolve: async () => undefined, invalidate: async () => {} }
    expect(() => createCodexHttpClient({ auth, fetchImpl: mockFetch(), requestTimeoutMs: 0 })).toThrow(TypeError)
    expect(() => createCodexHttpClient({ auth, fetchImpl: mockFetch(), requestTimeoutMs: 1.5 })).toThrow(
      /positive safe integer/,
    )
  })

  it('infers GET without a body and POST with one when no method is given', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { ok: true }))
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-method') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage', body: { q: 'x' } })
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('POST')
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('content-type')).toBe('application/json')
  })

  it('reports a non-Error fetch rejection as a transport failure', async () => {
    const fetchImpl = mockFetch(async () => {
      throw 'socket exploded'
    })
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-transport') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('a failed fetch must not resolve'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('TRANSPORT')
        expect((error as Error).message).toMatch(/socket exploded/)
      },
    )
  })

  it('omits the provider detail suffix and Retry-After when the 429 body carries none', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(429, {}))
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-rate') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('429 must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('RATE_LIMIT')
        expect((error as Error).message).toBe('Codex rate limit reached (HTTP 429)')
        expect(
          (error as { failure?: { providerRetryAfterMs?: number } }).failure?.providerRetryAfterMs,
        ).toBeUndefined()
      },
    )
  })

  it('maps each rejected-request status onto INVALID_ARGS', async () => {
    for (const status of [400, 404, 409, 422]) {
      const fetchImpl = mockFetch(async () => jsonResponse(status, { error: 'bad request shape' }))
      const client = createCodexHttpClient({
        auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-4xx') }), invalidate: async () => {} },
        fetchImpl,
        sleep: async () => {},
      })
      await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
        () => expect.unreachable('a rejected request must fail'),
        (error: unknown) => {
          expect((error as { code?: string }).code).toBe('INVALID_ARGS')
          expect((error as { failure?: { status?: number } }).failure?.status).toBe(status)
          expect((error as Error).message).toMatch(/rejected the request .*: bad request shape/)
        },
      )
      expect(fetchImpl).toHaveBeenCalledOnce()
    }
  })

  it('maps an unlisted client-error status onto SERVER', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(418, { error: 'teapot' }))
    const client = createCodexHttpClient({
      auth: { resolve: async () => ({ accessToken: jwtWithAccount('acct-418') }), invalidate: async () => {} },
      fetchImpl,
      sleep: async () => {},
    })
    await client.requestJson({ url: 'https://chatgpt.com/backend-api/wham/usage' }).then(
      () => expect.unreachable('418 must fail'),
      (error: unknown) => {
        expect((error as { code?: string }).code).toBe('SERVER')
        expect((error as { failure?: { status?: number } }).failure?.status).toBe(418)
        expect((error as Error).message).toBe('Codex backend request failed (HTTP 418): teapot')
      },
    )
  })
})

describe('parseRetryAfterMs', () => {
  it('accepts delta-seconds and future HTTP dates', () => {
    expect(parseRetryAfterMs('7', () => 0)).toBe(7000)
    expect(parseRetryAfterMs('0', () => 0)).toBeUndefined()
    const parsed = parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', () =>
      Date.parse('Wed, 21 Oct 2015 07:27:00 GMT'),
    )
    expect(parsed).toBe(60_000)
  })

  it('ignores an unparseable value and a Retry-After already in the past', () => {
    expect(parseRetryAfterMs('soon', () => 0)).toBeUndefined()
    expect(
      parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', () => Date.parse('Wed, 21 Oct 2015 07:29:00 GMT')),
    ).toBeUndefined()
    expect(parseRetryAfterMs('7', () => 0)).toBe(7000)
  })
})
