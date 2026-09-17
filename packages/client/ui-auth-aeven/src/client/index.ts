/**
 * The Aeven authentication surface for the AVN web client.
 *
 * AVN does not authenticate anyone itself: Aeven owns the credential, and this
 * presents Aeven's own screens so a reader signs in once, in one place. The
 * gate runs before the plugin graph, so no plugin ever sees an unauthenticated
 * context.
 * @module @aeven/client-ui-auth-aeven/client
 */

export { Authenticate, type AuthenticateProps } from './auth/views/Authenticate.tsx'
export { OauthResult, type OauthResultProps } from './auth/views/OauthResult.tsx'
export { matchAuthRoute, type AuthRouteMatch } from './auth/route-match.ts'
export { mountAuthScreen, mountNameScreen, type MountedAuthScreen } from './auth/mount.tsx'
export { NameCheck, type NameCheckProps } from './auth/views/NameCheck.tsx'
export { AUTH_ROUTES, AUTH_ROUTE_PREFIXES, isAuthRoute, navigateRoute } from './auth/services/routes.ts'
export {
  cachedProfile, forgetCachedProfile, session, storage,
  type AevenProfile, type UserConfig,
} from './auth/services/session.ts'
export { currentBearer } from './auth/services/tokens.ts'
export { signOut, getProfile, AevenApiError } from './auth/services/api.ts'
export { publishReader, publishedReader, type AevenReader } from './auth/services/reader.ts'
export { aevenConfig, mediaUrl, webUrl, type AevenClientConfig } from './auth/services/config.ts'

import { getProfile } from './auth/services/api.ts'
import { aevenConfig } from './auth/services/config.ts'
import { isSessionRefusal } from './auth/services/errors.ts'
import { AUTH_ROUTES, isAuthRoute, navigateRoute } from './auth/services/routes.ts'
import { publishReader } from './auth/services/reader.ts'
import { cachedProfile, session, storage, type AevenProfile } from './auth/services/session.ts'
import { sessionBearer, watchSession } from './auth/services/watch.ts'

/** How the gate resolved for this page load. */
export type AuthGateResult =
  /** A session was restored; the application may boot. */
  | { readonly state: 'authenticated'; readonly userId: string }
  /** A session was restored, but nobody has named this reader yet. */
  | { readonly state: 'unnamed'; readonly userId: string }
  /** Nobody is signed in; an authentication screen owns the page. */
  | { readonly state: 'unauthenticated' }
  /** No Aeven authority is configured, so this harness authenticates nobody. */
  | { readonly state: 'disabled' }

/**
 * How a restored profile resolves the gate.
 *
 * A name is what every surface calls the reader by, and the API records
 * whether they chose one — a name it derived from a social profile is not a
 * choice, and an account that never picked one answers nothing here. Both are
 * the state the naming step exists for, so only an explicit true boots.
 * @param profile - the restored profile, read live or kept from the last load.
 * @returns whether the application may boot, or the naming step owns the page.
 */
function gateResultFor(profile: AevenProfile): AuthGateResult {
  return profile.displayNameSet === true
    ? { state: 'authenticated', userId: profile.userId }
    : { state: 'unnamed', userId: profile.userId }
}

/**
 * Restore the Aeven session, if there is one.
 *
 * Reads the profile, which refreshes the access token through the cookie when
 * the held one has expired — the same sequence the Aeven client performs on
 * load, so a reader signed in there is signed in here without signing in
 * again.
 *
 * An Aeven that cannot be reached does not end the session. The Host verifies
 * the year-long refresh cookie against its own copy of the secret, so it still
 * identifies the reader with Aeven down and the application runs on local
 * providers; the kept profile names them until Aeven answers again.
 * @returns how the gate resolved.
 */
export async function restoreSession(): Promise<AuthGateResult> {
  // Without an Aeven API configured there is no authority to ask, and the
  // harness behaves as it always has.
  if (aevenConfig().apiUrl === undefined) return { state: 'disabled' }
  try {
    const profile = await getProfile()
    publishReader()
    return gateResultFor(profile)
  } catch (error) {
    // Aeven refusing the credential ends the session; Aeven being unreachable
    // says nothing about it, and signing the reader out over an outage would
    // put an authentication screen between them and providers that are still
    // running. The cookie the Host authenticates by outlives the outage.
    const kept = isSessionRefusal(error) ? undefined : cachedProfile()
    if (kept !== undefined) {
      session.adoptProfile(kept)
      publishReader()
      // The kept profile decides this the same way a live one does: a reader
      // who had a name keeps it through the outage, and one who never chose
      // one was already at the naming step, which needs the API either way.
      return gateResultFor(kept)
    }
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
 * Attach the Aeven bearer to every AVN RPC call, and keep the session alive.
 *
 * AVN's own API is fenced by the same authority as Aeven's, and a browser
 * cannot set a header on a WebSocket upgrade — so the socket presents the
 * refresh cookie and HTTP presents this. Installed through the transport hook
 * the connection plugin already reads, rather than teaching that plugin about
 * Aeven.
 *
 * A Host 401 renews the bearer and retries once. When Aeven refuses the renewal
 * — here or in the background renewal — the session has ended and the page
 * loads the sign-in screen.
 *
 * Must be called before the plugin graph boots: the connection builds its
 * caller once, from whatever the hook holds at that moment.
 * @returns disposer stopping the background renewal; the page keeps the transport hook.
 */
export function installAuthenticatedTransport(): () => void {
  const scope = globalThis as { __AVN_TRANSPORT__?: TransportHooks }
  const existing = scope.__AVN_TRANSPORT__?.fetch
  const send = existing ?? ((input: URL, init: RequestInit) => globalThis.fetch(input, init))
  const sendWith = (input: URL, init: RequestInit, bearer: string | undefined): Promise<Response> => {
    const headers = new Headers(init.headers)
    if (bearer !== undefined) headers.set('Authorization', `Bearer ${bearer}`)
    return send(input, { ...init, headers })
  }

  scope.__AVN_TRANSPORT__ = {
    ...scope.__AVN_TRANSPORT__,
    fetch: async (input: URL, init: RequestInit): Promise<Response> => {
      const bearer = await sessionBearer()
      const response = await sendWith(input, init, bearer)
      if (response.status !== 401 || bearer === undefined) return response
      const renewed = await sessionBearer(bearer)
      return renewed === undefined ? response : sendWith(input, init, renewed)
    },
  }
  return watchSession()
}
