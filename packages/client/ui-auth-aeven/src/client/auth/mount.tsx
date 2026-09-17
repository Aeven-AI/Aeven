/**
 * Mounting an authentication screen on the page.
 *
 * The web boot kernel is otherwise framework-free — React arrives with the UI
 * renderer, after every client entry activates. The authentication screens are
 * React, and they have to be on screen before any of that happens, so the gate
 * brings React forward for this one purpose and releases it again once a
 * session exists. The naming step is mounted the same way, for the same reason.
 * @module
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Authenticate } from './views/Authenticate.tsx'
import { NameCheck } from './views/NameCheck.tsx'
import { OauthResult } from './views/OauthResult.tsx'
import { matchAuthRoute } from './route-match.ts'
import { AUTH_ROUTES, isAuthRoute } from './services/routes.ts'
import { storage } from './services/session.ts'
import '../../vendor/aeven-auth.css'

/** A mounted authentication screen, and how to take it down. */
export interface MountedAuthScreen {
  /** Unmount and release the container back to the application. */
  unmount(): void
}

/**
 * Where a reader goes once they have a name: the page they first asked for.
 *
 * An authentication path is not a destination — a reader sent to sign-in and
 * then to the naming step did not ask for either — so it falls back to the
 * application root.
 * @returns the path to load.
 */
function destination(): string {
  const referrer = storage.getItem('authReferrer')
  if (referrer === null || referrer === '' || isAuthRoute(referrer)) return AUTH_ROUTES.home
  return referrer
}

/**
 * Render the authentication screen a path names.
 * @param container - the element to render into.
 * @param pathname - the browser path.
 * @returns the mounted screen, or undefined when no screen owns that path.
 */
export function mountAuthScreen(container: Element, pathname: string): MountedAuthScreen | undefined {
  const match = matchAuthRoute(pathname)
  if (match === undefined) return undefined

  const root: Root = createRoot(container)
  const render = (current: typeof match): void => {
    const screen = current.screen === 'oauthResult'
      ? createElement(OauthResult, { match: { params: current.params } })
      : createElement(Authenticate, {
        match: {
          path: current.path,
          params: current.params.authType === undefined ? {} : { authType: current.params.authType },
        },
      })
    // The stylesheet is rooted at `#app-root > .view-container > .view`, so the
    // screen is given the ancestors its rules select on. Without them the
    // components still style themselves and the layout does not, which reads
    // as a page that almost works.
    root.render(
      createElement('div', { id: 'app-root', style: { height: '100%', width: '100%' } },
        createElement('div', { className: 'view-container' }, screen)),
    )
  }
  render(match)

  // The screens navigate between themselves — sign-in to sign-up, and on to the
  // verification step — so the mounted screen follows the address rather than
  // the gate remounting a root per transition.
  const followRoute = (): void => {
    const next = matchAuthRoute(window.location.pathname)
    if (next !== undefined) {
      render(next)
      return
    }
    // Leaving the authentication surface is how these screens report success:
    // they navigate to wherever the reader was headed. The boot decided there
    // was no session and returned, so nothing here can start the application —
    // a document load runs the gate again, which now restores the session it
    // just established.
    window.location.assign(window.location.pathname + window.location.search)
  }
  window.addEventListener('popstate', followRoute)

  return {
    unmount: () => {
      window.removeEventListener('popstate', followRoute)
      root.unmount()
    },
  }
}

/**
 * Render the naming step, and load the application once the reader is named.
 *
 * The step has no route of its own: it owns whatever page the reader asked
 * for, and that address is remembered here so naming them returns them to it.
 * Giving the name is the last thing that happens before the application boots,
 * so the load that follows is the ordinary one, and its gate finds a profile
 * that carries a name.
 * @param container - the element to render into.
 * @param pathname - the browser path they asked for.
 * @returns the mounted screen, and how to take it down.
 */
export function mountNameScreen(container: Element, pathname: string): MountedAuthScreen {
  // An authentication path is where they already are, as for sign-in: recording
  // it as the destination would return them to a screen they have finished.
  if (!isAuthRoute(pathname) && pathname !== AUTH_ROUTES.home) {
    storage.setItem('authReferrer', pathname)
  }

  const root: Root = createRoot(container)
  root.render(
    // The stylesheet is rooted at `#app-root > .view-container > .view`, so the
    // step is given the ancestors its rules select on, exactly as the sign-in
    // screens are.
    createElement('div', { id: 'app-root', style: { height: '100%', width: '100%' } },
      createElement('div', { className: 'view-container' },
        createElement(NameCheck, {
          onNamed: () => { window.location.assign(destination()) },
        }))),
  )

  return { unmount: () => { root.unmount() } }
}
