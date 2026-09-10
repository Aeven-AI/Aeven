/**
 * Cache shared by every provider usage reader.
 *
 * Cache semantics, unchanged from the original Codex reader:
 * - A successful `read()` stores the projection until its TTL elapses.
 * - Concurrent non-force `read()` calls share one in-flight load.
 * - `read({ force: true })` always starts a new load and never joins an
 *   existing in-flight one. A later completion of the abandoned load cannot
 *   overwrite the forced result.
 * - `clear()` drops the stored projection and detaches any in-flight load so
 *   its later completion cannot repopulate the cache.
 *
 * A non-`entitled` answer is cached under a separate, longer TTL. A free
 * account's answer is settled until it signs into a different plan, and
 * re-asking on every Settings render would spend a guaranteed-refused request
 * each time. Login and logout call `clear()`, which is what actually
 * invalidates it.
 *
 * @module @deepseek-ai/dsh-experimental-subscription-auth/usage-reader
 */

import type { ProviderUsage } from './usage-view.ts'

/** Cache lifetime of an `entitled` answer. */
export const DEFAULT_USAGE_TTL_MS = 60_000

/**
 * Cache lifetime of a `no-subscription`, `not-entitled` or `redirected`
 * answer. Long because only a sign-in change can alter it, and `clear()`
 * already covers that.
 */
export const DEFAULT_USAGE_NEGATIVE_TTL_MS = 900_000

/** Cached, injectable usage source. Failures never invent quota numbers. */
export interface UsageReader {
  read(options?: { force?: boolean; signal?: AbortSignal }): Promise<ProviderUsage>
  clear(): void
}

export interface UsageReaderOptions {
  /** Perform one live read. `now` is the timestamp to stamp the projection with. */
  load(signal: AbortSignal | undefined, now: number): Promise<ProviderUsage>
  now?: () => number
  ttlMs?: number
  negativeTtlMs?: number
}

function copyUsage(usage: ProviderUsage): ProviderUsage {
  return { ...usage, windows: [...usage.windows] }
}

/**
 * Wrap one provider's load function in the shared cache.
 * @param options - the load function and its cache lifetimes.
 * @returns the reader consumed by the usage route.
 */
export function createUsageReader(options: UsageReaderOptions): UsageReader {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_USAGE_TTL_MS
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_USAGE_NEGATIVE_TTL_MS
  let cached: ProviderUsage | undefined
  let inFlight: Promise<ProviderUsage> | undefined
  let epoch = 0

  const lifetimeOf = (usage: ProviderUsage): number => (usage.entitlement === 'entitled' ? ttlMs : negativeTtlMs)

  return {
    read({ force = false, signal } = {}) {
      if (!force && cached !== undefined && now() - cached.fetchedAt < lifetimeOf(cached)) {
        return Promise.resolve(copyUsage(cached))
      }
      if (!force && inFlight !== undefined) return inFlight
      if (force) epoch += 1
      const started = epoch
      const current = options
        .load(signal, now())
        .then((value) => {
          if (started === epoch) cached = value
          return value
        })
        .finally(() => {
          if (inFlight === current) inFlight = undefined
        })
      inFlight = current
      return current
    },
    clear() {
      epoch += 1
      cached = undefined
      inFlight = undefined
    },
  }
}
