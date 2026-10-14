/** Registers the browser as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Remote event merge (ctx.remote, `browser/automation`).
import type {} from '@aeven/api-remotes/client'
import type { SessionId } from '@aeven/api-remotes/client'
// Type-only: pulls the session controller's Context merge (ctx.sessions).
import type {} from '@aeven/api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration.
import type {} from '@aeven/client-ui-sidebar-right/client'
// Type-only: also pulls the content registry's Context merge (ctx.sidebarContent).
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
// Type-only: pulls the settings scope's Context merge (ctx.settingsScope) and
// the settings slots this plugin's Browser section registers into.
import type {} from '@aeven/client-ui-settings/client'
import { createElement } from 'react'
import { writeClipboard } from '@aeven/client-ui-primitives'
import { BrowserPane } from './BrowserPane.tsx'
import { SearchEngineRow, type SearchEngineRowInjected } from './SearchEngineRow.tsx'
import { automate } from './automation.ts'
import {
  desktopBrowser, desktopLinks, desktopMenus, isDesktopShell, liveGuests, setPointerHold, writeLastUrl,
} from './guest.ts'
import { installLinkHandling } from './links.ts'
import { en, zh, type SidebarBrowserKey } from './locales.ts'
import { SearchEnginePreference } from './search-engine.ts'
import { BROWSER_SETTINGS_NAMESPACE, type BrowserSettings } from '../browser-settings.ts'

export type { BrowserPaneProps } from './BrowserPane.tsx'
export type { SearchEngineRowInjected, SearchEngineRowProps } from './SearchEngineRow.tsx'
export type { AddressTarget } from './url.ts'
export type { SidebarBrowserKey } from './locales.ts'
export { browserPartition, isDesktopShell, type BrowserGuest } from './guest.ts'
export { isLoopbackHost, resolveAddress, resolveTarget } from './url.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right sidebar browser copy: the pane's chrome and its Settings section. */
    sidebarBrowser: SidebarBrowserKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarBrowser'

/** Services required by the browser plugin. */
export const inject = ['slots', 'locale', 'settingsScope']

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
  // The Host's Chromium: the profile chrome-devtools-mcp drives, where the
  // agent's DevTools tools see what the reader opens. Null while the Host
  // does not provide it; `false` when it refused to come up, which is when the
  // address belongs to the operating system's browser instead.
  let openChromium: ((sessionId: string, url: string) => Promise<boolean>) | null = null
  ctx.inject(['remote', 'remote.browserChromium'], (scoped) => {
    const remote = scoped.remote
    scoped.effect(() => {
      openChromium = async (sessionId, url) => {
        try {
          const result = await remote.browserChromium.open(sessionId as SessionId, url)
          if (result.ok) return true
          console.error('ui-sidebar-browser: opening Chromium failed', result.error)
          return false
        } catch (error: unknown) {
          console.error('ui-sidebar-browser: opening Chromium failed', error)
          return false
        }
      }
      return () => { openChromium = null }
    }, 'ui-sidebar-browser: Host Chromium')
  })

  if (!isDesktopShell()) {
    ctx.inject(['sidebarContent', 'remote.browserChromium'], (scoped) => {
      scoped.effect(
        () => scoped.sidebarContent.registerLauncher('browser', (sessionId) => { void openChromium?.(sessionId, '') }),
        'ui-sidebar-browser: web launcher',
      )
    })
    return
  }

  // A pane receives only its session, so it translates through this plugin's
  // own dictionary.
  const t = ctx.locale.bind(NS)
  const openInChrome = (sessionId: string, url: string): void => {
    if (openChromium === null) console.error('ui-sidebar-browser: the Host provides no Chromium to open in')
    else void openChromium(sessionId, url)
  }
  // The window is an Electron page, so a click on a link reaches the shell
  // instead of opening a tab. Where it lands is decided here rather than in the
  // shell, because this is the side that can reach a session's own pane and the
  // Chromium the agent's DevTools tools drive. Served over HTTP none of this is
  // installed: a tab opens the link itself, which is what a browser can do.
  const menus = desktopMenus()
  const links = desktopLinks()
  const browser = desktopBrowser()
  if (menus !== undefined && links !== undefined && browser !== undefined) {
    ctx.inject(['sidebarContent', 'sessions'], (scoped) => {
      const openInSidebar = (url: string): void => {
        const sessionId = (scoped.sessions).list.getSnapshot().current
        if (sessionId === undefined) {
          openInSystemBrowser(url)
          return
        }
        // A mounted pane navigates the page it already shows; a pane that is
        // not mounted reopens at this address when the column mounts it.
        const guest = liveGuests.get(sessionId)
        if (guest === undefined) writeLastUrl(sessionId, url)
        else void guest.loadURL(url).catch((error: unknown) => {
          console.error('ui-sidebar-browser: the sidebar browser refused an address', error)
        })
        // Asking for the kind also shows the column it belongs to.
        scoped.sidebarContent.requestOpen(sessionId, 'browser')
      }
      const openInSystemBrowser = (url: string): void => {
        const sessionId = (scoped.sessions).list.getSnapshot().current
        const driven = openChromium === null || sessionId === undefined
          ? Promise.resolve(false)
          : openChromium(sessionId, url)
        void driven.then((opened) => {
          if (opened) return
          void browser.openExternal(url).catch((error: unknown) => {
            console.error('ui-sidebar-browser: the system browser refused an address', error)
          })
        })
      }
      scoped.effect(() => installLinkHandling({
        menus,
        links,
        t,
        document: window.document,
        openInSidebar,
        openInSystemBrowser,
        copyLink: (url) => {
          void writeClipboard(url).then((copied) => {
            if (!copied) console.error('ui-sidebar-browser: the clipboard refused a link')
          })
        },
      }), 'ui-sidebar-browser: desktop links')
    })
  }
  // One preference serves the pane and its Settings row, so choosing an engine
  // there changes what an already-open address bar searches with.
  const searchEngines = new SearchEnginePreference()
  ctx.effect(
    () => searchEngines.attach(ctx.settingsScope.bind<BrowserSettings>({ namespace: BROWSER_SETTINGS_NAMESPACE })),
    'ui-sidebar-browser: search engine preference',
  )
  // The row sits in General, the seat for a setting that needs no page of its
  // own, and mounts only where the embedded pane does: served over HTTP the
  // browser kind opens the Host's own Chromium, whose search settings are its
  // own.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'search-engine',
    order: 30,
    locale: NS,
    inject: (): SearchEngineRowInjected => ({
      hooks: { searchEngine: searchEngines.engine },
      setSearchEngine: (engine) => { searchEngines.setEngine(engine) },
    }),
  }, SearchEngineRow))

  const Pane = ({ sessionId, visible }: SidebarContentPaneProps) =>
    createElement(BrowserPane, { sessionId, t, openInChrome, visible, search: searchEngines })
  // The agent's browser_* tools reach this session's page. A session whose
  // pane is not mounted has no page here, so the request passes on and the
  // tool reports the browser closed.
  ctx.inject(['remote', 'sessions'], (scoped) => {
    // While the agent works its pointer is held, so the gaps between its
    // actions do not read as finishing; when the work stops, the hold is
    // released and the pointer fades on its own idle timeout.
    scoped.remote.$on('api-session/status', (sessionId, running) => {
      setPointerHold(sessionId, running)
    })
    scoped.remote.$on('browser/automation', function (request, next) {
      const sessionId = (scoped.sessions).scopeOf(this)
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
