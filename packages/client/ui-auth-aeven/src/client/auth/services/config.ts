/**
 * Deployment facts the Aeven screens read.
 *
 * Injected by the Host into the served index rather than read from Vite's
 * `import.meta.env`: AVN serves a built bundle, so the Aeven endpoints are
 * deployment configuration, not build configuration.
 * @module
 */

/**
 * How a provider sign-in reaches its provider.
 *
 * `redirect` takes the reader's document to the provider and returns it to this
 * origin. `window` reaches the provider from a window of its own and leaves
 * that document alone. The Host resolves this for its deployment and states it
 * in the page; this client only reads it.
 */
export type OAuthFlow = 'redirect' | 'window'

/** What the Host injects; absent in a harness with no Aeven authority. */
export interface AevenClientConfig {
  readonly apiUrl?: string
  readonly xOAuthUrl?: string
  readonly appleOAuthUrl?: string
  readonly googleOAuthUrl?: string
  readonly webUrl?: string
  readonly mediaUrl?: string
  readonly confettiColors?: readonly string[]
  readonly oauthFlow?: OAuthFlow
}

/**
 * Read the injected configuration.
 * @returns the configuration, or an empty one when nothing was injected.
 */
export function aevenConfig(): AevenClientConfig {
  return (globalThis as { __AVN_AEVEN__?: AevenClientConfig }).__AVN_AEVEN__ ?? {}
}

/** Loopback names that address this machine but are different sites to a browser. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Follow the page's own loopback host, as {@link apiUrl} explains.
 * @param configured - the configured origin, or undefined.
 * @returns the origin to address, or undefined when none was configured.
 */
function sameSiteOrigin(configured: string | undefined): string | undefined {
  if (configured === undefined) return undefined
  try {
    const url = new URL(configured)
    if (LOOPBACK.has(url.hostname) && LOOPBACK.has(window.location.hostname)) {
      url.hostname = window.location.hostname
      return url.origin
    }
    return configured
  } catch {
    // Not a URL: the deployment stated something this cannot reason about, so
    // it is addressed as configured and the request reports the failure.
    return configured
  }
}

/**
 * The Aeven API origin every request below is sent to.
 *
 * A configured loopback host follows the page's own. `localhost` and
 * `127.0.0.1` reach the same machine but are different sites to a browser, so
 * a cookie the API sets under one is never returned under the other — the
 * reader signs in over HTTP and their socket, which has only the cookie to
 * present, is refused. Following the page keeps both on one site whichever
 * address was typed. A configured non-loopback host is a deployment's
 * deliberate choice and is left alone.
 * @returns the origin to send Aeven requests to.
 */
export function apiUrl(): string {
  return sameSiteOrigin(aevenConfig().apiUrl) ?? ''
}

/**
 * The Aeven web client's origin, which the account menu links to.
 * @returns the origin, or undefined when this deployment names no web client.
 */
export function webUrl(): string | undefined {
  return sameSiteOrigin(aevenConfig().webUrl)
}

/**
 * The origin serving uploaded media, which profile-image paths are relative to.
 * @returns the origin, or undefined when this deployment names no media host.
 */
export function mediaUrl(): string | undefined {
  return sameSiteOrigin(aevenConfig().mediaUrl)
}

/**
 * The same override, for a URL that carries a path.
 *
 * {@link sameSiteOrigin} answers an *origin*, which is right for a host and wrong for
 * a provider URL, whose path is the endpoint: `http://localhost:9020/oauth/x` must
 * come back as `http://127.0.0.1:9020/oauth/x`, not as the host it was addressed to.
 * So this swaps the loopback name and leaves the rest of the URL as the deployment
 * wrote it.
 * @param configured - the configured URL.
 * @returns the URL to address.
 */
function followingPage(configured: string): string {
  try {
    const url = new URL(configured)
    if (LOOPBACK.has(url.hostname) && LOOPBACK.has(window.location.hostname)) {
      url.hostname = window.location.hostname
    }
    return url.toString()
  } catch {
    return configured
  }
}

/**
 * The provider sign-in URLs.
 *
 * Through {@link sameSiteOrigin} for the same reason as the origins above, and this
 * is the one that was missing it. A provider sign-in lands on *our* web client, which
 * exchanges the provider's answer into this origin's session — and a session cookie is
 * host-scoped, so a deployment whose loopback name differs from the one the reader
 * typed puts the session somewhere this page can never read it. The reader is then
 * signed in on `localhost` while the application runs on `127.0.0.1`: the refresh
 * cookie is absent from every request made here, the two-hour access token expires,
 * and every request afterwards is refused as an invalid credential — which the reader
 * sees as "API key is invalid" with nothing they can do but sign in again.
 *
 * A provider with no URL configured is one this deployment does not offer, and its
 * button does nothing rather than navigating to `undefined`.
 * @returns the URL per provider, each absent when unconfigured.
 */
export function oauthUrls(): { x?: string; apple?: string; google?: string } {
  const config = aevenConfig()
  return {
    ...config.xOAuthUrl === undefined ? {} : { x: followingPage(config.xOAuthUrl) },
    ...config.appleOAuthUrl === undefined ? {} : { apple: followingPage(config.appleOAuthUrl) },
    ...config.googleOAuthUrl === undefined ? {} : { google: followingPage(config.googleOAuthUrl) },
  }
}

/**
 * How a provider sign-in reaches its provider on this deployment.
 *
 * A deployment that offers a provider states the flow and the Host refuses to
 * load without one, so the absent case is a page served by a Host that offers
 * no provider: there is no sign-in to route, and the value is read only by
 * code a provider button reaches. `redirect` is what the fallthrough answers so
 * that a provider configured without a flow takes the shape a provider
 * registration is written for, which is also the shape this client had before
 * the flow was a deployment's to state.
 * @returns the flow to reach a provider by.
 */
export function oauthFlow(): OAuthFlow {
  return aevenConfig().oauthFlow ?? 'redirect'
}

/**
 * Palette for the sign-up celebration, defaulted to the Aeven client's.
 * @returns the confetti colours to draw.
 */
export function confettiColors(): readonly string[] {
  return aevenConfig().confettiColors ?? ['#fcf403', '#62fc03', '#03e7fc', '#a503fc', '#fc03ad']
}
