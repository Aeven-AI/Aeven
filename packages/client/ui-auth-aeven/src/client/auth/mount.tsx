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

import { Popup } from './com/Popup.tsx'
import { Authenticate, type AuthScreenCover } from './views/Authenticate.tsx'
import { NameCheck } from './views/NameCheck.tsx'
import { OauthResult } from './views/OauthResult.tsx'
import { matchAuthRoute } from './route-match.ts'
import { AUTH_EXIT_ELSEWHERE, AUTH_ROUTES, isAuthRoute } from './services/routes.ts'
import { storage } from './services/session.ts'
import '../../vendor/aeven-auth.css'

/**
 * How the reader left an authentication screen: `here` through this page, or
 * `elsewhere` when the sign-in finished in another window — a provider window
 * or the default browser a shell opened — which the reader is returning from.
 */
export type AuthScreenExit = 'here' | 'elsewhere'

export type { AuthScreenCover } from './views/Authenticate.tsx'

/** A mounted authentication screen, and how to take it down. */
export interface MountedAuthScreen {
  /**
   * Resolves once the reader has left this screen with a session established.
   *
   * The boot gate waits on this and then boots the application in the same
   * document, so a reader who signs in is never sent through a document load.
   * A reader returning from another window should find the cover already up,
   * so `elsewhere` asks the gate not to fade it in over this screen.
   */
  readonly authenticated: Promise<AuthScreenExit>
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
 * @param cover - the gate's cover, which a provider sign-in raises from the press on.
 * @returns the mounted screen, or undefined when no screen owns that path.
 */
export function mountAuthScreen(container: Element, pathname: string, cover?: AuthScreenCover): MountedAuthScreen | undefined {
  const match = matchAuthRoute(pathname)
  if (match === undefined) return undefined

  const root: Root = createRoot(container)
  const render = (current: typeof match): void => {
    const screen = current.screen === 'oauthResult'
      ? createElement(OauthResult, { match: { params: current.params } })
      : createElement(Authenticate, {
        ...cover === undefined ? {} : { cover },
        match: {
          path: current.path,
          params: current.params.authType === undefined ? {} : { authType: current.params.authType },
        },
      })
    // The stylesheet is rooted at `#app-root > .view-container > .view`, so the
    // screen is given the ancestors its rules select on. Without them the
    // components still style themselves and the layout does not, which reads
    // as a page that almost works. The popup portals itself to the body, so
    // where it sits here only ties its lifetime to the screen's.
    root.render(
      createElement('div', { id: 'app-root', style: { height: '100%', width: '100%' } },
        createElement(Popup),
        createElement('div', { className: 'view-container' }, screen)),
    )
  }
  render(match)

  // The screens report success by leaving the authentication surface, which is
  // what this settles. The boot gate is waiting on it and boots the application
  // in this document; a document load would re-run the whole kernel to reach the
  // same place, and would repaint the cover from the served HTML on the way.
  let settle: (exit: AuthScreenExit) => void = () => {}
  const authenticated = new Promise<AuthScreenExit>((resolve) => { settle = resolve })

  // The screens navigate between themselves — sign-in to sign-up, and on to the
  // verification step — so the mounted screen follows the address rather than
  // the gate remounting a root per transition.
  const followRoute = (): void => {
    const next = matchAuthRoute(window.location.pathname)
    if (next !== undefined) {
      render(next)
      return
    }
    const state = window.history.state as { authExit?: unknown } | null
    settle(state?.authExit === AUTH_EXIT_ELSEWHERE.authExit ? 'elsewhere' : 'here')
  }
  window.addEventListener('popstate', followRoute)

  return {
    authenticated,
    unmount: () => {
      window.removeEventListener('popstate', followRoute)
      root.unmount()
    },
  }
}

/**
 * Render the naming step, and hand the application its boot once the reader is named.
 *
 * The step has no route of its own: it owns whatever page the reader asked
 * for, and that address is remembered here so naming them returns them to it.
 * Giving the name is the last thing that happens before the application boots,
 * so the gate that waits on this finds a profile carrying a name.
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

  let settle: (exit: AuthScreenExit) => void = () => {}
  const authenticated = new Promise<AuthScreenExit>((resolve) => { settle = resolve })

  const root: Root = createRoot(container)
  root.render(
    // The stylesheet is rooted at `#app-root > .view-container > .view`, so the
    // step is given the ancestors its rules select on, exactly as the sign-in
    // screens are.
    createElement('div', { id: 'app-root', style: { height: '100%', width: '100%' } },
      createElement(Popup),
      createElement('div', { className: 'view-container' },
        createElement(NameCheck, {
          onNamed: () => {
            // The gate boots the application in this document once this settles,
            // so the reader is moved to where they were headed first. A plain
            // `pushState`: the application reads the address as it boots, and
            // there is no mounted application yet to hear a navigation.
            window.history.pushState(null, '', destination())
            settle('here')
          },
        }))),
  )

  return { authenticated, unmount: () => { root.unmount() } }
}
