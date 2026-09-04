/**
 * The Aeven authentication surface for the DSH web client.
 *
 * DSH does not authenticate anyone itself: Aeven owns the credential, and this
 * presents Aeven's own screens so a reader signs in once, in one place. The
 * gate runs before the plugin graph, so no plugin ever sees an unauthenticated
 * context.
 * @module @deepseek-ai/dsh-client-ui-auth-aeven/client
 */

export { Authenticate, type AuthenticateProps } from './views/Authenticate.tsx'
export { OauthResult, type OauthResultProps } from './views/OauthResult.tsx'
export { matchAuthRoute, type AuthRouteMatch } from './route-match.ts'
export { AUTH_ROUTES, AUTH_ROUTE_PREFIXES, isAuthRoute, navigateRoute } from './services/routes.ts'
export { session, storage, type AevenProfile, type UserConfig } from './services/session.ts'
export { currentBearer } from './services/tokens.ts'
export { signOut, getProfile, AevenApiError } from './services/api.ts'
export { aevenConfig, type AevenClientConfig } from './services/config.ts'

import { getProfile } from './services/api.ts'
import { aevenConfig } from './services/config.ts'
import { AUTH_ROUTES, isAuthRoute, navigateRoute } from './services/routes.ts'
import { session, storage } from './services/session.ts'

/** How the gate resolved for this page load. */
export type AuthGateResult =
  /** A session was restored; the application may boot. */
  | { readonly state: 'authenticated'; readonly userId: string }
  /** Nobody is signed in; an authentication screen owns the page. */
  | { readonly state: 'unauthenticated' }
  /** No Aeven authority is configured, so this harness authenticates nobody. */
  | { readonly state: 'disabled' }

/**
 * Restore the Aeven session, if there is one.
 *
 * Reads the profile, which refreshes the access token through the cookie when
 * the held one has expired — the same sequence the Aeven client performs on
 * load, so a reader signed in there is signed in here without signing in
 * again.
 * @returns how the gate resolved.
 */
export async function restoreSession(): Promise<AuthGateResult> {
  // Without an Aeven API configured there is no authority to ask, and the
  // harness behaves as it always has.
  if (aevenConfig().apiUrl === undefined) return { state: 'disabled' }
  try {
    const profile = await getProfile()
    return { state: 'authenticated', userId: profile.userId }
  } catch {
    // Every failure is the same to the reader: no session. The reason lives in
    // the API's answer, which the sign-in screen surfaces when they try.
    session.reset()
    return { state: 'unauthenticated' }
  }
}

/**
 * Send an unauthenticated reader to the sign-in screen, remembering where they
 * were so they return there afterwards.
 * @param pathname - the path they asked for.
 */
export function requireSignIn(pathname: string): void {
  // An authentication path is where they already are; recording it as the
  // destination would return them to the sign-in screen after signing in.
  if (!isAuthRoute(pathname) && pathname !== AUTH_ROUTES.home) {
    storage.setItem('authReferrer', pathname)
  }
  navigateRoute(AUTH_ROUTES.signIn)
}
