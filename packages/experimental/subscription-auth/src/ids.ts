/** Compatibility facade for stable identifiers owned by dsh-coding-oauth-core. */

import { CLAUDE_CODE_OAUTH_ROUTE, CODEX_OAUTH_ROUTE, GROK_BUILD_ROUTE } from 'dsh-coding-oauth-core'

export type {
  CodingOAuthOptionalRoute,
  CodingOAuthProviderSlug,
} from 'dsh-coding-oauth-core'
export {
  ANTIGRAVITY_ROUTE,
  CAPABILITY_SETTINGS_NAMESPACE,
  CAPABILITY_SETTINGS_PATH,
  CLAUDE_CODE_OAUTH_AUTH_FILENAME,
  CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
  CLAUDE_CODE_OAUTH_ROUTE,
  CLAUDE_PI_PROVIDER,
  CODEX_OAUTH_AUTH_FILENAME,
  CODEX_OAUTH_FAST_ROUTE,
  CODEX_OAUTH_MODELS_CACHE_FILENAME,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
  CODEX_USAGE_PATH,
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_MANAGEMENT_PATHS,
  CODING_OAUTH_MODELS_PATH,
  CODING_OAUTH_OPTIONAL_ROUTES,
  CODING_OAUTH_STATE_SCHEMA_VERSION,
  CODING_OAUTH_STATUS_PATH,
  DEFAULT_GROK_BUILD_MODEL,
  GATEWAY_KEY_FILENAME,
  GATEWAY_REVEAL_PATH,
  GATEWAY_ROTATE_PATH,
  GATEWAY_SETTINGS_PATH,
  GROK_BUILD_AUTH_FILENAME,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
  GROK_BUILD_AUTH_MODELS_PATH,
  GROK_BUILD_AUTH_STATUS_PATH,
  GROK_BUILD_MODELS_CACHE_FILENAME,
  GROK_BUILD_ROUTE,
  GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
  IMAGINE_CREDENTIAL_STATUS_PATH,
  KIMI_CODE_OAUTH_AUTH_FILENAME,
  KIMI_CODE_OAUTH_MODELS_CACHE_FILENAME,
  KIMI_CODE_OAUTH_ROUTE,
  KIMI_PI_PROVIDER,
  OAUTH_IMPORT_CANCEL_PATH,
  OAUTH_IMPORT_COMMIT_PATH,
  OAUTH_IMPORT_PREVIEW_PATH,
  OAUTH_IMPORT_SOURCES_PATH,
  XAI_PI_PROVIDER,
} from 'dsh-coding-oauth-core'

/**
 * LLM routes the OAuth adapter serves, registered as one set. Owned here
 * because core's list also names `kimi-code-oauth`, which this package does
 * not serve: `llm.registerAdapter` rejects the whole set when the adapter
 * cannot describe any one route, leaving no subscription route registered.
 */
export const CODING_OAUTH_ROUTES = [GROK_BUILD_ROUTE, CODEX_OAUTH_ROUTE, CLAUDE_CODE_OAUTH_ROUTE] as const

/** One LLM route the OAuth adapter serves. */
export type CodingOAuthRoute = (typeof CODING_OAUTH_ROUTES)[number]

/**
 * Owned here since the `@aeven/experimental-subscription-auth` rename. Core still exports
 * the pre-rename directory as a shared on-disk contract, so it stays reachable as
 * the legacy name: an existing install's artifacts are moved over on first start.
 */
export const IMAGINE_MEDIA_STORE_DIRNAME = '.avn-subscription-auth-media' as const
export { IMAGINE_MEDIA_STORE_DIRNAME as LEGACY_IMAGINE_MEDIA_STORE_DIRNAME } from 'dsh-coding-oauth-core'

/** Multi-account mutations (peer core contracts do not list these yet). */
export const CODING_OAUTH_API_BASE = '/plugins/avn-grok-build' as const

/**
 * Per-provider subscription usage reads, owned here because core's
 * `CODEX_USAGE_PATH` names one provider and usage is now served for several.
 * The legacy path stays registered as an alias for the Codex provider.
 */
export const SUBSCRIPTION_USAGE_PATH_PREFIX = `${CODING_OAUTH_API_BASE}/usage/` as const

/**
 * The registered prefix route, without the trailing slash.
 *
 * The Host webserver matches a prefix `p` against `p` itself and `p/<rest>`,
 * so a registered value that already ends in `/` would only ever be tested
 * against `//<rest>` and could never match a request.
 */
export const SUBSCRIPTION_USAGE_ROUTE = `${CODING_OAUTH_API_BASE}/usage` as const

/**
 * Build the usage path for one provider slug.
 * @param slug - the provider slug as the status route spells it.
 * @returns the exact same-origin path the Settings client requests.
 */
export function subscriptionUsagePath(slug: string): string {
  return `${SUBSCRIPTION_USAGE_PATH_PREFIX}${slug}`
}
