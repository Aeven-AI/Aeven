import { describe, expect, it, vi } from 'vitest'
import {
  adoptedHostSignIn, aevenApiTarget, completeOAuthLanding, forwardAevenApiRequest, oauthCallbackPair, oauthResultPath,
  type AevenApiFetch,
} from '../src/aeven-sign-in.ts'

vi.mock('electron', () => ({}))

const signIn = { apiUrl: 'https://api.aeven.test/v1/', oauthUrls: ['https://api.aeven.test/oauth/x'] }

describe('Aeven desktop sign-in', () => {
  it('maps only sign-in routes onto the configured API URL', () => {
    expect(aevenApiTarget('avn-app://app/.aeven/api/refresh-token', signIn.apiUrl)?.href)
      .toBe('https://api.aeven.test/v1/refresh-token')
    expect(aevenApiTarget('avn-app://app/.aeven/api/login?next=1', 'http://localhost:9000')?.href)
      .toBe('http://localhost:9000/login?next=1')
    expect(aevenApiTarget('avn-app://app/.aeven/api/api/cloud/plans', 'http://localhost:9000')?.href)
      .toBe('http://localhost:9000/api/cloud/plans')
    expect(aevenApiTarget('avn-app://app/.aeven/api/chat', signIn.apiUrl)).toBeUndefined()
    expect(aevenApiTarget('avn-app://app/.aeven/api/login/extra', signIn.apiUrl)).toBeUndefined()
    expect(aevenApiTarget('avn-app://app/api/login', signIn.apiUrl)).toBeUndefined()
  })

  it('forwards the request with session credentials and returns only the content type', async () => {
    const calls: [string, RequestInit][] = []
    const fetcher: AevenApiFetch = async (url, init) => {
      calls.push([url, init])
      return new Response('{"userId":"u"}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'refreshToken=r; HttpOnly' },
      })
    }
    const response = await forwardAevenApiRequest(new Request('avn-app://app/.aeven/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'renderer=1', authorization: 'Bearer t' },
      body: '{"email":"a@b.c"}',
    }), signIn, fetcher)

    expect(response.status).toBe(200)
    expect([...response.headers.keys()]).toEqual(['content-type'])
    expect(await response.text()).toBe('{"userId":"u"}')
    const [url, init] = calls[0]!
    expect(url).toBe('https://api.aeven.test/v1/login')
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
    expect([...new Headers(init.headers).entries()]).toEqual([
      ['authorization', 'Bearer t'],
      ['content-type', 'application/json'],
    ])
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"email":"a@b.c"}')
  })

  it('answers 404 without an Aeven authority or for other routes, and keeps null-body statuses empty', async () => {
    const fetcher = vi.fn<AevenApiFetch>(async () => new Response(null, { status: 204 }))
    expect((await forwardAevenApiRequest(new Request('avn-app://app/.aeven/api/login'), undefined, fetcher)).status).toBe(404)
    expect((await forwardAevenApiRequest(new Request('avn-app://app/.aeven/api/chat'), signIn, fetcher)).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
    const response = await forwardAevenApiRequest(new Request('avn-app://app/.aeven/api/get-profile'), signIn, fetcher)
    expect(response.status).toBe(204)
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('body')
  })

  it('recognizes the provider landing page', () => {
    expect(oauthResultPath('http://localhost:3030/oauth-result/session/challenge')).toBe('/oauth-result/session/challenge')
    expect(oauthResultPath('https://aeven.test/oauth-result/error')).toBe('/oauth-result/error')
    expect(oauthResultPath('https://x.com/i/oauth2/authorize?redirect=/oauth-result/a/b')).toBeUndefined()
    expect(oauthResultPath('avn-app://app/oauth-result/a/b')).toBeUndefined()
    expect(oauthResultPath('not a url')).toBeUndefined()
  })

  it('reads the pair out of a landing path, and nothing out of one that carries none', () => {
    expect(oauthCallbackPair('/oauth-result/sess-1/chal-2')).toEqual({ session: 'sess-1', challenge: 'chal-2' })
    expect(oauthCallbackPair('/oauth-result/sess-1/chal-2/')).toEqual({ session: 'sess-1', challenge: 'chal-2' })
    for (const path of ['/oauth-result/error', '/oauth-result', '/oauth-result/a/b/c', '/', '']) {
      expect(oauthCallbackPair(path)).toBeUndefined()
    }
  })

  it('exchanges a landing in the session that holds the cookie, rather than loading it', async () => {
    const calls: [string, RequestInit][] = []
    const fetcher: AevenApiFetch = async (url, init) => {
      calls.push([url, init])
      return new Response(null, { status: 200 })
    }

    await expect(completeOAuthLanding('/oauth-result/sess-1/chal-2', signIn, fetcher)).resolves.toBe(true)

    const [url, init] = calls[0]!
    expect(url).toBe('https://api.aeven.test/v1/check-oauth-token')
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"session":"sess-1","challenge":"chal-2"}')
  })

  it('leaves the reader where they were when the exchange is refused or the path carries no pair', async () => {
    const refused: AevenApiFetch = async () => new Response(null, { status: 401 })
    expect(await completeOAuthLanding('/oauth-result/sess-1/chal-2', signIn, refused)).toBe(false)

    const fetcher = vi.fn<AevenApiFetch>(async () => new Response(null, { status: 200 }))
    expect(await completeOAuthLanding('/oauth-result/error', signIn, fetcher)).toBe(false)
    expect(await completeOAuthLanding('/oauth-result/sess-1/chal-2', undefined, fetcher)).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reads the provider URLs an adopted Host states in its page', async () => {
    const config = {
      apiUrl: 'http://127.0.0.1:9000',
      xOAuthUrl: 'http://127.0.0.1:9020/oauth/x',
      googleOAuthUrl: 'http://127.0.0.1:9020/oauth/google',
      webUrl: 'https://aeven.test/</script>',
    }
    const page = '<html><head><script>globalThis["__AVN_OTHER__"] = {"apiUrl":"no"}</script>'
      + `<script>globalThis["__AVN_AEVEN__"] = ${JSON.stringify(config).replaceAll('<', '\\u003c')}</script></head></html>`
    const fetcher = vi.fn<AevenApiFetch>(async () => new Response(page, { status: 200 }))

    await expect(adoptedHostSignIn('http://127.0.0.1:3080/', fetcher)).resolves.toEqual({
      apiUrl: 'http://127.0.0.1:9000',
      oauthUrls: ['http://127.0.0.1:9020/oauth/x', 'http://127.0.0.1:9020/oauth/google'],
    })
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:3080/')
  })

  it('reports no endpoints for a page without an Aeven API, and fails on a refused page', async () => {
    const answer = (body: string, status = 200): AevenApiFetch => async () => new Response(body, { status })
    await expect(adoptedHostSignIn('http://127.0.0.1:3080/', answer('<html></html>'))).resolves.toBeUndefined()
    await expect(adoptedHostSignIn('http://127.0.0.1:3080/', answer('<script>globalThis["__AVN_AEVEN__"] = {}</script>')))
      .resolves.toBeUndefined()
    await expect(adoptedHostSignIn('http://127.0.0.1:3080/', answer('', 503))).rejects.toThrow('503')
  })
})
