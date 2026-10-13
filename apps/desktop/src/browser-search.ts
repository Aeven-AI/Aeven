/**
 * Search-engine completions for the right sidebar browser's address bar.
 *
 * No engine answers its completion endpoint with CORS headers, so the app page
 * cannot ask one itself; the shell performs the request and hands the body back.
 * The endpoint is allowlisted rather than accepted as any URL: the app renderer
 * is this shell's own page, but a bridge that fetches whatever it is handed is a
 * general-purpose network proxy for anything that ever reaches it.
 */

/** Completion hosts this shell answers for, one per engine the address bar offers. */
const SUGGEST_HOSTS = new Set([
  'suggestqueries.google.com',
  'duckduckgo.com',
])

/** How long one completion request may take, in ms. */
const SUGGEST_TIMEOUT_MS = 5000

/** Largest body crossing back to the renderer, in bytes. */
const SUGGEST_MAX_BYTES = 64 * 1024

/**
 * Read at most `maxBytes` of a response, so an oversized or endless body cannot
 * cross the bridge whole.
 * @param response - the response to read.
 * @param maxBytes - byte limit of the returned text.
 * @returns the decoded body, cut at the limit.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return await response.text()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (bytes >= maxBytes) {
      await reader.cancel()
      break
    }
  }
  return text
}

/**
 * Fetch one engine's completions.
 * @param rawUrl - completion endpoint the renderer built for its engine.
 * @returns the response body, for the renderer to parse.
 * @throws {Error} when the endpoint is not an allowlisted HTTPS completion
 * endpoint, or when the request or its answer fails.
 */
export async function fetchSuggestions(rawUrl: unknown): Promise<string> {
  if (typeof rawUrl !== 'string') throw new Error('avn desktop: a completion endpoint must be a string')
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('avn desktop: a completion endpoint must be an absolute address')
  }
  if (url.protocol !== 'https:' || !SUGGEST_HOSTS.has(url.hostname)) {
    throw new Error(`avn desktop: ${url.hostname} is not a search completion host`)
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    headers: { accept: 'application/json, text/javascript' },
  })
  if (!response.ok) throw new Error(`avn desktop: ${url.hostname} answered ${String(response.status)}`)
  return await readCapped(response, SUGGEST_MAX_BYTES)
}
