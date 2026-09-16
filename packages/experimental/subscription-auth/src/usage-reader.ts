/**
 * Cache and outcome mapping shared by every provider usage reader.
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
 * The raw Codex reader keeps its own richer projection, so it shares
 * {@link createCachedReader} with a single lifetime rather than
 * {@link createUsageReader}, which keys the second TTL on entitlement.
 *
 * @module @aeven/experimental-subscription-auth/usage-reader
 */

import type { UsageHttpResult } from './usage-http.ts'
import type { ProviderUsage } from './usage-view.ts'

/** Cache lifetime of an `entitled` answer. */
export const DEFAULT_USAGE_TTL_MS = 60_000

/**
 * Cache lifetime of a `no-subscription`, `not-entitled` or `redirected`
 * answer. Long because only a sign-in change can alter it, and `clear()`
 * already covers that.
 */
export const DEFAULT_USAGE_NEGATIVE_TTL_MS = 900_000

/** A reading stamped with the epoch milliseconds it was read at. */
export interface StampedReading {
  /** When the reading was taken, in epoch milliseconds. */
  readonly fetchedAt: number
}

/** Cached, injectable usage source. Failures never invent quota numbers. */
export interface UsageReader {
  read(options?: { force?: boolean; signal?: AbortSignal }): Promise<ProviderUsage>
  clear(): void
}

/** Options for usage reader. */
export interface UsageReaderOptions {
  /** Perform one live read. `now` is the timestamp to stamp the projection with. */
  load(signal: AbortSignal | undefined, now: number): Promise<ProviderUsage>
  now?: () => number
  ttlMs?: number
  negativeTtlMs?: number
}

/** Cached, injectable reading source. Failures never invent quota numbers. */
export interface CachedReader<T extends StampedReading> {
  read(options?: { force?: boolean; signal?: AbortSignal }): Promise<T>
  clear(): void
}

/** Options for {@link createCachedReader}. */
export interface CachedReaderOptions<T extends StampedReading> {
  /** Perform one live read. `now` is the timestamp to stamp the reading with. */
  load(signal: AbortSignal | undefined, now: number): Promise<T>
  /** How long a stored reading stays fresh, in milliseconds. */
  lifetimeOf(reading: T): number
  /** Detach the mutable parts of a stored reading before handing it to a caller. */
  copy(reading: T): T
  /** Clock behind the freshness check and the timestamp handed to `load`. */
  now: () => number
}

/** The cache lifetimes a provider reader passes through to the shared cache. */
export interface UsageCacheOverrides {
  readonly now?: () => number
  readonly ttlMs?: number
  readonly negativeTtlMs?: number
}

function copyUsage(usage: ProviderUsage): ProviderUsage {
  return { ...usage, windows: [...usage.windows] }
}

/**
 * Wrap one live read in the cache described in the module doc.
 * @param options - the live read and how its readings are cached.
 * @returns the reader with the `force` / `clear` semantics above.
 */
export function createCachedReader<T extends StampedReading>(options: CachedReaderOptions<T>): CachedReader<T> {
  let cached: T | undefined
  let inFlight: Promise<T> | undefined
  let epoch = 0

  return {
    read({ force = false, signal } = {}) {
      if (!force && cached !== undefined && options.now() - cached.fetchedAt < options.lifetimeOf(cached)) {
        return Promise.resolve(options.copy(cached))
      }
      if (!force && inFlight !== undefined) return inFlight
      if (force) epoch += 1
      const started = epoch
      const current = options
        .load(signal, options.now())
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

/**
 * Wrap one provider's load function in the shared cache, keying the second TTL
 * on entitlement.
 * @param options - the load function and its cache lifetimes.
 * @returns the reader consumed by the usage route.
 */
export function createUsageReader(options: UsageReaderOptions): UsageReader {
  const ttlMs = options.ttlMs ?? DEFAULT_USAGE_TTL_MS
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_USAGE_NEGATIVE_TTL_MS
  return createCachedReader<ProviderUsage>({
    load: (signal, now) => options.load(signal, now),
    now: options.now ?? Date.now,
    lifetimeOf: usage => (usage.entitlement === 'entitled' ? ttlMs : negativeTtlMs),
    copy: copyUsage,
  })
}

/**
 * Forward the cache lifetimes a provider reader was given, and only those.
 *
 * `exactOptionalPropertyTypes` separates an absent lifetime from an explicitly
 * undefined one, so the shared cache keeps applying its own default until the
 * caller really overrides it.
 * @param options - the provider reader options carrying the lifetimes.
 * @returns the cache fields to spread into {@link createUsageReader}.
 */
export function usageCacheOptions(
  options: UsageCacheOverrides,
): Pick<UsageReaderOptions, 'now' | 'ttlMs' | 'negativeTtlMs'> {
  return {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.negativeTtlMs === undefined ? {} : { negativeTtlMs: options.negativeTtlMs }),
  }
}

/**
 * Resolve the outcome of one `usageGetJson` read into the shared projection.
 *
 * A provider's refusal is an answer the card renders, not a fault: an
 * entitlement wall becomes `not-entitled` carrying the provider's own detail,
 * and credentials the provider rejected become `unknown`. Only a successful
 * body reaches the provider's own reducer.
 * @param result - the outcome of one usage GET.
 * @param fetchedAt - epoch milliseconds to stamp the projection with.
 * @param tier - plan name resolved before this request, when it resolved.
 * @param normalize - the provider's reducer for a successful body.
 * @returns the projection this outcome means.
 */
export function usageFromResult(
  result: UsageHttpResult,
  fetchedAt: number,
  tier: string | undefined,
  normalize: (body: unknown, fetchedAt: number, tier?: string) => ProviderUsage,
): ProviderUsage {
  if (result.kind === 'forbidden') {
    return {
      entitlement: 'not-entitled',
      windows: [],
      fetchedAt,
      ...(tier === undefined ? {} : { tier }),
      ...(result.detail === undefined ? {} : { gate: { message: result.detail } }),
    }
  }
  if (result.kind === 'unauthorized') {
    return { entitlement: 'unknown', windows: [], fetchedAt, ...(tier === undefined ? {} : { tier }) }
  }
  return normalize(result.body, fetchedAt, tier)
}
