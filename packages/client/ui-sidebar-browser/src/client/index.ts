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
// Type-only: also pulls the content registry's Context merge (ctx.sidebarContent).
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
// Type-only: pulls the settings scope's Context merge (ctx.settingsScope) and
// the settings slots this plugin's Browser section registers into.
import type {} from '@aeven/client-ui-settings/client'
import { createElement } from 'react'
import { BrowserPane } from './BrowserPane.tsx'
import { SearchEngineRow, type SearchEngineRowInjected } from './SearchEngineRow.tsx'
import { automate } from './automation.ts'
import { isDesktopShell, liveGuests, setPointerHold } from './guest.ts'
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
  // does not provide it.
  let openChromium: ((sessionId: string, url: string) => void) | null = null
  ctx.inject(['remote', 'remote.browserChromium'], (scoped) => {
    const remote = scoped.remote
    scoped.effect(() => {
      openChromium = (sessionId, url) => {
        void remote.browserChromium.open(sessionId as SessionId, url).then((result) => {
          if (!result.ok) console.error('ui-sidebar-browser: opening Chromium failed', result.error)
        }, (error: unknown) => { console.error('ui-sidebar-browser: opening Chromium failed', error) })
      }
      return () => { openChromium = null }
    }, 'ui-sidebar-browser: Host Chromium')
  })

  if (!isDesktopShell()) {
    ctx.inject(['sidebarContent', 'remote.browserChromium'], (scoped) => {
      scoped.effect(
        () => scoped.sidebarContent.registerLauncher('browser', (sessionId) => { openChromium?.(sessionId, '') }),
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
    else openChromium(sessionId, url)
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
