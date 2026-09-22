/**
 * Request origin and loopback-host handling for served pages.
 *
 * A page is addressed by whatever spelling the reader arrived on: a bookmark,
 * `localhost`, `127.0.0.1`, a second port, or a proxy in front. Deployment URLs
 * are configured once, so a loopback deployment would otherwise hand the page a
 * URL under a different spelling than the page itself — a different origin to the
 * browser, and one the client had to repair after the fact. The Host knows the
 * request, so the decision belongs here.
 * @module @aeven/host-webserver/origin
 */

import type { IncomingMessage } from 'node:http'

/**
 * Hostnames that address this machine.
 *
 * The client keeps its own copy for emissions that carry no origin (the worker
 * boot payload), so a change here has to be mirrored in
 * `packages/client/ui-auth-aeven/src/client/auth/services/config.ts`; the two
 * lists are deliberately identical, and drift between them is silent, which is
 * why each side's tests name the same four spellings.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Whether a URL hostname addresses this machine.
 * @param hostname - the `hostname` of a parsed URL, brackets included for IPv6.
 * @returns true for `localhost`, `127.0.0.1`, and `::1` in either spelling.
 */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname)
}

/**
 * The origin the request was addressed to, as `scheme://host[:port]`.
 *
 * The scheme comes from `X-Forwarded-Proto` when a proxy states it, because a
 * TLS-terminating proxy leaves the socket itself unencrypted; `req.protocol`
 * alone would report `http` for an `https` page. Without that header the socket
 * decides. A request with no `Host` carries no origin and returns `undefined`.
 * @param req - the node:http request.
 * @returns the request's origin, or undefined when it states no host.
 */
export function requestOrigin(req: IncomingMessage): string | undefined {
  const host = req.headers.host
  if (host === undefined || host === '') return undefined
  const forwarded = req.headers['x-forwarded-proto']
  const stated = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  // `encrypted` is stated by a TLS socket, while `IncomingMessage['socket']` is
  // a plain `Socket`, so TLS-ness is read structurally rather than by class.
  const socket = req.socket as IncomingMessage['socket'] & { encrypted?: boolean }
  const scheme = stated === undefined || stated === '' ? (socket.encrypted === true ? 'https' : 'http') : stated
  return `${scheme}://${host}`
}

/**
 * Address a configured URL under the spelling the request arrived on.
 *
 * Only the hostname moves, and only when the configured URL and the request are
 * both loopback: ports and paths stay as configured, a real deployment
 * (`aeven.ai`) and a provider's own domain (`x.com`) pass through untouched, and
 * a page reached over loopback is handed a provider URL on its own spelling so
 * the two are the same origin.
 * @param configured - the configured URL, or undefined when the deployment states none.
 * @param origin - the request's origin, or undefined when it carries none.
 * @returns the URL to hand this page, or undefined when none was configured.
 */
export function sameHostLoopbackUrl(configured: string | undefined, origin: string | undefined): string | undefined {
  if (configured === undefined || origin === undefined) return configured
  // The authority is swapped inside the configured string rather than rebuilt
  // from a parsed URL: a URL round trip adds a trailing slash to an origin that
  // carries no path, and these values are handed to the page as configured.
  const parts = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]+)([\s\S]*)$/.exec(configured)
  if (parts === null) return configured
  try {
    const url = new URL(configured)
    const requested = new URL(origin)
    if (!isLoopbackHost(url.hostname) || !isLoopbackHost(requested.hostname)) return configured
    const credentials = url.username === '' && url.password === ''
      ? ''
      : `${url.username}${url.password === '' ? '' : `:${url.password}`}@`
    const port = url.port === '' ? '' : `:${url.port}`
    return `${url.protocol}//${credentials}${requested.hostname}${port}${parts[3]}`
  } catch {
    // Not URLs: the deployment stated something this cannot reason about, so it
    // is handed over as configured and the page reports the failure itself.
    return configured
  }
}
