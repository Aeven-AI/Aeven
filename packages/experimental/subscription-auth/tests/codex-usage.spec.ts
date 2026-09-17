import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { CodexFetch } from '../src/codex-http.ts'
import { CODEX_USAGE_URL, createCodexUsageReader, normalizeCodexUsage } from '../src/codex-usage.ts'

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

function mockFetch(impl: CodexFetch): Mock<CodexFetch> {
  return vi.fn(impl)
}

function usageBody(usedPercent: number): unknown {
  return { rate_limit: { primary_window: { used_percent: usedPercent, limit_window_seconds: 18_000 } } }
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('unexpected real network')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeCodexUsage', () => {
  it('keeps valid windows and skips malformed optional buckets', () => {
    const usage = normalizeCodexUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_at: 1_700_000_100 },
          secondary_window: { used_percent: 200, limit_window_seconds: 604_800 },
        },
        additional_rate_limits: [
          {
            metered_feature: 'spark',
            limit_name: 'Spark',
            rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604_800 } },
          },
          { metered_feature: '', rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 60 } } },
          'nope',
        ],
        credits: { has_credits: true, unlimited: false, balance: '12.50' },
        spend_control: {
          reached: false,
          individual_limit: { limit: '100', used: '20', remaining: '80', remaining_percent: 80 },
        },
        rate_limit_reset_credits: { available_count: 2 },
        unexpected: { secret: 'ignore' },
      },
      1_700_000_000,
    )
    expect(usage.fetchedAt).toBe(1_700_000_000)
    expect(usage.rateLimits).toEqual([
      {
        id: 'codex',
        name: 'Codex',
        windows: [{ usedPercent: 25, remainingPercent: 75, windowSeconds: 18_000, resetsAt: 1_700_000_100 }],
      },
      {
        id: 'spark',
        name: 'Spark',
        windows: [{ usedPercent: 10, remainingPercent: 90, windowSeconds: 604_800 }],
      },
    ])
    expect(usage.credits).toEqual({ unlimited: false, balance: '12.50' })
    expect(usage.individualLimit).toEqual({ limit: '100', used: '20', remaining: '80', remainingPercent: 80 })
    expect(usage.spendControlReached).toBe(false)
    expect(usage.resetCredits).toEqual({ availableCount: 2 })
  })

  it('keeps an account without purchased credits as a zero balance', () => {
    const usage = normalizeCodexUsage({ credits: { has_credits: false, unlimited: false, balance: null } })
    expect(usage.credits).toEqual({ unlimited: false })
  })

  it('returns empty rate limits for an object without usable windows', () => {
    expect(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 'nope' } } }).rateLimits).toEqual([])
  })

  it('drops unparseable optional values instead of inventing them', () => {
    const usage = normalizeCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_at: 'whenever' },
      },
      additional_rate_limits: [
        {
          metered_feature: 'spark',
          rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604_800 } },
        },
      ],
      credits: { has_credits: true, unlimited: false, balance: 'not-a-number' },
      spend_control: {
        reached: false,
        individual_limit: {
          limit: '100',
          used: '20',
          remaining_percent: 80,
          reset_at: 1_700_000_500,
        },
      },
    })
    expect(usage.rateLimits).toEqual([
      {
        id: 'codex',
        name: 'Codex',
        windows: [{ usedPercent: 25, remainingPercent: 75, windowSeconds: 18_000 }],
      },
      { id: 'spark', windows: [{ usedPercent: 10, remainingPercent: 90, windowSeconds: 604_800 }] },
    ])
    expect(usage.credits).toEqual({ unlimited: false })
    expect(usage.individualLimit).toEqual({
      limit: '100',
      used: '20',
      remainingPercent: 80,
      resetsAt: 1_700_000_500,
    })
  })

  it('skips a spend control without a usable individual limit', () => {
    expect(normalizeCodexUsage({ spend_control: { reached: true, individual_limit: 'nope' } })).toMatchObject({
      rateLimits: [],
      spendControlReached: true,
    })
    expect(
      normalizeCodexUsage({ spend_control: { individual_limit: { limit: '100', remaining_percent: 50 } } }),
    ).toEqual({ rateLimits: [], fetchedAt: expect.any(Number) as number })
  })

  it('throws on a payload that is not an object', () => {
    expect(() => normalizeCodexUsage(42)).toThrow(/malformed usage response/)
    expect(() => normalizeCodexUsage(null)).toThrow(/malformed usage response/)
  })
})

describe('createCodexUsageReader', () => {
  it('GETs wham/usage and caches the normalized projection', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, usageBody(40)))
    let now = 1_000
    const reader = createCodexUsageReader({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-usage') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
      now: () => now,
      ttlMs: 60_000,
    })
    const first = await reader.read()
    now = 2_000
    const second = await reader.read()
    expect(first.rateLimits[0]?.windows[0]?.remainingPercent).toBe(60)
    expect(second.rateLimits[0]?.windows[0]?.remainingPercent).toBe(60)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(CODEX_USAGE_URL)
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('GET')
    now = 3_000
    await reader.read({ force: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not let force=true piggyback on a stale in-flight read', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const fetchImpl = mockFetch(async () => {
      if (resolveFirst === undefined) {
        return await new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return jsonResponse(200, usageBody(90))
    })
    const reader = createCodexUsageReader({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-usage') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
      now: () => 1_000,
      ttlMs: 60_000,
    })
    const first = reader.read()
    await vi.waitFor(() => {
      expect(resolveFirst).toBeDefined()
    })
    const forced = reader.read({ force: true })
    resolveFirst?.(jsonResponse(200, usageBody(10)))
    const [staleInFlight, forcedResult] = await Promise.all([first, forced])
    expect(staleInFlight.rateLimits[0]?.windows[0]?.usedPercent).toBe(10)
    expect(forcedResult.rateLimits[0]?.windows[0]?.usedPercent).toBe(90)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const cached = await reader.read()
    expect(cached.rateLimits[0]?.windows[0]?.usedPercent).toBe(90)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('clear() drops the cache and prevents an in-flight read from repopulating it', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const fetchImpl = mockFetch(async () => {
      if (resolveFirst === undefined) {
        return await new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return jsonResponse(200, usageBody(55))
    })
    let now = 1_000
    const reader = createCodexUsageReader({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-usage') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
      now: () => now,
      ttlMs: 60_000,
    })
    const first = reader.read()
    await vi.waitFor(() => {
      expect(resolveFirst).toBeDefined()
    })
    reader.clear()
    resolveFirst?.(jsonResponse(200, usageBody(10)))
    await expect(first).resolves.toMatchObject({
      rateLimits: [{ windows: [{ usedPercent: 10 }] }],
    })
    now = 2_000
    const afterClear = await reader.read()
    expect(afterClear.rateLimits[0]?.windows[0]?.usedPercent).toBe(55)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight GET between concurrent non-force readers', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const fetchImpl = mockFetch(async () => {
      if (resolveFirst === undefined) {
        return await new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return jsonResponse(200, usageBody(70))
    })
    const reader = createCodexUsageReader({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-usage') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
      now: () => 1_000,
      ttlMs: 60_000,
    })
    const first = reader.read()
    await vi.waitFor(() => {
      expect(resolveFirst).toBeDefined()
    })
    const second = reader.read()
    resolveFirst?.(jsonResponse(200, usageBody(70)))
    const [a, b] = await Promise.all([first, second])
    expect(a.rateLimits[0]?.windows[0]?.usedPercent).toBe(70)
    expect(b.rateLimits[0]?.windows[0]?.usedPercent).toBe(70)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('forwards the caller abort signal into the usage GET', async () => {
    const fetchImpl = mockFetch(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!(signal instanceof AbortSignal)) throw new Error('missing request signal')
          const onAbort = (): void => {
            reject(new DOMException('aborted', 'AbortError'))
          }
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }),
    )
    const reader = createCodexUsageReader({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-usage') }),
        invalidate: async () => {},
      },
      fetchImpl,
      sleep: async () => {},
      now: () => 1_000,
      ttlMs: 60_000,
    })
    const controller = new AbortController()
    const pending = reader.read({ signal: controller.signal })
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledOnce()
    })
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('defaults to global fetch, the system clock and the default TTL', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, usageBody(30)))
    vi.stubGlobal('fetch', fetchImpl)
    const reader = createCodexUsageReader({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-usage') }),
        invalidate: async () => {},
      },
      originator: 'avn-usage-test',
      userAgent: 'avn-usage-test',
    })
    const first = await reader.read()
    const second = await reader.read()
    expect(first.rateLimits[0]?.windows[0]?.usedPercent).toBe(30)
    expect(second.fetchedAt).toBe(first.fetchedAt)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(headers.get('originator')).toBe('avn-usage-test')
    expect(headers.get('user-agent')).toBe('avn-usage-test')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(CODEX_USAGE_URL)
  })
})
