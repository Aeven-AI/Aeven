/**
 * Where a link opens in the desktop shell, and the menu a right-click on one
 * offers.
 *
 * The window is an Electron page, so a link click reaches the shell rather than
 * a browser tab: the shell reports the address here, and this module decides
 * which of the reader's browsers shows it — the session's own pane in the
 * sidebar, the Chromium the agent's DevTools tools drive, or the operating
 * system's default browser. Served over HTTP none of this is installed: a tab
 * opens the link itself, which is what a browser already does.
 */

import type { TranslateNS } from '@aeven/client-ui-slots'
import type { DesktopLinksBridge, DesktopMenuBridge, DesktopMenuItem } from './guest.ts'

/** Row ids of the link menu; the chosen id comes back from the shell. */
export const LINK_MENU_ROWS = {
  sidebar: 'open-in-sidebar',
  system: 'open-in-system-browser',
  copy: 'copy-link',
} as const

/** Dictionary of the plugin that shows this menu, which owns its copy. */
type LinkMenuLabels = TranslateNS<'sidebarBrowser'>

/**
 * The rows a right-click on a link shows.
 *
 * The first two are the two browsers this application has — the pane beside the
 * conversation and the one the reader's desktop opens — and the third is the
 * address itself, which a reader copies when they want it somewhere else.
 * @param t - namespace-bound translate for this plugin's dictionary.
 * @returns the rows, in display order.
 */
export function linkMenuRows(t: LinkMenuLabels): DesktopMenuItem[] {
  return [
    { type: 'row', id: LINK_MENU_ROWS.system, label: t('link.open') },
    { type: 'row', id: LINK_MENU_ROWS.sidebar, label: t('link.openInSidebar') },
    { type: 'separator' },
    { type: 'row', id: LINK_MENU_ROWS.copy, label: t('link.copy') },
  ]
}

/**
 * The absolute http(s) address a right-click landed on, when it landed on a
 * link that leaves this application.
 *
 * A same-origin address is not external — it is a route of this application,
 * such as a footnote reference — and a scheme the client cannot load (`mailto:`,
 * `file:`) belongs to the platform's own menu, so both are left alone.
 * @param target - the event target of the right-click.
 * @param origin - the origin of the page the click happened in.
 * @returns the address to open, or undefined when the menu is not ours to show.
 */
export function externalLinkAt(target: EventTarget | null, origin: string): string | undefined {
  if (!(target instanceof Element)) return undefined
  const anchor = target.closest('a')
  if (anchor === null) return undefined
  let url: URL
  try {
    url = new URL(anchor.href)
  } catch {
    // An anchor whose destination does not parse names nothing to open.
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  return url.origin === origin ? undefined : url.href
}

/** Where the three destinations of the link menu are. */
export interface LinkDestinations {
  /** Show the address in the session's browser pane, opening the column. */
  readonly openInSidebar: (url: string) => void
  /**
   * Open the address in the Chromium the agent drives, because the reader sees
   * what the agent sees when a page is driven there; the operating system's
   * default browser takes it when no such browser is available.
   */
  readonly openInSystemBrowser: (url: string) => void
  /** Write the address to the clipboard. */
  readonly copyLink: (url: string) => void
}

/**
 * Run one chosen row of the link menu.
 * @param id - the row id the shell reported.
 * @param url - the address the menu was shown for.
 * @param destinations - where each row leads.
 * @returns true when the row was one this menu owns.
 */
export function runLinkMenuRow(id: string, url: string, destinations: LinkDestinations): boolean {
  switch (id) {
    case LINK_MENU_ROWS.sidebar:
      destinations.openInSidebar(url)
      return true
    case LINK_MENU_ROWS.system:
      destinations.openInSystemBrowser(url)
      return true
    case LINK_MENU_ROWS.copy:
      destinations.copyLink(url)
      return true
    default:
      return false
  }
}

/** What installing the link handling needs from the application. */
export interface LinkHandling extends LinkDestinations {
  readonly menus: DesktopMenuBridge
  readonly links: DesktopLinksBridge
  readonly t: LinkMenuLabels
  /** The page the handler listens on; the window's own document in production. */
  readonly document: Document
}

/**
 * Handle the desktop shell's links: every address the application's own content
 * opens lands where the destinations say, and a right-click on a link that
 * leaves the application offers them.
 *
 * The right-click is suppressed before the menu is shown, which is also what
 * keeps the shell's own context menu away: Electron emits its `context-menu`
 * event only for clicks the page does not prevent, so exactly one menu is up.
 * @param input - the shell bridges, the destinations, and the page to listen on.
 * @returns disposer removing the listener and the shell subscription.
 */
export function installLinkHandling(input: LinkHandling): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    const url = externalLinkAt(event.target, input.document.location.origin)
    if (url === undefined) return
    event.preventDefault()
    void input.menus.show(linkMenuRows(input.t)).then((id) => {
      if (id !== null) runLinkMenuRow(id, url, input)
    }, (error: unknown) => {
      console.error('ui-sidebar-browser: the shell refused to show the link menu', error)
    })
  }
  input.document.addEventListener('contextmenu', onContextMenu, { capture: true })
  const stopLinks = input.links.onOpen((url) => { input.openInSystemBrowser(url) })
  return () => {
    input.document.removeEventListener('contextmenu', onContextMenu, { capture: true })
    stopLinks()
  }
}
