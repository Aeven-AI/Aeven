/** Parser for the Host usage response and the date formatting the usage panel shows. */

import { isRecord } from './api.ts'
import type {
  UsageBreakdownView,
  UsageCreditsView,
  UsageEntitlementView,
  UsageGateView,
  UsageProductLabelView,
  UsageView,
  UsageWindowLabelView,
  UsageWindowView,
} from './types.ts'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length < 500 ? value : undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalPercent(value: unknown): number | undefined {
  const numeric = optionalFiniteNumber(value)
  return numeric !== undefined && numeric >= 0 && numeric <= 100 ? numeric : undefined
}

/**
 * Format an epoch timestamp as a medium date and short time in the viewer's locale.
 * @param value - epoch seconds or milliseconds; anything else is treated as absent.
 * @returns the formatted date, or undefined when `value` is not a usable timestamp.
 */
export function formatEpoch(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : undefined
  if (ms === undefined) return undefined
  const formatted = new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return formatted.length > 0 ? formatted : undefined
}

const USAGE_WINDOW_LABELS = new Set<UsageWindowLabelView>([
  'fiveHour',
  'weekly',
  'monthly',
  'session',
  'codeReview',
  'usage',
  'custom',
])

const USAGE_ENTITLEMENTS = new Set<UsageEntitlementView>([
  'entitled',
  'no-subscription',
  'not-entitled',
  'redirected',
  'unknown',
])

function parseUsageWindow(value: unknown): UsageWindowView | undefined {
  if (!isRecord(value)) return undefined
  const id = optionalString(value['id'])
  const remainingPercent = optionalPercent(value['remainingPercent'])
  if (id === undefined || remainingPercent === undefined) return undefined
  const rawLabel = optionalString(value['label'])
  const tag =
    rawLabel !== undefined && USAGE_WINDOW_LABELS.has(rawLabel as UsageWindowLabelView)
      ? (rawLabel as UsageWindowLabelView)
      : 'usage'
  const labelText = optionalString(value['labelText'])
  const resetsAt = optionalFiniteNumber(value['resetsAt'])
  return {
    id,
    label: tag,
    remainingPercent,
    ...(labelText === undefined ? {} : { labelText }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function parseUsageCredits(value: unknown): UsageCreditsView | undefined {
  if (!isRecord(value)) return undefined
  const kind = optionalString(value['kind'])
  const remaining = optionalFiniteNumber(value['remaining'])
  if (remaining === undefined || remaining < 0) return undefined
  const unlimited = optionalBoolean(value['unlimited'])
  const limit = unlimited === undefined ? {} : { unlimited }
  if (kind === 'count') return { kind, remaining, ...limit }
  const currency = optionalString(value['currency'])
  if (kind !== 'money' || currency === undefined || !/^[A-Z]{3}$/u.test(currency)) return undefined
  return { kind, currency, remaining, ...limit }
}

const USAGE_PRODUCT_LABELS = new Set<UsageProductLabelView>(['grokBuild', 'chat', 'imagine', 'custom'])

function parseUsageBreakdown(value: unknown): UsageBreakdownView[] {
  if (!Array.isArray(value)) return []
  const entries: UsageBreakdownView[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = optionalString(item['id'])
    const usedPercent = optionalPercent(item['usedPercent'])
    if (id === undefined || usedPercent === undefined) continue
    const rawLabel = optionalString(item['label'])
    const tag = rawLabel !== undefined && USAGE_PRODUCT_LABELS.has(rawLabel as UsageProductLabelView)
      ? (rawLabel as UsageProductLabelView)
      : 'custom'
    const labelText = optionalString(item['labelText'])
    entries.push({ id, label: tag, usedPercent, ...(labelText === undefined ? {} : { labelText }) })
  }
  return entries
}

function parseUsageGate(value: unknown): UsageGateView | undefined {
  if (!isRecord(value)) return undefined
  const message = optionalString(value['message'])
  const url = optionalString(value['url'])
  const label = optionalString(value['label'])
  if (message === undefined && url === undefined && label === undefined) return undefined
  return {
    ...(message === undefined ? {} : { message }),
    ...(url === undefined ? {} : { url }),
    ...(label === undefined ? {} : { label }),
  }
}

/**
 * Read one provider's usage answer.
 *
 * An unreadable body becomes `unknown` rather than undefined: the card must
 * still say something about a signed-in provider, and "not determined" is a
 * truthful thing to say.
 * @param value - the parsed usage response body.
 * @returns the projection the card renders.
 */
export function parseUsage(value: unknown): UsageView {
  const payload = isRecord(value) ? value : {}
  const rawEntitlement = optionalString(payload['entitlement'])
  const entitlement =
    rawEntitlement !== undefined && USAGE_ENTITLEMENTS.has(rawEntitlement as UsageEntitlementView)
      ? (rawEntitlement as UsageEntitlementView)
      : 'unknown'
  const windows = Array.isArray(payload['windows'])
    ? payload['windows'].map(parseUsageWindow).filter((entry): entry is UsageWindowView => entry !== undefined)
    : []
  const credits = parseUsageCredits(payload['credits'])
  const breakdown = parseUsageBreakdown(payload['breakdown'])
  const gate = parseUsageGate(payload['gate'])
  const tier = optionalString(payload['tier'])
  const redirectUrl = optionalString(payload['redirectUrl'])
  const fetchedAt = optionalFiniteNumber(payload['fetchedAt'])
  return {
    entitlement,
    windows,
    ...(credits === undefined ? {} : { credits }),
    ...(breakdown.length === 0 ? {} : { breakdown }),
    ...(gate === undefined ? {} : { gate }),
    ...(tier === undefined ? {} : { tier }),
    ...(redirectUrl === undefined ? {} : { redirectUrl }),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
  }
}
