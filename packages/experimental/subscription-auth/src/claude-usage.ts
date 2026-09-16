/**
 * Claude subscription quota reader (`GET /api/oauth/usage`).
 *
 * The endpoint answers 200 for every signed-in account. A plan without metered
 * subscription quota — free, or one billed as API credits — simply carries no
 * limit buckets, which the official client reports as "usage is only available
 * for subscription plans". That is a `no-subscription` projection here, not an
 * error: the account is signed in, it just has nothing to meter.
 *
 * Anthropic reports `utilization` (consumed) per window and an RFC 3339
 * `resets_at`; {@link ProviderUsage} carries remaining percent and epoch
 * seconds, so both are converted.
 *
 * @module @aeven/experimental-subscription-auth/claude-usage
 */

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
  noSubscriptionUsage,
  type ProviderUsage,
  remainingFromUsed,
  type UsageCredits,
  type UsageWindow,
  type UsageWindowLabel,
} from './usage-view.ts'

/** Anthropic's first-party API origin; the only host these tokens may reach. */
export const CLAUDE_API_ORIGIN = 'https://api.anthropic.com'

/** Subscription quota windows for the signed-in account. */
export const CLAUDE_USAGE_URL = `${CLAUDE_API_ORIGIN}/api/oauth/usage`

/** Account and organization identity, read only for the plan name. */
export const CLAUDE_PROFILE_URL = `${CLAUDE_API_ORIGIN}/api/oauth/profile`

/**
 * The three buckets the endpoint reports, in display order, paired with the
 * window each one means.
 */
const CLAUDE_WINDOWS: readonly (readonly [key: string, label: UsageWindowLabel])[] = [
  ['five_hour', 'fiveHour'],
  ['seven_day', 'weekly'],
  ['seven_day_opus', 'weeklyOpus'],
]

/** `organization_type` values that name a paid Claude plan. */
const CLAUDE_TIER_NAMES: Readonly<Record<string, string>> = {
  claude_pro: 'Pro',
  claude_max: 'Max',
  claude_team: 'Team',
  claude_enterprise: 'Enterprise',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one `{ utilization, resets_at }` bucket.
 *
 * `utilization` is nullable upstream; a null bucket means the window is not
 * metered for this account, which is absence rather than zero usage.
 */
function parseWindow(id: string, label: UsageWindowLabel, value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined
  const utilization = value['utilization']
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return undefined
  const resetsAt = epochSecondsFromRfc3339(value['resets_at'])
  return {
    id,
    label,
    remainingPercent: remainingFromUsed(utilization),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/**
 * Read `extra_usage`, the monthly allowance that keeps Claude working past the
 * plan limits. Amounts are minor units of `currency`. A null `monthly_limit`
 * on an enabled allowance means no cap; a disabled allowance has nothing left.
 */
function parseExtraUsage(value: unknown): UsageCredits | undefined {
  if (!isRecord(value) || typeof value['is_enabled'] !== 'boolean') return undefined
  const rawCurrency = value['currency']
  const currency = typeof rawCurrency === 'string' && /^[A-Z]{3}$/u.test(rawCurrency) ? rawCurrency : 'USD'
  if (!value['is_enabled']) return { kind: 'money', currency, remaining: 0 }
  const limit = value['monthly_limit']
  if (limit === null) return { kind: 'money', currency, remaining: 0, unlimited: true }
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return undefined
  const used = value['used_credits']
  const spent = typeof used === 'number' && Number.isFinite(used) ? used : 0
  return { kind: 'money', currency, remaining: Math.max(0, limit - spent) }
}

/**
 * Reduce an `/api/oauth/usage` document to the shared projection.
 * @param value - the parsed response body.
 * @param fetchedAt - epoch milliseconds to stamp the projection with.
 * @param tier - plan name from the profile read, when it resolved.
 * @returns an `entitled` projection, or `no-subscription` when nothing is metered.
 */
export function normalizeClaudeUsage(value: unknown, fetchedAt: number, tier?: string): ProviderUsage {
  if (!isRecord(value)) return noSubscriptionUsage(fetchedAt, tier)
  const windows: UsageWindow[] = []
  for (const [key, label] of CLAUDE_WINDOWS) {
    const window = parseWindow(key, label, value[key])
    if (window !== undefined) windows.push(window)
  }
  if (windows.length === 0) return noSubscriptionUsage(fetchedAt, tier)
  const credits = parseExtraUsage(value['extra_usage'])
  return {
    entitlement: 'entitled',
    windows,
    fetchedAt,
    ...(tier === undefined ? {} : { tier }),
    ...(credits === undefined ? {} : { credits }),
  }
}

/**
 * Read the plan name from an `/api/oauth/profile` document.
 *
 * An account with no paid organization type is reported as `Free` rather than
 * omitted: naming the plan is what explains an unmetered card to the user.
 * @param value - the parsed profile body.
 * @returns the display plan name, or undefined when the body is unusable.
 */
export function claudeTierFromProfile(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const organization = value['organization']
  if (isRecord(organization)) {
    const type = organization['organization_type']
    if (typeof type === 'string') {
      const named = CLAUDE_TIER_NAMES[type]
      if (named !== undefined) return named
    }
  }
  const account = value['account']
  if (isRecord(account)) {
    if (account['has_claude_max'] === true) return 'Max'
    if (account['has_claude_pro'] === true) return 'Pro'
    return 'Free'
  }
  return undefined
}

/** Options for claude usage reader. */
export interface ClaudeUsageReaderOptions {
  /** Resolve the Claude OAuth access token, refreshing under the store lock. */
  resolveToken(): Promise<string | undefined>
  /** Drop the cached token after Anthropic rejected it. */
  invalidateToken(): Promise<void>
  readonly fetchImpl?: UsageFetch
  readonly userAgent?: string
  readonly now?: () => number
  readonly ttlMs?: number
  readonly negativeTtlMs?: number
}

const DEFAULT_USER_AGENT = '@aeven/experimental-subscription-auth'

/**
 * Build the cached Claude usage reader.
 * @param options - token seam, injected transport, and cache lifetimes.
 * @returns the reader the usage route serves for the `claude` provider.
 */
export function createClaudeUsageReader(options: ClaudeUsageReaderOptions): UsageReader {
  const http: UsageHttpOptions = {
    origin: CLAUDE_API_ORIGIN,
    resolveToken: () => options.resolveToken(),
    invalidateToken: () => options.invalidateToken(),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  }
  const headers = {
    'content-type': 'application/json',
    'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
  } as const

  const load: UsageReaderOptions['load'] = async (signal, now) => {
    // The plan name is contextual, so a failed or refused profile read must
    // not fail the quota read that the card is actually about.
    const profile = await usageGetJson(CLAUDE_PROFILE_URL, headers, http, signal).catch(() => undefined)
    const tier = profile?.kind === 'ok' ? claudeTierFromProfile(profile.body) : undefined

    const result = await usageGetJson(CLAUDE_USAGE_URL, headers, http, signal)
    return usageFromResult(result, now, tier, normalizeClaudeUsage)
  }

  return createUsageReader({ load, ...usageCacheOptions(options) })
}
