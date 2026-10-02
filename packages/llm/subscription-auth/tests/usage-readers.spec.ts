/**
 * Per-provider usage readers, with the free-tier answers as the main subject.
 *
 * A free plan is the case most likely to be mishandled, because each provider
 * expresses it differently: Codex refuses outright, and Grok still meters a
 * capped allowance. Each is asserted here so
 * the card cannot silently collapse them into "no data".
 */

import { LlmError } from '@aeven/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexUsage } from '../src/codex-usage.ts'
import { codexUsageToProviderUsage, createCodexProviderUsageReader } from '../src/codex-usage-adapter.ts'
import { createGrokUsageReader, isQualifyingGrokTier, normalizeGrokUsage } from '../src/grok-usage.ts'
import { createUsageReader } from '../src/usage-reader.ts'
import { type UsageHttpOptions, UsageHttpError, usageGetJson } from '../src/usage-http.ts'
import type { ProviderUsage } from '../src/usage-view.ts'
import { epochSecondsFromRfc3339, noSubscriptionUsage, remainingFromUsed } from '../src/usage-view.ts'

const NOW = 1_800_000_000_000

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A Codex access JWT carrying only the plan claim the usage card labels from. */
function jwtWithPlan(planType: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: planType } }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

/** A fetch stub answering by URL substring, so request order stays free. */
function fetchStub(routes: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (input: string, _init?: RequestInit) => {
    const match = Object.keys(routes).find(key => input.includes(key))
    if (match === undefined) throw new Error(`unexpected request: ${input}`)
    const route = routes[match]
    const status = route?.status ?? 200
    return new Response(JSON.stringify(route?.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function tokenSeam() {
  return { resolveToken: async () => 'token', invalidateToken: async () => undefined }
}

describe('shared usage projection', () => {
  it('floors remaining so a nearly-exhausted window never reads as zero', () => {
    expect(remainingFromUsed(99.994)).toBe(1)
    expect(remainingFromUsed(0)).toBe(100)
    expect(remainingFromUsed(100)).toBe(0)
    // Out-of-range and non-finite input clamps rather than propagating NaN.
    expect(remainingFromUsed(140)).toBe(0)
    expect(remainingFromUsed(Number.NaN)).toBe(0)
  })

  it('converts RFC 3339 resets to epoch seconds and rejects unusable values', () => {
    expect(epochSecondsFromRfc3339('2026-09-15T11:26:00Z')).toBe(Math.floor(Date.parse('2026-09-15T11:26:00Z') / 1000))
    expect(epochSecondsFromRfc3339('not a date')).toBeUndefined()
    expect(epochSecondsFromRfc3339(undefined)).toBeUndefined()
  })

  it('treats an instant at or before the epoch as unusable rather than as a reset', () => {
    expect(epochSecondsFromRfc3339('1970-01-01T00:00:00Z')).toBeUndefined()
    expect(epochSecondsFromRfc3339('1969-12-31T23:59:59Z')).toBeUndefined()
  })

  it('omits the tier key when the provider named no plan', () => {
    const usage = noSubscriptionUsage(NOW)
    expect(usage).toEqual({ entitlement: 'no-subscription', windows: [], fetchedAt: NOW })
    expect('tier' in usage).toBe(false)
  })
})

describe('usage http transport', () => {
  const ORIGIN = 'https://api.anthropic.com'
  const USAGE_URL = `${ORIGIN}/api/oauth/usage`

  /** One usage GET's options, with the token seam already answered. */
  function httpOptions(overrides: Partial<UsageHttpOptions> = {}): UsageHttpOptions {
    return {
      origin: ORIGIN,
      resolveToken: async () => 'token',
      invalidateToken: async () => undefined,
      ...overrides,
    }
  }

  it('refuses a URL that is not an absolute URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await expect(usageGetJson('not a url', {}, httpOptions({ fetchImpl }))).rejects.toThrow('usage URL is invalid')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a URL outside the configured origin before any request', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const outside = httpOptions({ fetchImpl })

    await expect(usageGetJson('https://evil.example.com/api/oauth/usage', {}, outside)).rejects.toThrow(
      `usage requests may only reach ${ORIGIN}`,
    )
    // A downgrade to plaintext is refused by the same rule.
    await expect(usageGetJson('http://api.anthropic.com/api/oauth/usage', {}, outside)).rejects.toThrow(
      `usage requests may only reach ${ORIGIN}`,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back to the global fetch when no transport is injected', async () => {
    const requested: string[] = []
    const globalFetch = vi.fn(async (input: string) => {
      requested.push(input)
      return new Response('{"windows":2}', { status: 200 })
    })
    vi.stubGlobal('fetch', globalFetch)

    const result = await usageGetJson(USAGE_URL, {}, httpOptions())

    expect(result).toEqual({ kind: 'ok', body: { windows: 2 } })
    expect(globalFetch).toHaveBeenCalledTimes(1)
    // The document was fetched from the URL the caller asked for, through the global fetch.
    expect(requested).toEqual([USAGE_URL])
  })

  it('answers an absent token as unauthorized instead of requesting', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const result = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl, resolveToken: async () => undefined }))
    expect(result).toEqual({ kind: 'unauthorized' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads a bodyless or blank document as an empty object', async () => {
    const bodyless = vi.fn(async () => new Response(null, { status: 200 }))
    expect(await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: bodyless }))).toEqual({ kind: 'ok', body: {} })

    const blank = vi.fn(async () => new Response('  \n ', { status: 200 }))
    expect(await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: blank }))).toEqual({ kind: 'ok', body: {} })
  })

  it('skips a stream chunk that carries no bytes', async () => {
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(undefined as unknown as Uint8Array)
        controller.enqueue(new TextEncoder().encode('{"windows":3}'))
        controller.close()
      },
    })
    const fetchImpl = vi.fn(async () => new Response(chunks, { status: 200 }))
    expect(await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl }))).toEqual({ kind: 'ok', body: { windows: 3 } })
  })

  it('refuses a response larger than the size cap', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(300_000), { status: 200 }))
    await expect(usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl }))).rejects.toThrow(
      'usage response exceeded the size limit',
    )
  })

  it('rejects a body that is not JSON, keeping the status it arrived with', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }))
    const failure: unknown = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl })).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(UsageHttpError)
    expect((failure as UsageHttpError).message).toBe('usage response was not JSON')
    expect((failure as UsageHttpError).status).toBe(200)
  })

  it('omits a refusal detail the provider did not explain', async () => {
    // An unparsable error body, then a body whose explanation is only whitespace.
    const opaque = vi.fn(async () => new Response('gated', { status: 403 }))
    expect(await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: opaque }))).toEqual({ kind: 'forbidden' })

    const blank = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: '   ' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }))
    expect(await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: blank }))).toEqual({ kind: 'forbidden' })
  })

  it("reports a failed request with the provider's own detail when it gave one", async () => {
    const explained = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'backend exploded' } }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }))
    const failure: unknown = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: explained })).catch(
      (error: unknown) => error,
    )
    expect((failure as UsageHttpError).message).toBe('usage request failed (HTTP 502): backend exploded')
    expect((failure as UsageHttpError).status).toBe(502)

    const unexplained = vi.fn(async () => new Response('nope', { status: 500 }))
    await expect(usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: unexplained }))).rejects.toThrow(
      'usage request failed (HTTP 500)',
    )
  })

  it('refreshes the token once and retries after a 401', async () => {
    const invalidateToken = vi.fn(async () => undefined)
    let calls = 0
    const fetchImpl = vi.fn(async () =>
      calls++ === 0
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify({ five_hour: { utilization: 1 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))

    const result = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl, invalidateToken }))

    expect(result).toEqual({ kind: 'ok', body: { five_hour: { utilization: 1 } } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(invalidateToken).toHaveBeenCalledTimes(1)
  })

  it('gives up as unauthorized when the refreshed token is refused too', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    const result = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl }))
    expect(result).toEqual({ kind: 'unauthorized' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects at once when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller gave up'))
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))

    await expect(usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl }), controller.signal)).rejects.toThrow(
      'caller gave up',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('abandons an in-flight request when the caller aborts', async () => {
    const controller = new AbortController()
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fetchImpl = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error)
          })
          markStarted()
        }),
    )

    const pending = usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl }), controller.signal)
    await started
    controller.abort(new Error('caller cancelled'))

    await expect(pending).rejects.toThrow('caller cancelled')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('wraps a transport failure while keeping its message', async () => {
    const thrown = vi.fn(async () => {
      throw new Error('socket closed')
    })
    const failure: unknown = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: thrown })).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(UsageHttpError)
    expect((failure as UsageHttpError).message).toBe('socket closed')

    // A transport that rejects with something other than an Error is still readable.
    const nonError = vi.fn(async () => {
      throw 'connection reset'
    })
    const other: unknown = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl: nonError })).catch(
      (error: unknown) => error,
    )
    expect((other as UsageHttpError).message).toBe('connection reset')
  })

  it('abandons a request the provider never answers', async () => {
    const fetchImpl = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error)
          })
        }),
    )
    const failure: unknown = await usageGetJson(USAGE_URL, {}, httpOptions({ fetchImpl, timeoutMs: 5 })).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(UsageHttpError)
    expect((failure as UsageHttpError).message).toBe('usage request timed out')
  })
})

describe('Grok usage', () => {
  it('projects the weekly period and prepaid balance', () => {
    const usage = normalizeGrokUsage(
      {
        config: {
          creditUsagePercent: 48.7,
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-09-15T11:26:00Z' },
          prepaidBalance: { val: -1234 },
        },
      },
      NOW,
      'SuperGrok Heavy',
    )
    expect(usage.entitlement).toBe('entitled')
    expect(usage.windows[0]).toMatchObject({ label: 'weekly', remainingPercent: 52 })
    // Balances are stored as negative cents; the card shows the absolute value.
    expect(usage.credits).toEqual({ kind: 'money', currency: 'USD', remaining: 1234 })
  })

  it('reads a proto3 zero, which arrives as an empty object rather than a val', () => {
    const usage = normalizeGrokUsage({ config: { creditUsagePercent: 10, prepaidBalance: {} } }, NOW)
    expect(usage.credits).toEqual({ kind: 'money', currency: 'USD', remaining: 0 })
  })

  it('falls back to the deprecated limit/used pair when no percentage is reported', () => {
    const usage = normalizeGrokUsage(
      {
        config: {
          monthlyLimit: { val: 1000 },
          used: { val: 250 },
          currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY' },
        },
      },
      NOW,
    )
    expect(usage.windows[0]).toMatchObject({ label: 'monthly', remainingPercent: 75 })
  })

  it('splits the pooled allowance by product, whichever way the product is spelled', () => {
    // The live proxy says `GrokBuild`; xAI's fixtures say `PRODUCT_GROK_BUILD`.
    const live = normalizeGrokUsage(
      {
        config: {
          creditUsagePercent: 89,
          productUsage: [
            { product: 'GrokBuild', usagePercent: 68.4 },
            { product: 'GrokChat', usagePercent: 19 },
            { product: 'GrokImagine', usagePercent: 2 },
          ],
        },
      },
      NOW,
    )
    expect(live.windows[0]?.remainingPercent).toBe(11)
    expect(live.breakdown).toEqual([
      { id: 'GrokBuild', label: 'grokBuild', usedPercent: 68 },
      { id: 'GrokChat', label: 'chat', usedPercent: 19 },
      { id: 'GrokImagine', label: 'imagine', usedPercent: 2 },
    ])

    const fixture = normalizeGrokUsage(
      { config: { creditUsagePercent: 61, productUsage: [{ product: 'PRODUCT_GROK_BUILD', usagePercent: 61.2 }] } },
      NOW,
    )
    expect(fixture.breakdown).toEqual([{ id: 'PRODUCT_GROK_BUILD', label: 'grokBuild', usedPercent: 61 }])

    // A product this build does not know keeps its own words rather than vanishing.
    const unknown = normalizeGrokUsage(
      { config: { creditUsagePercent: 5, productUsage: [{ product: 'GrokVoiceMode', usagePercent: 5 }] } },
      NOW,
    )
    expect(unknown.breakdown).toEqual([{ id: 'GrokVoiceMode', label: 'custom', labelText: 'Grok Voice Mode', usedPercent: 5 }])
  })

  it('treats a config-less answer as no-subscription', () => {
    expect(normalizeGrokUsage({}, NOW).entitlement).toBe('no-subscription')
  })

  it('counts an absent or Free tier as no active subscription', () => {
    expect(isQualifyingGrokTier(undefined)).toBe(false)
    expect(isQualifyingGrokTier('')).toBe(false)
    expect(isQualifyingGrokTier('Free')).toBe(false)
    expect(isQualifyingGrokTier('SuperGrok')).toBe(true)
  })

  it('labels a free account Free and still reports its capped allowance', async () => {
    // The proxy names a tier only for an active subscription, so a free
    // account's `/user` answer simply omits it — while billing still meters.
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: { user_id: 'u-1' } },
      '/billing?format=credits': { body: { config: { creditUsagePercent: 30 } } },
    })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.tier).toBe('Free')
    expect(usage.entitlement).toBe('entitled')
    expect(usage.windows[0]?.remainingPercent).toBe(70)
  })

  it('sends the account id the billing endpoint expects', async () => {
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: { user_id: 'u-42', subscription_tier: 'SuperGrok' } },
      '/billing?format=credits': { body: { config: { creditUsagePercent: 5 } } },
    })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    await reader.read()
    const billingCall = fetchImpl.mock.calls.find(call => call[0].includes('/billing'))
    const headers = billingCall?.[1]?.headers as Record<string, string> | undefined
    expect(headers?.['x-userid']).toBe('u-42')
    expect(headers?.['X-XAI-Token-Auth']).toBe('xai-grok-cli')
  })

  it('turns a gated account into not-entitled', async () => {
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: {} },
      '/billing?format=credits': { status: 403, body: { error: 'Grok Build is not available for this account' } },
    })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('not-entitled')
    expect(usage.gate?.message).toBe('Grok Build is not available for this account')
  })

  it('ignores a cent field that is not a whole number', () => {
    const fractional = normalizeGrokUsage(
      { config: { creditUsagePercent: 10, prepaidBalance: { val: 12.5 } } },
      NOW,
    )
    expect(fractional.credits).toBeUndefined()
    expect(fractional.windows[0]).toMatchObject({ remainingPercent: 90 })

    const textual = normalizeGrokUsage({ config: { creditUsagePercent: 10, prepaidBalance: { val: '1200' } } }, NOW)
    expect(textual.credits).toBeUndefined()
  })

  it('labels a billing period it does not recognise as a plain usage window', () => {
    const usage = normalizeGrokUsage(
      { config: { creditUsagePercent: 25, currentPeriod: { type: 'USAGE_PERIOD_TYPE_DAILY' } } },
      NOW,
    )
    expect(usage.windows[0]).toMatchObject({ label: 'usage', remainingPercent: 75 })
  })

  it('shows a product it cannot name by its raw id', () => {
    const usage = normalizeGrokUsage(
      { config: { creditUsagePercent: 3, productUsage: [{ product: '___', usagePercent: 3 }] } },
      NOW,
    )
    expect(usage.breakdown).toEqual([{ id: '___', label: 'custom', labelText: '___', usedPercent: 3 }])
  })

  it('skips malformed product entries instead of dropping the whole breakdown', () => {
    const usage = normalizeGrokUsage(
      {
        config: {
          creditUsagePercent: 61,
          productUsage: [
            'nope',
            { product: '', usagePercent: 5 },
            { product: 'GrokChat', usagePercent: null },
            { product: 'GrokBuild', usagePercent: 61 },
          ],
        },
      },
      NOW,
    )
    expect(usage.breakdown).toEqual([{ id: 'GrokBuild', label: 'grokBuild', usedPercent: 61 }])
  })

  it('treats a billing document that is not an object as no-subscription', () => {
    expect(normalizeGrokUsage(null, NOW)).toEqual({ entitlement: 'no-subscription', windows: [], fetchedAt: NOW })
    expect(normalizeGrokUsage('nope', NOW).entitlement).toBe('no-subscription')
  })

  it('reports no-subscription when neither a percentage nor a usable limit pair is present', () => {
    const usage = normalizeGrokUsage({ config: { monthlyLimit: { val: 0 }, used: { val: 10 } } }, NOW)
    expect(usage).toEqual({ entitlement: 'no-subscription', windows: [], fetchedAt: NOW })
  })

  it('falls back to the free plan when the identity read fails', async () => {
    const fetchImpl = fetchStub({ '/billing?format=credits': { body: { config: { creditUsagePercent: 20 } } } })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('entitled')
    expect(usage.tier).toBeUndefined()
    expect(usage.windows[0]?.remainingPercent).toBe(80)
  })

  it('treats an identity document that is not an object as an unnamed account', async () => {
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: ['u-1'] },
      '/billing?format=credits': { body: { config: { creditUsagePercent: 20 } } },
    })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.tier).toBe('Free')
  })

  it('reports a gate the provider left unexplained without a message', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.includes('/user')
        ? new Response(JSON.stringify({ subscription_tier: 'SuperGrok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
        : new Response('gated', { status: 403, headers: { 'content-type': 'text/plain' } }))

    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('not-entitled')
    expect(usage.gate).toBeUndefined()
    expect(usage.tier).toBe('SuperGrok')
  })

  it('reports a gated account with no tier when the identity read failed too', async () => {
    const fetchImpl = fetchStub({
      '/billing?format=credits': { status: 403, body: { error: 'Grok Build is not available for this account' } },
    })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('not-entitled')
    expect(usage.tier).toBeUndefined()
    expect(usage.gate?.message).toBe('Grok Build is not available for this account')
  })

  it('reports an unknown entitlement when no token can be resolved', async () => {
    const fetchImpl = fetchStub({ '/billing?format=credits': { status: 401, body: {} } })
    const reader = createGrokUsageReader({
      resolveToken: async () => undefined,
      invalidateToken: async () => undefined,
      fetchImpl,
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage).toEqual({ entitlement: 'unknown', windows: [], fetchedAt: NOW })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps the tier the identity read resolved when billing refuses the token', async () => {
    let calls = 0
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: { user_id: 'u-7', subscription_tier: 'SuperGrok' } },
      '/billing?format=credits': { status: 401, body: {} },
    })
    const reader = createGrokUsageReader({
      resolveToken: async () => (calls++ === 0 ? 'token' : undefined),
      invalidateToken: async () => undefined,
      fetchImpl,
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage).toEqual({ entitlement: 'unknown', windows: [], fetchedAt: NOW, tier: 'SuperGrok' })
  })

  it('honours explicit cache lifetimes', async () => {
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: { user_id: 'u-1' } },
      '/billing?format=credits': { body: { config: { creditUsagePercent: 30 } } },
    })
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW, ttlMs: 0, negativeTtlMs: 0 })

    await reader.read()
    await reader.read()

    expect(fetchImpl.mock.calls.filter(call => call[0].includes('/billing'))).toHaveLength(2)
  })

  it('uses the global fetch when no transport is injected', async () => {
    const globalFetch = vi.fn(async (input: string) =>
      input.includes('/user')
        ? new Response(JSON.stringify({ user_id: 'u-9', subscription_tier: 'SuperGrok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
        : new Response(JSON.stringify({ config: { creditUsagePercent: 40 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
    vi.stubGlobal('fetch', globalFetch)

    const reader = createGrokUsageReader({ ...tokenSeam(), now: () => NOW })
    const usage = await reader.read()

    expect(usage.tier).toBe('SuperGrok')
    expect(usage.windows[0]?.remainingPercent).toBe(60)
    expect(globalFetch).toHaveBeenCalledTimes(2)
  })

  it('stamps the projection with the wall clock when no clock is injected', async () => {
    const fetchImpl = fetchStub({
      '/user?include=subscription': { body: { user_id: 'u-1' } },
      '/billing?format=credits': { body: { config: { creditUsagePercent: 30 } } },
    })
    const before = Date.now()
    const reader = createGrokUsageReader({ ...tokenSeam(), fetchImpl })

    const usage = await reader.read()

    expect(usage.entitlement).toBe('entitled')
    expect(usage.fetchedAt).toBeGreaterThanOrEqual(before)
    expect(usage.fetchedAt).toBeLessThanOrEqual(Date.now())
  })
})

describe('Codex usage adapter', () => {
  const reading: CodexUsage = {
    rateLimits: [
      {
        id: 'codex',
        name: 'Codex',
        windows: [
          { usedPercent: 14, remainingPercent: 86, windowSeconds: 18_000, resetsAt: 1_789_000_000 },
          { usedPercent: 49, remainingPercent: 51, windowSeconds: 604_800, resetsAt: 1_789_500_000 },
        ],
      },
    ],
    credits: { unlimited: false, balance: '0' },
    fetchedAt: NOW,
  }

  it('keeps both windows and names them by duration', () => {
    const usage = codexUsageToProviderUsage(reading, 'Plus')
    expect(usage.windows.map(window => window.label)).toEqual(['fiveHour', 'weekly'])
    expect(usage.windows.map(window => window.remainingPercent)).toEqual([86, 51])
    expect(usage.credits).toEqual({ kind: 'count', remaining: 0 })
    expect(usage.tier).toBe('Plus')
  })

  it('reports a plan the backend refuses as not-entitled', async () => {
    const reader = createCodexProviderUsageReader({
      usage: {
        read: () =>
          Promise.reject(new LlmError('Current ChatGPT subscription cannot use this Codex capability', 'QUOTA')),
        clear: () => undefined,
      },
      resolveToken: async () => undefined,
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('not-entitled')
    expect(usage.gate?.message).toContain('cannot use this Codex capability')
  })

  it('reports an empty reading as no-subscription', () => {
    expect(codexUsageToProviderUsage({ rateLimits: [], fetchedAt: NOW }).entitlement).toBe('no-subscription')
  })

  it('names a window by its limit when the window declares no duration', () => {
    const usage = codexUsageToProviderUsage({
      rateLimits: [
        {
          id: 'code_review',
          name: 'Code review',
          windows: [
            { usedPercent: 20, remainingPercent: 80 } as CodexUsage['rateLimits'][number]['windows'][number],
          ],
        },
      ],
      fetchedAt: NOW,
    })
    expect(usage.windows).toEqual([
      { id: 'code_review:0', label: 'custom', labelText: 'Code review', remainingPercent: 80 },
    ])
  })

  it('falls back to a generic label when a window has neither a duration nor a limit name', () => {
    const usage = codexUsageToProviderUsage({
      rateLimits: [
        {
          id: 'codex',
          windows: [{ usedPercent: 5, remainingPercent: 95 } as CodexUsage['rateLimits'][number]['windows'][number]],
        },
      ],
      fetchedAt: NOW,
    })
    expect(usage.windows).toEqual([{ id: 'codex:0', label: 'usage', remainingPercent: 95 }])
  })

  it('names a window too long for a session and too short for a week by its limit name', () => {
    const usage = codexUsageToProviderUsage({
      rateLimits: [
        { id: 'codex', name: 'Daily', windows: [{ usedPercent: 10, remainingPercent: 90, windowSeconds: 86_400 }] },
      ],
      fetchedAt: NOW,
    })
    expect(usage.windows[0]).toMatchObject({ label: 'custom', labelText: 'Daily' })
  })

  it('omits a window reset the backend did not report', () => {
    const usage = codexUsageToProviderUsage({
      rateLimits: [{ id: 'codex', windows: [{ usedPercent: 1, remainingPercent: 99, windowSeconds: 18_000 }] }],
      fetchedAt: NOW,
    })
    expect(usage.windows).toEqual([{ id: 'codex:0', label: 'fiveHour', remainingPercent: 99 }])
  })

  it('treats a missing balance as zero credits', () => {
    const usage = codexUsageToProviderUsage({ ...reading, credits: { unlimited: false } })
    expect(usage.credits).toEqual({ kind: 'count', remaining: 0 })
  })

  it('keeps an unlimited credit plan marked unlimited', () => {
    const usage = codexUsageToProviderUsage({ ...reading, credits: { unlimited: true, balance: '0' } })
    expect(usage.credits).toEqual({ kind: 'count', remaining: 0, unlimited: true })
  })

  it('omits credits when the reading reports none', () => {
    const usage = codexUsageToProviderUsage({ rateLimits: reading.rateLimits, fetchedAt: NOW }, 'Plus')
    expect(usage.entitlement).toBe('entitled')
    expect('credits' in usage).toBe(false)
  })

  it('titles the plan claim, dropping the chatgpt prefix', async () => {
    const reader = createCodexProviderUsageReader({
      usage: { read: async () => ({ ...reading }), clear: () => undefined },
      resolveToken: async () => jwtWithPlan('chatgpt_plus'),
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage.tier).toBe('Plus')
    expect(usage.entitlement).toBe('entitled')
    expect(usage.windows.map(window => window.remainingPercent)).toEqual([86, 51])
  })

  it('keeps a claim that is only the prefix rather than rendering an empty plan', async () => {
    const reader = createCodexProviderUsageReader({
      usage: { read: async () => ({ ...reading }), clear: () => undefined },
      resolveToken: async () => jwtWithPlan('chatgpt_'),
      now: () => NOW,
    })
    expect((await reader.read()).tier).toBe('chatgpt_')
  })

  it('reports a reading with no plan claim as an untiered answer', async () => {
    const reader = createCodexProviderUsageReader({
      usage: { read: async () => ({ ...reading }), clear: () => undefined },
      resolveToken: async () => {
        throw new Error('no session')
      },
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage.tier).toBeUndefined()
    expect(usage.entitlement).toBe('entitled')
  })

  it('passes the caller signal through to the underlying read', async () => {
    const controller = new AbortController()
    const read = vi.fn(async () => ({ ...reading }))
    const reader = createCodexProviderUsageReader({
      usage: { read, clear: () => undefined },
      resolveToken: async () => jwtWithPlan('plus'),
      now: () => NOW,
    })

    await reader.read({ force: true, signal: controller.signal })

    expect(read).toHaveBeenCalledWith({ force: true, signal: controller.signal })
  })

  it('reports an authentication failure without claiming the plan is unusable', async () => {
    const reader = createCodexProviderUsageReader({
      usage: { read: () => Promise.reject(new LlmError('token expired', 'AUTH')), clear: () => undefined },
      resolveToken: async () => jwtWithPlan('plus'),
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage).toMatchObject({ entitlement: 'unknown', windows: [], fetchedAt: NOW, tier: 'Plus' })
    expect(usage.gate).toBeUndefined()
  })

  it('reports a free plan the backend refuses as not-entitled', async () => {
    const reader = createCodexProviderUsageReader({
      usage: { read: () => Promise.reject(new LlmError('backend exploded', 'SERVER')), clear: () => undefined },
      resolveToken: async () => jwtWithPlan('free'),
      now: () => NOW,
    })
    const usage = await reader.read()
    expect(usage).toEqual({ entitlement: 'not-entitled', windows: [], fetchedAt: NOW, tier: 'Free' })
  })

  it('rethrows a failure that is not an entitlement answer', async () => {
    const reader = createCodexProviderUsageReader({
      usage: { read: () => Promise.reject(new Error('socket closed')), clear: () => undefined },
      resolveToken: async () => jwtWithPlan('plus'),
      now: () => NOW,
    })
    await expect(reader.read()).rejects.toThrow('socket closed')
  })

  it('honours explicit cache lifetimes', async () => {
    const read = vi.fn(async () => ({ ...reading }))
    const reader = createCodexProviderUsageReader({
      usage: { read, clear: () => undefined },
      resolveToken: async () => undefined,
      now: () => NOW,
      ttlMs: 0,
      negativeTtlMs: 0,
    })

    await reader.read()
    await reader.read()

    expect(read).toHaveBeenCalledTimes(2)
  })

  it('stamps a refused answer with the wall clock when no clock is injected', async () => {
    const before = Date.now()
    const reader = createCodexProviderUsageReader({
      usage: { read: () => Promise.reject(new LlmError('token expired', 'AUTH')), clear: () => undefined },
      resolveToken: async () => jwtWithPlan('plus'),
    })

    const usage = await reader.read()

    expect(usage.entitlement).toBe('unknown')
    expect(usage.fetchedAt).toBeGreaterThanOrEqual(before)
    expect(usage.fetchedAt).toBeLessThanOrEqual(Date.now())
  })
})

describe('usage reader cache', () => {
  it('caches a refusal for longer than a live answer and clears on demand', async () => {
    let clock = NOW
    let loads = 0
    const answer: ProviderUsage = { entitlement: 'no-subscription', windows: [], fetchedAt: NOW }
    const reader = createUsageReader({
      load: (_signal, now) => {
        loads += 1
        return Promise.resolve({ ...answer, fetchedAt: now })
      },
      now: () => clock,
      ttlMs: 1_000,
      negativeTtlMs: 100_000,
    })

    await reader.read()
    clock += 5_000
    // Past the live TTL but well inside the negative one: no second request.
    await reader.read()
    expect(loads).toBe(1)

    reader.clear()
    await reader.read()
    expect(loads).toBe(2)
  })

  it('never lets an abandoned load overwrite a forced result', async () => {
    const gates: { resolve: (usage: ProviderUsage) => void }[] = []
    const reader = createUsageReader({
      load: () =>
        new Promise<ProviderUsage>((resolve) => {
          gates.push({ resolve })
        }),
      now: () => NOW,
    })

    const first = reader.read()
    const forced = reader.read({ force: true })
    expect(gates).toHaveLength(2)

    gates[1]?.resolve({ entitlement: 'entitled', windows: [], fetchedAt: NOW })
    gates[0]?.resolve({ entitlement: 'not-entitled', windows: [], fetchedAt: NOW })
    await first
    expect((await forced).entitlement).toBe('entitled')

    // The cache holds the forced answer, not the late one it never awaited.
    expect((await reader.read()).entitlement).toBe('entitled')
  })

  it('shares one in-flight load between concurrent readers', async () => {
    let release: (usage: ProviderUsage) => void = () => undefined
    let loads = 0
    const reader = createUsageReader({
      load: () => {
        loads += 1
        return new Promise<ProviderUsage>((resolve) => {
          release = resolve
        })
      },
      now: () => NOW,
    })

    const first = reader.read()
    const second = reader.read()
    // The second reader joined the first request instead of starting its own.
    expect(loads).toBe(1)

    release({ entitlement: 'entitled', windows: [], fetchedAt: NOW })
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual({ entitlement: 'entitled', windows: [], fetchedAt: NOW })
    expect(b).toEqual(a)
    expect(loads).toBe(1)
  })

  it('stamps a load with the wall clock when no clock is injected', async () => {
    const before = Date.now()
    const reader = createUsageReader({
      load: (_signal, now) => Promise.resolve({ entitlement: 'entitled', windows: [], fetchedAt: now }),
    })

    const usage = await reader.read()

    expect(usage.entitlement).toBe('entitled')
    expect(usage.fetchedAt).toBeGreaterThanOrEqual(before)
    expect(usage.fetchedAt).toBeLessThanOrEqual(Date.now())
  })
})
