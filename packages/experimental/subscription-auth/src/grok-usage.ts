/**
 * Grok Build subscription quota reader (`GET /v1/billing?format=credits`).
 *
 * Two requests, in order, because the second needs the first:
 * 1. `/v1/user?include=subscription` — the live plan name and the account id.
 * 2. `/v1/billing?format=credits` — the credits config, which the official
 *    client sends with an `x-userid` header taken from that first response.
 *
 * Grok differs from the other providers in that a free plan still receives a
 * capped allowance rather than nothing, so a `Free` tier is reported with
 * whatever the billing config meters rather than being short-circuited.
 * The proxy returns a tier only for an active subscription, so an absent or
 * `Free` tier both mean the same thing.
 *
 * Money arrives as proto3 JSON, where a zero-valued scalar is omitted: a `$0`
 * balance is `{}`, not `{ "val": 0 }`. Every cent field defaults to 0 rather
 * than failing the parse, matching the upstream client.
 *
 * @module @aeven/experimental-subscription-auth/grok-usage
 */

import { GROK_BUILD_BASE_URL, grokBuildFingerprintHeaders } from './provider.ts'
import { type UsageFetch, type UsageHttpOptions, usageGetJson } from './usage-http.ts'
import {
  createUsageReader,
  usageCacheOptions,
  usageFromResult,
  type UsageReader,
  type UsageReaderOptions,
} from './usage-reader.ts'
import {
  epochSecondsFromRfc3339,
  type ProviderUsage,
  remainingFromUsed,
  type UsageBreakdownEntry,
  type UsageCredits,
  type UsageProductLabel,
  type UsageWindow,
  type UsageWindowLabel,
} from './usage-view.ts'

/** The CLI chat proxy origin; the only host a Grok subscription token may reach. */
export const GROK_PROXY_ORIGIN = 'https://cli-chat-proxy.grok.com'

/** Credits configuration for the signed-in account. */
export const GROK_BILLING_URL = `${GROK_BUILD_BASE_URL}/billing?format=credits`

/** Live plan name and canonical account id. */
export const GROK_USER_URL = `${GROK_BUILD_BASE_URL}/user?include=subscription`

/** The plan name the proxy uses for an account with no active subscription. */
export const GROK_FREE_TIER = 'Free'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a proto3 cent value.
 * @param value - the `{ val }` wrapper, `{}` for zero, or absent.
 * @returns the cent amount, or undefined when the field was not present at all.
 */
function centValue(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const val = value['val']
  if (val === undefined) return 0
  return typeof val === 'number' && Number.isSafeInteger(val) ? val : undefined
}

/** Map the proto usage-period enum onto the window this bar describes. */
function periodLabel(type: unknown): UsageWindowLabel {
  if (typeof type !== 'string') return 'usage'
  if (type.includes('WEEKLY')) return 'weekly'
  if (type.includes('MONTHLY')) return 'monthly'
  return 'usage'
}

/**
 * Whether the proxy's tier string names an active subscription.
 * Empty and `Free` both mean it does not, matching the upstream check.
 * @param tier - the reported tier, if any.
 * @returns true when the tier names a paid plan.
 */
export function isQualifyingGrokTier(tier: string | undefined): boolean {
  if (tier === undefined) return false
  const trimmed = tier.trim()
  return trimmed.length > 0 && trimmed.toLowerCase() !== GROK_FREE_TIER.toLowerCase()
}

/**
 * Name a `productUsage` product. The live proxy spells products `GrokBuild`,
 * `GrokChat`, `GrokImagine`, while xAI's own fixtures use `PRODUCT_GROK_BUILD`,
 * so matching is case- and separator-insensitive. An unknown product is shown
 * by its own words rather than dropped.
 */
function productLabel(product: string): { label: UsageProductLabel; labelText?: string } {
  const key = product.toLowerCase().replace(/[^a-z]/gu, '')
  if (key.includes('build')) return { label: 'grokBuild' }
  if (key.includes('imagine')) return { label: 'imagine' }
  if (key.includes('chat')) return { label: 'chat' }
  const words = product
    .replace(/^PRODUCT_/u, '')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .split(/[\s_]+/u)
    .filter(word => word.length > 0)
  const text = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
  return { label: 'custom', labelText: text.length > 0 ? text : product }
}

/**
 * Read the pooled allowance's per-product shares.
 *
 * `productUsage` carries each product's share of the unified pool, so the
 * shares sum to the pool's used percentage. The official client does not read
 * the field yet; its values are what grok.com shows as the usage breakdown.
 */
function parseProductUsage(value: unknown): UsageBreakdownEntry[] {
  if (!Array.isArray(value)) return []
  const entries: UsageBreakdownEntry[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const product = item['product']
    const percent = item['usagePercent']
    if (typeof product !== 'string' || product.length === 0) continue
    if (typeof percent !== 'number' || !Number.isFinite(percent)) continue
    entries.push({ id: product, ...productLabel(product), usedPercent: Math.max(0, Math.min(100, Math.floor(percent))) })
  }
  return entries
}

/**
 * Reduce a credits-config document to the shared projection.
 *
 * Prefers the newer `creditUsagePercent` / `currentPeriod` fields and falls
 * back to the deprecated `monthlyLimit` / `used` / `billingPeriodEnd` pair,
 * the same precedence the official client applies.
 * @param value - the parsed `/billing` body.
 * @param fetchedAt - epoch milliseconds to stamp the projection with.
 * @param tier - plan name from the `/user` read, when it resolved.
 * @returns the projection; `no-subscription` when nothing is metered.
 */
export function normalizeGrokUsage(value: unknown, fetchedAt: number, tier?: string): ProviderUsage {
  const root = isRecord(value) ? value : {}
  const config = isRecord(root['config']) ? root['config'] : undefined
  const withTier = tier === undefined ? {} : { tier }
  if (config === undefined) return { entitlement: 'no-subscription', windows: [], fetchedAt, ...withTier }

  const period = isRecord(config['currentPeriod']) ? config['currentPeriod'] : undefined
  const limit = centValue(config['monthlyLimit'])
  const used = centValue(config['used'])
  const reportedPercent = config['creditUsagePercent']
  const usedPercent =
    typeof reportedPercent === 'number' && Number.isFinite(reportedPercent)
      ? reportedPercent
      : limit !== undefined && limit > 0 && used !== undefined
        ? (used / limit) * 100
        : undefined

  const windows: UsageWindow[] = []
  if (usedPercent !== undefined) {
    const resetsAt = epochSecondsFromRfc3339(period?.['end']) ?? epochSecondsFromRfc3339(config['billingPeriodEnd'])
    windows.push({
      id: 'billing-period',
      label: periodLabel(period?.['type']),
      remainingPercent: remainingFromUsed(usedPercent),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }

  // Billing stores balances as negative cents by accounting convention; the
  // web clients display the absolute value, so the projection carries it too.
  const prepaid = centValue(config['prepaidBalance'])
  const credits: UsageCredits | undefined =
    prepaid === undefined ? undefined : { kind: 'money', currency: 'USD', remaining: Math.abs(prepaid) }

  if (windows.length === 0 && credits === undefined) {
    return { entitlement: 'no-subscription', windows: [], fetchedAt, ...withTier }
  }
  const breakdown = parseProductUsage(config['productUsage'])
  return {
    entitlement: 'entitled',
    windows,
    fetchedAt,
    ...withTier,
    ...(credits === undefined ? {} : { credits }),
    ...(breakdown.length === 0 ? {} : { breakdown }),
  }
}

/** Options for grok usage reader. */
export interface GrokUsageReaderOptions {
  /** Resolve the Grok Build OAuth access token, refreshing under the store lock. */
  resolveToken(): Promise<string | undefined>
  /** Drop the cached token after the proxy rejected it. */
  invalidateToken(): Promise<void>
  readonly fetchImpl?: UsageFetch
  readonly now?: () => number
  readonly ttlMs?: number
  readonly negativeTtlMs?: number
}

/** What the `/user` read contributes to the billing request that follows it. */
interface GrokIdentity {
  readonly userId?: string
  readonly tier?: string
}

function parseIdentity(value: unknown): GrokIdentity {
  if (!isRecord(value)) return {}
  const userId = value['user_id'] ?? value['userId']
  const tier = value['subscription_tier'] ?? value['subscriptionTier']
  return {
    ...(typeof userId === 'string' && userId.length > 0 ? { userId } : {}),
    ...(typeof tier === 'string' && tier.trim().length > 0 ? { tier: tier.trim() } : {}),
  }
}

/**
 * Build the cached Grok Build usage reader.
 * @param options - token seam, injected transport, and cache lifetimes.
 * @returns the reader the usage route serves for the `grok` provider.
 */
export function createGrokUsageReader(options: GrokUsageReaderOptions): UsageReader {
  const http: UsageHttpOptions = {
    origin: GROK_PROXY_ORIGIN,
    resolveToken: () => options.resolveToken(),
    invalidateToken: () => options.invalidateToken(),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  }

  const load: UsageReaderOptions['load'] = async (signal, now) => {
    // A failed identity read must not fail the quota read: `x-userid` is
    // contextual and the tier only labels the card.
    const identityResult = await usageGetJson(GROK_USER_URL, grokBuildFingerprintHeaders(), http, signal).catch(
      () => undefined,
    )
    const identity = identityResult?.kind === 'ok' ? parseIdentity(identityResult.body) : {}
    // The proxy names a tier only for an active subscription, so silence
    // means the free plan rather than an unknown one.
    const tier = identity.tier ?? (identityResult?.kind === 'ok' ? GROK_FREE_TIER : undefined)

    const headers = {
      ...grokBuildFingerprintHeaders(),
      ...(identity.userId === undefined ? {} : { 'x-userid': identity.userId }),
    }
    const result = await usageGetJson(GROK_BILLING_URL, headers, http, signal)
    return usageFromResult(result, now, tier, normalizeGrokUsage)
  }

  return createUsageReader({ load, ...usageCacheOptions(options) })
}
