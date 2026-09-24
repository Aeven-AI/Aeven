/** Registers the browser as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Remote event merge (ctx.remote, `browser/automation`).
import type {} from '@aeven/api-remotes/client'
import type { SessionId } from '@aeven/api-remotes/client'
import type { ISessions } from '@aeven/api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration.
import type {} from '@aeven/client-ui-sidebar-right/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import { createElement } from 'react'
import { BrowserPane } from './BrowserPane.tsx'
import { automate } from './automation.ts'
import { isDesktopShell, liveGuests } from './guest.ts'
import { en, zh, type SidebarBrowserKey } from './locales.ts'

export type { BrowserPaneProps } from './BrowserPane.tsx'
export type { SidebarBrowserKey } from './locales.ts'
export { browserPartition, isDesktopShell, type BrowserGuest } from './guest.ts'
export { isLoopbackHost, resolveAddress } from './url.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right sidebar browser copy. */
    sidebarBrowser: SidebarBrowserKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarBrowser'

/** Services required by the browser plugin. */
export const inject = ['slots', 'locale']

/**
 * Registers the browser pane.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-browser: dictionaries')

  // The pane is not a slot occupant of its own: `sidebar.right.body` holds one
  // occupant, and the selection owns it. Registering here would race that.
  // The selection renders this pane once a reader picks the browser.
  // The selection publishes the registry from its own plugin, which may apply
  // after this one, so the contribution waits for the service rather than
  // reading it once. A profile without the selection never fires the callback
  // and simply has no column to register into.
  // A browser tab has no guest to embed, so picking the browser opens the
  // Host's Chromium window, which the model drives through
  // chrome-devtools-mcp, and adds no pill.
  if (!isDesktopShell()) {
    ctx.inject(['sidebarContent', 'remote', 'remote.browserChromium'], (scoped) => {
      const remote = scoped.remote
      const launch = (sessionId: string): void => {
        void remote.browserChromium.open(sessionId as SessionId, '').then((result) => {
          if (!result.ok) console.error('ui-sidebar-browser: opening Chromium failed', result.error)
        }, (error: unknown) => { console.error('ui-sidebar-browser: opening Chromium failed', error) })
      }
      scoped.effect(() => scoped.sidebarContent.registerLauncher('browser', launch), 'ui-sidebar-browser: web launcher')
    })
    return
  }

  // A pane receives only its session, so it translates through this plugin's
  // own dictionary.
  const t = ctx.locale.bind(NS)
  const Pane = ({ sessionId }: { readonly sessionId: string }) => createElement(BrowserPane, { sessionId, t })
  // The agent's browser_* tools reach this session's page. A session whose
  // pane is not mounted has no page here, so the request passes on and the
  // tool reports the browser closed.
  ctx.inject(['remote', 'sessions'], (scoped) => {
    scoped.remote.$on('browser/automation', function (request, next) {
      const sessionId = (scoped.sessions as ISessions).scopeOf(this)
      const guest = sessionId === undefined ? undefined : liveGuests.get(sessionId)
      if (guest === undefined) return next()
      return automate(guest, request) as ReturnType<typeof next>
    })
  })

  ctx.inject(['sidebarContent'], (scoped) => {
    scoped.effect(
      () => scoped.sidebarContent.register('browser', Pane),
      'ui-sidebar-browser: content kind',
    )
  })
}
