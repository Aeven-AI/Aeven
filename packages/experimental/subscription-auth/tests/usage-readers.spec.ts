/**
 * Per-provider usage readers, with the free-tier answers as the main subject.
 *
 * A free plan is the case most likely to be mishandled, because each provider
 * expresses it differently: Claude answers 200 with no buckets, Codex refuses
 * outright, and Grok still meters a capped allowance. Each is asserted here so
 * the card cannot silently collapse them into "no data".
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { claudeTierFromProfile, createClaudeUsageReader, normalizeClaudeUsage } from '../src/claude-usage.ts'
import type { CodexUsage } from '../src/codex-usage.ts'
import { codexUsageToProviderUsage, createCodexProviderUsageReader } from '../src/codex-usage-adapter.ts'
import { createGrokUsageReader, isQualifyingGrokTier, normalizeGrokUsage } from '../src/grok-usage.ts'
import { createUsageReader } from '../src/usage-reader.ts'
import type { ProviderUsage } from '../src/usage-view.ts'
import { epochSecondsFromRfc3339, hasMeteredUsage, remainingFromUsed } from '../src/usage-view.ts'

const NOW = 1_800_000_000_000

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
})

describe('Claude usage', () => {
  const usageBody = {
    five_hour: { utilization: 14, resets_at: '2026-09-09T14:38:00Z' },
    seven_day: { utilization: 49, resets_at: '2026-09-15T11:26:00Z' },
    seven_day_opus: { utilization: null },
  }

  it('projects the metered windows as remaining percentages', () => {
    const usage = normalizeClaudeUsage(usageBody, NOW, 'Max')
    expect(usage.entitlement).toBe('entitled')
    expect(usage.tier).toBe('Max')
    // The null Opus bucket is absence, not zero usage, so it contributes no bar.
    expect(usage.windows.map(window => window.id)).toEqual(['five_hour', 'seven_day'])
    expect(usage.windows[0]).toMatchObject({ label: 'fiveHour', remainingPercent: 86 })
    expect(usage.windows[1]).toMatchObject({ label: 'weekly', remainingPercent: 51 })
    expect(usage.windows[0]?.resetsAt).toBe(Math.floor(Date.parse('2026-09-09T14:38:00Z') / 1000))
  })

  it('reports what is left of the extra-usage allowance as credits in its currency', () => {
    const capped = normalizeClaudeUsage(
      { ...usageBody, extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.7, currency: 'EUR' } },
      NOW,
    )
    expect(capped.credits).toEqual({ kind: 'money', currency: 'EUR', remaining: 3766 })

    const uncapped = normalizeClaudeUsage(
      { ...usageBody, extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 800, utilization: null } },
      NOW,
    )
    expect(uncapped.credits).toEqual({ kind: 'money', currency: 'USD', remaining: 0, unlimited: true })

    // Extra usage turned off leaves nothing beyond the plan, which reads as a zero balance.
    const disabled = normalizeClaudeUsage(
      { ...usageBody, extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null } },
      NOW,
    )
    expect(disabled.credits).toEqual({ kind: 'money', currency: 'USD', remaining: 0 })
    expect(normalizeClaudeUsage(usageBody, NOW).credits).toBeUndefined()
  })

  it('reports a plan with no metered buckets as no-subscription rather than empty', () => {
    const free = normalizeClaudeUsage({}, NOW, 'Free')
    expect(free.entitlement).toBe('no-subscription')
    expect(free.windows).toEqual([])
    expect(free.tier).toBe('Free')
    expect(hasMeteredUsage(free)).toBe(false)
  })

  it('names the plan from the profile, falling back to Free for an unpaid account', () => {
    expect(claudeTierFromProfile({ organization: { organization_type: 'claude_max' } })).toBe('Max')
    expect(claudeTierFromProfile({ organization: { organization_type: 'claude_pro' } })).toBe('Pro')
    expect(claudeTierFromProfile({ organization: { organization_type: 'claude_enterprise' } })).toBe('Enterprise')
    expect(claudeTierFromProfile({ account: { has_claude_pro: false, has_claude_max: false } })).toBe('Free')
    expect(claudeTierFromProfile('nonsense')).toBeUndefined()
  })

  it('reads usage and tier together over HTTP', async () => {
    const fetchImpl = fetchStub({
      '/api/oauth/profile': { body: { organization: { organization_type: 'claude_pro' } } },
      '/api/oauth/usage': { body: usageBody },
    })
    const reader = createClaudeUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('entitled')
    expect(usage.tier).toBe('Pro')
    expect(usage.windows).toHaveLength(2)
  })

  it("turns a refusal into not-entitled and keeps the provider's own wording", async () => {
    const fetchImpl = fetchStub({
      '/api/oauth/profile': { body: { account: {} } },
      '/api/oauth/usage': { status: 403, body: { error: { message: 'This plan has no Claude Code access' } } },
    })
    const reader = createClaudeUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('not-entitled')
    expect(usage.gate?.message).toBe('This plan has no Claude Code access')
    expect(usage.tier).toBe('Free')
  })

  it('still answers when the profile read fails, because the tier is only a label', async () => {
    const fetchImpl = fetchStub({
      '/api/oauth/profile': { status: 500, body: {} },
      '/api/oauth/usage': { body: usageBody },
    })
    const reader = createClaudeUsageReader({ ...tokenSeam(), fetchImpl, now: () => NOW })
    const usage = await reader.read()
    expect(usage.entitlement).toBe('entitled')
    expect(usage.tier).toBeUndefined()
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
})
