/**
 * Outbound JSON GET used by the Claude and Grok usage readers.
 *
 * `codex-http` cannot serve these: it pins every request to `chatgpt.com`
 * `/backend-api/` paths as a deliberate egress restriction. This module keeps
 * the same posture per provider — the caller supplies the one origin its
 * tokens may ever reach, and a URL outside it is refused before any request.
 *
 * @module @aeven/subscription-auth/usage-http
 */

import { safeMessage } from './redact.ts'

/** Response body cap. Quota documents are small; anything larger is a wrong endpoint. */
const MAX_BODY_BYTES = 262_144

const DEFAULT_TIMEOUT_MS = 15_000

/** Injected fetch. Tests pass a mock; production defaults to global fetch. */
export type UsageFetch = (input: string, init?: RequestInit) => Promise<Response>

/** Outcome of one usage GET, as data rather than exceptions for expected refusals. */
export type UsageHttpResult =
	| { readonly kind: 'ok'; readonly body: unknown }
	/** The provider refused on entitlement grounds (403), with its own detail. */
	| { readonly kind: 'forbidden'; readonly detail?: string }
	/** Credentials were rejected even after one refresh. */
	| { readonly kind: 'unauthorized' }

/** A transport or protocol failure. Distinct from a provider's considered refusal. */
export class UsageHttpError extends Error {
  /** Status implementation. */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'UsageHttpError'
    this.status = status
  }
}

/** Options for usage http. */
export interface UsageHttpOptions {
  /** Only URLs on this exact https origin may be requested. */
  readonly origin: string
  /** Resolve the current bearer token, refreshing if the session needs to. */
  resolveToken(): Promise<string | undefined>
  /** Drop the cached token after the provider rejected it. */
  invalidateToken(): Promise<void>
  readonly fetchImpl?: UsageFetch
  readonly timeoutMs?: number
}

function assertOrigin(url: string, origin: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UsageHttpError('usage URL is invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username !== '' || parsed.password !== '') {
    throw new UsageHttpError(`usage requests may only reach ${origin}`)
  }
  return parsed
}

async function readBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (reader === undefined) return {}
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- chunk-less read; a spec pins it
      if (value === undefined) continue
      total += value.byteLength
      if (total > MAX_BODY_BYTES) throw new UsageHttpError('usage response exceeded the size limit')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes).trim()
  if (text.length === 0) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new UsageHttpError('usage response was not JSON', response.status)
  }
}

/** Pull a human-readable refusal reason out of a provider error body, redacted. */
function detailOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  const error = record['error']
  const raw =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null
        ? (error as Record<string, unknown>)['message']
        : record['message']
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : safeMessage(trimmed)
}

/**
 * GET one JSON document with bearer auth, retrying once after a 401 refresh.
 *
 * 401 and 403 return as results rather than throwing: a free account hitting
 * an entitlement wall is an expected answer the card renders, not a fault.
 * @param url - absolute https URL on the configured origin.
 * @param headers - provider fingerprint headers merged under `Authorization`.
 * @param options - origin restriction, token seam, and injected transport.
 * @param signal - caller cancellation.
 * @returns the parsed body, or the provider's refusal.
 */
export async function usageGetJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  options: UsageHttpOptions,
  signal?: AbortSignal,
): Promise<UsageHttpResult> {
  const target = assertOrigin(url, options.origin)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const attempt = async (retrying: boolean): Promise<UsageHttpResult> => {
    const token = await options.resolveToken()
    if (token === undefined || token.length === 0) return { kind: 'unauthorized' }
    const controller = new AbortController()
    const onAbort = (): void =>{  controller.abort(signal?.reason as unknown) }
    if (signal !== undefined) {
      if (signal.aborted) throw signal.reason
      signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() =>{  controller.abort(new UsageHttpError('usage request timed out')) }, timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(target.toString(), {
        method: 'GET',
        headers: { ...headers, Authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason
      throw new UsageHttpError(safeMessage(error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    if (response.status === 401) {
      if (retrying) return { kind: 'unauthorized' }
      await options.invalidateToken()
      return attempt(true)
    }
    if (response.status === 403) {
      const body = await readBody(response).catch(() => undefined)
      const detail = detailOf(body)
      return { kind: 'forbidden', ...(detail === undefined ? {} : { detail }) }
    }
    if (!response.ok) {
      const body = await readBody(response).catch(() => undefined)
      const detail = detailOf(body)
      throw new UsageHttpError(
        `usage request failed (HTTP ${String(response.status)})${detail === undefined ? '' : `: ${detail}`}`,
        response.status,
      )
    }
    return { kind: 'ok', body: await readBody(response) }
  }

  return attempt(false)
}
