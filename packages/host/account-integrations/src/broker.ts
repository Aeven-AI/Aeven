/**
 * Client of the Aeven API's connector broker.
 *
 * Connector application credentials — OAuth client secrets, the Discord bot token, the
 * Telegram application identifiers — and every OAuth refresh token live on the Aeven API,
 * never in this Host. The Host reaches them only through these calls, each authenticated
 * with the signed-in user's own Aeven access token, so one user's Host can act only on
 * that user's grants.
 */

import { z } from 'zod'
import type { DiscordGuild } from './discord.ts'
import type { ConnectorId, ConnectorProvider } from './types.ts'

/** Why a broker call failed; `reauthorize` means the user must consent again. */
export type BrokerFailure = 'signed-out' | 'not-configured' | 'not-connected' | 'reauthorize' | 'unavailable'

/** A broker refusal; `reason` is a fixed code, never a response body. */
export class BrokerError extends Error {
  /**
   * @param reason - the fixed failure code.
   * @param status - the HTTP status, when the API answered.
   */
  constructor(readonly reason: BrokerFailure, readonly status?: number) {
    super(`connector broker: ${reason}`)
    this.name = 'BrokerError'
  }
}

const startSchema = z.object({ url: z.url(), state: z.string().min(1), expiresAt: z.string() })
const guildSchema = z.object({ id: z.string().min(1), name: z.string(), icon: z.string().optional() })
const statusSchema = z.object({
  status: z.enum(['pending', 'connected', 'failed']),
  provider: z.string(),
  connectorId: z.string().optional(),
  error: z.string().optional(),
  adminConsentUrl: z.url().optional(),
  result: z.object({
    scopes: z.array(z.string()).optional(),
    tenantId: z.string().optional(),
    account: z.object({ id: z.string(), name: z.string(), username: z.string() }).optional(),
    guild: guildSchema.optional(),
    installer: z.object({ id: z.string(), name: z.string() }).optional(),
    botUserId: z.string().optional(),
    applicationId: z.string().optional(),
  }).optional(),
})
const tokenSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.string().optional(), scopes: z.array(z.string()).optional() })
const telegramSchema = z.object({ apiId: z.string().min(1), apiHash: z.string().min(1) })

/** A consent's outcome as the broker reports it. */
export type ConsentStatus = z.infer<typeof statusSchema>

/** A short-lived access token the broker issued. */
export interface IssuedToken {
  accessToken: string
  /** Epoch milliseconds; absent for a token that does not expire. */
  expiresAt?: number
  scopes?: string[]
}

/** Settings for one {@link ConnectorBroker}. */
export interface ConnectorBrokerOptions {
  /** Aeven API origin, such as `http://localhost:9000`. */
  readonly apiUrl: string
  /** Budget for one call. */
  readonly timeoutMs: number
  /** The user's current Aeven access token, or undefined when that user has no live session. */
  readonly sessionToken: (owner: string) => Promise<string | undefined>
}

/** Calls the Aeven API's `/connectors` routes as one signed-in user. */
export class ConnectorBroker {
  /** @param options - API origin, call budget, and the per-user session token source. */
  constructor(private readonly options: ConnectorBrokerOptions) {}

  /**
   * Base URL the Discord connector process sends its REST calls to for one guild.
   * @param guildId - the guild the process serves.
   * @returns the proxy base, which stands in for `https://discord.com/api/v10`.
   */
  discordApiBase(guildId: string): string {
    return this.url(`/connectors/discord/guilds/${encodeURIComponent(guildId)}/api`)
  }

  /**
   * The user's current Aeven access token.
   * @param owner - signed-in user.
   * @returns the bearer token.
   * @throws {BrokerError} `signed-out` when the user has no live session on this Host.
   */
  async session(owner: string): Promise<string> {
    const token = await this.options.sessionToken(owner)
    if (token === undefined || token === '') throw new BrokerError('signed-out')
    return token
  }

  /**
   * Start a consent; the API keeps the PKCE verifier.
   * @param owner - signed-in user.
   * @param request - provider, the Host connector id for OAuth providers, and Discord's permission bitfield.
   * @returns the provider URL to open and the state to poll.
   */
  async start(owner: string, request: { provider: ConnectorProvider; connectorId?: ConnectorId; permissions?: string }): Promise<z.infer<typeof startSchema>> {
    return startSchema.parse(await this.call(owner, 'POST', '/connectors/oauth/start', request))
  }

  /**
   * Read a consent's outcome.
   * @param owner - the user who started it.
   * @param state - the consent's state value.
   * @returns pending, failed, or connected with what the Host records.
   */
  async status(owner: string, state: string): Promise<ConsentStatus> {
    return statusSchema.parse(await this.call(owner, 'GET', `/connectors/oauth/${encodeURIComponent(state)}`))
  }

  /**
   * Issue a current access token for one OAuth connector; the API refreshes it when needed.
   * @param owner - signed-in user.
   * @param id - the connector the grant is stored under.
   * @returns the token, its expiry, and the granted scopes.
   */
  async token(owner: string, id: ConnectorId): Promise<IssuedToken> {
    const token = tokenSchema.parse(await this.call(owner, 'POST', `/connectors/${encodeURIComponent(id)}/token`))
    return {
      accessToken: token.accessToken,
      ...token.expiresAt === undefined ? {} : { expiresAt: Date.parse(token.expiresAt) },
      ...token.scopes === undefined ? {} : { scopes: token.scopes },
    }
  }

  /**
   * Delete one OAuth grant; the API revokes it at the provider where possible.
   * @param owner - signed-in user.
   * @param id - the connector the grant is stored under.
   */
  async remove(owner: string, id: ConnectorId): Promise<void> {
    await this.call(owner, 'DELETE', `/connectors/${encodeURIComponent(id)}`)
  }

  /**
   * Delete the user's installation of the Aeven bot in one guild.
   * @param owner - signed-in user.
   * @param guildId - Discord guild id.
   */
  async removeDiscord(owner: string, guildId: string): Promise<void> {
    await this.call(owner, 'DELETE', `/connectors/discord/guilds/${encodeURIComponent(guildId)}`)
  }

  /**
   * Whether the Aeven bot is still a member of a guild, and the guild's current name and icon.
   * @param owner - signed-in user who installed it.
   * @param guildId - Discord guild id.
   * @returns the guild, or undefined when the bot is no longer a member or the user's installation is gone.
   */
  async discordGuild(owner: string, guildId: string): Promise<DiscordGuild | undefined> {
    const response = await this.request(owner, 'GET', `/connectors/discord/guilds/${encodeURIComponent(guildId)}/api/guilds/${encodeURIComponent(guildId)}`)
    if (response.status === 403 || response.status === 404) return undefined
    if (!response.ok) throw new BrokerError('unavailable', response.status)
    const guild = z.object({ id: z.string(), name: z.string(), icon: z.string().nullish() }).parse(await response.json())
    return { id: guild.id, name: guild.name, ...guild.icon == null ? {} : { icon: guild.icon } }
  }

  /**
   * The Telegram application identifiers every MTProto client presents.
   * @param owner - signed-in user.
   * @returns the application id and hash.
   */
  async telegramApp(owner: string): Promise<z.infer<typeof telegramSchema>> {
    return telegramSchema.parse(await this.call(owner, 'GET', '/connectors/telegram/app'))
  }

  private url(path: string): string {
    return `${this.options.apiUrl.replace(/\/+$/, '')}${path}`
  }

  private async request(owner: string, method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.session(owner)
    try {
      return await fetch(this.url(path), {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...body === undefined ? {} : { 'Content-Type': 'application/json' } },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'error',
      })
    } catch {
      // A network failure carries no detail worth surfacing; the caller reports the API as unavailable.
      throw new BrokerError('unavailable')
    }
  }

  private async call(owner: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(owner, method, path, body)
    if (response.ok) return await response.json()
    const error = await response.json().then(value => (value as { error?: unknown } | null)?.error, () => undefined)
    if (response.status === 401) throw new BrokerError('signed-out', 401)
    if (error === 'provider-not-configured') throw new BrokerError('not-configured', response.status)
    if (error === 'reauthorize') throw new BrokerError('reauthorize', response.status)
    if (response.status === 404) throw new BrokerError('not-connected', 404)
    throw new BrokerError('unavailable', response.status)
  }
}
