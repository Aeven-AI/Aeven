/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiUrl, confettiColors, oauthUrls } from '../src/client/auth/services/config.ts'
import { usableToken } from '../src/client/auth/services/tokens.ts'
import { session, storage } from '../src/client/auth/services/session.ts'
import { bearerToken, deleteBearerToken, setBearerToken } from '../src/client/auth/services/tokens.ts'
import { cloneObject, guid, href } from '../src/client/auth/services/utility.ts'

/** A token as the Aeven API signs it; only the payload is read here. */
function token(claims: object): string {
  const encode = (value: object): string => btoa(JSON.stringify(value))
  return `header.${encode(claims)}.signature`
}

const soon = (): number => Math.floor(Date.now() / 1000) + 30
const later = (): number => Math.floor(Date.now() / 1000) + 3600

describe('apiUrl', () => {
  const injected = (value: unknown): void => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = value
  }
  afterEach(() => { delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ })

  it('is empty when no Aeven is configured, which leaves the harness unauthenticated', () => {
    injected(undefined)
    expect(apiUrl()).toBe('')
  })

  it('follows the page when both are loopback', () => {
    // jsdom serves these tests from localhost; a configured 127.0.0.1 would be
    // a different site, and the cookie an upgrade needs would never come back.
    injected({ apiUrl: 'http://127.0.0.1:9000' })
    expect(new URL(apiUrl()).hostname).toBe(window.location.hostname)
    expect(new URL(apiUrl()).port).toBe('9000')
  })

  it('leaves a real host alone, because a deployment chose it', () => {
    injected({ apiUrl: 'https://api.aeven.io' })
    expect(apiUrl()).toBe('https://api.aeven.io')
  })

  it('passes through something it cannot parse rather than inventing an origin', () => {
    injected({ apiUrl: 'not a url' })
    expect(apiUrl()).toBe('not a url')
  })
})

describe('the provider buttons a deployment offers', () => {
  afterEach(() => { delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ })

  it('names only the providers configured, so an unconfigured one cannot be opened', () => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { xOAuthUrl: 'https://x.test/o' }
    expect(oauthUrls()).toEqual({ x: 'https://x.test/o' })
  })

  it('names every provider a deployment configures', () => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = {
      xOAuthUrl: 'https://x.test/o',
      appleOAuthUrl: 'https://apple.test/o',
      googleOAuthUrl: 'https://google.test/o',
    }
    expect(oauthUrls()).toEqual({
      x: 'https://x.test/o', apple: 'https://apple.test/o', google: 'https://google.test/o',
    })
  })

  it('offers none when nothing is configured', () => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = {}
    expect(oauthUrls()).toEqual({})
    // The celebration still has a palette, so sign-up does not fail for want
    // of one.
    expect(confettiColors().length).toBeGreaterThan(0)
  })

  it('uses the palette a deployment states', () => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { confettiColors: ['#fff'] }
    expect(confettiColors()).toEqual(['#fff'])
  })
})

describe('usableToken', () => {
  it('accepts a token that names this user and has time left', () => {
    expect(usableToken(token({ userId: 'u-1', exp: later() }), 'u-1')).toBe(true)
  })

  it('refuses one inside the margin Aeven refreshes within', () => {
    // Aeven treats the last two minutes as spent rather than racing expiry.
    expect(usableToken(token({ userId: 'u-1', exp: soon() }), 'u-1')).toBe(false)
  })

  it('refuses one belonging to another user', () => {
    expect(usableToken(token({ userId: 'u-2', exp: later() }), 'u-1')).toBe(false)
  })

  it('refuses anything it cannot read, so the caller refreshes instead', () => {
    expect(usableToken('not-a-token', 'u-1')).toBe(false)
    expect(usableToken('a.!!!.c', 'u-1')).toBe(false)
    expect(usableToken(token({ userId: 'u-1' }), 'u-1')).toBe(false)
  })
})

describe('the held session', () => {
  beforeEach(() => { session.reset(); window.localStorage.clear() })

  it('adopts a profile and reports the user every surface reads', () => {
    session.adoptProfile({ userId: 'u-1', email: 'a@b.c', displayName: 'Ollie', displayNameSet: true })
    expect(session.userConfig).toEqual({
      userId: 'u-1', email: 'a@b.c', displayName: 'Ollie', displayNameSet: true,
      profile: undefined, userSignedIn: true,
    })
  })

  it('adopts the name the reader chose, and keeps it in the profile it holds', () => {
    session.adoptProfile({ userId: 'u-1', displayName: 'u-1' })
    expect(session.displayNameSet).toBeUndefined()
    session.adoptDisplayName('Ollie')
    expect(session.displayName).toBe('Ollie')
    expect(session.displayNameSet).toBe(true)

    // A load that cannot reach Aeven restores from this, so it has to carry
    // the choice; a page that never cached one has nothing to rewrite.
    session.adoptProfile({ userId: 'u-1', displayName: 'u-1' })
    session.adoptDisplayName('Ollie')
    expect(JSON.parse(window.localStorage.getItem('aevenProfile') ?? 'null') as unknown)
      .toMatchObject({ userId: 'u-1', displayName: 'Ollie', displayNameSet: true })
    window.localStorage.clear()
    expect(() => { session.adoptDisplayName('Ollie') }).not.toThrow()
  })

  it('forgets everything on reset, leaving the page signed out', () => {
    session.adoptProfile({ userId: 'u-1', email: 'a@b.c', displayName: 'Ollie', displayNameSet: true })
    session.reset()
    expect(session.userConfig).toMatchObject({
      userId: null, userSignedIn: false, email: undefined,
      displayName: undefined, displayNameSet: undefined,
    })
  })

  it('reads and writes storage, and survives a browser that refuses it', () => {
    storage.setItem('userId', 'u-1')
    expect(storage.getItem('userId')).toBe('u-1')
    expect(storage.getItem('absent')).toBeNull()
  })
})

describe('the held tokens', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('holds one token per user, as the Aeven client does', () => {
    setBearerToken('u-1', 'token-1')
    setBearerToken('u-2', 'token-2')
    expect(bearerToken('u-1')).toBe('token-1')
    // The shape is shared, so a session started in either client is understood
    // by the other.
    expect(Object.keys(JSON.parse(window.localStorage.getItem('appBearers') ?? '{}') as object).sort())
      .toEqual(['u-1', 'u-2'])
  })

  it('forgets one user without disturbing another', () => {
    setBearerToken('u-1', 'token-1')
    setBearerToken('u-2', 'token-2')
    deleteBearerToken('u-1')
    expect(bearerToken('u-1')).toBeUndefined()
    expect(bearerToken('u-2')).toBe('token-2')
  })

  it('answers for no user at all, rather than reading a key named null', () => {
    expect(bearerToken(null)).toBeUndefined()
    expect(bearerToken('')).toBeUndefined()
    expect(() => { deleteBearerToken(null) }).not.toThrow()
    expect(() => { setBearerToken('', 'x') }).not.toThrow()
  })

  it('treats unreadable storage as empty, so a refresh replaces it', () => {
    window.localStorage.setItem('appBearers', 'not json')
    expect(bearerToken('u-1')).toBeUndefined()
  })
})

describe('the helpers the screens call', () => {
  it('mints an identifier of the shape Aeven mints', () => {
    const one = guid()
    expect(one).toHaveLength(34)
    // Screens key their own listeners on it, so two must not collide.
    expect(guid()).not.toBe(one)
  })

  it('returns a path as its own href, with the trailing slash when asked', () => {
    expect(href('/sign-in')).toBe('/sign-in')
    expect(href('/sign-in', true)).toBe('/sign-in/')
    expect(href('/sign-in/', true)).toBe('/sign-in/')
  })

  it('copies a value structurally', () => {
    const source = { a: 1, nested: { b: 2 } }
    const copy = cloneObject(source)
    copy.nested.b = 3
    expect(source.nested.b).toBe(2)
  })
})

describe('storage a browser refuses', () => {
  it('reads as absent and writes without failing the page', () => {
    const denied = (): never => { throw new DOMException('denied', 'SecurityError') }
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied })
    // A private window or blocked site data throws on access; an unreadable
    // store is an absent session, which the caller already handles.
    expect(storage.getItem('userId')).toBeNull()
    expect(() => { storage.setItem('userId', 'u-1') }).not.toThrow()
    vi.unstubAllGlobals()
  })
})
