/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AevenApiError, checkOauthToken, forgotPassword, getProfile, removeAvatar, resendCode, resetPassword,
  setDisplayName, signIn, signOut, signUp, uploadAvatar, verifyEmail, mfa, hasPendingMfaChallenge,
} from '../src/client/auth/services/api.ts'
import { session } from '../src/client/auth/services/session.ts'

/** One recorded call against the Aeven API. */
interface Call {
  url: string
  method: string
  credentials?: string
  authorization: string | null
  body?: string
  /** Whether the body was form data, which carries no readable string form. */
  multipart: boolean
}

/** A scripted Aeven API, recording how each request was credentialed. */
function scriptedApi(answers: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input
    const route = new URL(url as string).pathname
    calls.push({
      url: route,
      method: init?.method ?? 'GET',
      ...init?.credentials === undefined ? {} : { credentials: init.credentials },
      authorization: new Headers(init?.headers).get('authorization'),
      multipart: init?.body instanceof FormData,
      ...typeof init?.body === 'string' ? { body: init.body } : {},
    })
    const answer = answers[route] ?? { status: 404, body: {} }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status, headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

const grant = { userId: 'u-1', accessToken: 'header.eyJ1c2VySWQiOiJ1LTEiLCJleHAiOjk5OTk5OTk5OTl9.sig' }

describe('the Aeven API calls', () => {
  beforeEach(() => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
    session.reset()
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
  })

  it('signs in with the cookie routes, and adopts the session it establishes', async () => {
    const api = scriptedApi({ '/login': { status: 200, body: grant } })
    await signIn('a@b.c', 'secret')
    // The session routes authenticate by cookie, so credentials must be sent
    // and no bearer exists to send yet.
    expect(api.calls[0]).toMatchObject({
      url: '/login', method: 'POST', credentials: 'include', authorization: null,
    })
    expect(session.userId).toBe('u-1')
    expect(session.userSignedIn).toBe(true)
    expect(window.localStorage.getItem('userId')).toBe('u-1')
  })

  it('adopts the session only after password MFA succeeds', async () => {
    const api = scriptedApi({
      '/login': { status: 202, body: { challenge: 'password-challenge' } },
      '/mfa/login': { status: 200, body: grant },
    })
    await expect(signIn('a@b.c', 'secret')).rejects.toThrow('mfa-required')
    expect(session.userSignedIn).toBe(false)
    expect(hasPendingMfaChallenge()).toBe(true)
    await mfa('login', '123456')
    expect(api.calls.at(-1)).toMatchObject({
      url: '/mfa/login', authorization: null,
      body: JSON.stringify({ code: '123456', challenge: 'password-challenge' }),
    })
    expect(session.userSignedIn).toBe(true)
    expect(hasPendingMfaChallenge()).toBe(false)
  })

  it('completes the same MFA exchange after an Apple or other social sign-in', async () => {
    scriptedApi({
      '/check-oauth-token': { status: 202, body: { challenge: 'social-challenge' } },
      '/mfa/login': { status: 200, body: grant },
    })
    await expect(checkOauthToken('apple-session', 'apple-challenge')).rejects.toThrow('mfa-required')
    expect(session.userSignedIn).toBe(false)
    await mfa('login', '123456')
    expect(session.userSignedIn).toBe(true)
  })

  it('discards an expired MFA challenge and refuses to send it again', async () => {
    const api = scriptedApi({
      '/login': { status: 202, body: { challenge: 'expired-challenge' } },
      '/mfa/login': { status: 400, body: { error: 'expired-code' } },
    })
    await expect(signIn('a@b.c', 'secret')).rejects.toThrow('mfa-required')
    await expect(mfa('login', '123456')).rejects.toThrow('expired-code')
    expect(hasPendingMfaChallenge()).toBe(false)
    await expect(mfa('login', '654321')).rejects.toThrow('expired-code')
    expect(api.calls.filter(call => call.url === '/mfa/login')).toHaveLength(1)
  })

  it('rejects an MFA success response that did not establish a session', async () => {
    scriptedApi({
      '/login': { status: 202, body: { challenge: 'challenge' } },
      '/mfa/login': { status: 200, body: { result: 'user-signed-in' } },
    })
    await expect(signIn('a@b.c', 'secret')).rejects.toThrow('mfa-required')
    await expect(mfa('login', '123456')).rejects.toThrow('request-failed')
    expect(session.userSignedIn).toBe(false)
  })

  it('reports the API error code, so a caller can tell a refusal from an outage', async () => {
    scriptedApi({ '/login': { status: 401, body: { error: 'invalid-credentials' } } })
    await expect(signIn('a@b.c', 'wrong')).rejects.toThrow(AevenApiError)
    await expect(signIn('a@b.c', 'wrong')).rejects.toThrow('invalid-credentials')
    expect(session.userSignedIn).toBe(false)
  })

  it('sends the bearer, not the cookie, when reading the profile', async () => {
    const api = scriptedApi({
      '/login': { status: 200, body: grant },
      '/get-profile': { status: 200, body: { userId: 'u-1', email: 'a@b.c', displayName: 'Ollie' } },
    })
    await signIn('a@b.c', 'secret')
    await getProfile()
    const profileCall = api.calls.find(c => c.url === '/get-profile')
    // This route reads the header; Aeven sends no cookie with it at all.
    expect(profileCall?.authorization).toMatch(/^Bearer /)
    expect(session.displayName).toBe('Ollie')
  })

  it('stores the name the reader chose, and adopts it for every surface after', async () => {
    const api = scriptedApi({
      '/login': { status: 200, body: grant },
      '/get-profile': { status: 200, body: { userId: 'u-1', displayName: 'u-1' } },
      '/set-display-name': {
        status: 200,
        body: { result: 'display-name-set', displayName: 'Ollie', displayNameSet: true },
      },
    })
    await signIn('a@b.c', 'secret')
    await getProfile()

    expect(await setDisplayName('Ollie')).toBe('Ollie')
    // The route reads the bearer, as the profile read does.
    const call = api.calls.at(-1)
    expect(call).toMatchObject({
      url: '/set-display-name', method: 'POST', body: JSON.stringify({ displayName: 'Ollie' }),
    })
    expect(call?.authorization).toMatch(/^Bearer /)
    expect(session.displayName).toBe('Ollie')
    expect(session.displayNameSet).toBe(true)
    // The kept profile carries it too, so the next load does not ask again.
    expect(JSON.parse(window.localStorage.getItem('aevenProfile') ?? 'null') as unknown)
      .toMatchObject({ displayName: 'Ollie', displayNameSet: true })
  })

  it('reports a refused name distinctly, and leaves the session unnamed', async () => {
    const api = scriptedApi({
      '/login': { status: 200, body: grant },
      '/set-display-name': { status: 400, body: { error: 'invalid-display-name' } },
    })
    await signIn('a@b.c', 'secret')

    await expect(setDisplayName('')).rejects.toThrow('invalid-display-name')
    expect(api.calls.at(-1)?.url).toBe('/set-display-name')
    expect(session.displayNameSet).toBeUndefined()
  })

  it('stores the picture the reader picked, and adopts it for every surface after', async () => {
    const api = scriptedApi({
      '/login': { status: 200, body: grant },
      '/upload-avatar': {
        status: 200,
        body: { result: 'avatar-set', avatar: { url: '/user-images/u-1-new.webp', contentType: 'image/webp' } },
      },
    })
    await signIn('a@b.c', 'secret')

    const stored = await uploadAvatar(new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' }))

    expect(stored).toEqual({ avatar: { url: '/user-images/u-1-new.webp', contentType: 'image/webp' } })
    // The picture route reads the bearer and takes form data, as the server's
    // upload route expects; a JSON content type on a multipart body would break it.
    const call = api.calls.at(-1)
    expect(call).toMatchObject({ url: '/upload-avatar', method: 'POST', credentials: 'include', multipart: true })
    expect(call?.authorization).toMatch(/^Bearer /u)
    expect(session.profile).toEqual({ avatar: { url: '/user-images/u-1-new.webp', contentType: 'image/webp' } })
  })

  it('reports a refused picture distinctly, and leaves the account as it was', async () => {
    const api = scriptedApi({
      '/login': { status: 200, body: grant },
      '/upload-avatar': { status: 415, body: { error: 'invalid-image-type' } },
    })
    await signIn('a@b.c', 'secret')

    await expect(uploadAvatar(new File([new Uint8Array([1])], 'me.svg'))).rejects.toThrow('invalid-image-type')
    expect(api.calls.at(-1)?.url).toBe('/upload-avatar')
    expect(session.profile).toBeUndefined()
  })

  it('removes the picture and adopts an account that no longer has one', async () => {
    const api = scriptedApi({
      '/login': { status: 200, body: grant },
      '/get-profile': {
        status: 200,
        body: { userId: 'u-1', profile: { avatar: { url: '/user-images/u-1.webp' } } },
      },
      '/delete-avatar': { status: 200, body: { result: 'avatar-removed' } },
    })
    await signIn('a@b.c', 'secret')
    await getProfile()
    expect(session.profile?.avatar?.url).toBe('/user-images/u-1.webp')

    await removeAvatar()

    expect(api.calls.at(-1)).toMatchObject({ url: '/delete-avatar', method: 'POST', credentials: 'include' })
    expect(session.profile).toBeUndefined()
    // The kept profile drops it too, so a load that cannot reach Aeven does not
    // draw a picture the account no longer has.
    expect(JSON.parse(window.localStorage.getItem('aevenProfile') ?? 'null')).toEqual({ userId: 'u-1' })
  })

  it('refreshes through the cookie when no token is held', async () => {
    const api = scriptedApi({
      '/refresh-token': { status: 200, body: grant },
      '/get-profile': { status: 200, body: { userId: 'u-1' } },
    })
    await getProfile()
    expect(api.calls[0]).toMatchObject({ url: '/refresh-token', method: 'POST', credentials: 'include' })
    expect(api.calls[1]?.authorization).toMatch(/^Bearer /)
  })

  it('fails the profile read when nothing can establish a session', async () => {
    scriptedApi({ '/refresh-token': { status: 400, body: { error: 'no-token' } } })
    await expect(getProfile()).rejects.toThrow()
  })

  it('registers without adopting a session, because the API answers a challenge', async () => {
    const api = scriptedApi({ '/register': { status: 200, body: { result: 'user-created' } } })
    await signUp('a@b.c', 'secret')
    expect(api.calls[0]).toMatchObject({ url: '/register', method: 'POST', credentials: 'include' })
    // Registration precedes verification; nobody is signed in yet.
    expect(session.userSignedIn).toBe(false)
  })

  it('adopts a session from verification only when the API returns one', async () => {
    scriptedApi({ '/verify-email': { status: 200, body: grant } })
    await verifyEmail('a@b.c', '123456')
    expect(session.userId).toBe('u-1')

    session.reset()
    scriptedApi({ '/verify-email': { status: 200, body: { ok: true } } })
    // Some flows acknowledge and leave the reader at the sign-in screen.
    await verifyEmail('a@b.c', '123456')
    expect(session.userSignedIn).toBe(false)
  })

  it('asks for a fresh verification code for the address being verified', async () => {
    const api = scriptedApi({ '/resend-code': { status: 200, body: { result: 'verification-code-sent' } } })
    await resendCode('a@b.c')
    expect(api.calls[0]).toMatchObject({ url: '/resend-code', method: 'POST', body: '{"email":"a@b.c"}' })

    scriptedApi({ '/resend-code': { status: 409, body: { error: 'email-already-verified' } } })
    await expect(resendCode('a@b.c')).rejects.toThrow('email-already-verified')
  })

  it('requests a reset code, then replaces the password with it, signing nobody in', async () => {
    const api = scriptedApi({
      '/forgot-password': { status: 200, body: { result: 'reset-code-sent' } },
      '/reset-password': { status: 200, body: { result: 'password-reset' } },
    })
    await forgotPassword('a@b.c')
    await resetPassword('a@b.c', '123456', 'New1!pass')
    expect(api.calls).toMatchObject([
      { url: '/forgot-password', method: 'POST', body: '{"email":"a@b.c"}' },
      { url: '/reset-password', method: 'POST', body: '{"email":"a@b.c","code":"123456","password":"New1!pass"}' },
    ])
    expect(session.userSignedIn).toBe(false)

    scriptedApi({ '/reset-password': { status: 400, body: { error: 'expired-code' } } })
    await expect(resetPassword('a@b.c', '123456', 'New1!pass')).rejects.toThrow('expired-code')
  })

  it('completes a social sign-in from the values the provider redirected back with', async () => {
    const api = scriptedApi({ '/check-oauth-token': { status: 200, body: grant } })
    await checkOauthToken('sess-1', 'chal-2')
    expect(api.calls[0]).toMatchObject({ url: '/check-oauth-token', credentials: 'include' })
    expect(JSON.parse(api.calls[0]?.body ?? '{}') as unknown)
      .toEqual({ session: 'sess-1', challenge: 'chal-2' })
    expect(session.userId).toBe('u-1')
  })

  it('reports a refusal that carries no code as a plain failure', async () => {
    scriptedApi({ '/login': { status: 500, body: 'not json at all' } })
    await expect(signIn('a@b.c', 'secret')).rejects.toThrow('request-failed')
  })

  it('reports a body that is not JSON as a plain failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway</html>', {
      status: 502, headers: { 'content-type': 'text/html' },
    })))
    // A proxy answering HTML carries no error code; the status still does.
    await expect(signIn('a@b.c', 'secret')).rejects.toThrow('request-failed')
  })

  it('reports a refused profile read distinctly from a refused session', async () => {
    scriptedApi({
      '/refresh-token': { status: 200, body: grant },
      '/get-profile': { status: 403, body: {} },
    })
    await expect(getProfile()).rejects.toThrow('profile-failed')
  })

  it('discards the local credential on sign-out whatever the API answered', async () => {
    scriptedApi({ '/login': { status: 200, body: grant }, '/logout': { status: 500, body: {} } })
    await signIn('a@b.c', 'secret')
    // A browser holding a token for someone who signed out is the one state
    // worth avoiding, so the local side is cleared even on a failed call.
    await expect(signOut()).rejects.toThrow()
    expect(session.userSignedIn).toBe(false)
    expect(Object.keys(JSON.parse(window.localStorage.getItem('appBearers') ?? '{}') as object))
      .toEqual([])
  })
})
