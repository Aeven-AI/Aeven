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
  const parts = token.split('.')
  if (parts.length !== 3 || parts[1] === undefined) return false
  let claims: { exp?: unknown; userId?: unknown }
  try {
    claims = JSON.parse(window.atob(parts[1])) as { exp?: unknown; userId?: unknown }
  } catch {
    // A token that will not decode is not one to send; the caller refreshes.
    return false
  }
  if (typeof claims.exp !== 'number') return false
  if (claims.exp - Math.floor(Date.now() / 1000) < EXPIRY_MARGIN_SECONDS) return false
  return claims.userId === userId
}

/**
 * Exchange the refresh cookie for a fresh access token.
 * @returns the new grant.
 * @throws when the cookie is missing or the API refuses it.
 */
export async function refreshSession(): Promise<SessionGrant> {
  const response = await fetch(`${apiUrl()}/refresh-token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(`refresh-failed:${String(response.status)}`)
  const grant = await response.json() as SessionGrant
  setBearerToken(grant.userId, grant.accessToken)
  storage.setItem('userId', grant.userId)
  session.userId = grant.userId
  session.userSignedIn = true
  return grant
}

/**
 * Ensure a usable access token, refreshing when the held one has expired.
 *
 * Every authenticated call goes through this first, which is what keeps the
 * bearer fresh without the caller knowing the token exists.
 * @returns the token to send.
 * @throws when no session can be established.
 */
export async function currentBearer(): Promise<string> {
  const userId = storage.getItem('userId')
  const held = bearerToken(userId)
  if (held !== undefined && usableToken(held, userId)) {
    session.userId = userId
    session.userSignedIn = true
    return held
  }
  const grant = await refreshSession()
  return grant.accessToken
}
