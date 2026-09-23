/** Address-bar input to a URL the browser will navigate to. */

/** Schemes a guest may load. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

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

/**
 * Resolve what a reader typed into a URL to navigate to.
 *
 * A bare host becomes HTTPS, since a reader typing `example.com` means the
 * site rather than a relative path. A loopback address keeps `http`, because a
 * development server rarely serves TLS, and is advertised as `localhost` so
 * Chromium's dual-stack lookup reaches a server bound to only `::1` or
 * `127.0.0.1`.
 * @param input - raw address-bar text.
 * @returns the URL to load, or undefined when the text addresses nothing.
 */
export function resolveAddress(input: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `${isLoopbackCandidate(trimmed) ? 'http' : 'https'}://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return undefined
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return undefined
  if (url.hostname === '') return undefined

  if (isLoopbackHost(url.hostname)) url.hostname = 'localhost'
  return url.toString()
}

/** Whether text without a scheme names this machine, so it keeps `http`. */
function isLoopbackCandidate(text: string): boolean {
  const [authority = ''] = text.split('/')
  const [host = ''] = authority.split(':')
  return isLoopbackHost(host)
}
