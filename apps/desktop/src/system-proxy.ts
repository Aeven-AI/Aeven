/**
 * The operating system's proxy choice for Host requests, read from Chromium's resolver.
 *
 * `Session.resolveProxy()` evaluates the system proxy settings, PAC scripts and WPAD included, the
 * way the renderer's own requests do, and answers in PAC result syntax: entries such as
 * `PROXY host:port`, `HTTPS host:port`, `SOCKS5 host:port`, or `DIRECT`, separated by `;` in order
 * of preference.
 * @module
 */

/** Proxy URL scheme for each PAC keyword the Host's transport can use. */
const PAC_SCHEMES: Readonly<Partial<Record<string, string>>> = { PROXY: 'http', HTTPS: 'https', SOCKS5: 'socks5' }

/** SOCKS's registered port, which Chromium assumes for a SOCKS entry that names none. */
const SOCKS_DEFAULT_PORT = '1080'

/** Resolve the PAC-syntax proxy list for one URL; `Session.resolveProxy` in production. */
export type ChromiumProxyResolver = (url: string) => Promise<string>

/**
 * Turn one PAC result into the ordered routes the Host's undici transport can use.
 *
 * Entries keep their order. `PROXY`, `HTTPS`, and `SOCKS5` become `http:`, `https:`, and `socks5:`
 * proxy URLs, a `SOCKS5` entry without a port taking SOCKS's 1080 as Chromium does. `DIRECT` becomes
 * `null` and ends the list, since nothing after it is ever tried. `SOCKS` and `SOCKS4` entries (SOCKS
 * version 4, which the Host's transport cannot speak), QUIC entries, and entries carrying credentials
 * or a path are dropped. A result with no usable entry becomes `[null]`, a direct connection.
 * @param rules - `Session.resolveProxy()` result.
 * @returns at least one route, in order of preference.
 */
export function proxyRoutesFromPacResult(rules: string): (string | null)[] {
  const routes: (string | null)[] = []
  for (const entry of rules.split(';')) {
    const [keyword = '', server, ...rest] = entry.trim().split(/\s+/u)
    const kind = keyword.toUpperCase()
    if (kind === 'DIRECT') {
      routes.push(null)
      return routes
    }
    if (server === undefined || rest.length > 0) continue
    const scheme = PAC_SCHEMES[kind]
    if (scheme === undefined || !URL.canParse(`${scheme}://${server}`)) continue
    const url = new URL(`${scheme}://${server}`)
    if (url.hostname === '' || url.username !== '' || url.password !== '') continue
    if (!['', '/'].includes(url.pathname) || url.search !== '' || url.hash !== '') continue
    // `socks5:` is not a special URL scheme, so `URL.origin` is "null" and no default port applies.
    const route = scheme === 'socks5' ? `socks5://${url.hostname}:${url.port === '' ? SOCKS_DEFAULT_PORT : url.port}` : url.origin
    if (!routes.includes(route)) routes.push(route)
  }
  return routes.length === 0 ? [null] : routes
}

/**
 * Answer one Host proxy question.
 * @param resolve - Chromium's resolver for the session whose network settings the Host follows.
 * @param url - the `http:` or `https:` URL the Host is about to request.
 * @returns the routes in order of preference, `null` meaning direct; `[null]` when Chromium cannot resolve.
 */
export async function hostProxyRoutesFor(resolve: ChromiumProxyResolver, url: string): Promise<(string | null)[]> {
  try {
    return proxyRoutesFromPacResult(await resolve(url))
  } catch (error) {
    console.warn(`desktop: could not resolve the system proxy for the Host; connecting directly: ${error instanceof Error ? error.message : String(error)}`)
    return [null]
  }
}
