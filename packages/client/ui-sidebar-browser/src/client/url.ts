/** Address-bar input to a URL the browser will navigate to, or to a search query. */

/** Schemes a guest may load. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

/** Leading token that names a URL scheme, so `mailto:x` is not read as a query. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Whether a hostname addresses this machine.
 *
 * Loopback is a primary target rather than an edge case: a development server
 * beside the session is the page most likely to be opened here.
 * @param hostname - the URL's hostname, without brackets for IPv6.
 * @returns true for the loopback names and addresses.
 */
export function isLoopbackHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '')
  return bare === 'localhost'
    || bare === '::1'
    || bare === '0.0.0.0'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
}

/** What an address-bar entry names: an address to load, or text to search for. */
export type AddressTarget =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'query'; readonly query: string }

/**
 * Resolve what a reader typed into the address bar.
 *
 * A combined field searches for text that names no host, as a browser's own
 * does; a scheme the guest cannot load names neither an address nor a query.
 * @param input - raw address-bar text.
 * @returns the address to load or the query to search for, or undefined when
 * the text names neither.
 */
export function resolveTarget(input: string): AddressTarget | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined
  const url = addressOf(trimmed)
  if (url !== undefined) return { kind: 'url', url }
  return SCHEME.test(trimmed) ? undefined : { kind: 'query', query: trimmed }
}

/**
 * Resolve the address text names, for callers that require one rather than
 * searching: the agent's navigation names a page, so text that reaches no host
 * is refused there instead of becoming a search.
 * @param input - raw address text.
 * @returns the URL to load, or undefined when the text names no address.
 */
export function resolveAddress(input: string): string | undefined {
  const trimmed = input.trim()
  return trimmed === '' ? undefined : addressOf(trimmed)
}

/**
 * The address an entry names, whether it is absolute or a bare host.
 * @param trimmed - address-bar text without surrounding whitespace.
 * @returns the URL to load, or undefined when the text names no host.
 */
function addressOf(trimmed: string): string | undefined {
  const absolute = parse(trimmed)
  if (absolute !== undefined) return absolute
  const host = bareHost(trimmed)
  if (host === undefined) return undefined
  // A bare host becomes HTTPS, since a reader typing `example.com` means the
  // site, while a loopback address keeps `http` because a development server
  // rarely serves TLS.
  return parse(`${isLoopbackHost(host) ? 'http' : 'https'}://${trimmed}`)
}

/**
 * Parse an absolute address the guest may load.
 *
 * The entry is read as a scheme only when the guest can load that scheme, so a
 * host carrying a port (`localhost:3000`, `example.com:8080`) falls through to
 * the bare-host rule instead of parsing as a scheme named after its host. A
 * loopback host is advertised as `localhost` so Chromium's dual-stack lookup
 * reaches a server bound to only `::1` or `127.0.0.1`.
 * @param text - text to read as an absolute address.
 * @returns the normalized URL, or undefined when the text is not one.
 */
function parse(text: string): string | undefined {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    // Not an absolute address; the caller decides whether it is a bare host.
    return undefined
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return undefined
  if (url.protocol === 'file:') return url.toString()
  if (url.hostname === '') return undefined
  if (isLoopbackHost(url.hostname)) url.hostname = 'localhost'
  return url.toString()
}

/**
 * The host a bare entry names, when it names one.
 *
 * Whitespace settles it: a reader typing a sentence means a query even when the
 * sentence contains a dot. A single word is a query too, since a name with no
 * dot reaches no public host.
 * @param text - text without a usable scheme.
 * @returns the host, or undefined when the text is not a host.
 */
function bareHost(text: string): string | undefined {
  if (/\s/.test(text)) return undefined
  let url: URL
  try {
    url = new URL(`https://${text}`)
  } catch {
    // A malformed authority — an unparsable or out-of-range port — names no host.
    return undefined
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === '') return undefined
  if (isLoopbackHost(host)) return host
  return /^[\w-]+(\.[\w-]+)+$/.test(host) ? host : undefined
}
