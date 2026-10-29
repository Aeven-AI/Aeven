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
import { forgetCachedProfile, session, storage, type AevenProfile, type AevenProfileMedia } from './session.ts'
import { currentBearer, deleteBearerToken, setBearerToken, type SessionGrant } from './tokens.ts'

import type { MfaAnswer } from '@aeven/client-ui-primitives'

let pendingMfaChallenge: string | undefined

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
 * @throws {AevenApiError} `mfa-required` when an authenticator challenge must complete before sign-in.
 */
export async function signIn(email: string, password: string): Promise<void> {
  acceptSignIn(await request<SessionGrant | { challenge: string }>('/login', {
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
 * @throws {AevenApiError} `mfa-required` when an authenticator challenge must complete before sign-in.
 */
export async function signUp(email: string, password: string): Promise<void> {
  const answer = await request<{ challenge?: string }>('/register', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (answer.challenge !== undefined) acceptSignIn({ challenge: answer.challenge })
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
 * Mail a fresh verification code to an address that registered and has not verified.
 * @param email - the address being verified.
 * @throws {AevenApiError} `email-already-verified` when there is nothing left to verify.
 */
export async function resendCode(email: string): Promise<void> {
  await request<unknown>('/resend-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/**
 * Mail a password reset code. The API answers the same whether or not the
 * address holds an account.
 * @param email - the address to reset.
 */
export async function forgotPassword(email: string): Promise<void> {
  await request<unknown>('/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/**
 * Check an emailed reset code without using it up, so the new password can be
 * asked for on a screen of its own.
 * @param email - the address being reset.
 * @param code - the code from the email.
 * @throws {AevenApiError} `invalid-code`, `expired-code`, or `too-many-attempts` when the code is refused.
 */
export async function checkResetCode(email: string, code: string): Promise<void> {
  await request<unknown>('/check-reset-code', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

/**
 * Replace the password with the emailed reset code. The API ends every session
 * the account holds and signs nobody in, so the reader signs in afterwards.
 * @param email - the address being reset.
 * @param code - the code from the email.
 * @param password - the new password.
 * @throws {AevenApiError} `invalid-code`, `expired-code`, or `too-many-attempts` when the code is refused.
 */
export async function resetPassword(email: string, code: string, password: string): Promise<void> {
  await request<unknown>('/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, password }),
  })
}

/**
 * Complete a social sign-in from the values the provider redirected back with.
 * @param oAuthSession - the session identifier in the redirect.
 * @param oAuthChallenge - the challenge in the redirect.
 * @throws {AevenApiError} `mfa-required` when the account requires an authenticator code.
 */
export async function checkOauthToken(oAuthSession: string, oAuthChallenge: string): Promise<void> {
  acceptSignIn(await request<SessionGrant | { challenge: string }>('/check-oauth-token', {
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
    pendingMfaChallenge = undefined
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

/** What `/set-locale` answers with. */
interface LocaleGrant {
  /** The stored language, echoed back. */
  readonly locale?: string
}

/**
 * Store the language Aeven writes mail to this account in.
 *
 * The mail server reads the account rather than the page, so a choice kept only in the
 * browser would leave every message in English.
 * @param locale - the app's locale id, one of `en`, `es` or `zh`.
 * @returns the language the API stored.
 * @throws {AevenApiError} when the API refuses the language or the bearer.
 */
export async function setLocale(locale: string): Promise<string> {
  const bearer = await currentBearer()
  const answer = await request<LocaleGrant>('/set-locale', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ locale }),
  })
  return answer.locale ?? locale
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

/** What `/upload-avatar` and `/delete-avatar` answer with. */
export interface AvatarAnswer {
  /** The stored picture, absent once the account has none. */
  readonly avatar?: { readonly url?: string } | null
}

/**
 * Adopt the picture an avatar route answered with.
 * @param answer - the route's body.
 * @returns the profile media the account now has, or undefined when it has no picture.
 */
function adoptAvatar(answer: AvatarAnswer): AevenProfileMedia | undefined {
  const media = answer.avatar === undefined || answer.avatar === null
    ? undefined
    : { avatar: answer.avatar }
  session.adoptImage(media)
  return media
}

/**
 * Send the reader's multipart picture to an avatar route.
 *
 * The body is form data, which writes its own boundary, so no content type is
 * stated here: the bearer is the only header the route reads.
 * @param path - the avatar route.
 * @param body - the multipart body, or nothing for a route that takes none.
 * @returns the decoded answer.
 * @throws {AevenApiError} when the API refuses the picture or the bearer.
 */
async function postAvatar(path: string, body?: FormData): Promise<AvatarAnswer> {
  const bearer = await currentBearer()
  return request<AvatarAnswer>(path, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${bearer}` },
    ...body === undefined ? {} : { body },
  })
}

/**
 * Replace the reader's profile picture with the picture they picked.
 *
 * The account records the picture, so it is stored rather than drawn from this
 * page: the account menu, the next load, and every other client show it too.
 * @param image - the file the reader picked.
 * @returns the profile media the account now has.
 * @throws {AevenApiError} when the API refuses the picture or the bearer.
 */
export async function uploadAvatar(image: Blob): Promise<AevenProfileMedia | undefined> {
  const form = new FormData()
  form.append('file', image)
  return adoptAvatar(await postAvatar('/upload-avatar', form))
}

/**
 * Remove the reader's profile picture, leaving the initial in its place.
 * @returns nothing; the account answers with no picture.
 * @throws {AevenApiError} when the API refuses the bearer.
 */
export async function removeAvatar(): Promise<void> {
  adoptAvatar(await postAvatar('/delete-avatar'))
}

/** Accept an ordinary grant or retain a short-lived second-factor challenge in memory. */
function acceptSignIn(answer: SessionGrant | { challenge: string }): void {
  if ('challenge' in answer) {
    pendingMfaChallenge = answer.challenge
    throw new AevenApiError('mfa-required', 202)
  }
  pendingMfaChallenge = undefined
  adopt(answer)
}

/**
 * Whether this document holds the challenge issued by its first sign-in factor.
 * @returns false after reload, expiry, or completed sign-in.
 */
export function hasPendingMfaChallenge(): boolean {
  return pendingMfaChallenge !== undefined
}

/**
 * Call an authenticator operation with the current bearer or pending sign-in challenge.
 * @param action - enrollment, settings status, or second-factor completion.
 * @param code - authenticator or recovery code, when required.
 * @returns enrollment material, updated status, or a completed session.
 * @throws {AevenApiError} when the server rejects the credential or code.
 */
export async function mfa(action: 'status' | 'setup' | 'enable' | 'disable' | 'login', code?: string): Promise<MfaAnswer> {
  if (action === 'login' && pendingMfaChallenge === undefined) throw new AevenApiError('expired-code', 400)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (action !== 'login') headers.Authorization = `Bearer ${await currentBearer()}`
  const answer = await request<MfaAnswer & Partial<SessionGrant>>(`/mfa/${action}`, {
    method: action === 'status' ? 'GET' : 'POST',
    credentials: 'include', headers,
    ...action === 'status' ? {} : { body: JSON.stringify({ code, challenge: pendingMfaChallenge }) },
  }).catch((error: unknown) => {
    if (action === 'login' && error instanceof AevenApiError && error.message === 'expired-code') {
      pendingMfaChallenge = undefined
    }
    throw error
  })
  if (action === 'login') {
    if (typeof answer.userId !== 'string' || typeof answer.accessToken !== 'string') {
      throw new AevenApiError('request-failed', 502)
    }
    adopt({ userId: answer.userId, accessToken: answer.accessToken })
    pendingMfaChallenge = undefined
  }
  return answer
}
