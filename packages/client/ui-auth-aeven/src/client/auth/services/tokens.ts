/**
 * The access token the browser holds, and its refresh.
 *
 * Same storage key and shape as the Aeven client — `appBearers` keyed by user
 * id — so a session started in either client is understood by the other. The
 * refresh token is an httpOnly cookie nothing here can read; the API exchanges
 * it for a fresh access token.
 * @module
 */

import { apiUrl } from './config.ts'
import { AevenApiError } from './errors.ts'
import { session, storage } from './session.ts'

/** Aeven refuses a token within two minutes of expiry rather than racing it. */
const EXPIRY_MARGIN_SECONDS = 120

/** What `/refresh-token` and `/login` answer with. */
export interface SessionGrant {
  readonly userId: string
  readonly accessToken: string
}

/**
 * Read the stored tokens.
 * @returns tokens by user id, or an empty set when storage holds nothing usable.
 */
function readBearers(): Record<string, string> {
  const raw = storage.getItem('appBearers')
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    // Unparsable storage is treated as empty; the next refresh replaces it.
    return {}
  }
}

/**
 * The token held for one user.
 * @param userId - the user to read.
 * @returns the token, or undefined when none is held.
 */
export function bearerToken(userId: string | null): string | undefined {
  if (userId === null || userId === '') return undefined
  return readBearers()[userId]
}

/**
 * Hold a token for one user.
 * @param userId - the user it belongs to.
 * @param token - the access token.
 */
export function setBearerToken(userId: string, token: string): void {
  storage.setItem('appBearers', JSON.stringify({ ...readBearers(), [userId]: token }))
}

/**
 * Discard the token held for one user.
 * @param userId - the user to forget.
 */
export function deleteBearerToken(userId: string | null): void {
  if (userId === null || userId === '') return
  const { [userId]: removed, ...rest } = readBearers()
  void removed
  storage.setItem('appBearers', JSON.stringify(rest))
}

/** Web Lock name serializing refreshes across every tab of this origin. */
const REFRESH_LOCK = 'aeven-session-refresh'

/**
 * Decode a token's payload without verifying it.
 * @param token - the token to inspect.
 * @returns the claims, or undefined when the token will not decode.
 */
function claimsOf(token: string): { exp?: unknown; userId?: unknown } | undefined {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[1] === undefined) return undefined
  try {
    return JSON.parse(window.atob(parts[1])) as { exp?: unknown; userId?: unknown }
  } catch {
    // A token that will not decode is not one to send; the caller refreshes.
    return undefined
  }
}

/**
 * When a held token stops being worth sending.
 * @param token - the token to inspect.
 * @returns epoch milliseconds at which {@link usableToken} turns false, or undefined when it names no expiry.
 */
export function bearerRenewalTime(token: string): number | undefined {
  const exp = claimsOf(token)?.exp
  return typeof exp === 'number' ? (exp - EXPIRY_MARGIN_SECONDS) * 1000 : undefined
}

/**
 * Whether a held token is still worth sending.
 *
 * Advisory only: this decides whether to refresh before calling, never whether
 * a caller is authenticated. Only the API can verify the signature.
 * @param token - the token to inspect.
 * @param userId - the user it should belong to.
 * @returns true when it is unexpired and names that user.
 */
export function usableToken(token: string, userId: string | null): boolean {
  const claims = claimsOf(token)
  const renewal = bearerRenewalTime(token)
  if (claims === undefined || renewal === undefined || renewal <= Date.now()) return false
  return claims.userId === userId
}

/**
 * The stored token when it is still worth sending, adopting its user.
 * @param rejected - a token the caller already saw refused, which is never returned.
 * @returns the token, or undefined when a refresh is needed.
 */
function heldBearer(rejected: string | undefined): string | undefined {
  const userId = storage.getItem('userId')
  const held = bearerToken(userId)
  if (held === undefined || held === rejected || !usableToken(held, userId)) return undefined
  session.userId = userId
  session.userSignedIn = true
  return held
}

/**
 * Exchange the refresh cookie for a fresh access token.
 *
 * The API rotates the refresh token on every exchange and refuses the one it
 * replaced, clearing the cookie as it does. Two exchanges presenting the same
 * cookie therefore end the session, so this must only run under
 * {@link renewBearer}'s serialization.
 * @returns the new grant.
 * @throws {AevenApiError} when the cookie is missing or the API refuses it.
 */
async function exchangeRefreshCookie(): Promise<SessionGrant> {
  const response = await fetch(`${apiUrl()}/refresh-token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new AevenApiError('refresh-failed', response.status)
  const grant = await response.json() as SessionGrant
  setBearerToken(grant.userId, grant.accessToken)
  storage.setItem('userId', grant.userId)
  session.userId = grant.userId
  session.userSignedIn = true
  return grant
}

/**
 * Run a refresh step while holding the origin-wide refresh lock.
 * @param step - the work to serialize.
 * @returns what the step returned.
 */
function withRefreshLock<T>(step: () => Promise<T>): Promise<T> {
  // Web Locks exist only in secure contexts; a plain-HTTP LAN deployment has
  // none and serializes within this tab alone.
  if (!('locks' in navigator)) return step()
  return navigator.locks.request(REFRESH_LOCK, step)
}

let pendingRenewal: Promise<string> | undefined

/**
 * Obtain a fresh access token, serialized within this tab and across tabs.
 *
 * Callers in this tab share one in-flight renewal. Inside the lock the stored
 * token is read again, so a renewal another tab just completed is adopted
 * rather than repeated with a cookie that has since rotated.
 * @param rejected - a token the caller already saw refused.
 * @returns the token to send.
 * @throws {AevenApiError} when the API refuses the refresh cookie.
 */
function renewBearer(rejected: string | undefined): Promise<string> {
  pendingRenewal ??= withRefreshLock(async () =>
    heldBearer(rejected) ?? (await exchangeRefreshCookie()).accessToken,
  ).finally(() => { pendingRenewal = undefined })
  return pendingRenewal
}

/**
 * Ensure a usable access token, refreshing when the held one has expired.
 *
 * Every authenticated call goes through this first, which is what keeps the
 * bearer fresh without the caller knowing the token exists.
 * @param rejected - a token the Host refused; a fresh one is obtained instead of returning it.
 * @returns the token to send.
 * @throws {AevenApiError} when the API refuses the refresh cookie; any other
 * error is a transport failure that says nothing about the session.
 */
export async function currentBearer(rejected?: string): Promise<string> {
  return heldBearer(rejected) ?? renewBearer(rejected)
}
