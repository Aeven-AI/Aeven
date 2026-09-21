import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiUrl, confettiColors, mediaUrl, oauthFlow, oauthUrls, webUrl } from '../src/client/auth/services/config.ts'

interface Scope {
  __AVN_AEVEN__?: Record<string, unknown>
}

const scope = globalThis as Scope

function servedFrom(hostname: string): void {
  vi.stubGlobal('window', { location: { hostname } })
}

afterEach(() => {
  delete scope.__AVN_AEVEN__
  vi.unstubAllGlobals()
})

describe('Aeven deployment configuration', () => {
  it('addresses nothing when nothing was injected', () => {
    servedFrom('localhost')
    expect(apiUrl()).toBe('')
    expect(webUrl()).toBeUndefined()
    expect(mediaUrl()).toBeUndefined()
    expect(oauthUrls()).toEqual({})
  })

  it('follows the page onto its own loopback name', () => {
    servedFrom('127.0.0.1')
    scope.__AVN_AEVEN__ = {
      apiUrl: 'http://localhost:9000',
      webUrl: 'http://localhost:3030',
      mediaUrl: 'http://localhost:9020',
    }
    expect(apiUrl()).toBe('http://127.0.0.1:9000')
    expect(webUrl()).toBe('http://127.0.0.1:3030')
    expect(mediaUrl()).toBe('http://127.0.0.1:9020')
  })

  it('leaves a deployment origin alone', () => {
    servedFrom('avn.example')
    scope.__AVN_AEVEN__ = { webUrl: 'https://aeven.example', mediaUrl: 'https://media.example' }
    expect(webUrl()).toBe('https://aeven.example')
    expect(mediaUrl()).toBe('https://media.example')
  })

  it('leaves a loopback origin alone for a page served elsewhere', () => {
    servedFrom('avn.example')
    scope.__AVN_AEVEN__ = { webUrl: 'http://localhost:3030' }
    expect(webUrl()).toBe('http://localhost:3030')
  })

  it('passes an unparseable origin through, so the request reports the failure', () => {
    servedFrom('localhost')
    scope.__AVN_AEVEN__ = { apiUrl: 'not a url', webUrl: 'also not a url' }
    expect(apiUrl()).toBe('not a url')
    expect(webUrl()).toBe('also not a url')
  })

  it('offers only the providers this deployment configured', () => {
    servedFrom('localhost')
    scope.__AVN_AEVEN__ = { googleOAuthUrl: 'https://aeven.test/google' }
    expect(oauthUrls()).toEqual({ google: 'https://aeven.test/google' })
  })

  it('sends a provider sign-in to the page own loopback name, so the session lands where this page can read it', () => {
    // The failure this pins, seen in production: the deployment states its provider
    // URLs on `localhost` while the reader is on `127.0.0.1`. Those are different
    // sites to a browser, so the session the sign-in creates is written as a cookie
    // for `localhost` — which this page never sends. The refresh cookie is then absent,
    // the two-hour access token expires, and every request after that is refused as an
    // invalid credential, reported to the reader as "API key is invalid".
    servedFrom('127.0.0.1')
    scope.__AVN_AEVEN__ = {
      xOAuthUrl: 'http://localhost:9020/oauth/x',
      appleOAuthUrl: 'http://localhost:9020/oauth/apple',
      googleOAuthUrl: 'http://localhost:9020/oauth/google',
    }
    expect(oauthUrls()).toEqual({
      x: 'http://127.0.0.1:9020/oauth/x',
      apple: 'http://127.0.0.1:9020/oauth/apple',
      google: 'http://127.0.0.1:9020/oauth/google',
    })
  })

  it('leaves a provider addressed by its own name alone', () => {
    // The other half: a URL that is not loopback is the deployment's or the provider's
    // deliberate address, and following the page there would send the reader elsewhere.
    servedFrom('127.0.0.1')
    scope.__AVN_AEVEN__ = { xOAuthUrl: 'https://x.com/i/oauth2/authorize' }
    expect(oauthUrls()).toEqual({ x: 'https://x.com/i/oauth2/authorize' })
  })

  it('reaches a provider by the flow the deployment states', () => {
    servedFrom('localhost')
    expect(oauthFlow()).toBe('redirect')
    scope.__AVN_AEVEN__ = { oauthFlow: 'window' }
    expect(oauthFlow()).toBe('window')
    scope.__AVN_AEVEN__ = { oauthFlow: 'redirect' }
    expect(oauthFlow()).toBe('redirect')
  })

  it('defaults the celebration palette and accepts a configured one', () => {
    servedFrom('localhost')
    expect(confettiColors()).toHaveLength(5)
    scope.__AVN_AEVEN__ = { confettiColors: ['#000'] }
    expect(confettiColors()).toEqual(['#000'])
  })
})
