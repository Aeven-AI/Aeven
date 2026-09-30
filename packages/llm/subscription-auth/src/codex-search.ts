/**
 * Optional Codex subscription search against the private ChatGPT backend.
 * Default-off: parent registers the returned provider only when the user enables it.
 *
 * @module @aeven/subscription-auth/codex-search
 */

import { LlmError } from '@aeven/llm'
import { randomUUID } from '@aeven/util-crypto'
import {
  type CodexAuthSession,
  type CodexFetch,
  type CodexHttpClient,
  isRecord,
  optionalNonEmptyString,
  resolveCodexHttpClient,
} from './codex-http.ts'

/** Stable search-provider id. Parent must not write this into `web.searchProvider` by default. */
export const CODEX_SEARCH_PROVIDER_ID = 'codex-oauth-search'

/** Official Codex standalone search endpoint. */
export const CODEX_SEARCH_URL = 'https://chatgpt.com/backend-api/codex/alpha/search'

/** Codex search context sizes. */
export const CODEX_SEARCH_CONTEXT_SIZES = ['low', 'medium', 'high'] as const
/** Codex search context size. */
export type CodexSearchContextSize = (typeof CODEX_SEARCH_CONTEXT_SIZES)[number]

/** Codex search modes. */
export const CODEX_SEARCH_MODES = ['live', 'cached', 'indexed'] as const
/** Codex search mode. */
export type CodexSearchMode = (typeof CODEX_SEARCH_MODES)[number]

/** Codex external web access. */
export type CodexExternalWebAccess = true | false | 'indexed'

/** Codex search source. */
export interface CodexSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
}

/** Codex search request. */
export interface CodexSearchRequest {
  readonly query: string
  readonly maxResults?: number
}

/** Codex search result. */
export interface CodexSearchResult {
  readonly content?: string
  readonly sources: readonly CodexSearchSource[]
  readonly truncated: boolean
}

/** Codex search request body. */
export interface CodexSearchRequestBody {
  readonly id: string
  readonly model: string
  readonly input: readonly [
    {
      readonly type: 'message'
      readonly role: 'user'
      readonly content: readonly [{ readonly type: 'input_text'; readonly text: string }]
    },
  ]
  readonly commands: {
    readonly search_query: readonly [{ readonly q: string }]
  }
  readonly settings: {
    readonly search_context_size: CodexSearchContextSize
    readonly allowed_callers: readonly ['direct']
    readonly external_web_access: CodexExternalWebAccess
  }
  readonly max_output_tokens: number
}

/** Options for codex search provider. */
export interface CodexSearchProviderOptions {
  readonly auth: CodexAuthSession
  readonly http?: CodexHttpClient
  readonly fetchImpl?: CodexFetch
  /** Current visible Codex model, or a live resolver for catalog/login changes. */
  readonly model: string | (() => string)
  readonly mode?: CodexSearchMode
  readonly contextSize?: CodexSearchContextSize
  readonly maxOutputTokens?: number
  readonly resolveRequestId?: () => string
  readonly originator?: string
  readonly userAgent?: string
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Structural `WebSearchProvider` so parent can register without this module importing avn-web. */
export interface CodexSearchProvider {
  readonly id: typeof CODEX_SEARCH_PROVIDER_ID
  available(): boolean
  search(request: CodexSearchRequest, signal?: AbortSignal): Promise<CodexSearchResult>
}

const DEFAULT_CONTEXT_SIZE: CodexSearchContextSize = 'medium'
const DEFAULT_MODE: CodexSearchMode = 'live'
const DEFAULT_MAX_OUTPUT_TOKENS = 1024

/**
 * Map configured search mode onto the verified `external_web_access` field.
 * @param mode - Mode value.
 * @returns The resulting external web access.
 */
export function externalWebAccess(mode: CodexSearchMode): CodexExternalWebAccess {
  switch (mode) {
    case 'cached':
      return false
    case 'indexed':
      return 'indexed'
    case 'live':
      return true
  }
}

/**
 * Accept only citeable http(s) URLs.
 * @param value - Value to process.
 * @returns The resulting citeable http url.
 */
export function citeableHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username !== '' || url.password !== '') return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Reject `<1` / non-finite `maxResults` rather than treating them as unlimited.
 * @param maxResults - Max results value.
 */
export function assertCodexSearchMaxResults(maxResults: number | undefined): void {
  if (maxResults === undefined) return
  if (!Number.isFinite(maxResults) || maxResults < 1) {
    throw new LlmError('Codex search maxResults must be a finite number of at least 1', 'INVALID_ARGS')
  }
}

/**
 * Map the standalone endpoint's forward-compatible result DTOs.
 * Only `type === "text_result"` items with valid http(s) URLs are kept; URLs are de-duplicated.
 * @param value - Value to process.
 * @param maxResults - Max results value.
 * @returns The resulting map codex search response.
 */
export function mapCodexSearchResponse(value: unknown, maxResults?: number): CodexSearchResult {
  assertCodexSearchMaxResults(maxResults)
  if (!isRecord(value) || typeof value['output'] !== 'string') {
    throw new LlmError('Codex returned a search response without string output', 'SERVER')
  }
  const output = value['output']
  const rawResults = value['results']
  if (rawResults !== undefined && !Array.isArray(rawResults)) {
    throw new LlmError('Codex returned a search response with non-array results', 'SERVER')
  }
  const sources: CodexSearchSource[] = []
  const seen = new Set<string>()
  for (const item of rawResults ?? []) {
    if (!isRecord(item) || item['type'] !== 'text_result') continue
    const url = citeableHttpUrl(item['url'])
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    const title = optionalNonEmptyString(item['title'])
    const snippet = optionalNonEmptyString(item['snippet'])
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
    })
  }
  const limited = maxResults === undefined ? sources : sources.slice(0, maxResults)
  return {
    ...(output.length === 0 ? {} : { content: output }),
    sources: limited,
    truncated: limited.length < sources.length,
  }
}

/**
 * Build codex search request body.
 * @param query - Query value.
 * @param options - Operation options.
 * @returns The resulting codex search request body.
 */
export function buildCodexSearchRequestBody(
  query: string,
  options: {
    id: string
    model: string
    mode: CodexSearchMode
    contextSize: CodexSearchContextSize
    maxOutputTokens: number
  },
): CodexSearchRequestBody {
  return {
    id: options.id,
    model: options.model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: query }],
      },
    ],
    commands: { search_query: [{ q: query }] },
    settings: {
      search_context_size: options.contextSize,
      allowed_callers: ['direct'],
      external_web_access: externalWebAccess(options.mode),
    },
    max_output_tokens: options.maxOutputTokens,
  }
}

/**
 * Factory for an injectable, default-off Codex search provider.
 * @param options - Operation options.
 * @returns The created codex search provider.
 */
export function createCodexSearchProvider(options: CodexSearchProviderOptions): CodexSearchProvider {
  const http = resolveCodexHttpClient(options)
  const mode = options.mode ?? DEFAULT_MODE
  const contextSize = options.contextSize ?? DEFAULT_CONTEXT_SIZE
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const resolveRequestId = options.resolveRequestId ?? (() => randomUUID())
  const configuredModel = options.model
  const resolveModel: () => string = typeof configuredModel === 'function' ? configuredModel : () => configuredModel
  const available = (): boolean =>
    resolveModel().trim().length > 0 && Number.isInteger(maxOutputTokens) && maxOutputTokens > 0

  return {
    id: CODEX_SEARCH_PROVIDER_ID,
    available,
    async search(request, signal) {
      const query = request.query.trim()
      if (query.length === 0) {
        throw new LlmError('Codex search requires a non-empty query', 'INVALID_ARGS')
      }
      assertCodexSearchMaxResults(request.maxResults)
      const model = resolveModel().trim()
      if (model.length === 0 || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
        throw new LlmError('Codex search is not configured', 'INVALID_ARGS')
      }
      const body = buildCodexSearchRequestBody(query, {
        id: resolveRequestId(),
        model,
        mode,
        contextSize,
        maxOutputTokens,
      })
      const payload = await http.requestJson({
        url: CODEX_SEARCH_URL,
        method: 'POST',
        body,
        ...(signal === undefined ? {} : { signal }),
      })
      return mapCodexSearchResponse(payload, request.maxResults)
    },
  }
}
