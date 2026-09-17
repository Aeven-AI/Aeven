/**
 * Matching a browser path to the authentication screen that owns it.
 *
 * The ported screens read `match.path` and `match.params.authType`, which the
 * Aeven client's router supplied. AVN has no general router, so the six auth
 * paths are matched here and nowhere else.
 * @module
 */

import { AUTH_ROUTES } from './services/routes.ts'

/** Which screen a path resolves to, and what it matched out of it. */
export interface AuthRouteMatch {
  readonly screen: 'authenticate' | 'oauthResult'
  readonly path: string
  readonly params: {
    readonly authType?: string
    readonly error?: string
    readonly oAuthSession?: string
    readonly oAuthChallenge?: string
  }
}

/**
 * Resolve a path to its authentication screen.
 * @param pathname - the browser path.
 * @returns the match, or undefined when no authentication screen owns it.
 */
export function matchAuthRoute(pathname: string): AuthRouteMatch | undefined {
  // A trailing slash is how the Aeven client links between these screens, so
  // both forms name the same route.
  const segments = pathname.replace(/\/+$/, '').split('/').filter(s => s !== '')
  const [first, second, third] = segments

  if (first === 'sign-in' || first === 'sign-up') {
    const base = first === 'sign-in' ? AUTH_ROUTES.signIn : AUTH_ROUTES.signUp
    if (second === undefined) return { screen: 'authenticate', path: base, params: {} }
    return {
      screen: 'authenticate',
      path: `${base}/:authType`,
      params: { authType: second },
    }
  }

  if (first === 'oauth-result') {
    // Two shapes share this prefix: a single error, or the session/challenge
    // pair a provider redirects back with.
    if (second !== undefined && third !== undefined) {
      return {
        screen: 'oauthResult',
        path: AUTH_ROUTES.oAuthResultSession,
        params: { oAuthSession: second, oAuthChallenge: third },
      }
    }
    if (second !== undefined) {
      return { screen: 'oauthResult', path: AUTH_ROUTES.oAuthResult, params: { error: second } }
    }
  }

  return undefined
}
