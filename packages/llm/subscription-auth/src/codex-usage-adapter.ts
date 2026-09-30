/**
 * Projects the Codex `wham/usage` reading onto the shared usage model.
 *
 * The Codex reader predates the shared model and keeps its own richer
 * projection, so this module adapts rather than replaces it. Two things the
 * card needs that the raw reading does not state:
 * - Windows are identified by duration. `wham/usage` reports a `primary_window`
 *   and a `secondary_window` per limit without naming either; their
 *   `limit_window_seconds` is what distinguishes the 5-hour window from the
 *   weekly one.
 * - A 403 is an entitlement answer, not a fault. The Codex HTTP client raises
 *   it as `LlmError` with code `QUOTA`, which becomes `not-entitled` here.
 *
 * @module @aeven/subscription-auth/codex-usage-adapter
 */

import { LlmError } from '@aeven/llm'
import { chatgptPlanTypeFromAccessToken } from './codex-http.ts'
import type { CodexUsage, CodexUsageReader } from './codex-usage.ts'
import { createUsageReader, usageCacheOptions, type UsageReader, type UsageReaderOptions } from './usage-reader.ts'
import type { ProviderUsage, UsageCredits, UsageWindow, UsageWindowLabel } from './usage-view.ts'

/** Upper bound for treating a window as the short rolling session limit. */
const SHORT_WINDOW_MAX_SECONDS = 6 * 60 * 60

/** Lower bound for treating a window as the weekly limit. */
const WEEKLY_WINDOW_MIN_SECONDS = 5 * 24 * 60 * 60

/** Plan claim values that name an account without Codex access. */
const FREE_PLAN_CLAIMS = new Set(['free', 'chatgpt_free', 'anonymous'])

/** Title-case a raw plan claim (`plus` becomes `Plus`) for display. */
function displayPlan(claim: string): string {
  const trimmed = claim.trim().replace(/^chatgpt[_-]/u, '')
  if (trimmed.length === 0) return claim
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/** Name a window from its declared duration, falling back to the limit's own name. */
function labelFor(windowSeconds: number | undefined, limitName: string | undefined): UsageWindowLabel {
  if (windowSeconds !== undefined) {
    if (windowSeconds <= SHORT_WINDOW_MAX_SECONDS) return 'fiveHour'
    if (windowSeconds >= WEEKLY_WINDOW_MIN_SECONDS) return 'weekly'
  }
  return limitName === undefined ? 'usage' : 'custom'
}

/**
 * Convert a Codex reading into the shared projection.
 * @param usage - the reading from {@link CodexUsageReader}.
 * @param tier - plan name decoded from the access token, when present.
 * @returns an `entitled` projection, or `no-subscription` when nothing is metered.
 */
export function codexUsageToProviderUsage(usage: CodexUsage, tier?: string): ProviderUsage {
  const windows: UsageWindow[] = []
  for (const limit of usage.rateLimits) {
    limit.windows.forEach((window, index) => {
      const label = labelFor(window.windowSeconds, limit.name)
      windows.push({
        id: `${limit.id}:${String(index)}`,
        label,
        ...(label === 'custom' && limit.name !== undefined ? { labelText: limit.name } : {}),
        remainingPercent: Math.max(0, Math.floor(window.remainingPercent)),
        ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
      })
    })
  }

  const credits: UsageCredits | undefined =
    usage.credits === undefined
      ? undefined
      : {
        kind: 'count',
        remaining: Number.parseFloat(usage.credits.balance ?? '0'),
        ...(usage.credits.unlimited ? { unlimited: true } : {}),
      }
  const usableCredits = credits !== undefined && Number.isFinite(credits.remaining) ? credits : undefined

  const withTier = tier === undefined ? {} : { tier }
  if (windows.length === 0 && usableCredits === undefined) {
    return { entitlement: 'no-subscription', windows: [], fetchedAt: usage.fetchedAt, ...withTier }
  }
  return {
    entitlement: 'entitled',
    windows,
    fetchedAt: usage.fetchedAt,
    ...withTier,
    ...(usableCredits === undefined ? {} : { credits: usableCredits }),
  }
}

/** Options for codex provider usage. */
export interface CodexProviderUsageOptions {
  /** The existing Codex reading source. */
  readonly usage: CodexUsageReader
  /** Resolve the access token, read only for its plan claim. */
  resolveToken(): Promise<string | undefined>
  readonly now?: () => number
  readonly ttlMs?: number
  readonly negativeTtlMs?: number
}

/**
 * Wrap the Codex reading source as a shared-model usage reader.
 * @param options - the underlying reader, token seam, and cache lifetimes.
 * @returns the reader the usage route serves for the `codex` provider.
 */
export function createCodexProviderUsageReader(options: CodexProviderUsageOptions): UsageReader {
  const load: UsageReaderOptions['load'] = async (signal, now) => {
    const token = await options.resolveToken().catch(() => undefined)
    const claim = token === undefined ? undefined : chatgptPlanTypeFromAccessToken(token)
    const tier = claim === undefined ? undefined : displayPlan(claim)
    try {
      const reading = await options.usage.read({ force: true, ...(signal === undefined ? {} : { signal }) })
      return codexUsageToProviderUsage(reading, tier)
    } catch (error) {
      // A ChatGPT plan without Codex is refused at the backend rather than
      // answered with empty quota, so the refusal is the entitlement signal.
      if (error instanceof LlmError && (error.code === 'QUOTA' || error.code === 'AUTH')) {
        return {
          entitlement: error.code === 'QUOTA' ? 'not-entitled' : 'unknown',
          windows: [],
          fetchedAt: now,
          ...(tier === undefined ? {} : { tier }),
          ...(error.code === 'QUOTA' ? { gate: { message: error.message } } : {}),
        }
      }
      if (claim !== undefined && FREE_PLAN_CLAIMS.has(claim.trim().toLowerCase())) {
        return { entitlement: 'not-entitled', windows: [], fetchedAt: now, tier: displayPlan(claim) }
      }
      throw error
    }
  }

  return createUsageReader({ load, ...usageCacheOptions(options) })
}
