/**
 * Native pi-ai OAuth providers and their stable Aeven route aliases.
 * @module @aeven/subscription-auth/oauth-providers
 */

import type { Api, ApiKeyAuth, Model, Provider } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import {
  CODEX_OAUTH_AUTH_FILENAME,
  CODEX_OAUTH_MODELS_CACHE_FILENAME,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
} from './ids.ts'

/** Slug of a provider served through pi-ai's native OAuth provider; Grok has its own session. */
export type SubscriptionProviderSlug = 'codex'
/** Subscription login method. */
export type SubscriptionLoginMethod = 'browser' | 'device'

/** Oauth provider definition. */
export interface OAuthProviderDefinition {
  slug: SubscriptionProviderSlug
  route: string
  nativeProviderId: string
  displayName: string
  authFilename: string
  modelsCacheFilename: string
  loginMethods: readonly SubscriptionLoginMethod[]
  recommendedLoginMethod: SubscriptionLoginMethod
  providerFactory(): Provider
  /** The request provider serving exactly `models`, which may include ids the shipped catalog lacks. */
  requestProvider(models: readonly Model<Api>[]): Provider
}

function requestTokenAuth(name: string): ApiKeyAuth {
  return {
    name,
    resolve: ({ credential }) => {
      const token = credential?.key?.trim()
      if (token === undefined || token.length === 0) return Promise.resolve(undefined)
      return Promise.resolve({ auth: { apiKey: token }, source: 'OAuth bridge' })
    },
  }
}

function servingProvider(base: Provider, models: readonly Model<Api>[], apiKey: ApiKeyAuth): Provider {
  return {
    ...base,
    auth: { ...base.auth, apiKey },
    getModels: () => [...models],
  }
}

const createCodexProvider = (): Provider => openaiCodexProvider()

/** Provider definition for codex oauth. */
export const CODEX_OAUTH_PROVIDER: OAuthProviderDefinition = {
  slug: 'codex',
  route: CODEX_OAUTH_ROUTE,
  nativeProviderId: CODEX_PI_PROVIDER,
  displayName: 'OpenAI Codex (ChatGPT Plus/Pro)',
  authFilename: CODEX_OAUTH_AUTH_FILENAME,
  modelsCacheFilename: CODEX_OAUTH_MODELS_CACHE_FILENAME,
  loginMethods: ['device', 'browser'],
  recommendedLoginMethod: 'device',
  providerFactory: createCodexProvider,
  requestProvider: models =>
    servingProvider(createCodexProvider(), models, requestTokenAuth('OpenAI Codex OAuth token')),
}

/** Oauth provider definitions. */
export const OAUTH_PROVIDER_DEFINITIONS = [CODEX_OAUTH_PROVIDER] as const

/**
 * Oauth provider definition.
 * @param slug - Slug value.
 * @returns The resulting oauth provider definition.
 */
export function oauthProviderDefinition(slug: string): OAuthProviderDefinition | undefined {
  return OAUTH_PROVIDER_DEFINITIONS.find(provider => provider.slug === slug)
}
