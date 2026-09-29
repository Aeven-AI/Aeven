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
import { forgetCachedProfile, session, storage, type AevenProfile } from './session.ts'
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
    // The kept profile is what would restore this reader through an outage, so
    // a deliberate sign-out has to discard it too.
    forgetCachedProfile()
    session.reset()
  }
}

/** What `/set-display-name` answers with. */
interface DisplayNameGrant {
  /** The stored name, echoed back. */
  readonly displayName?: string
  /** Always true on a stored name; the screen reads it from the session instead. */
  readonly displayNameSet?: boolean
}

/**
 * Store the name Aeven shows for the reader.
 *
 * The name is the one thing about a reader every surface names them by — the
 * account menu, and the greeting a session opens with — so the API records it
 * against the account rather than the page. The bearer is this route's
 * credential, as it is for the profile.
 * @param displayName - the name to store, already stripped of what a reader cannot see.
 * @returns the name the API stored.
 * @throws {AevenApiError} when the API refuses the name or the bearer.
 */
export async function setDisplayName(displayName: string): Promise<string> {
  const bearer = await currentBearer()
  const answer = await request<DisplayNameGrant>('/set-display-name', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ displayName }),
  })
  const stored = answer.displayName ?? displayName
  session.adoptDisplayName(stored)
  return stored
}

/**
 * One call to Aeven's own account routes under `/api/cloud`, as the signed-in reader.
 *
 * The bearer is the credential; a 401 renews it once and repeats the call, the
 * same recovery the Host transport applies. These routes answer failures as
 * `{ error, code }`, so the thrown error carries `code` rather than the message.
 * @param path - the route below `/api/cloud`, starting with `/`.
 * @param init - method and body; the bearer and content type are supplied.
 * @returns the decoded response body.
 * @throws {AevenApiError} when the API refuses the call or the renewal.
 */
export async function cloud<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (bearer: string): Promise<Response> => fetch(`${apiUrl()}/api/cloud${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  })
  const bearer = await currentBearer()
  let response = await send(bearer)
  if (response.status === 401) response = await send(await currentBearer(bearer))
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // A body that is not JSON carries no error code; the status still does.
    body = {}
  }
  if (!response.ok) {
    const code = (body as { code?: unknown }).code
    throw new AevenApiError(typeof code === 'string' ? code : 'request-failed', response.status)
  }
  return body as T
}
