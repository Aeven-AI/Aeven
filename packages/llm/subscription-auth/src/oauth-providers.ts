/**
 * Native pi-ai OAuth providers and their stable Aeven route aliases.
 * @module @aeven/subscription-auth/oauth-providers
 */

import type { ApiKeyAuth, Provider } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import {
  CLAUDE_CODE_OAUTH_AUTH_FILENAME,
  CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
  CLAUDE_CODE_OAUTH_ROUTE,
  CLAUDE_PI_PROVIDER,
  CODEX_OAUTH_AUTH_FILENAME,
  CODEX_OAUTH_MODELS_CACHE_FILENAME,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
  type CodingOAuthProviderSlug,
} from './ids.ts'

/** Subscription provider slug. */
export type SubscriptionProviderSlug = Exclude<CodingOAuthProviderSlug, 'grok'>
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
  requestProvider(selectedIds?: readonly string[]): Provider
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

function selectedProvider(
  base: Provider,
  selectedIds: readonly string[] | undefined,
  apiKey: ApiKeyAuth | undefined,
): Provider {
  const selected = selectedIds === undefined || selectedIds.length === 0 ? undefined : new Set(selectedIds)
  return {
    ...base,
    auth: apiKey === undefined ? base.auth : { ...base.auth, apiKey },
    getModels: () => {
      const models = base.getModels()
      return selected === undefined ? models : models.filter(model => selected.has(model.id))
    },
  }
}

function asProvider(factory: () => Provider): () => Provider {
  return factory
}

const createCodexProvider = asProvider(openaiCodexProvider)
const createClaudeProvider = asProvider(anthropicProvider)

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
  requestProvider: selectedIds =>
    selectedProvider(createCodexProvider(), selectedIds, requestTokenAuth('OpenAI Codex OAuth token')),
}

/** Provider definition for claude code oauth. */
export const CLAUDE_CODE_OAUTH_PROVIDER: OAuthProviderDefinition = {
  slug: 'claude',
  route: CLAUDE_CODE_OAUTH_ROUTE,
  nativeProviderId: CLAUDE_PI_PROVIDER,
  displayName: 'Claude Code (Pro/Max)',
  authFilename: CLAUDE_CODE_OAUTH_AUTH_FILENAME,
  modelsCacheFilename: CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
  loginMethods: ['browser'],
  recommendedLoginMethod: 'browser',
  providerFactory: createClaudeProvider,
  requestProvider: selectedIds => selectedProvider(createClaudeProvider(), selectedIds, undefined),
}

/** Oauth provider definitions. */
export const OAUTH_PROVIDER_DEFINITIONS = [
  CODEX_OAUTH_PROVIDER,
  CLAUDE_CODE_OAUTH_PROVIDER,
] as const

/**
 * Oauth provider definition.
 * @param slug - Slug value.
 * @returns The resulting oauth provider definition.
 */
export function oauthProviderDefinition(slug: string): OAuthProviderDefinition | undefined {
  return OAUTH_PROVIDER_DEFINITIONS.find(provider => provider.slug === slug)
}
