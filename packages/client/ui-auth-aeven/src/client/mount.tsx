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
import '../vendor/aeven-auth.css'

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
    root.render(current.screen === 'oauthResult'
      ? createElement(OauthResult, { match: { params: current.params } })
      : createElement(Authenticate, {
        match: {
          path: current.path,
          params: current.params.authType === undefined ? {} : { authType: current.params.authType },
        },
      }))
  }
  render(match)

  // The screens navigate between themselves — sign-in to sign-up, and on to the
  // verification step — so the mounted screen follows the address rather than
  // the gate remounting a root per transition.
  const followRoute = (): void => {
    const next = matchAuthRoute(window.location.pathname)
    if (next !== undefined) render(next)
  }
  window.addEventListener('popstate', followRoute)

  return {
    unmount: () => {
      window.removeEventListener('popstate', followRoute)
      root.unmount()
    },
  }
}
