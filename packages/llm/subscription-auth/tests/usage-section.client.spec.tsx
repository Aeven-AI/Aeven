/**
 * @vitest-environment happy-dom
 *
 * What the usage panel actually shows, per entitlement state.
 *
 * The regression this pins down first: the previous card rendered only
 * `windows[0]`, so a Codex account's weekly limit was fetched, parsed, and
 * then dropped. Every window the projection carries must reach the screen.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageSection } from '../src/client/components/UsageSection.tsx'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'
import { parseUsage } from '../src/client/parsers.ts'
import type { UsageView } from '../src/client/types.ts'

afterEach(cleanup)

/** The real English dictionary, so a missing key fails the test rather than passing silently. */
function t(key: GrokBuildSettingsKey, params?: Record<string, unknown>): string {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce< string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

/**
 * What the viewer's own locale renders for a dollar amount. The panel formats
 * through `Intl`, so the symbol and the separator belong to the machine, not
 * to this spec: `$12.34` here is `US$12.34` where the default locale is not
 * en-US. `whole` matches the panel rule that a whole balance drops its
 * fraction.
 */
function money(amount: number, whole = false): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    ...(whole ? { minimumFractionDigits: 0 } : {}),
  }).format(amount)
}

function show(
  usage: UsageView | undefined,
  options?: { loading?: boolean; error?: string; onRefresh?: () => void },
) {
  render(
    <UsageSection
      usage={usage}
      error={options?.error}
      loading={options?.loading === true}
      t={t}
      style={{}}
      {...(options?.onRefresh === undefined ? {} : { onRefresh: options.onRefresh })}
    />,
  )
}

describe('usage panel', () => {
  it('renders every window, not just the first', () => {
    show({
      entitlement: 'entitled',
      tier: 'Plus',
      windows: [
        { id: 'codex:0', label: 'fiveHour', remainingPercent: 86 },
        { id: 'codex:1', label: 'weekly', remainingPercent: 51 },
      ],
      credits: { kind: 'count', remaining: 0 },
    })

    expect(screen.getByText(en.usageWindowFiveHour)).toBeDefined()
    expect(screen.getByText(en.usageWindowWeekly)).toBeDefined()
    expect(screen.getByText(/86%/u)).toBeDefined()
    expect(screen.getByText(/51%/u)).toBeDefined()
    expect(screen.getByText(en.usageCreditsRemaining)).toBeDefined()
    expect(screen.getByText(en.usageCreditsHint)).toBeDefined()
    expect(screen.getByText('Plan: Plus')).toBeDefined()
  })

  it('colours each bar by consumption while the label states what is left', () => {
    show({
      entitlement: 'entitled',
      windows: [{ id: 'w', label: 'weekly', remainingPercent: 4 }],
    })
    // 4% remaining is 96% consumed, which the meter must report as nearly full.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('96')
  })

  it('formats a cent balance as money and a count as a bare number', () => {
    show({ entitlement: 'entitled', windows: [], credits: { kind: 'money', currency: 'USD', remaining: 1234 } })
    expect(screen.getByText(money(12.34))).toBeDefined()
    cleanup()

    show({ entitlement: 'entitled', windows: [], credits: { kind: 'money', currency: 'USD', remaining: 500 } })
    expect(screen.getByText(money(5, true))).toBeDefined()
    cleanup()

    show({ entitlement: 'entitled', windows: [], credits: { kind: 'count', remaining: 12 } })
    expect(screen.getByText('12')).toBeDefined()
  })

  it('explains a free plan instead of showing an empty panel', () => {
    show({ entitlement: 'no-subscription', tier: 'Free', windows: [] })
    expect(screen.getByText(en.usageNoSubscription)).toBeDefined()
    expect(screen.getByText(en.usageNoSubscriptionHint)).toBeDefined()
    expect(screen.getByText('Plan: Free')).toBeDefined()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it("prefers the provider's own refusal wording over ours", () => {
    show({
      entitlement: 'not-entitled',
      windows: [],
      gate: { message: 'Upgrade to SuperGrok to keep building', url: 'https://grok.com/supergrok', label: 'Upgrade' },
    })
    expect(screen.getByText('Upgrade to SuperGrok to keep building')).toBeDefined()
    expect(screen.queryByText(en.usageNotEntitled)).toBeNull()
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://grok.com/supergrok')
  })

  it('falls back to our wording when the provider refused without explaining', () => {
    show({ entitlement: 'not-entitled', windows: [] })
    expect(screen.getByText(en.usageNotEntitled)).toBeDefined()
  })

  it('sends the viewer to the provider when quota is managed elsewhere', () => {
    show({ entitlement: 'redirected', windows: [], redirectUrl: 'https://example.com/billing' })
    expect(screen.getByText(en.usageRedirect)).toBeDefined()
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com/billing')
  })

  it('distinguishes loading, undetermined, and failed reads', () => {
    show(undefined, { loading: true })
    expect(screen.getByText(en.usageLoading)).toBeDefined()
    cleanup()

    show({ entitlement: 'unknown', windows: [] })
    expect(screen.getByText(en.usageUnavailable)).toBeDefined()
    cleanup()

    show(undefined, { error: 'the request failed' })
    expect(screen.getByRole('alert').textContent).toBe('the request failed')
  })

  it('renders what the parser produces from a Host response body', () => {
    const parsed = parseUsage({
      entitlement: 'entitled',
      tier: 'Max',
      windows: [
        { id: 'five_hour', label: 'fiveHour', remainingPercent: 86, resetsAt: 1_789_000_000 },
        { id: 'seven_day', label: 'weekly', remainingPercent: 51 },
      ],
      fetchedAt: 1_800_000_000_000,
    })
    show(parsed)
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
    expect(screen.getByText(/Resets/u)).toBeDefined()
  })

  it('names each product of a pooled allowance with its share', () => {
    show({
      entitlement: 'entitled',
      windows: [{ id: 'weekly', label: 'weekly', remainingPercent: 11 }],
      breakdown: [
        { id: 'GrokBuild', label: 'grokBuild', usedPercent: 68 },
        { id: 'GrokChat', label: 'chat', usedPercent: 19 },
        { id: 'GrokImagine', label: 'imagine', usedPercent: 2 },
      ],
    })
    expect(screen.getByText(en.usageBreakdownTitle)).toBeDefined()
    expect(screen.getByText(en.usageProductGrokBuild)).toBeDefined()
    expect(screen.getByText('68%')).toBeDefined()
    expect(screen.getByText('2%')).toBeDefined()
    // The product block restates the pool it splits: the weekly window's figures appear twice.
    expect(screen.getAllByText('11%')).toHaveLength(2)
    // The product split is a second bar, not a second meter: one progressbar per window.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
  })

  it('offers a refresh that is unavailable while a read is in flight', () => {
    const onRefresh = vi.fn()
    show({ entitlement: 'entitled', windows: [], fetchedAt: 1_800_000_000_000 }, { onRefresh })
    fireEvent.click(screen.getByRole('button', { name: en.usageRefresh }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    cleanup()

    show({ entitlement: 'entitled', windows: [] }, { onRefresh, loading: true })
    expect(screen.getByRole('button', { name: en.usageRefresh }).hasAttribute('disabled')).toBe(true)
  })

  it('reads an unusable body as undetermined rather than inventing quota', () => {
    const parsed = parseUsage('nonsense')
    expect(parsed.entitlement).toBe('unknown')
    expect(parsed.windows).toEqual([])
  })

  it('drops a window with no usable remaining percentage', () => {
    const parsed = parseUsage({ entitlement: 'entitled', windows: [{ id: 'a' }, { id: 'b', remainingPercent: 20 }] })
    expect(parsed.windows.map(window => window.id)).toEqual(['b'])
  })

  it('reports an unlimited allowance as unlimited rather than as a number', () => {
    show({
      entitlement: 'entitled',
      windows: [],
      credits: { kind: 'money', currency: 'USD', remaining: 0, unlimited: true },
    })

    expect(screen.getByText(en.usageCreditsUnlimited)).toBeTruthy()
    expect(screen.queryByText('$0')).toBeNull()
  })

  it('assumes cents when the locale reports no fraction preference to read', () => {
    // Pin the locale boundary: whatever a currency's own digit count is, a
    // balance the viewer's format cannot place is still read as cents.
    const resolvedOptions = vi
      .spyOn(Intl.NumberFormat.prototype, 'resolvedOptions')
      .mockReturnValue({} as Intl.ResolvedNumberFormatOptions)
    try {
      show({ entitlement: 'entitled', windows: [], credits: { kind: 'money', currency: 'USD', remaining: 1234 } })

      expect(screen.getByText(money(12.34))).toBeTruthy()
    } finally {
      resolvedOptions.mockRestore()
    }
  })

  it('names a window by the label the provider wrote when it calls the window custom', () => {
    show({
      entitlement: 'entitled',
      windows: [{ id: 'w', label: 'custom', labelText: 'This sprint', remainingPercent: 40 }],
    })
    expect(screen.getByText('This sprint')).toBeTruthy()
    cleanup()

    // A custom window the provider left unnamed still reads as a window.
    show({ entitlement: 'entitled', windows: [{ id: 'w', label: 'custom', remainingPercent: 40 }] })
    expect(screen.getByText(en.usageWindowGeneric)).toBeTruthy()
  })

  it('names a product by the label the provider wrote when it calls the product custom', () => {
    const windows = [{ id: 'weekly', label: 'weekly' as const, remainingPercent: 50 }]
    show({
      entitlement: 'entitled',
      windows,
      breakdown: [{ id: 'p', label: 'custom', labelText: 'Code review', usedPercent: 5 }],
    })
    expect(screen.getByText('Code review')).toBeTruthy()
    cleanup()

    show({ entitlement: 'entitled', windows, breakdown: [{ id: 'p', label: 'custom', usedPercent: 5 }] })
    expect(screen.getByText(en.usageProductGrokBuild)).toBeTruthy()
  })

  it('restates the pooled window only when the provider reported exactly one', () => {
    const breakdown = [{ id: 'GrokBuild', label: 'grokBuild' as const, usedPercent: 68 }]
    show({
      entitlement: 'entitled',
      windows: [
        { id: 'w1', label: 'weekly', remainingPercent: 11 },
        { id: 'w2', label: 'monthly', remainingPercent: 22 },
      ],
      breakdown,
    })

    // With two windows the split belongs to no single one of them, so neither is restated.
    expect(screen.getByText(en.usageBreakdownTitle)).toBeTruthy()
    expect(screen.getAllByText('11%')).toHaveLength(1)
    expect(screen.getAllByText('22%')).toHaveLength(1)
    cleanup()

    show({ entitlement: 'entitled', windows: [{ id: 'w1', label: 'weekly', remainingPercent: 11 }], breakdown })
    expect(screen.getAllByText('11%')).toHaveLength(2)
  })

  it('still explains the redirect when the provider gave no place to go', () => {
    show({ entitlement: 'redirected', windows: [] })

    expect(screen.getByText(en.usageRedirect)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it("uses the provider's own link label only when it wrote one", () => {
    show({ entitlement: 'not-entitled', windows: [], gate: { url: 'https://grok.com/upgrade' } })

    expect(screen.getByText(en.usageNotEntitled)).toBeTruthy()
    expect(screen.getByRole('link').textContent).toBe(en.usageOpenProvider)
    cleanup()

    show({ entitlement: 'not-entitled', windows: [], gate: { url: 'https://grok.com/upgrade', label: 'Upgrade' } })
    expect(screen.getByRole('link').textContent).toBe('Upgrade')
  })
})
