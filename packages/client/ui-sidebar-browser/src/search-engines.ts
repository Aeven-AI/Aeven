/**
 * The search engines the address bar can search with.
 *
 * Endpoints are external specifications rather than deployment choices, so
 * they are fixed here and the reader's engine is the setting. Every engine
 * answers completions in one envelope, `["query", ["completion", …]]`, so a
 * single parser serves all of them.
 */

/** Engine ids a reader may store; the settings schema accepts exactly these. */
export const SEARCH_ENGINE_IDS = ['google', 'duckduckgo'] as const

/** One engine the address bar can search with. */
export type SearchEngineId = typeof SEARCH_ENGINE_IDS[number]

/** Engine used until the reader picks another. */
export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'google'

/** Longest completion list kept from one engine answer. */
export const MAX_SUGGESTIONS = 8

/** One engine's endpoints. */
interface EngineEndpoints {
  /** Address rendering `query`'s results page. */
  readonly search: (query: string) => string
  /** Address answering `query`'s completions as JSON. */
  readonly suggest: (query: string) => string
}

const ENDPOINTS: Record<SearchEngineId, EngineEndpoints> = {
  google: {
    search: query => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    suggest: query => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`,
  },
  duckduckgo: {
    search: query => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    suggest: query => `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(query)}`,
  },
}

/**
 * Whether a value names an engine this build can search with.
 * @param value - value crossing the settings or wire boundary.
 * @returns whether it is one of {@link SEARCH_ENGINE_IDS}.
 */
export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return SEARCH_ENGINE_IDS.some(id => id === value)
}

/**
 * The results page for a query.
 * @param engine - engine to search with.
 * @param query - text the reader typed.
 * @returns the absolute address to load.
 */
export function searchUrl(engine: SearchEngineId, query: string): string {
  return ENDPOINTS[engine].search(query)
}

/**
 * The completion endpoint for a query.
 * @param engine - engine to ask.
 * @param query - text the reader has typed so far.
 * @returns the absolute address answering with the completion envelope.
 */
export function suggestUrl(engine: SearchEngineId, query: string): string {
  return ENDPOINTS[engine].suggest(query)
}

/**
 * Read one engine's completion answer, dropping anything the envelope does not
 * carry. A malformed or truncated body yields no completions rather than an
 * error: the address bar still navigates what the reader typed.
 * @param body - raw response body from a {@link suggestUrl} endpoint.
 * @returns the completions, deduplicated, in engine order, at most {@link MAX_SUGGESTIONS}.
 */
export function parseSuggestions(body: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // Truncated or non-JSON body: the engine answered nothing usable.
    return []
  }
  if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) return []
  const seen = new Set<string>()
  const completions: string[] = []
  for (const item of parsed[1] as unknown[]) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    completions.push(text)
    if (completions.length === MAX_SUGGESTIONS) break
  }
  return completions
}
