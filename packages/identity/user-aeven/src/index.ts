/**
 * Aeven authority for the authenticated-user seam.
 *
 * The Aeven client presents a different credential per transport, so this
 * resolver reads both: an HTTP RPC call carries the short-lived access token in
 * `Authorization: Bearer`, while a WebSocket upgrade carries only the
 * `refreshToken` cookie, because a browser cannot set a header on one. Each is
 * verified against its own shared secret, mirroring the Aeven API's
 * `authenticate` and `authenticateSocketUpgrade`.
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
import type {} from '@aeven/host-webserver'
import { verifiedUserId } from './jwt.ts'

/** Cordis plugin name. */
export const name = 'identity-user-aeven'

/** Page global carrying {@link AevenClientConfig}; `dsh-client-ui-auth-aeven` reads it. */
export const AEVEN_CLIENT_CONFIG_GLOBAL = '__DSH_AEVEN__'

/** Deployment endpoints the Host states in the served page; each is absent when unconfigured. */
export interface AevenClientConfig {
  readonly apiUrl?: string
  readonly xOAuthUrl?: string
  readonly appleOAuthUrl?: string
  readonly googleOAuthUrl?: string
  readonly webUrl?: string
  readonly mediaUrl?: string
}
/** The seam must exist before this authority can register into it. */
export const inject = ['identityUsers']

/** Config for the Aeven authority. */
export interface Config {
  /** Registry key under the seam. Defaults to `aeven`. */
  id?: string
  /** Environment variable holding the access-token secret; the API's `JWT_SECRET`. */
  accessSecretEnv?: string
  /** Environment variable holding the refresh-token secret; the API's `REFRESH_SECRET`. */
  refreshSecretEnv?: string
  /** Cookie carrying the refresh token on a WebSocket upgrade. */
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
}

export const Config: z<Config> = z.object({
  id: z.string().default('aeven'),
  accessSecretEnv: z.string().default('AEVEN_JWT_SECRET'),
  refreshSecretEnv: z.string().default('AEVEN_REFRESH_SECRET'),
  refreshCookieName: z.string().default('refreshToken'),
  apiUrl: z.string(),
  xOAuthUrl: z.string(),
  appleOAuthUrl: z.string(),
  googleOAuthUrl: z.string(),
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
 * Register the Aeven authority on the identity seam.
 * @param ctx - context carrying the seam.
 * @param config - registry key, secret references, and the cookie name.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { id, accessSecretEnv, refreshSecretEnv, refreshCookieName } = config as ResolvedConfig

  const resolver: UserResolver = {
    id,
    resolve(request: IdentityRequest): User | undefined {
      const nowSeconds = Math.floor(Date.now() / 1000)

      // The bearer first: an HTTP call carries the access token, which is the
      // shorter-lived of the two and the one the client keeps fresh.
      const authorization = headerValue(request.headers, 'authorization')
      const accessSecret = process.env[accessSecretEnv]
      if (authorization !== undefined && accessSecret !== undefined && accessSecret !== '') {
        const [scheme, token] = authorization.split(' ')
        if (scheme?.toLowerCase() === 'bearer' && token !== undefined) {
          const userId = verifiedUserId(token, accessSecret, nowSeconds)
          if (userId !== undefined) return { id: userId }
        }
      }

      // Then the cookie: a WebSocket upgrade has no way to send a header, so
      // the refresh token is the only credential it can present.
      const cookie = headerValue(request.headers, 'cookie')
      const refreshSecret = process.env[refreshSecretEnv]
      if (cookie !== undefined && refreshSecret !== undefined && refreshSecret !== '') {
        const token = cookieValue(cookie, refreshCookieName)
        if (token !== undefined) {
          const userId = verifiedUserId(token, refreshSecret, nowSeconds)
          if (userId !== undefined) return { id: userId }
        }
      }

      return undefined
    },
  }

  ctx.effect(() => ctx.identityUsers.registerResolver(resolver), 'identity-user-aeven: resolver')

  // The endpoints are deployment facts, not build facts, so the Host states
  // them in the page rather than the browser bundle carrying them.
  ctx.on('webserver/index-inject', (table) => {
    const value: AevenClientConfig = {
      ...config.apiUrl === undefined ? {} : { apiUrl: config.apiUrl },
      ...config.xOAuthUrl === undefined ? {} : { xOAuthUrl: config.xOAuthUrl },
      ...config.appleOAuthUrl === undefined ? {} : { appleOAuthUrl: config.appleOAuthUrl },
      ...config.googleOAuthUrl === undefined ? {} : { googleOAuthUrl: config.googleOAuthUrl },
      ...config.webUrl === undefined ? {} : { webUrl: config.webUrl },
      ...config.mediaUrl === undefined ? {} : { mediaUrl: config.mediaUrl },
    }
    table.push({ kind: 'global', name: AEVEN_CLIENT_CONFIG_GLOBAL, value })
  })
}
