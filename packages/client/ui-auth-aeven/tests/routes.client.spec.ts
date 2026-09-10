/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchAuthRoute } from '../src/client/auth/route-match.ts'
import { isAuthRoute, navigateRoute, AUTH_ROUTES } from '../src/client/auth/services/routes.ts'
import { isEmail, isValidPassword } from '../src/client/auth/services/utility.ts'

describe('matchAuthRoute', () => {
  it('matches the sign-in and sign-up screens, with and without a step', () => {
    expect(matchAuthRoute('/sign-in')).toEqual({
      screen: 'authenticate', path: AUTH_ROUTES.signIn, params: {},
    })
    expect(matchAuthRoute('/sign-in/email')).toEqual({
      screen: 'authenticate', path: AUTH_ROUTES.signInSub, params: { authType: 'email' },
    })
    expect(matchAuthRoute('/sign-up/verify')).toEqual({
      screen: 'authenticate', path: AUTH_ROUTES.signUpSub, params: { authType: 'verify' },
    })
  })

  it('reads a trailing slash as the same route, which is how the screens link', () => {
    expect(matchAuthRoute('/sign-in/')).toEqual(matchAuthRoute('/sign-in'))
    expect(matchAuthRoute('/sign-in/email/')).toEqual(matchAuthRoute('/sign-in/email'))
  })

  it('separates the two shapes an OAuth redirect can take', () => {
    // A provider returns either a failure, or the pair to exchange.
    expect(matchAuthRoute('/oauth-result/denied')).toEqual({
      screen: 'oauthResult', path: AUTH_ROUTES.oAuthResult, params: { error: 'denied' },
    })
    expect(matchAuthRoute('/oauth-result/sess-1/chal-2')).toEqual({
      screen: 'oauthResult',
      path: AUTH_ROUTES.oAuthResultSession,
      params: { oAuthSession: 'sess-1', oAuthChallenge: 'chal-2' },
    })
  })

  it('claims no path an authentication screen does not own', () => {
    for (const path of ['/', '/c/abc', '/oauth-result', '/settings', '/sign-in-elsewhere']) {
      expect(matchAuthRoute(path)).toBeUndefined()
    }
  })
})

describe('isAuthRoute', () => {
  it('recognizes the surface, and nothing merely prefixed by its name', () => {
    expect(isAuthRoute('/sign-in')).toBe(true)
    expect(isAuthRoute('/sign-up/email')).toBe(true)
    expect(isAuthRoute('/oauth-result/x/y')).toBe(true)
    expect(isAuthRoute('/')).toBe(false)
    expect(isAuthRoute('/c/abc')).toBe(false)
    // A path that starts with the same letters is a different route; recording
    // it as the destination would send the reader back to the screen they
    // just left.
    expect(isAuthRoute('/sign-in-elsewhere')).toBe(false)
  })
})

describe('the credential rules, carried over from Aeven', () => {
  it('accepts and rejects the addresses the API does', () => {
    expect(isEmail('olivier@aeven.io')).toBe(true)
    expect(isEmail('a.b+c@example.co.uk')).toBe(true)
    expect(isEmail('no-at-sign')).toBe(false)
    expect(isEmail('two@at@signs.com')).toBe(false)
    expect(isEmail('trailing@dot.')).toBe(false)
    expect(isEmail(`${'a'.repeat(65)}@example.com`)).toBe(false)
    // The API caps the whole address as well as the local part.
    expect(isEmail(`${'a'.repeat(250)}@example.com`)).toBe(false)
  })

  it('requires the four character classes and the length Aeven requires', () => {
    expect(isValidPassword('Airwave007!')).toBe(true)
    expect(isValidPassword('short1!A')).toBe(true)
    expect(isValidPassword('nouppercase1!')).toBe(false)
    expect(isValidPassword('NOLOWERCASE1!')).toBe(false)
    expect(isValidPassword('NoDigits!!')).toBe(false)
    expect(isValidPassword('NoSymbols123')).toBe(false)
    expect(isValidPassword('Sh1!')).toBe(false)
  })
})

describe('navigateRoute', () => {
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

  it('moves and tells the page, because pushState notifies nothing on its own', () => {
    const heard: string[] = []
    const listener = (): void => { heard.push(window.location.pathname) }
    window.addEventListener('popstate', listener)
    navigateRoute('/sign-up')
    window.removeEventListener('popstate', listener)
    expect(window.location.pathname).toBe('/sign-up')
    // The screens follow this event; a Back or Forward raises the same one.
    expect(heard).toEqual(['/sign-up'])
  })

  it('does nothing for the path already shown, or for none at all', () => {
    window.history.replaceState(null, '', '/sign-in')
    const push = vi.spyOn(window.history, 'pushState')
    navigateRoute('/sign-in')
    navigateRoute('')
    expect(push).not.toHaveBeenCalled()
  })
})
