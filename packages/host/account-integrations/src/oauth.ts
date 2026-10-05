/** Account-bound OAuth consent and credential refresh for configured MCP providers. */

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@aeven/credentials'
import type { ConnectorId, ConnectorProvider } from './types.ts'

/** Deployment-owned OAuth application and optional remote MCP resource. */
export interface OAuthProviderConfig {
  /** MCP endpoint receiving this provider's access token. */
  endpoint?: string
  /** Provider authorization endpoint. */
  authorizationUrl: string
  /** Provider token endpoint. */
  tokenUrl: string
  /** Registered application identifier. */
  clientId: string
  /** Credential reference for a confidential application's secret. */
  clientSecretRef?: string
  /** Explicit delegated permissions requested at consent. */
  scopes: string[]
}

/** Validated bearer grant kept in the credential provider. */
export const grantSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.number().optional(),
})

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
})

/**
 * Derive a private credential address from the immutable account and connector ids.
 * @param owner - authenticated account id.
 * @param id - connector id.
 * @returns account-owned credential address.
 */
export function connectorCredential(owner: string, id: ConnectorId) {
  const account = createHash('sha256').update(owner).digest('hex')
  return credentialKey('account-integrations', `u-${account}-${id}`)
}

/** One state capability bound to the account which initiated consent. */
export interface PendingConsent {
  owner: string
  id: ConnectorId
  provider: ConnectorProvider
  verifier: string
  expiresAt: number
  /** In-flight callback whose writes must settle before disconnect removes the account. */
  completion?: Promise<void>
}

/**
 * Construct a PKCE authorization URL and its private state capability.
 * @param provider - registered OAuth application.
 * @param redirectUri - deployment's registered callback URL.
 * @param lifetimeMs - maximum consent duration.
 * @param account - owning account and connector.
 * @returns consent link, state key, and account-bound private state.
 */
export function createConsent(provider: OAuthProviderConfig, redirectUri: string, lifetimeMs: number,
  account: Pick<PendingConsent, 'owner' | 'id' | 'provider'>) {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const url = new URL(provider.authorizationUrl)
  url.searchParams.set('client_id', provider.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  url.searchParams.set('code_challenge_method', 'S256')
  if (['gmail', 'google-drive', 'google-calendar'].includes(account.provider)) {
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
  }
  return { url: url.href, state, consent: { ...account, verifier, expiresAt: Date.now() + lifetimeMs } }
}

/**
 * Exchange an authorization code or refresh token using the deployment's application.
 * @param ctx - credential provider context.
 * @param provider - configured OAuth application.
 * @param fields - grant-specific protocol fields.
 * @param signal - cancellation and network budget.
 * @returns validated bearer grant; provider response bodies never appear in errors.
 */
export async function exchangeGrant(ctx: Context, provider: OAuthProviderConfig,
  fields: Record<string, string>, signal: AbortSignal): Promise<z.infer<typeof grantSchema>> {
  const body = new URLSearchParams({ ...fields, client_id: provider.clientId })
  if (provider.clientSecretRef !== undefined) {
    const secret = await ctx.credentials.resolve(credentialRef(provider.clientSecretRef))
    if (secret === undefined) throw new Error('connector OAuth application secret is not configured')
    body.set('client_secret', secret.value)
  }
  const response = await fetch(provider.tokenUrl, { method: 'POST', headers: { Accept: 'application/json' }, body, signal, redirect: 'error' })
  if (!response.ok) throw new Error(`connector authorization failed (${response.status})`)
  const token = tokenSchema.parse(await response.json())
  return {
    accessToken: token.access_token,
    ...token.scope === undefined ? {} : { scopes: token.scope.split(/\s+/).filter(Boolean) },
    ...token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token },
    ...token.expires_in === undefined ? {} : { expiresAt: Date.now() + token.expires_in * 1000 },
  }
}
