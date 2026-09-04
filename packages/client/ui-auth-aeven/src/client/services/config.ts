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
  readonly confettiColors?: readonly string[]
}

/**
 * Read the injected configuration.
 * @returns the configuration, or an empty one when nothing was injected.
 */
export function aevenConfig(): AevenClientConfig {
  return (globalThis as { __DSH_AEVEN__?: AevenClientConfig }).__DSH_AEVEN__ ?? {}
}

/** The Aeven API origin every request below is sent to. */
export function apiUrl(): string {
  return aevenConfig().apiUrl ?? ''
}

/**
 * The provider sign-in URLs.
 *
 * A provider with no URL configured is one this deployment does not offer, and
 * its button does nothing rather than navigating to `undefined`.
 */
export function oauthUrls(): { x?: string; apple?: string; google?: string } {
  const config = aevenConfig()
  return {
    ...config.xOAuthUrl === undefined ? {} : { x: config.xOAuthUrl },
    ...config.appleOAuthUrl === undefined ? {} : { apple: config.appleOAuthUrl },
    ...config.googleOAuthUrl === undefined ? {} : { google: config.googleOAuthUrl },
  }
}

/** Palette for the sign-up celebration, defaulted to the Aeven client's. */
export function confettiColors(): readonly string[] {
  return aevenConfig().confettiColors ?? ['#fcf403', '#62fc03', '#03e7fc', '#a503fc', '#fc03ad']
}
