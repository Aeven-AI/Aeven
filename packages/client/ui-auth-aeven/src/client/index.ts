/**
 * The Aeven authentication surface for the DSH web client.
 *
 * DSH does not authenticate anyone itself: Aeven owns the credential, and this
 * presents Aeven's own screens so a reader signs in once, in one place. The
 * gate runs before the plugin graph, so no plugin ever sees an unauthenticated
 * context.
 * @module @deepseek-ai/dsh-client-ui-auth-aeven/client
 */

export { Authenticate, type AuthenticateProps } from './auth/views/Authenticate.tsx'
export { OauthResult, type OauthResultProps } from './auth/views/OauthResult.tsx'
export { matchAuthRoute, type AuthRouteMatch } from './auth/route-match.ts'
export { mountAuthScreen, type MountedAuthScreen } from './auth/mount.tsx'
export { AUTH_ROUTES, AUTH_ROUTE_PREFIXES, isAuthRoute, navigateRoute } from './auth/services/routes.ts'
export { session, storage, type AevenProfile, type UserConfig } from './auth/services/session.ts'
export { currentBearer } from './auth/services/tokens.ts'
export { signOut, getProfile, AevenApiError } from './auth/services/api.ts'
export { publishReader, publishedReader, type AevenReader } from './auth/services/reader.ts'
export { aevenConfig, mediaUrl, webUrl, type AevenClientConfig } from './auth/services/config.ts'

import { getProfile } from './auth/services/api.ts'
import { aevenConfig } from './auth/services/config.ts'
import { AUTH_ROUTES, isAuthRoute, navigateRoute } from './auth/services/routes.ts'
import { publishReader } from './auth/services/reader.ts'
import { session, storage } from './auth/services/session.ts'
import { currentBearer } from './auth/services/tokens.ts'

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
    publishReader()
    return { state: 'authenticated', userId: profile.userId }
  } catch {
    // Every failure is the same to the reader: no session. The reason lives in
    // the API's answer, which the sign-in screen surfaces when they try.
    session.reset()
    publishReader()
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

/** The transport seam the connection plugin reads before it builds its caller. */
interface TransportHooks {
  fetch?: (input: URL, init: RequestInit) => Promise<Response>
}

/**
 * Attach the Aeven bearer to every DSH RPC call.
 *
 * DSH's own API is fenced by the same authority as Aeven's, and a browser
 * cannot set a header on a WebSocket upgrade — so the socket presents the
 * refresh cookie and HTTP presents this. Installed through the transport hook
 * the connection plugin already reads, rather than teaching that plugin about
 * Aeven.
 *
 * Must be called before the plugin graph boots: the connection builds its
 * caller once, from whatever the hook holds at that moment.
 */
export function installAuthenticatedTransport(): void {
  const scope = globalThis as { __DSH_TRANSPORT__?: TransportHooks }
  const existing = scope.__DSH_TRANSPORT__?.fetch
  const send = existing ?? ((input: URL, init: RequestInit) => globalThis.fetch(input, init))

  scope.__DSH_TRANSPORT__ = {
    ...scope.__DSH_TRANSPORT__,
    fetch: async (input: URL, init: RequestInit): Promise<Response> => {
      const headers = new Headers(init.headers)
      try {
        headers.set('Authorization', `Bearer ${await currentBearer()}`)
      } catch {
        // No session to present. The request still goes out and the Host
        // answers 401, which is the same answer it would give to a bearer it
        // rejected — the caller handles one case, not two.
      }
      return send(input, { ...init, headers })
    },
  }
}
