/**
 * Mounting an authentication screen on the page.
 *
 * The web boot kernel is otherwise framework-free — React arrives with the UI
 * renderer, after every client entry activates. The authentication screens are
 * React, and they have to be on screen before any of that happens, so the gate
 * brings React forward for this one purpose and releases it again once a
 * session exists.
 * @module
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Authenticate } from './views/Authenticate.tsx'
import { OauthResult } from './views/OauthResult.tsx'
import { matchAuthRoute } from './route-match.ts'
import '../../vendor/aeven-auth.css'

/** A mounted authentication screen, and how to take it down. */
export interface MountedAuthScreen {
  /** Unmount and release the container back to the application. */
  unmount(): void
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
