/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AevenApiError, checkOauthToken, getProfile, signIn, signOut, signUp, verifyEmail,
} from '../src/client/auth/services/api.ts'
import { session } from '../src/client/auth/services/session.ts'

/** One recorded call against the Aeven API. */
interface Call { url: string; method: string; credentials?: string; authorization: string | null; body?: string }

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
