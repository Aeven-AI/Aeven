/**
 * The Aeven API calls the authentication screens make.
 *
 * Authentication only: the Aeven client's AppService also carries chat, file
 * and transcription routes these screens never reach. Each route is sent the
 * credential it expects — the refresh cookie for the session routes, the bearer
 * for the profile.
 * @module
 */

import { apiUrl } from './config.ts'
import { AevenApiError } from './errors.ts'
import { session, storage, type AevenProfile } from './session.ts'
import { currentBearer, deleteBearerToken, setBearerToken, type SessionGrant } from './tokens.ts'

export { AevenApiError } from './errors.ts'

/**
 * One JSON request against the Aeven API.
 * @param path - the route.
 * @param init - fetch options; credentials and content type are supplied.
 * @returns the decoded response body.
 * @throws {AevenApiError} when the API refuses the request.
 */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // A body that is not JSON carries no error code; the status still does.
    body = {}
  }
  if (!response.ok) {
    const code = (body as { error?: unknown }).error
    throw new AevenApiError(typeof code === 'string' ? code : 'request-failed', response.status)
  }
  return body as T
}

/**
 * Adopt the session an authenticating route established.
 * @param grant - the user and access token the API answered with.
 */
function adopt(grant: SessionGrant): void {
  setBearerToken(grant.userId, grant.accessToken)
  storage.setItem('userId', grant.userId)
  session.userId = grant.userId
  session.userSignedIn = true
}

/**
 * Sign in with an email address and password.
 * @param email - the address.
 * @param password - the password.
 */
export async function signIn(email: string, password: string): Promise<void> {
  adopt(await request<SessionGrant>('/login', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  }))
}

/**
 * Register a new account. The API answers with a verification challenge rather
 * than a session, so nothing is adopted here.
 * @param email - the address.
 * @param password - the password.
 */
export async function signUp(email: string, password: string): Promise<void> {
  await request<unknown>('/register', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * Complete registration with the emailed code.
 * @param email - the address being verified.
 * @param code - the code from the email.
 */
export async function verifyEmail(email: string, code: string): Promise<void> {
  const grant = await request<Partial<SessionGrant>>('/verify-email', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ email, code }),
  })
  // Verification signs the user in when the API returns a grant; some flows
  // return only an acknowledgement and leave them at the sign-in screen.
  if (grant.userId !== undefined && grant.accessToken !== undefined) {
    adopt({ userId: grant.userId, accessToken: grant.accessToken })
  }
}

/**
 * Complete a social sign-in from the values the provider redirected back with.
 * @param oAuthSession - the session identifier in the redirect.
 * @param oAuthChallenge - the challenge in the redirect.
 */
export async function checkOauthToken(oAuthSession: string, oAuthChallenge: string): Promise<void> {
  adopt(await request<SessionGrant>('/check-oauth-token', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session: oAuthSession, challenge: oAuthChallenge }),
  }))
}

/**
 * The signed-in user's profile; the bearer is this route's credential.
 * @returns the profile, which is also adopted into the page session.
 * @throws {AevenApiError} when the API refuses the bearer.
 */
export async function getProfile(): Promise<AevenProfile> {
  const bearer = await currentBearer()
  const response = await fetch(`${apiUrl()}/get-profile`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  if (!response.ok) throw new AevenApiError('profile-failed', response.status)
  const profile = await response.json() as AevenProfile
  session.adoptProfile(profile)
  return profile
}

/**
 * Sign out: invalidate the session at the API, then locally.
 *
 * The local credential is discarded whatever the API answered — a browser
 * holding a token for a user who has signed out is the one state worth
 * avoiding.
 */
export async function signOut(): Promise<void> {
  try {
    await request<unknown>('/logout', { method: 'POST', credentials: 'include', body: '{}' })
  } finally {
    deleteBearerToken(session.userId)
    session.reset()
  }
}
