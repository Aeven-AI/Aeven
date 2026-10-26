/**
 * The desktop shell's hold on the reader's Aeven session.
 *
 * The window renews its own access token while it is open, but background mode
 * keeps the shell and its Host running with no window, and the Host presents the
 * reader's access token to Aeven's model route on their behalf. So the shell
 * keeps the session itself, in the cookie jar the window shares:
 *
 * - it renews the access token before it lapses, whether or not a window is
 *   open, and hands each one to the Host; every renewal also rotates the
 *   year-long refresh token, so a running shell never signs out;
 * - it writes the cookie store to disk whenever the refresh cookie changes, so a
 *   crash cannot lose a rotation the API has already recorded;
 * - it mirrors the refresh cookie onto the Host's loopback origin, so the Host
 *   identifies the reader by it, verified locally, whenever the window has no
 *   fresh access token to present, as while Aeven is unreachable.
 *
 * A refusal from the API is the end of the session: the API clears the cookie
 * as it refuses, and the mirror follows.
 */

import type { Cookie, Cookies } from 'electron'
import type { AevenApiFetch } from './aeven-sign-in.ts'

/** The API's refresh cookie, which `identity-user-aeven` also reads from requests without a bearer. */
const REFRESH_COOKIE = 'refreshToken'

/** The Host's credential handover route, `CREDENTIAL_HANDOVER_PATH` in `@aeven/client-connection`. */
const CREDENTIAL_HANDOVER_PATH = '/api/credential'

/** Renew this long before the access token expires. */
const RENEWAL_MARGIN_MS = 5 * 60 * 1000

/** Retry a renewal that failed without the API refusing it after this long. */
const RETRY_MS = 60 * 1000

/** Longest delay `setTimeout` honours; a longer one fires immediately. */
const MAX_TIMER_MS = 2 ** 31 - 1

/** What the shell needs to keep one session. */
export interface AevenSessionOptions {
  /** Aeven API URL, such as `https://aeven.io/api`. */
  readonly apiUrl: string
  /** Origin of the Host the window renders, such as `http://127.0.0.1:3080`. */
  readonly hostOrigin: string
  /** Cookie store of the session the window and the API requests share. */
  readonly cookies: Cookies
  /** Sends a request to the API through that session, presenting and storing its cookies. */
  readonly fetchApi: AevenApiFetch
  /** Sends a request to the Host. */
  readonly fetchHost: (url: string, init: RequestInit) => Promise<Response>
  /** Sink for failures that leave the session as it was. */
  readonly warn: (message: string) => void
}

/**
 * When an access token should be renewed.
 * @param token - the compact JWS.
 * @returns epoch milliseconds, or undefined when the token names no expiry.
 */
export function renewalTime(token: string): number | undefined {
  const payload = token.split('.')[1]
  if (payload === undefined) return undefined
  let claims: { exp?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
  } catch {
    // A payload that will not decode names no expiry; the caller retries on its own pace.
    return undefined
  }
  return typeof claims.exp === 'number' ? claims.exp * 1000 - RENEWAL_MARGIN_MS : undefined
}

/**
 * Address one route on the configured API, keeping the deployment's path prefix.
 * @param apiUrl - the API URL.
 * @param route - the route, starting with `/`.
 * @returns the absolute URL.
 */
function routeUrl(apiUrl: string, route: string): string {
  const base = new URL(apiUrl)
  return new URL(`${base.pathname.replace(/\/+$/u, '')}${route}`, base).href
}

/** One kept session; {@link AevenSession.dispose} ends the keeping, not the session. */
export class AevenSession {
  private timer: ReturnType<typeof setTimeout> | undefined
  /** When the scheduled renewal is due; undefined while none is scheduled, as before a sign-in. */
  private due: number | undefined
  private renewing: Promise<void> | undefined
  private disposed = false
  private readonly apiHost: string
  private readonly onCookieChanged = (_event: unknown, cookie: Cookie, _cause: string, removed: boolean): void => {
    if (cookie.name !== REFRESH_COOKIE || !this.isApiCookie(cookie)) return
    void this.options.cookies.flushStore().catch((error: unknown) => { this.warn('could not write the cookie store', error) })
    void this.mirror()
    // A sign-in after the shell started: nothing is scheduled for it yet.
    if (!removed && this.due === undefined) void this.renew()
  }

  /**
   * @param options - the API, the Host, and the session they share.
   */
  constructor(private readonly options: AevenSessionOptions) {
    this.apiHost = new URL(options.apiUrl).hostname
  }

  /** Mirror the current cookie, renew at once, and follow every later change. */
  start(): void {
    this.options.cookies.on('changed', this.onCookieChanged)
    void this.mirror()
    void this.renew()
  }

  /** Renew now when the renewal is overdue, as after the machine slept through it. */
  wake(): void {
    if (this.due !== undefined && Date.now() >= this.due) void this.renew()
  }

  /** Stop renewing and following the cookie; the session and both cookies stay. */
  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.options.cookies.removeListener('changed', this.onCookieChanged)
  }

  /**
   * Renew the access token, joining a renewal already running.
   * @returns settles once the renewal answered and the next one is scheduled.
   */
  renew(): Promise<void> {
    this.renewing ??= this.renewOnce().finally(() => { this.renewing = undefined })
    return this.renewing
  }

  private async renewOnce(): Promise<void> {
    if (this.disposed) return
    this.due = undefined
    clearTimeout(this.timer)
    if (await this.refreshCookie() === undefined) return
    let response: Response
    try {
      response = await this.options.fetchApi(routeUrl(this.options.apiUrl, '/refresh-token'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    } catch (error) {
      this.warn('could not reach Aeven to renew the session', error)
      this.schedule(Date.now() + RETRY_MS)
      return
    }
    // The API clears the cookie as it refuses, and the cookie listener mirrors
    // that; nothing is scheduled for a session that no longer exists.
    if (response.status === 400 || response.status === 401) return
    const grant = response.ok ? await response.json().catch(() => undefined) as { accessToken?: unknown } | undefined : undefined
    if (typeof grant?.accessToken !== 'string') {
      this.schedule(Date.now() + RETRY_MS)
      return
    }
    await this.handOver(grant.accessToken)
    this.schedule(renewalTime(grant.accessToken) ?? Date.now() + RETRY_MS)
  }

  /**
   * Give the Host the reader's current access token for the routes it calls on their behalf.
   * @param token - the access token.
   */
  private async handOver(token: string): Promise<void> {
    try {
      await this.options.fetchHost(new URL(CREDENTIAL_HANDOVER_PATH, this.options.hostOrigin).href, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${token}` },
      })
    } catch (error) {
      // The next renewal hands a token over again, and so does every window request.
      this.warn('could not hand the session to the Host', error)
    }
  }

  /** Make the Host's origin carry the API's refresh cookie, or none when the API holds none. */
  private async mirror(): Promise<void> {
    const cookie = await this.refreshCookie()
    try {
      if (cookie === undefined) {
        await this.options.cookies.remove(this.options.hostOrigin, REFRESH_COOKIE)
      } else {
        await this.options.cookies.set({
          url: this.options.hostOrigin,
          name: REFRESH_COOKIE,
          value: cookie.value,
          httpOnly: true,
          sameSite: 'strict',
          ...cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate },
        })
      }
    } catch (error) {
      this.warn('could not mirror the session onto the Host', error)
    }
  }

  /**
   * The API's refresh cookie in the shared session.
   * @returns the cookie, or undefined when nobody is signed in.
   */
  private async refreshCookie(): Promise<Cookie | undefined> {
    const cookies = await this.options.cookies.get({ url: this.options.apiUrl, name: REFRESH_COOKIE })
    return cookies[0]
  }

  /**
   * Whether a cookie is the API's rather than the Host's mirror of it.
   * @param cookie - a changed cookie.
   * @returns true when its domain is the API's host or a parent of it.
   */
  private isApiCookie(cookie: Cookie): boolean {
    const domain = (cookie.domain ?? '').replace(/^\./u, '')
    return domain !== '' && (this.apiHost === domain || this.apiHost.endsWith(`.${domain}`))
  }

  private schedule(at: number): void {
    if (this.disposed) return
    this.due = at
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.renew() }, Math.min(Math.max(at - Date.now(), 0), MAX_TIMER_MS))
  }

  private warn(what: string, error: unknown): void {
    this.options.warn(`avn desktop: ${what}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
