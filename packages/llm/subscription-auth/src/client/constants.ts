/** Static tables for the Coding OAuth settings UI. */

import {
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_MODELS_PATH,
  CODING_OAUTH_STATUS_PATH,
} from 'dsh-coding-oauth-core/contracts'
import type { ProviderCardDefinition } from './types.ts'

/** Sign-in status for every provider. */
export const STATUS_PATH = CODING_OAUTH_STATUS_PATH
/** Start a sign-in for one provider and method. */
export const LOGIN_PATH = CODING_OAUTH_LOGIN_PATH
/** Finish a pending sign-in with the authorization code or redirect URL the user pasted. */
export const LOGIN_CODE_PATH = CODING_OAUTH_LOGIN_CODE_PATH
/** Cancel a provider's pending sign-in. */
export const LOGIN_CANCEL_PATH = CODING_OAUTH_LOGIN_CANCEL_PATH
/** Sign one provider out. */
export const LOGOUT_PATH = CODING_OAUTH_LOGOUT_PATH
/** Replace one provider's model selection. */
export const MODELS_PATH = CODING_OAUTH_MODELS_PATH

/**
 * Per-provider usage reads. Mirrors the Host `subscriptionUsagePath`; the
 * client bundle cannot import Host modules, so the one path rule is restated
 * rather than shared.
 */
export const SUBSCRIPTION_USAGE_PATH_PREFIX = '/plugins/avn-grok-build/usage/'

/**
 * Build the usage path for one provider slug.
 * @param slug - the provider slug as the status route spells it.
 * @returns the same-origin path to request.
 */
export function subscriptionUsagePath(slug: string): string {
  return `${SUBSCRIPTION_USAGE_PATH_PREFIX}${slug}`
}

/** Status poll cadence while any provider is signing in, in milliseconds. */
export const POLL_INTERVAL_MS = 1_000

/** The provider cards, in render order. */
export const PROVIDERS: readonly ProviderCardDefinition[] = [
  {
    slug: 'grok',
    titleKey: 'grokTitle',
    descriptionKey: 'grokDescription',
    localMethod: 'pkce',
    remoteMethod: 'device',
  },
  {
    slug: 'codex',
    titleKey: 'codexTitle',
    descriptionKey: 'codexDescription',
    localMethod: 'browser',
    remoteMethod: 'device',
  },
]
