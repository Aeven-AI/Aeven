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
// Type-only: the `shell.overlay` declaration the extension prompt registers into.
import type {} from '@aeven/client-ui-layout/client'
// Type-only: pulls the conversation service the extension prompt's continue sends through.
import type {} from '@aeven/client-ui-conversation/client'
import { createElement } from 'react'
import { writeClipboard } from '@aeven/client-ui-primitives'
import { BrowserPane } from './BrowserPane.tsx'
import { SearchEngineRow, type SearchEngineRowInjected } from './SearchEngineRow.tsx'
import { automate, mintRequestId, navigateClosed } from './automation.ts'
import { UserChromePreference } from './user-chrome.ts'
import { UserChromeRow, type UserChromeRowInjected } from './UserChromeRow.tsx'
import { resolveAddress } from './url.ts'
import { handoffs } from './handoff.ts'
import { searchHistory } from './history.ts'
import {
  desktopBrowser, desktopLinks, desktopMenus, isDesktopShell, liveGuests, livePaneCursors, setPointerHold, writeLastUrl,
  type BrowserGuest, type ChromeKind, type ChromeTabRef,
} from './guest.ts'
import { installLinkHandling } from './links.ts'
import { PageExtensionLink, pageConnector, pageExtensionBridge, type PageExtensionBridge } from './extension-page.ts'
import { ExtensionRow, type ExtensionRowInjected } from './ExtensionRow.tsx'
import { AEVEN_EXTENSION_STORE_URL, browserLabel as extensionBrowserLabel, canInstallExtension, ExtensionPrompt } from './extension-install.ts'
import { ExtensionPromptModal, type ExtensionPromptInjected } from './ExtensionPromptModal.tsx'
import { en, es, zh, type SidebarBrowserKey } from './locales.ts'
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

/** A Chrome tab as listed to the agent; a type alias, so it is JSON the tool result can carry. */
type ListedChromeTab = {
  tabId: string
  browser: string
  url: string
  title: string
  browserName?: string
  current: boolean
}

/** Chrome access for the agent's tab commands and actions. */
interface ChromeAccess {
  /** The bridge that reaches the Chromes: the desktop shell's, or in the web app the page's link to the extension. */
  bridge(): PageExtensionBridge | undefined
  /** Aeven's Chrome's debugging endpoint, when the Host runs one. */
  aevenUrl(): string | undefined
  /** Whether the reader allowed their own Chrome. */
  userAllowed(): boolean
  /** Make sure Aeven's Chrome runs, launching it on the Host. */
  launch(sessionId: string): Promise<boolean>
  /** The Chrome tabs the session may use, as listed to the agent. */
  list(sessionId: string): Promise<ListedChromeTab[]>
}

/** Tab-id prefix of each Chrome. */
const CHROME_PREFIX: Readonly<Record<ChromeKind, string>> = { aeven: 'chrome:', user: 'my-chrome:', extension: 'ext:' }

/** How each Chrome is named to the agent. */
const CHROME_BROWSER: Readonly<Record<ChromeKind, string>> = { aeven: 'chrome', user: 'my-chrome', extension: 'extension' }

/**
 * Read a Chrome tab id the agent names.
 * @param tabId - a tab id from a tab list.
 * @returns the Chrome tab, or undefined for a sidebar tab id.
 */
function parseChromeTabId(tabId: string | undefined): ChromeTabRef | undefined {
  if (tabId?.startsWith(CHROME_PREFIX.extension) === true) return { kind: 'extension', targetId: tabId.slice(CHROME_PREFIX.extension.length) }
  if (tabId?.startsWith(CHROME_PREFIX.user) === true) return { kind: 'user', targetId: tabId.slice(CHROME_PREFIX.user.length) }
  if (tabId?.startsWith(CHROME_PREFIX.aeven) === true) return { kind: 'aeven', targetId: tabId.slice(CHROME_PREFIX.aeven.length) }
  return undefined
}

/**
 * List the tabs of the Chromes a session may use.
 * @param sessionId - the session.
 * @param bridge - reaches the Chromes.
 * @param kinds - the Chromes to list.
 * @param aevenUrl - Aeven's Chrome's endpoint, when it runs.
 * @returns the tabs as listed to the agent.
 */
async function listChromeTabs(
  sessionId: string, bridge: PageExtensionBridge, kinds: readonly ChromeKind[], aevenUrl: string | undefined,
): Promise<ListedChromeTab[]> {
  const current = liveGuests.chrome(sessionId)
  const listed = []
  for (const kind of kinds) {
    // A Chrome that is not running, or does not allow debugging, lists no tabs.
    const tabs = await bridge.chromeTabs(kind, aevenUrl).catch(() => [])
    listed.push(...tabs.map(tab => ({
      tabId: `${CHROME_PREFIX[kind]}${tab.targetId}`, browser: CHROME_BROWSER[kind], url: tab.url, title: tab.title,
      ...tab.browser === undefined ? {} : { browserName: tab.browser },
      current: current?.kind === kind && current.targetId === tab.targetId,
    })))
  }
  return listed
}

/**
 * Answer a tab command that names a Chrome tab or opens one.
 * @param sessionId - the session.
 * @param request - the `tabs` request.
 * @param chrome - Chrome access.
 * @param tab - the named Chrome tab, absent for `new`.
 * @returns the tabs after the command.
 */
async function chromeTabs(
  sessionId: string,
  request: { readonly input: { readonly [key: string]: unknown }; readonly signal?: AbortSignal | undefined },
  chrome: ChromeAccess,
  tab: ChromeTabRef | undefined,
): Promise<{ [key: string]: unknown }> {
  const bridge = chrome.bridge()
  if (bridge === undefined) throw new Error('Chrome tabs are driven from the desktop app')
  const action = request.input.action
  const kind: ChromeKind = tab?.kind ?? (request.input.browser === 'my-chrome' ? 'user' : request.input.browser === 'extension' ? 'extension' : 'aeven')
  if (kind === 'user' && !chrome.userAllowed()) throw new Error('the user has not allowed Aeven to use their Chrome; they can turn on Settings > General > Use your Chrome')
  if (kind === 'aeven' && chrome.aevenUrl() === undefined) throw new Error('this Host runs no Chrome for Aeven')
  const all = async (): Promise<unknown[]> => [
    ...liveGuests.tabs(sessionId).map(entry => ({ tabId: entry.tabId, browser: 'sidebar', url: entry.guest.getURL(), title: entry.guest.getTitle(), current: false })),
    ...await chrome.list(sessionId),
  ]
  switch (action) {
    case 'new': {
      const url = typeof request.input.url === 'string' ? request.input.url : ''
      const browserName = kind === 'extension' && typeof request.input.browserName === 'string' ? request.input.browserName : undefined
      let targetId: string
      try {
        targetId = await bridge.chromeOpen(kind, chrome.aevenUrl(), url, browserName)
      } catch (error) {
        // Aeven's Chrome starts on demand; the reader's Chrome is theirs to start, and the
        // extension's browser is started by the shell itself.
        if (kind !== 'aeven' || !await chrome.launch(sessionId)) throw error
        targetId = await bridge.chromeOpen(kind, chrome.aevenUrl(), url, browserName)
      }
      liveGuests.selectChrome(sessionId, { kind, targetId })
      if (url !== '') await bridge.chromeAutomate(kind, chrome.aevenUrl(), targetId, 'wait', { load: 'load', timeoutMs: 10_000 }).catch(() => undefined)
      return { tabId: `${CHROME_PREFIX[kind]}${targetId}`, tabs: await all() }
    }
    case 'select': {
      if (tab === undefined) throw new Error('select needs a tabId')
      liveGuests.selectChrome(sessionId, tab)
      return { tabs: await all() }
    }
    case 'close': {
      if (tab === undefined) throw new Error('close needs a tabId')
      await bridge.chromeClose(tab.kind, chrome.aevenUrl(), tab.targetId)
      if (liveGuests.chrome(sessionId)?.targetId === tab.targetId) liveGuests.selectChrome(sessionId, undefined)
      return { tabs: await all() }
    }
    default:
      throw new Error('a Chrome tab can be selected or closed, and new opens one')
  }
}

/** How long a tab opened at an address is given to finish loading, in ms. */
const NEW_TAB_LOAD_TIMEOUT_MS = 10_000

/**
 * Resolve once a new tab has loaded its first address, or after {@link NEW_TAB_LOAD_TIMEOUT_MS}.
 * A fast page can finish before a listener attaches, so the state is sampled.
 * @param guest - the new tab's guest.
 * @param signal - abandons the wait.
 */
async function loaded(guest: BrowserGuest, signal: AbortSignal | undefined): Promise<void> {
  const deadline = Date.now() + NEW_TAB_LOAD_TIMEOUT_MS
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    try {
      if (!guest.isLoading() && guest.getURL() !== 'about:blank' && guest.getURL() !== '') return
    } catch {
      // A guest that has not attached its contents yet answers neither call; it is still loading.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/**
 * Answer the agent's tab command for a session: list its browser tabs, open a new
 * one (optionally at an address), show one, or close one.
 * @param sessionId - the session whose tabs are addressed.
 * @param request - the `tabs` request; `input.action` is list, new, select, or close.
 * @param content - the sidebar column that opens and shows pills.
 * @returns the session's tabs after the command, and the opened tab's id for `new`.
 * @throws {Error} when the action is unknown or names no open tab.
 */
async function browserTabs(
  sessionId: string,
  request: { readonly input: { readonly [key: string]: unknown }; readonly signal?: AbortSignal | undefined },
  content: { requestOpen(sessionId: string, kind: 'browser', newSurface?: boolean, surfaceId?: string): void },
  browserLabel: string,
  chrome: ChromeAccess,
): Promise<{ [key: string]: unknown }> {
  // The pointer of the tab shown presses the column's own pills and plus menu, as
  // the reader would; without a shown tab the column is asked directly.
  const current = liveGuests.current(sessionId)
  const pane = current === undefined ? undefined : livePaneCursors.get(current.guest)
  const pill = (tabId: string, part: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-sidebar-right-surface="${CSS.escape(tabId)}"] ${part}`)
  const action = request.input.action ?? 'list'
  const tabId = typeof request.input.tabId === 'string' ? request.input.tabId : undefined
  const chromeTab = parseChromeTabId(tabId)
  if (chromeTab !== undefined || (action === 'new' && (request.input.browser === 'chrome' || request.input.browser === 'my-chrome' || request.input.browser === 'extension'))) {
    return await chromeTabs(sessionId, request, chrome, chromeTab)
  }
  const list = async (): Promise<ListedChromeTab[]> => {
    const current = liveGuests.chrome(sessionId) === undefined ? liveGuests.current(sessionId)?.tabId : undefined
    return [
      ...liveGuests.tabs(sessionId).map(tab => ({ tabId: tab.tabId, browser: 'sidebar', url: tab.guest.getURL(), title: tab.guest.getTitle(), current: tab.tabId === current })),
      ...await chrome.list(sessionId),
    ]
  }
  const named = (): NonNullable<ReturnType<typeof liveGuests.current>> => {
    const tab = liveGuests.tabs(sessionId).find(candidate => candidate.tabId === tabId)
    if (tab === undefined) throw new Error(`no open tab ${String(tabId)}; list the tabs first`)
    return tab
  }
  switch (action) {
    case 'list':
      return { tabs: await list() }
    case 'new': {
      const address = typeof request.input.url === 'string' ? request.input.url : undefined
      const url = address === undefined ? undefined : resolveAddress(address)
      if (address !== undefined && url === undefined) throw new Error(`not a navigable address: ${address}`)
      const mounted = liveGuests.whenTab(sessionId, request.signal, true)
      if (url !== undefined) writeLastUrl(sessionId, url)
      const plus = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-sidebar-right-surfaces] button[aria-haspopup="menu"]')
      const row = (): HTMLElement | null =>
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent.trim() === browserLabel) ?? null
      if (pane !== undefined && plus() !== null) {
        await pane.pressElement(plus, request.signal)
        await pane.pressElement(row, request.signal)
      } else {
        content.requestOpen(sessionId, 'browser', true)
      }
      const tab = await mounted
      liveGuests.activate(sessionId, tab.tabId)
      if (url !== undefined) await loaded(tab.guest, request.signal)
      return { tabId: tab.tabId, tabs: await list() }
    }
    case 'select': {
      const tab = named()
      if (pane !== undefined && pill(tab.tabId, '[role="tab"]') !== null) await pane.pressElement(() => pill(tab.tabId, '[role="tab"]'), request.signal)
      else content.requestOpen(sessionId, 'browser', false, tab.tabId)
      liveGuests.activate(sessionId, tab.tabId)
      return { tabs: await list() }
    }
    case 'close': {
      const tab = named()
      if (pane !== undefined && pill(tab.tabId, 'button[aria-label]') !== null) await pane.pressElement(() => pill(tab.tabId, 'button[aria-label]'), request.signal)
      else tab.close()
      return { tabs: (await list()).filter(entry => entry.tabId !== tab.tabId) }
    }
    default:
      throw new Error('tabs action must be list, new, select, or close')
  }
}

/**
 * The download page of this deployment's Aeven site, which the served page states as
 * `__AVN_AEVEN__.webUrl`; a deployment that names none offers no download.
 * @returns the page, or undefined.
 */
function downloadPage(): string | undefined {
  const site = (globalThis as { __AVN_AEVEN__?: { readonly webUrl?: string } }).__AVN_AEVEN__?.webUrl
  return site === undefined || !URL.canParse(site) ? undefined : new URL('/downloads', site).href
}

/**
 * Open an address for the agent in a new tab of the reader's browser, through the extension,
 * and make it the session's current tab.
 * @param sessionId - the session.
 * @param request - the `navigate` request.
 * @param chrome - extension access.
 * @returns the loaded page, as a navigation reports it.
 */
async function navigateInNewExtensionTab(
  sessionId: string,
  request: { readonly input: { readonly [key: string]: unknown }; readonly signal?: AbortSignal | undefined },
  chrome: ChromeAccess,
): Promise<{ [key: string]: unknown }> {
  const address = typeof request.input.url === 'string' ? request.input.url : ''
  const url = resolveAddress(address)
  if (url === undefined) throw new Error(`not a navigable address: ${address}`)
  const opened = await chromeTabs(sessionId, { input: { action: 'new', browser: 'extension', url }, signal: request.signal }, chrome, undefined)
  // The browser's own tab list carries the loaded address and title; the engine's target keeps what the tab
  // showed when the debugger attached, which is empty for a tab still loading.
  const listed = (await chrome.list(sessionId)).find(entry => entry.tabId === opened.tabId)
  return { ok: true, url: listed?.url || url, title: listed?.title ?? '', tabId: opened.tabId }
}

/**
 * Serve the agent's browser from a web page, where the reader's own browser,
 * reached through the Aeven extension, is the only one: the session's status, a
 * navigation that opens a new extension tab when none is current, its tab
 * commands for `browser extension`, its actions in the extension tab it selected,
 * and history and bookmarks from the reader's browser. A request that needs the
 * extension while it is missing waits on the install prompt. Everything else
 * passes on.
 * @param ctx - Client root context.
 * @param bridge - the page's link to the extension.
 * @param prompt - the page's extension install prompt.
 */
function installPageExtension(ctx: ClientContext, bridge: PageExtensionBridge, prompt: ExtensionPrompt): void {
  const chrome: ChromeAccess = {
    bridge: () => bridge,
    aevenUrl: () => undefined,
    userAllowed: () => false,
    launch: () => Promise.resolve(false),
    list: async sessionId => await listChromeTabs(sessionId, bridge, ['extension'], undefined),
  }
  /**
   * Run work that needs the extension once it is connected, prompting the reader to add it.
   * @param sessionId - the session whose agent asks.
   * @param request - the pending request, whose signal and deadline bound the prompt.
   * @param work - the request's own work.
   * @returns what the work returns.
   */
  const withExtension = async <T>(
    sessionId: string,
    request: { readonly signal?: AbortSignal | undefined; readonly timeoutMs?: number | undefined },
    work: () => Promise<T>,
  ): Promise<T> => {
    await prompt.require(sessionId, request.signal, request.timeoutMs)
    return await work()
  }
  ctx.inject(['remote', 'sessions'], (scoped) => {
    scoped.remote.$on('browser/automation', function (request, next) {
      const sessionId = (scoped.sessions).scopeOf(this)
      if (sessionId === undefined) return next()
      if (request.operation === 'bookmarks' || (request.operation === 'history' && request.input.source === 'browser')) {
        const limit = typeof request.input.limit === 'number' && Number.isInteger(request.input.limit) && request.input.limit > 0 ? Math.min(request.input.limit, 200) : 20
        return withExtension(sessionId, request, async () => ({
          entries: await bridge.extensionRead(request.operation === 'bookmarks' ? 'bookmarks' : 'history', typeof request.input.query === 'string' ? request.input.query : '', limit),
        })) as ReturnType<typeof next>
      }
      if (request.operation === 'tabs') {
        const tab = parseChromeTabId(typeof request.input.tabId === 'string' ? request.input.tabId : undefined)
        if (tab?.kind === 'extension' || (request.input.action === 'new' && request.input.browser === 'extension')) {
          return withExtension(sessionId, request, async () => await chromeTabs(sessionId, request, chrome, tab)) as ReturnType<typeof next>
        }
        if ((request.input.action ?? 'list') === 'list') return chrome.list(sessionId).then(tabs => ({ tabs }))
        return next()
      }
      const chromeTab = liveGuests.chrome(sessionId)
      if (chromeTab?.kind !== 'extension') {
        // Without a current extension tab, the session's browser is the one a navigation opens through the extension.
        if (request.operation === 'status') {
          return Promise.resolve(canInstallExtension()
            ? { open: false, openable: true, opensIn: 'user-browser' }
            : { open: false, openable: false, unavailable: 'browser-unsupported' })
        }
        if (request.operation === 'navigate') {
          const opened = withExtension(sessionId, request, async () => await navigateInNewExtensionTab(sessionId, request, chrome))
          return opened as ReturnType<typeof next>
        }
        return next()
      }
      if (request.operation === 'handoff' || request.operation === 'control') return next()
      const operate = async (): Promise<unknown> => {
        const requestId = mintRequestId()
        const cancel = (): void => { bridge.cancelAutomation(chromeTab.targetId, requestId) }
        request.signal?.addEventListener('abort', cancel, { once: true })
        try {
          return await bridge.chromeAutomate('extension', undefined, chromeTab.targetId, request.operation, request.input, requestId, request.timeoutMs)
        } finally {
          request.signal?.removeEventListener('abort', cancel)
        }
      }
      if (request.operation !== 'navigate') return operate() as ReturnType<typeof next>
      // The reader may have closed the current tab; a navigation then opens a new one.
      return (async () => {
        const open = (await chrome.list(sessionId)).some(entry => entry.tabId === `${CHROME_PREFIX.extension}${chromeTab.targetId}`)
        if (open) return await operate()
        liveGuests.selectChrome(sessionId, undefined)
        return await withExtension(sessionId, request, async () => await navigateInNewExtensionTab(sessionId, request, chrome))
      })() as ReturnType<typeof next>
    })
  })
}

/** Services required by the browser plugin. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Registers the browser pane.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-sidebar-browser: dictionaries')

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

  // The desktop app reaches the extension through its native host; a web page
  // connects to the extension in the browser it runs in.
  const pageBridge = pageExtensionBridge(new PageExtensionLink(pageConnector))
  const extensionStatus = desktopBrowser()?.extensionStatus ?? pageBridge.extensionStatus
  // A web page in a browser that can install the extension offers the store from the row.
  const installUrl = !isDesktopShell() && canInstallExtension() ? AEVEN_EXTENSION_STORE_URL : undefined
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'browser-extension',
    order: 32,
    locale: NS,
    inject: (): ExtensionRowInjected => ({ extensionStatus, installUrl }),
  }, ExtensionRow))

  if (!isDesktopShell()) {
    ctx.inject(['sidebarContent', 'remote.browserChromium'], (scoped) => {
      scoped.effect(
        () => scoped.sidebarContent.registerLauncher('browser', (sessionId) => { void openChromium?.(sessionId, '') }),
        'ui-sidebar-browser: web launcher',
      )
    })
    const prompt = new ExtensionPrompt(pageBridge.extensionStatus)
    ctx.effect(() => () => { prompt.close() }, 'ui-sidebar-browser: extension prompt')
    const downloadUrl = downloadPage()
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'browser-extension-prompt',
      locale: NS,
      inject: (): ExtensionPromptInjected => ({
        hooks: { prompt: prompt.state },
        storeUrl: AEVEN_EXTENSION_STORE_URL,
        browser: extensionBrowserLabel(),
        downloadUrl,
        dismiss: () => { prompt.dismiss() },
        check: () => { prompt.check() },
        close: () => { prompt.close() },
        continueTask: (sessionId, text) => {
          const conversation = ctx.get('sessions')?.scope(sessionId as SessionId)?.get('conversation')
          if (conversation === undefined) {
            console.error(`ui-sidebar-browser: session "${sessionId}" has no conversation to continue in`)
            return
          }
          conversation.send(text).catch((error: unknown) => {
            console.error('ui-sidebar-browser: continuing the task failed', error)
          })
        },
      }),
    }, ExtensionPromptModal))
    installPageExtension(ctx, pageBridge, prompt)
    return
  }

  // A pane receives only its session, so it translates through this plugin's
  // own dictionary.
  const t = ctx.locale.bind(NS)
  // The sidebar's plus menu names the browser kind in its own dictionary.
  const browserLabel = (): string => ctx.locale.bind('sidebarSelect')('browser.tab')
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
        scoped.sidebarContent.requestOpen(sessionId, 'browser', false, liveGuests.current(sessionId)?.tabId)
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
  const userChrome = new UserChromePreference()
  ctx.effect(
    () => userChrome.attach(ctx.settingsScope.bind<BrowserSettings>({ namespace: BROWSER_SETTINGS_NAMESPACE })),
    'ui-sidebar-browser: user Chrome preference',
  )
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'user-chrome',
    order: 31,
    locale: NS,
    inject: (): UserChromeRowInjected => ({
      hooks: { userChrome: userChrome.allowed },
      setUserChrome: (allowed) => { userChrome.set(allowed) },
    }),
  }, UserChromeRow))
  // Aeven's Chrome's debugging endpoint, as the Host last reported it with a tab command.
  let aevenChromeUrl: string | undefined
  const chrome: ChromeAccess = {
    bridge: desktopBrowser,
    aevenUrl: () => aevenChromeUrl,
    userAllowed: () => userChrome.allowed.getSnapshot(),
    launch: async sessionId => await (openChromium?.(sessionId, '') ?? Promise.resolve(false)),
    async list(sessionId) {
      const bridge = desktopBrowser()
      if (bridge === undefined) return []
      const kinds = (['aeven', 'user', 'extension'] as const).filter(kind =>
        (kind !== 'aeven' || aevenChromeUrl !== undefined) && (kind !== 'user' || userChrome.allowed.getSnapshot()))
      return await listChromeTabs(sessionId, bridge, kinds, aevenChromeUrl)
    },
  }

  const Pane = ({ sessionId, surfaceId, active, visible, closeSurface }: SidebarContentPaneProps) =>
    createElement(BrowserPane, {
      sessionId, tabId: surfaceId, active, closeTab: closeSurface, t, openInChrome, visible, search: searchEngines,
    })
  // The agent's browser_* tools reach this session's page. A session whose
  // pane is not mounted reports that it can open one, and a navigation opens
  // the pane at the address; every other action passes on and the tool reports
  // the browser closed.
  ctx.inject(['remote', 'sessions'], (scoped) => {
    // While the agent works its pointer is held, so the gaps between its
    // actions do not read as finishing; when the work stops, the hold is
    // released and the pointer fades on its own idle timeout.
    scoped.remote.$on('api-session/status', (sessionId, running) => {
      setPointerHold(sessionId, running)
    })
    scoped.remote.$on('browser/automation', function (request, next) {
      const sessionId = (scoped.sessions).scopeOf(this)
      if (sessionId === undefined) return next()
      const guest = liveGuests.get(sessionId)
      /** Bring the session's current tab, or its browser when none is mounted, into view. */
      const showCurrent = (): void => { ctx.get('sidebarContent')?.requestOpen(sessionId, 'browser', false, liveGuests.current(sessionId)?.tabId) }
      if (request.operation === 'bookmarks' || (request.operation === 'history' && request.input.source === 'browser')) {
        const bridge = desktopBrowser()
        if (bridge === undefined) return next()
        const limit = typeof request.input.limit === 'number' && Number.isInteger(request.input.limit) && request.input.limit > 0 ? Math.min(request.input.limit, 200) : 20
        return bridge.extensionRead(request.operation === 'bookmarks' ? 'bookmarks' : 'history', typeof request.input.query === 'string' ? request.input.query : '', limit)
          .then(entries => ({ entries })) as ReturnType<typeof next>
      }
      if (request.operation === 'history') {
        const limit = typeof request.input.limit === 'number' && Number.isInteger(request.input.limit) && request.input.limit > 0 ? Math.min(request.input.limit, 200) : 20
        const entries = searchHistory(typeof request.input.query === 'string' ? request.input.query : '', limit)
        return Promise.resolve({ entries: entries.map(entry => ({ ...entry, visitedAt: new Date(entry.visitedAt).toISOString() })) })
      }
      if (request.operation === 'tabs') {
        const content = ctx.get('sidebarContent')
        if (content === undefined) return next()
        if (typeof request.input.chromium === 'string') aevenChromeUrl = request.input.chromium
        return browserTabs(sessionId, request, content, browserLabel(), chrome) as ReturnType<typeof next>
      }
      // A Chrome tab the agent selected is its current tab: its actions run there.
      const chromeTab = liveGuests.chrome(sessionId)
      if (chromeTab !== undefined && request.operation !== 'handoff') {
        if (request.operation === 'control') return Promise.reject(new Error("preview_browser_control presses the sidebar browser's own toolbar; select a sidebar tab first"))
        const bridge = desktopBrowser()
        if (bridge === undefined) return next()
        const requestId = mintRequestId()
        const cancel = (): void => { bridge.cancelAutomation(chromeTab.targetId, requestId) }
        request.signal?.addEventListener('abort', cancel, { once: true })
        const { kind, targetId } = chromeTab
        return bridge.chromeAutomate(kind, aevenChromeUrl, targetId, request.operation, request.input, requestId, request.timeoutMs)
          .finally(() => { request.signal?.removeEventListener('abort', cancel) }) as ReturnType<typeof next>
      }
      if (request.operation === 'handoff') {
        // The handoff is the pane's modal, so a closed pane opens first.
        const content = ctx.get('sidebarContent')
        if (guest === undefined && content === undefined) return next()
        return (async () => {
          showCurrent()
          if (guest === undefined) await liveGuests.whenMounted(sessionId, request.signal)
          const message = typeof request.input.message === 'string' ? request.input.message : ''
          const accepted = await handoffs.open(sessionId, request.input.reason, message, request.signal)
          return { accepted }
        })()
      }
      if (guest !== undefined) {
        // A pane stays mounted while its column is hidden: a navigation or a pressed
        // control is the agent using the browser, so the column comes into view first.
        if (request.operation === 'navigate' || request.operation === 'control') showCurrent()
        return automate(guest, request) as ReturnType<typeof next>
      }
      const content = ctx.get('sidebarContent')
      if (content === undefined) return next()
      if (request.operation === 'status') return Promise.resolve({ open: false, openable: true })
      if (request.operation !== 'navigate') return next()
      return navigateClosed(sessionId, request, () => { content.requestOpen(sessionId, 'browser') }) as ReturnType<typeof next>
    })
  })

  ctx.inject(['sidebarContent'], (scoped) => {
    scoped.effect(
      () => scoped.sidebarContent.register('browser', Pane),
      'ui-sidebar-browser: content kind',
    )
  })
}
