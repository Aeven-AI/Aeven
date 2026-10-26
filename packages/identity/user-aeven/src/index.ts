/**
 * Aeven authority for the authenticated-user seam.
 *
 * The resolver reads two credentials. The short-lived access token arrives as
 * `Authorization: Bearer` (the Remote stream gateway maps a WebSocket's bearer
 * subprotocol to the same header) and, when presented, decides alone. The
 * `refreshToken` cookie identifies only a request that presents no bearer. Both are
 * ES256 tokens verified against the public keys the Aeven API publishes at
 * `/.well-known/jwks.json`, mirroring the API's `authenticate` and
 * `authenticateSocketUpgrade`. This Host holds no secret that can sign a token.
 *
 * Verification is local, so identifying a caller costs no request to Aeven and
 * the seam stays synchronous. The price is that a token revoked before it
 * expires still verifies here; a sign-out invalidates the credential at its
 * source, which is what makes that window narrow in practice.
 * @module @aeven/identity-user-aeven
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { IdentityRequest, User, UserResolver } from '@aeven/identity-user'
import type {} from '@aeven/identity-user'
import { sameHostLoopbackUrl } from '@aeven/host-webserver'
import type {} from '@aeven/host-webserver'
import { credentialRef } from '@aeven/credentials'
import { verifyToken, type TokenType } from './jwt.ts'
import { RemoteKeySet } from './jwks.ts'

/** Cordis plugin name. */
export const name = 'identity-user-aeven'

/** Page global carrying {@link AevenClientConfig}; `avn-client-ui-auth-aeven` reads it. */
export const AEVEN_CLIENT_CONFIG_GLOBAL = '__AVN_AEVEN__'

/** Deployment endpoints the Host states in the served page; each is absent when unconfigured. */
export interface AevenClientConfig {
  readonly apiUrl?: string
  readonly xOAuthUrl?: string
  readonly appleOAuthUrl?: string
  readonly googleOAuthUrl?: string
  readonly webUrl?: string
  readonly mediaUrl?: string
  readonly oauthFlow?: OAuthFlow
}

/**
 * How a provider sign-in reaches the provider's consent screen.
 *
 * `redirect` navigates the page's own document: the reader leaves this origin,
 * the provider returns them to `<this origin>/oauth-result/<session>/<challenge>`,
 * and the kernel boots again on that document. A public deployment wants this —
 * it is the shape provider registrations and popup blockers both expect.
 *
 * `window` reaches the provider from a separate window and never moves the
 * application's document, so a reader who signs in keeps the page they were on.
 * An installed application serves its own page from a scheme or a loopback
 * origin, where a redirected document would be a second shell to boot and, on
 * the desktop, a new window to open. The landing document reports its result
 * back to the window that opened it and closes.
 */
export type OAuthFlow = 'redirect' | 'window'
/** The seam must exist before this authority can register into it. */
export const inject = ['identityUsers']

/** Config for the Aeven authority. */
export interface Config {
  /** Registry key under the seam. Defaults to `aeven`. */
  id?: string
  /**
   * Least time between two fetches of the API's key set. A token naming a key the
   * Host does not hold starts a fetch, so a rotated key is picked up without a restart.
   */
  jwksRefreshIntervalMs?: number
  /** Budget for one key set fetch. */
  jwksTimeoutMs?: number
  /**
   * File keeping the last key set fetched. A Host that starts with it verifies
   * tokens at once and refreshes the set in the background, so a reader signed
   * in before keeps working while the API is unreachable. Absent keeps the keys
   * in memory only, and the Host waits for its first fetch.
   */
  jwksCacheFile?: string
  /** Cookie carrying the refresh token for a request that presents no bearer. */
  refreshCookieName?: string
  /**
   * Origin of the Aeven API the browser signs in against, such as
   * `http://localhost:9000`. Absent leaves the web client with no
   * authentication surface, which is how a harness without Aeven behaves.
   */
  apiUrl?: string
  /** Provider sign-in URL; absent hides that provider's button. */
  xOAuthUrl?: string
  /** Provider sign-in URL; absent hides that provider's button. */
  appleOAuthUrl?: string
  /** Provider sign-in URL; absent hides that provider's button. */
  googleOAuthUrl?: string
  /**
   * How a provider sign-in reaches the provider, once any `*OAuthUrl` is set.
   *
   * Required with an oauth URL and meaningless without one, so a deployment
   * that offers a provider states which shape it serves rather than inheriting
   * one that suits a different deployment. A public site states `redirect`; an
   * installed application serving its own page states `window`.
   */
  oauthFlow?: OAuthFlow
  /**
   * Origin of the Aeven web client, such as `http://localhost:3030`. The
   * account menu links there; absent leaves the menu with no account rows,
   * because a harness that cannot name the account page must not invent one.
   */
  webUrl?: string
  /**
   * Origin serving Aeven's uploaded media, such as `http://localhost:9020`.
   * Profile-image paths are relative to it; absent leaves every reader on the
   * generated gradient.
   */
  mediaUrl?: string
  /**
   * Credential reference the access token this authority verifies answers to.
   *
   * The token is the caller's Aeven session, and `llm-aeven` presents one to
   * Aeven's own `/v1` on the caller's behalf, so the two must name the same
   * reference. Stated here as well as there because this authority is what
   * proves the token, and a name only one side knows publishes nothing. An
   * operator pointing a custom endpoint at Aeven sets both to the same value.
   */
  credentialRef?: string
}

export const Config: z<Config> = z.object({
  id: z.string().default('aeven'),
  jwksRefreshIntervalMs: z.natural().min(1).default(60_000),
  jwksTimeoutMs: z.natural().min(1).default(10_000),
  jwksCacheFile: z.string(),
  refreshCookieName: z.string().default('refreshToken'),
  credentialRef: z.string().default('AEVEN_TOKEN'),
  apiUrl: z.string(),
  xOAuthUrl: z.string(),
  appleOAuthUrl: z.string(),
  googleOAuthUrl: z.string(),
  oauthFlow: z.union(['redirect', 'window']),
  webUrl: z.string(),
  mediaUrl: z.string(),
})

/** Config after schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/**
 * Read one header from either representation the transports produce.
 * @param headers - Fetch `Headers` or a node:http header record.
 * @param name - lower-case header name.
 * @returns the single header value, or undefined when absent or repeated.
 */
function headerValue(headers: IdentityRequest['headers'], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = (headers as Record<string, string | readonly string[] | undefined>)[name]
  if (typeof value === 'string') return value
  // A repeated header is ambiguous about which credential to trust, so it names
  // no credential at all.
  return undefined
}

/**
 * Read one cookie without implementing general Cookie decoding.
 * @param header - the raw `cookie` header.
 * @param name - the cookie to read.
 * @returns the cookie value, or undefined when absent.
 */
function cookieValue(header: string, name: string): string | undefined {
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/**
 * Resolve how provider sign-ins reach their providers.
 *
 * Required exactly when the deployment offers one. A flow statement of its own
 * is ignored when no provider URL is configured: there is no sign-in for it to
 * describe, so an unconfigured authority stays unconfigured rather than
 * failing over a field nothing reads.
 * @param config - the authority's configured endpoints.
 * @returns the flow to state in the page, or undefined when no provider is offered.
 * @throws {Error} when a provider is offered without stating a flow.
 */
function resolveOAuthFlow(config: Config): OAuthFlow | undefined {
  const offers = config.xOAuthUrl !== undefined
    || config.appleOAuthUrl !== undefined
    || config.googleOAuthUrl !== undefined
  if (config.oauthFlow !== undefined) {
    if (!offers) return undefined
    return config.oauthFlow
  }
  if (!offers) return undefined
  throw new Error(
    'identity-user-aeven: oauthFlow is required when a provider URL is configured; '
    + "state 'redirect' for a page that may leave its document, or 'window' for one that may not",
  )
}

/**
 * Register the Aeven authority on the identity seam.
 * @param ctx - context carrying the seam.
 * @param config - registry key, secret references, and the cookie name.
 * @returns settles once the first key set fetch has completed or failed.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // schemastery (Config) has already filled every defaulted field.
  const { id, refreshCookieName, jwksRefreshIntervalMs, jwksTimeoutMs } = config as ResolvedConfig
  // Read at load: an offered provider with no stated flow is self-contained
  // misconfiguration, and failing when the page is served would report it hours
  // after the deployment that stated it.
  const oauthFlow = resolveOAuthFlow(config)

  // Without an API there are no published keys, so no token can verify and the
  // resolver admits nobody, the same as a deployment without Aeven.
  const keySet = config.apiUrl === undefined ? undefined : new RemoteKeySet({
    url: new URL('/.well-known/jwks.json', config.apiUrl).href,
    minRefreshIntervalMs: jwksRefreshIntervalMs,
    timeoutMs: jwksTimeoutMs,
    ...config.jwksCacheFile === undefined ? {} : { cacheFile: config.jwksCacheFile },
    warn: (message) =>{  ctx.logger('identity-user-aeven').warn(message) },
  })
  if (keySet !== undefined) {
    ctx.effect(() => () =>{  keySet.dispose() }, 'identity-user-aeven: key set')
  }

  /**
   * Verify one presented token against the published keys.
   * @param token - the compact JWS from a header or cookie.
   * @param type - the token type that transport carries.
   * @param nowSeconds - current time, for the expiry comparison.
   * @returns the verified user id, or undefined.
   */
  function verifiedUserId(token: string, type: TokenType, nowSeconds: number): string | undefined {
    if (keySet === undefined) return undefined
    const result = verifyToken(token, type, kid => keySet.keyFor(kid), nowSeconds)
    return result.kind === 'verified' ? result.userId : undefined
  }

  const resolver: UserResolver = {
    id,
    // The access token this resolver verifies is the same bearer `llm-aeven`
    // presents to Aeven's `/v1`, so the connection publishes each admitted one
    // and the model route follows the caller's rotation with no stored copy.
    credentialRef: credentialRef((config as ResolvedConfig).credentialRef),
    resolve(request: IdentityRequest): User | undefined {
      const nowSeconds = Math.floor(Date.now() / 1000)

      // A presented bearer is the page's own session and decides alone. The
      // refresh cookie is shared by every tab and port of the host, so falling
      // back to it when the bearer fails would identify whichever account
      // signed in last; the client renews a refused bearer and retries.
      const authorization = headerValue(request.headers, 'authorization')
      if (authorization !== undefined) {
        const [scheme, token] = authorization.split(' ')
        if (scheme?.toLowerCase() === 'bearer' && token !== undefined) {
          const userId = verifiedUserId(token, 'access', nowSeconds)
          return userId === undefined ? undefined : { id: userId }
        }
      }

      // Without a bearer, the cookie: a request the page sent with no session
      // token of its own, such as a socket from a client without the bearer hook.
      const cookie = headerValue(request.headers, 'cookie')
      if (cookie !== undefined) {
        const token = cookieValue(cookie, refreshCookieName)
        if (token !== undefined) {
          const userId = verifiedUserId(token, 'refresh', nowSeconds)
          if (userId !== undefined) return { id: userId }
        }
      }

      return undefined
    },
  }

  ctx.effect(() => ctx.identityUsers.registerResolver(resolver), 'identity-user-aeven: resolver')

  // The endpoints are deployment facts, not build facts, so the Host states
  // them in the page rather than the browser bundle carrying them. Each is
  // stated under the spelling *this request* arrived on: a page reached over
  // `localhost` is handed `http://localhost:9000`, not the configured
  // `127.0.0.1:9000`, so page and API stay one origin whichever arrival path the
  // reader used. A non-loopback deployment, and a provider's own domain, pass
  // through as configured.
  ctx.on('webserver/index-inject', (table, origin) => {
    const apiUrl = sameHostLoopbackUrl(config.apiUrl, origin)
    const xOAuthUrl = sameHostLoopbackUrl(config.xOAuthUrl, origin)
    const appleOAuthUrl = sameHostLoopbackUrl(config.appleOAuthUrl, origin)
    const googleOAuthUrl = sameHostLoopbackUrl(config.googleOAuthUrl, origin)
    const webUrl = sameHostLoopbackUrl(config.webUrl, origin)
    const mediaUrl = sameHostLoopbackUrl(config.mediaUrl, origin)
    const value: AevenClientConfig = {
      ...apiUrl === undefined ? {} : { apiUrl },
      ...xOAuthUrl === undefined ? {} : { xOAuthUrl },
      ...appleOAuthUrl === undefined ? {} : { appleOAuthUrl },
      ...googleOAuthUrl === undefined ? {} : { googleOAuthUrl },
      ...oauthFlow === undefined ? {} : { oauthFlow },
      ...webUrl === undefined ? {} : { webUrl },
      ...mediaUrl === undefined ? {} : { mediaUrl },
    }
    table.push({ kind: 'global', name: AEVEN_CLIENT_CONFIG_GLOBAL, value })
  })

  // The plugin becomes active once it holds keys to verify with: the cached set
  // when there is one, otherwise the first fetch, so a Host that waits for its
  // plugin tree does not admit its first requests while no token can verify yet.
  // The resolver is already registered, so those requests are refused rather
  // than unauthenticated; a failed fetch is reported through the logger and
  // later misses refresh in the background.
  if (keySet === undefined) return
  if (await keySet.load()) void keySet.refresh()
  else await keySet.refresh()
}
