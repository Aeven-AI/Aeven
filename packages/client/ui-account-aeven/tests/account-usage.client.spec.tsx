// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import type { CloudPayment } from '../src/client/cloud.ts'
import { en } from '../src/client/locales.ts'

const period = { id: 'period-1', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' }

const usage = {
  plan: 'pro',
  planName: 'Pro',
  status: 'active',
  billingPeriod: { ...period, renews: true },
  usage: { tokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheHitInputTokens: 0, requests: 0 },
  allowance: { usedPercent: 0, remainingPercent: 100 },
  balance: { purchasedUsdMicros: 0, currency: 'USD' },
  actions: [],
}

const subscription = {
  plan: 'pro',
  planName: 'Pro',
  status: 'active',
  renews: true,
  price: { monthlyUsdMicros: 20_000_000, currency: 'USD' },
  billingPeriod: period,
  managed: false,
  cancelAtPeriodEnd: false,
  pendingPlan: null,
}

const credit = (type: 'topup' | 'refund' | 'adjustment', micros: number, createdAt: string): CloudPayment =>
  ({ kind: 'credit', type, amountUsdMicros: micros, currency: 'USD', createdAt })

const plan = (micros: number, createdAt: string): CloudPayment =>
  ({ kind: 'subscription', type: null, amountUsdMicros: micros, currency: 'USD', createdAt })

/**
 * Render the account page with one payment answer. The other account routes answer
 * with an empty account, so only the usage group carries content.
 * @param payments - what `/payments` answers with, or a refusal.
 * @returns the render handle, and the route double.
 */
function show(payments: readonly CloudPayment[] | Error) {
  const cloud = vi.fn(async (path: string) => {
    if (path === '/usage') return usage
    if (path === '/subscription') return subscription
    if (path === '/topup/options') return { enabled: false, currency: null, presets: [] }
    if (path === '/wallet') {
      return { currency: 'USD', balance: { purchasedUsdMicros: 0, currency: 'USD' }, transactions: [] }
    }
    if (path === '/plans') return { subscriptionsEnabled: false, plans: [] }
    if (path === '/payments') {
      if (payments instanceof Error) throw payments
      return { currency: 'USD', payments: payments }
    }
    throw new Error(`unexpected route ${path}`)
  })
  const props = {
    reader: () => ({ userId: 'reader-1', displayName: 'Ollie', email: 'ollie@example.test' }),
    signOut: vi.fn(),
    setImage: vi.fn(async () => undefined),
    removeImage: vi.fn(async () => {}),
    mfa: vi.fn(async () => ({ enabled: false })),
    security: {
      cached: () => false,
      read: async () => false,
      record: () => {},
    },
    cloud,
    cached: () => undefined,
    t: (key: keyof typeof en) => en[key],
  }
  return { ...render(<AccountSection {...props as unknown as AccountSectionProps} />), cloud }
}

afterEach(cleanup)

describe('the usage payment history', () => {
  it('lists plan and credit payments as soon as the page has answered, with no control to open them', async () => {
    show([plan(20_000_000, '2026-10-02T09:00:00.000Z'), credit('topup', 25_000_000, '2026-10-05T10:00:00.000Z')])

    expect(await screen.findByText(en['usage.payments'])).toBeDefined()
    expect(screen.getByText(en['activity.subscription'])).toBeDefined()
    expect(screen.getByText(en['activity.topup'])).toBeDefined()
    // Payment history is part of the page, so it carries no show/hide control.
    expect(screen.queryByRole('button', { name: /show|hide/i })).toBeNull()
  })

  it('states an empty statement when nothing has been paid', async () => {
    show([])

    expect(await screen.findByText(en['activity.empty'])).toBeDefined()
    expect(screen.queryByText(en['activity.topup'])).toBeNull()
  })

  it('offers a retry in place of the list when the payment read failed', async () => {
    const { cloud } = show(new Error('unavailable'))

    const retry = await screen.findByRole('button', { name: en['section.retry'] })
    expect(screen.getByText(en['usage.payments'])).toBeDefined()
    // The retry re-reads the broken route rather than the whole page.
    const before = cloud.mock.calls.filter(call => call[0] === '/payments').length
    fireEvent.click(retry)
    expect(cloud.mock.calls.filter(call => call[0] === '/payments').length).toBeGreaterThan(before)
  })
})
