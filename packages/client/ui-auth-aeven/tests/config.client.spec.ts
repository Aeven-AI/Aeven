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
