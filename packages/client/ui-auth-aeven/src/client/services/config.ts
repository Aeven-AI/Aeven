/**
 * Deployment facts the Aeven screens read.
 *
 * Injected by the Host into the served index rather than read from Vite's
 * `import.meta.env`: DSH serves a built bundle, so the Aeven endpoints are
 * deployment configuration, not build configuration.
 * @module
 */

/** What the Host injects; absent in a harness with no Aeven authority. */
export interface AevenClientConfig {
  readonly apiUrl?: string
  readonly xOAuthUrl?: string
  readonly appleOAuthUrl?: string
  readonly googleOAuthUrl?: string
  readonly webUrl?: string
  readonly mediaUrl?: string
  readonly confettiColors?: readonly string[]
}

/**
 * Read the injected configuration.
 * @returns the configuration, or an empty one when nothing was injected.
 */
export function aevenConfig(): AevenClientConfig {
  return (globalThis as { __DSH_AEVEN__?: AevenClientConfig }).__DSH_AEVEN__ ?? {}
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
 * The provider sign-in URLs.
 *
 * A provider with no URL configured is one this deployment does not offer, and
 * its button does nothing rather than navigating to `undefined`.
 * @returns the URL per provider, each absent when unconfigured.
 */
export function oauthUrls(): { x?: string; apple?: string; google?: string } {
  const config = aevenConfig()
  return {
    ...config.xOAuthUrl === undefined ? {} : { x: config.xOAuthUrl },
    ...config.appleOAuthUrl === undefined ? {} : { apple: config.appleOAuthUrl },
    ...config.googleOAuthUrl === undefined ? {} : { google: config.googleOAuthUrl },
  }
}

/**
 * Palette for the sign-up celebration, defaulted to the Aeven client's.
 * @returns the confetti colours to draw.
 */
export function confettiColors(): readonly string[] {
  return aevenConfig().confettiColors ?? ['#fcf403', '#62fc03', '#03e7fc', '#a503fc', '#fc03ad']
}
