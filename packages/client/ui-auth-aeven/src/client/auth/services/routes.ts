/**
 * The authentication routes, and moving between them.
 *
 * The paths match the Aeven client exactly, so a link into either client
 * resolves in the other.
 * @module
 */

/** Every path the authentication surface answers on. */
export const AUTH_ROUTES = {
  home: '/',
  signIn: '/sign-in',
  signInSub: '/sign-in/:authType',
  signUp: '/sign-up',
  signUpSub: '/sign-up/:authType',
  oAuthResult: '/oauth-result/:error',
  oAuthResultSession: '/oauth-result/:oAuthSession/:oAuthChallenge',
} as const

/** The prefixes the Host must resolve to the application index. */
export const AUTH_ROUTE_PREFIXES = ['/sign-in', '/sign-up', '/oauth-result'] as const

/**
 * Whether a path belongs to the authentication surface.
 * @param pathname - the path to test.
 * @returns true when an authentication screen owns it.
 */
export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * Move to a path within the SPA.
 *
 * `pushState` notifies nothing on its own, so the event a Back or Forward would
 * raise is dispatched here and the application observes one thing either way.
 * @param path - the path to move to.
 */
export function navigateRoute(path: string): void {
  if (path === '' || window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
