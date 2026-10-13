/**
 * Discord REST client for one guild's connector process.
 *
 * Every request carries the `Authorization` value the connector passed. Aeven's
 * connector sends its calls to the Aeven API's Discord proxy with the owner's
 * session; the proxy acts as the application's bot only inside the owner's guild,
 * so this process never holds the bot token. Failures become {@link DiscordError}, which carries the HTTP
 * status and a sentence written here — never Discord's response body, because a
 * body can carry other people's text.
 */

import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

/** HTTP verbs this client issues. */
export type DiscordMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** Per-call additions to a request. */
export interface DiscordRequestOptions {
  /** JSON body, serialized with `content-type: application/json`. */
  body?: unknown
  /** Extra request headers, such as `X-Audit-Log-Reason`. */
  headers?: Record<string, string> | undefined
  /** Caller cancellation, combined with the client's own network budget. */
  signal?: AbortSignal | undefined
}

/** One file upload: the local path, its size cap, and the payload Discord reads beside it. */
export interface DiscordUploadOptions {
  /** Local path of the one file to upload. */
  filePath: string
  /** Message fields sent as `payload_json` beside `files[0]`. */
  payload: Record<string, unknown>
  /** Largest accepted file size. A larger file is refused before any request. */
  maxBytes: number
  /** Extra request headers, such as `X-Audit-Log-Reason`. */
  headers?: Record<string, string> | undefined
  /** Caller cancellation, combined with the client's own network budget. */
  signal?: AbortSignal | undefined
}

/** Constructor values of {@link DiscordRest}. */
export interface DiscordRestOptions {
  /** `Authorization` header value every request carries. */
  authorization: string
  /** API base, such as `https://discord.com/api/v10`. */
  baseUrl: string
  /** Network budget for one logical call, covering every attempt and wait it makes. */
  timeoutMs: number
}

/** Attempts per logical call, counting the first. */
const MAX_ATTEMPTS = 3
/** Longest single rate-limit wait. A longer wait fails the call instead of holding it. */
const MAX_RATE_LIMIT_WAIT_MS = 15_000
/** Pause before re-sending an idempotent request that Discord answered with a server failure. */
const SERVER_FAILURE_DELAY_MS = 250
/** Wait used when Discord reports a rate limit without naming one. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000

/** Fixed sentences failures map to. Discord's own text never reaches them. */
const MESSAGES = {
  /** 401. */
  token: 'Discord rejected the bot token.',
  /** 403. */
  refused: 'Discord refused this request for the bot user.',
  /** 404. */
  missing: 'Discord holds nothing at this path.',
  /** Any other 4xx. */
  rejected: 'Discord rejected this request.',
  /** 5xx. */
  failed: 'Discord reported a server failure.',
  /** 429 that outlived the attempt cap. */
  rateLimited: 'Discord rate-limited this request past the retry budget.',
  /** 429 naming a wait longer than this client will hold a call open. */
  longWait: 'Discord asked for a longer wait than this tool can hold.',
  /** No response arrived. */
  unanswered: 'Discord did not answer the request.',
  /** A response body that is not JSON. */
  unreadable: 'Discord answered with a body this client could not read.',
  /** 413, and the local size cap. */
  tooLarge: 'The file is larger than this connector may upload.',
  /** A file that is absent, unreadable, or not a regular file. */
  absentFile: 'No readable file exists at the given path.',
} as const

/** A Discord failure: the HTTP status, and a sentence written by this package. */
export class DiscordError extends Error {
  /** HTTP status of the answer, or `0` when no answer arrived. */
  readonly status: number

  /**
   * @param status - HTTP status of the answer, or `0` when no answer arrived.
   * @param message - fixed sentence written by this package.
   */
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DiscordError'
    this.status = status
  }
}

/**
 * Whether Discord refused a guild lookup, which the caller reads as "the bot is not in this guild".
 * @param error - the value a request threw.
 * @returns true for HTTP 403 and 404, the two answers that mean the guild is out of reach.
 */
export function isGuildUnreachable(error: unknown): boolean {
  return error instanceof DiscordError && (error.status === 403 || error.status === 404)
}

/**
 * The fixed sentence for a status.
 * @param status - HTTP status Discord answered with.
 * @returns the sentence, with the status appended.
 */
function fixedMessage(status: number): string {
  if (status === 401) return `${MESSAGES.token} (HTTP ${status})`
  if (status === 403) return `${MESSAGES.refused} (HTTP ${status})`
  if (status === 404) return `${MESSAGES.missing} (HTTP ${status})`
  if (status >= 500) return `${MESSAGES.failed} (HTTP ${status})`
  return `${MESSAGES.rejected} (HTTP ${status})`
}

/**
 * Convert a header's value into a wait.
 * @param value - header value in seconds, possibly fractional.
 * @returns the wait in whole milliseconds, or undefined when the header is absent or not a number.
 */
function secondsToMs(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return Math.ceil(seconds * 1000)
}

/**
 * Read the wait a 429 body names.
 * @param response - the 429 response.
 * @returns the wait in whole milliseconds, or undefined when the body is absent, not JSON, or says nothing usable.
 */
async function bodyRetryAfterMs(response: Response): Promise<number | undefined> {
  try {
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return undefined
    const retryAfter: unknown = (body as { retry_after?: unknown }).retry_after
    if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter < 0) return undefined
    return Math.ceil(retryAfter * 1000)
  } catch {
    // A 429 body that is absent or not JSON leaves the headers to carry the wait.
    return undefined
  }
}

/**
 * The wait a 429 asks for, preferring Discord's exact body value over its header hints.
 * @param response - the 429 response.
 * @returns the wait in whole milliseconds.
 */
async function rateLimitWaitMs(response: Response): Promise<number> {
  const fromBody = await bodyRetryAfterMs(response)
  const fromHeader = secondsToMs(response.headers.get('retry-after'))
  const fromBucket = response.headers.get('x-rate-limit-remaining') === '0'
    ? secondsToMs(response.headers.get('x-rate-limit-reset-after'))
    : undefined
  return fromBody ?? fromHeader ?? fromBucket ?? DEFAULT_RATE_LIMIT_WAIT_MS
}

/**
 * Decode a successful response.
 * @param response - a response Discord answered with 2xx.
 * @returns the decoded body, or undefined for an empty body.
 * @throws {DiscordError} when the body is present but not JSON.
 */
async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (text === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new DiscordError(0, MESSAGES.unreadable)
  }
}

/**
 * Size of a regular file.
 * @param path - local path to inspect.
 * @returns the size in bytes, or undefined when the path is absent, unreadable, or not a regular file.
 */
async function fileSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : undefined
  } catch {
    // An absent path and an unreadable path report the same fixed sentence as a directory does.
    return undefined
  }
}

/**
 * Hold the call open for a wait.
 * @param ms - milliseconds to pause.
 * @returns a promise that settles after the wait.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Discord's REST API, reached directly or through the Aeven API's proxy. */
export class DiscordRest {
  /** `Authorization` header value every request carries. */
  readonly authorization: string
  /** API base, without a trailing slash. */
  readonly baseUrl: string
  /** Network budget for one logical call, covering every attempt and wait it makes. */
  readonly timeoutMs: number

  /**
   * @param options - authorization, API base, and network budget.
   */
  constructor(options: DiscordRestOptions) {
    this.authorization = options.authorization
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.timeoutMs = options.timeoutMs
  }

  /**
   * Send one request and return Discord's decoded response.
   *
   * The declared response type is the caller's assertion: this client does not
   * validate Discord's response fields.
   * @param method - HTTP verb. Only `GET` is re-sent after a server failure or a lost connection.
   * @param path - API path starting with `/`, including any query string.
   * @param options - JSON body, extra headers, and caller cancellation.
   * @returns the response body, or undefined for a `204` or an empty body.
   * @throws {DiscordError} when Discord rejects the request or answers nothing usable.
   */
  async request<T = unknown>(method: DiscordMethod, path: string, options: DiscordRequestOptions = {}): Promise<T> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    return await this.#run<T>(method, path, options, body)
  }

  /**
   * Upload one file to a channel as a multipart message.
   * @param path - API path starting with `/`.
   * @param options - the local file, its size cap, the payload beside it, and caller cancellation.
   * @returns the decoded response, normally the created message.
   * @throws {DiscordError} when the file is unreadable, over the cap, or Discord rejects the request.
   */
  async upload<T = unknown>(path: string, options: DiscordUploadOptions): Promise<T> {
    const size = await fileSize(options.filePath)
    if (size === undefined) throw new DiscordError(0, MESSAGES.absentFile)
    if (size > options.maxBytes) throw new DiscordError(413, MESSAGES.tooLarge)
    let bytes: Buffer
    try {
      bytes = await readFile(options.filePath)
    } catch {
      // The file vanished or became unreadable between the size check and the read.
      throw new DiscordError(0, MESSAGES.absentFile)
    }
    const form = new FormData()
    form.append('payload_json', JSON.stringify(options.payload))
    form.append('files[0]', new Blob([new Uint8Array(bytes)]), basename(options.filePath))
    return await this.#run<T>('POST', path, options, form, false)
  }

  /**
   * Send one request, retrying within the budget and the attempt cap.
   * @param method - HTTP verb. Only `GET` is re-sent after a server failure or a lost connection.
   * @param path - API path starting with `/`.
   * @param options - extra headers and caller cancellation.
   * @param body - already-serialized request body.
   * @param json - whether the body needs the JSON content type. Multipart bodies set their own.
   * @returns the response body.
   * @throws {DiscordError} when Discord rejects the request or answers nothing usable.
   */
  async #run<T>(
    method: DiscordMethod,
    path: string,
    options: DiscordRequestOptions | DiscordUploadOptions,
    body: RequestInit['body'],
    json = true,
  ): Promise<T> {
    const startedAt = Date.now()
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const headers: Record<string, string> = { authorization: this.authorization, ...options.headers }
    if (json && body !== undefined) headers['content-type'] = 'application/json'

    for (let attempt = 1; ; attempt += 1) {
      let response: Response
      try {
        response = await fetch(`${this.baseUrl}${path}`, { method, headers, body, signal })
      } catch {
        // A write may already have landed, so a non-idempotent verb is never re-sent here.
        if (method !== 'GET' || attempt >= MAX_ATTEMPTS) throw new DiscordError(0, MESSAGES.unanswered)
        continue
      }

      if (response.status === 429) {
        const waitMs = await rateLimitWaitMs(response)
        if (waitMs > MAX_RATE_LIMIT_WAIT_MS || Date.now() + waitMs > startedAt + this.timeoutMs) {
          throw new DiscordError(429, MESSAGES.longWait)
        }
        if (attempt >= MAX_ATTEMPTS) throw new DiscordError(429, MESSAGES.rateLimited)
        await sleep(waitMs)
        continue
      }

      if (response.status >= 500) {
        if (method !== 'GET' || attempt >= MAX_ATTEMPTS) throw new DiscordError(response.status, MESSAGES.failed)
        await sleep(SERVER_FAILURE_DELAY_MS)
        continue
      }

      if (!response.ok) throw new DiscordError(response.status, fixedMessage(response.status))
      return await decode<T>(response)
    }
  }
}
