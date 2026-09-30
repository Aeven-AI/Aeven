/**
 * Reading the Host's usage answer: what survives into the card's projection and
 * what is dropped, plus the timestamp formatting the panel prints.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatEpoch, parseUsage } from '../src/client/parsers.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usage timestamp formatting', () => {
  it('treats a missing or impossible timestamp as absent', () => {
    expect(formatEpoch(undefined)).toBeUndefined()
    expect(formatEpoch(Number.NaN)).toBeUndefined()
    expect(formatEpoch(0)).toBeUndefined()
    expect(formatEpoch(-1)).toBeUndefined()
    // Below a plausible epoch second there is no date to name.
    expect(formatEpoch(1_700_000)).toBeUndefined()
    expect(formatEpoch(1_000_000_000)).toBeUndefined()
  })

  it('reads the same instant from epoch seconds and from milliseconds', () => {
    const seconds = 1_800_000_000

    expect(formatEpoch(seconds)).toBe(formatEpoch(seconds * 1000))
    expect(formatEpoch(1_800_000_000_000)).toBe(formatEpoch(seconds))
  })

  it('names the date the timestamp actually falls on', () => {
    // 1.8e9 is 2027-01-15 in UTC, and no timezone moves it out of that year.
    expect(formatEpoch(1_800_000_000)).toMatch(/2027/u)
  })

  it('reports nothing when the viewer’s locale formats the date to nothing', () => {
    // A locale or build that yields an empty string must not print a blank date.
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('')

    expect(formatEpoch(1_800_000_000)).toBeUndefined()
  })
})

describe('usage window parsing', () => {
  it('keeps every window it can place and name, and drops the rest', () => {
    const parsed = parseUsage({
      entitlement: 'entitled',
      windows: [
        'nonsense',
        { id: 'no-percent' },
        { remainingPercent: 10 },
        { id: 'too-full', remainingPercent: 150 },
        { id: 'negative', remainingPercent: -1 },
        { id: 'timed', label: 'weekly', remainingPercent: 10, labelText: 'This week', resetsAt: 1_800_000_000 },
        { id: 'unknown-label', label: 'whenever', remainingPercent: 20 },
        { id: 'bare', remainingPercent: 30 },
      ],
    })

    expect(parsed.windows.map(window => window.id)).toEqual(['timed', 'unknown-label', 'bare'])
    expect(parsed.windows[0]).toEqual({
      id: 'timed',
      label: 'weekly',
      remainingPercent: 10,
      labelText: 'This week',
      resetsAt: 1_800_000_000,
    })
    // A label no window type owns is still a window; it just reads generically.
    expect(parsed.windows[1]?.label).toBe('usage')
    expect(parsed.windows[1]?.labelText).toBeUndefined()
    expect(parsed.windows[1]?.resetsAt).toBeUndefined()
  })

  it('reports no windows for a provider that sent none', () => {
    expect(parseUsage({ entitlement: 'entitled' }).windows).toEqual([])
  })
})

describe('credit balance parsing', () => {
  it('reads a balance in the unit the provider reported it in', () => {
    expect(parseUsage({ credits: { kind: 'count', remaining: 0 } }).credits).toEqual({ kind: 'count', remaining: 0 })
    expect(parseUsage({ credits: { kind: 'count', remaining: 3, unlimited: false } }).credits).toEqual({
      kind: 'count',
      remaining: 3,
      unlimited: false,
    })
    expect(parseUsage({ credits: { kind: 'money', currency: 'USD', remaining: 1234 } }).credits).toEqual({
      kind: 'money',
      currency: 'USD',
      remaining: 1234,
    })
    expect(parseUsage({ credits: { kind: 'money', currency: 'USD', remaining: 5, unlimited: true } }).credits).toEqual({
      kind: 'money',
      currency: 'USD',
      remaining: 5,
      unlimited: true,
    })
  })

  it('drops a credit entry it cannot bill against', () => {
    expect(parseUsage({ credits: 'lots' }).credits).toBeUndefined()
    expect(parseUsage({ credits: { kind: 'count' } }).credits).toBeUndefined()
    expect(parseUsage({ credits: { kind: 'count', remaining: -1 } }).credits).toBeUndefined()
    expect(parseUsage({ credits: { remaining: 5 } }).credits).toBeUndefined()
    expect(parseUsage({ credits: { kind: 'money', remaining: 5 } }).credits).toBeUndefined()
    expect(parseUsage({ credits: { kind: 'money', currency: 'usd', remaining: 5 } }).credits).toBeUndefined()
    expect(parseUsage({ credits: { kind: 'money', currency: 'US', remaining: 5 } }).credits).toBeUndefined()
  })
})

describe('product breakdown parsing', () => {
  it('keeps only the shares it can name and place', () => {
    const parsed = parseUsage({
      breakdown: [
        'nonsense',
        { id: 'no-percent' },
        { usedPercent: 10 },
        { id: 'too-full', usedPercent: 101 },
        { id: 'named', label: 'grokBuild', usedPercent: 68 },
        { id: 'unknown-label', label: 'not-a-product', usedPercent: 19 },
        { id: 'labelled', label: 'custom', labelText: 'Code review', usedPercent: 3 },
        { id: 'bare', usedPercent: 2 },
      ],
    })

    expect(parsed.breakdown).toEqual([
      { id: 'named', label: 'grokBuild', usedPercent: 68 },
      { id: 'unknown-label', label: 'custom', usedPercent: 19 },
      { id: 'labelled', label: 'custom', usedPercent: 3, labelText: 'Code review' },
      { id: 'bare', label: 'custom', usedPercent: 2 },
    ])
  })

  it('reports no breakdown unless the provider sent a list', () => {
    expect(parseUsage({ breakdown: 'nope' }).breakdown).toBeUndefined()
    expect(parseUsage({ breakdown: [] }).breakdown).toBeUndefined()
  })
})

describe('refusal gate parsing', () => {
  it("carries the provider's own refusal wording, link, and link label", () => {
    expect(parseUsage({ gate: { message: 'Upgrade', url: 'https://x/upgrade', label: 'Upgrade now' } }).gate).toEqual({
      message: 'Upgrade',
      url: 'https://x/upgrade',
      label: 'Upgrade now',
    })
    expect(parseUsage({ gate: { message: 'Upgrade' } }).gate).toEqual({ message: 'Upgrade' })
    expect(parseUsage({ gate: { url: 'https://x/upgrade' } }).gate).toEqual({ url: 'https://x/upgrade' })
    expect(parseUsage({ gate: { label: 'Upgrade now' } }).gate).toEqual({ label: 'Upgrade now' })
  })

  it('reports no gate when the provider refused without saying anything', () => {
    expect(parseUsage({ gate: {} }).gate).toBeUndefined()
    expect(parseUsage({ gate: 'nope' }).gate).toBeUndefined()
    expect(parseUsage({ entitlement: 'not-entitled' }).gate).toBeUndefined()
  })
})

describe('usage projection', () => {
  it('carries every optional part the provider actually sent', () => {
    const parsed = parseUsage({
      entitlement: 'redirected',
      tier: 'Max',
      redirectUrl: 'https://example.com/billing',
      fetchedAt: 1_800_000_000_000,
      windows: [{ id: 'w', remainingPercent: 50 }],
      credits: { kind: 'count', remaining: 7 },
      breakdown: [{ id: 'p', label: 'chat', usedPercent: 12 }],
      gate: { message: 'ask your admin' },
    })

    expect(parsed).toEqual({
      entitlement: 'redirected',
      tier: 'Max',
      redirectUrl: 'https://example.com/billing',
      fetchedAt: 1_800_000_000_000,
      windows: [{ id: 'w', label: 'usage', remainingPercent: 50 }],
      credits: { kind: 'count', remaining: 7 },
      breakdown: [{ id: 'p', label: 'chat', usedPercent: 12 }],
      gate: { message: 'ask your admin' },
    })
  })

  it('leaves out every optional part the provider did not send', () => {
    expect(parseUsage({ entitlement: 'no-subscription' })).toEqual({ entitlement: 'no-subscription', windows: [] })
  })

  it('reads a body it cannot understand as undetermined rather than as an answer', () => {
    expect(parseUsage('nonsense')).toEqual({ entitlement: 'unknown', windows: [] })
    expect(parseUsage({ entitlement: 'not-a-state' })).toEqual({ entitlement: 'unknown', windows: [] })
  })
})
