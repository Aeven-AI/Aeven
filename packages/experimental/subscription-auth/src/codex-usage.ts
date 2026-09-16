/**
 * Optional ChatGPT Codex quota reader (`GET /backend-api/wham/usage`).
 * Normalizes unknown/malformed optional fields instead of failing the card.
 *
 * Cache semantics, kept by the shared cache core in `usage-reader.ts`:
 * - A successful `read()` stores the projection until `ttlMs` elapses.
 * - Concurrent non-force `read()` calls share one in-flight GET.
 * - `read({ force: true })` always issues a new GET and never joins an
 *   existing in-flight read (forced or not). A later completion of the
 *   abandoned in-flight GET cannot overwrite the forced result.
 * - `clear()` drops the stored projection and detaches any in-flight GET so
 *   its later completion cannot repopulate the cache.
 *
 * @module @aeven/experimental-subscription-auth/codex-usage
 */

import { LlmError } from '@aeven/llm'
import {
  type CodexAuthSession,
  type CodexFetch,
  type CodexHttpClient,
  isRecord,
  optionalNonEmptyString,
  resolveCodexHttpClient,
} from './codex-http.ts'
import { createCachedReader, type CachedReaderOptions } from './usage-reader.ts'

/** Official ChatGPT rate-limit usage endpoint used by the Codex client. */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** Codex rate limit window. */
export interface CodexRateLimitWindow {
  readonly usedPercent: number
  readonly remainingPercent: number
  readonly windowSeconds: number
  readonly resetsAt?: number
}

/** Codex rate limit. */
export interface CodexRateLimit {
  readonly id: string
  readonly name?: string
  readonly windows: readonly CodexRateLimitWindow[]
}

/** Codex credits. */
export interface CodexCredits {
  readonly unlimited: boolean
  readonly balance?: string
}

/** Codex individual limit. */
export interface CodexIndividualLimit {
  readonly limit: string
  readonly used: string
  readonly remaining?: string
  readonly remainingPercent: number
  readonly resetsAt?: number
}

/** Codex usage. */
export interface CodexUsage {
  readonly rateLimits: readonly CodexRateLimit[]
  readonly credits?: CodexCredits
  readonly individualLimit?: CodexIndividualLimit
  readonly spendControlReached?: boolean
  readonly resetCredits?: { readonly availableCount: number }
  readonly fetchedAt: number
}

/** Options for codex usage reader. */
export interface CodexUsageReaderOptions {
  readonly auth: CodexAuthSession
  readonly http?: CodexHttpClient
  readonly fetchImpl?: CodexFetch
  readonly originator?: string
  readonly userAgent?: string
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly now?: () => number
  readonly ttlMs?: number
}

/** Codex usage reader. */
export interface CodexUsageReader {
  read(options?: { force?: boolean; signal?: AbortSignal }): Promise<CodexUsage>
  clear(): void
}

const DEFAULT_TTL_MS = 60_000

function finitePercent(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function epochSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === 0) return undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function decimalAmount(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^-?\d+(?:\.\d+)?$/u.test(value)
    ? value
    : undefined
}

function parseWindow(value: unknown): CodexRateLimitWindow | undefined {
  if (!isRecord(value)) return undefined
  const usedPercent = finitePercent(value['used_percent'])
  const windowSeconds = positiveInt(value['limit_window_seconds'])
  if (usedPercent === undefined || windowSeconds === undefined) return undefined
  const resetsAt = epochSeconds(value['reset_at'])
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowSeconds,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function parseLimit(id: string, name: string | undefined, value: unknown): CodexRateLimit | undefined {
  if (!isRecord(value)) return undefined
  const windows = [parseWindow(value['primary_window']), parseWindow(value['secondary_window'])].filter(
    (window): window is CodexRateLimitWindow => window !== undefined,
  )
  if (windows.length === 0) return undefined
  return { id, ...(name === undefined ? {} : { name }), windows }
}

/**
 * An account without purchased credits still reports the object with
 * `has_credits: false`; ChatGPT shows that as a zero balance, so it is kept.
 */
function parseCredits(value: unknown): CodexCredits | undefined {
  if (!isRecord(value) || typeof value['has_credits'] !== 'boolean' || typeof value['unlimited'] !== 'boolean') {
    return undefined
  }
  const balance = value['has_credits'] ? decimalAmount(value['balance']) : undefined
  return {
    unlimited: value['unlimited'],
    ...(balance === undefined ? {} : { balance }),
  }
}

function parseIndividualLimit(value: unknown): CodexIndividualLimit | undefined {
  if (!isRecord(value)) return undefined
  const individual = value['individual_limit']
  if (!isRecord(individual)) return undefined
  const remainingPercent = finitePercent(individual['remaining_percent'])
  const limit = decimalAmount(individual['limit'])
  const used = decimalAmount(individual['used'])
  if (remainingPercent === undefined || limit === undefined || used === undefined) return undefined
  const remaining = decimalAmount(individual['remaining'])
  const resetsAt = epochSeconds(individual['reset_at'])
  return {
    limit,
    used,
    remainingPercent,
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function copyUsage(usage: CodexUsage): CodexUsage {
  return { ...usage, rateLimits: [...usage.rateLimits] }
}

/**
 * Reduce an opaque `wham/usage` payload to a secret-free quota projection.
 * Unknown extra fields are ignored; malformed optional buckets are skipped.
 * @param value - Value to process.
 * @param fetchedAt - Fetched at value.
 * @returns The resulting normalize codex usage.
 */
export function normalizeCodexUsage(value: unknown, fetchedAt = Date.now()): CodexUsage {
  if (!isRecord(value)) {
    throw new LlmError('Codex returned a malformed usage response', 'SERVER')
  }
  const rateLimits: CodexRateLimit[] = []
  const seen = new Set<string>()
  const add = (limit: CodexRateLimit | undefined): void => {
    if (limit === undefined || seen.has(limit.id)) return
    seen.add(limit.id)
    rateLimits.push(limit)
  }
  add(parseLimit('codex', 'Codex', value['rate_limit']))
  const additional = value['additional_rate_limits']
  if (Array.isArray(additional)) {
    for (const entry of additional) {
      if (!isRecord(entry)) continue
      const id = optionalNonEmptyString(entry['metered_feature'])
      if (id === undefined) continue
      const name = optionalNonEmptyString(entry['limit_name'])
      add(parseLimit(id, name, entry['rate_limit']))
    }
  }
  add(parseLimit('code_review', 'Code review', value['code_review_rate_limit']))
  const credits = parseCredits(value['credits'])
  const individualLimit = parseIndividualLimit(value['spend_control'])
  const spendControlReached =
    isRecord(value['spend_control']) && typeof value['spend_control']['reached'] === 'boolean'
      ? value['spend_control']['reached']
      : undefined
  const resetRaw = value['rate_limit_reset_credits']
  const resetCount = isRecord(resetRaw) ? resetRaw['available_count'] : undefined
  const resetCredits =
    typeof resetCount === 'number' && Number.isSafeInteger(resetCount) && resetCount >= 0
      ? { availableCount: resetCount }
      : undefined
  return {
    rateLimits,
    fetchedAt,
    ...(credits === undefined ? {} : { credits }),
    ...(individualLimit === undefined ? {} : { individualLimit }),
    ...(spendControlReached === undefined ? {} : { spendControlReached }),
    ...(resetCredits === undefined ? {} : { resetCredits }),
  }
}

/**
 * Cached, injectable usage reader. Failures do not invent quota numbers.
 *
 * See the module doc for `force` / `clear` cache semantics.
 * @param options - Operation options.
 * @returns The created codex usage reader.
 */
export function createCodexUsageReader(options: CodexUsageReaderOptions): CodexUsageReader {
  const http = resolveCodexHttpClient(options)
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  const load: CachedReaderOptions<CodexUsage>['load'] = async (signal) => {
    const payload = await http.requestJson({
      url: CODEX_USAGE_URL,
      method: 'GET',
      headers: { 'cache-control': 'no-store' },
      ...(signal === undefined ? {} : { signal }),
    })
    return normalizeCodexUsage(payload, now())
  }

  return createCachedReader<CodexUsage>({
    load,
    now,
    lifetimeOf: () => ttlMs,
    copy: copyUsage,
  })
}
