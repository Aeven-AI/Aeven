/** The Electron `<webview>` guest: what the pane may call on it, where it stores, and the shell's browser bridge. */

/**
 * The guest element's surface, narrowed to what the pane uses.
 *
 * Electron's `<webview>` is not a DOM type this project can import, and the
 * renderer holds it as an `HTMLElement`, so the methods the toolbar drives are
 * declared here rather than asserted at each call.
 */
export interface BrowserGuest extends HTMLElement {
  /** Navigate the guest to an absolute URL. */
  loadURL: (url: string) => Promise<void>
  /** The URL the guest currently shows. */
  getURL: () => string
  /** The page's title. */
  getTitle: () => string
  /** Whether a load is in progress. */
  isLoading: () => boolean
  /** Whether the guest's own history can move back. */
  canGoBack: () => boolean
  /** Whether the guest's own history can move forward. */
  canGoForward: () => boolean
  /** Move back one entry in the guest's history. */
  goBack: () => void
  /** Move forward one entry in the guest's history. */
  goForward: () => void
  /** Reload the visited page. */
  reload: () => void
  /** Reload the visited page, bypassing the HTTP cache. */
  reloadIgnoringCache: () => void
  /** Stop the load in progress. */
  stop: () => void
  /** Open Chromium DevTools on the visited page. */
  openDevTools: () => void
  /** Set the page zoom, where 1 is 100%. */
  setZoomFactor: (factor: number) => void
  /** The guest's web contents id, which the shell's browser operations address. */
  getWebContentsId: () => number
}

/** `prefers-color-scheme` a guest is shown with; `system` clears the override. */
export type BrowserColorScheme = 'system' | 'light' | 'dark'

/**
 * The shell's browser operations (desktop `ipc.ts` `AvnDesktopBrowserApi`),
 * restated because the client cannot import the desktop application.
 */
export interface DesktopBrowserBridge {
  /** Open an HTTP(S) address in the system browser. */
  openExternal: (url: string) => Promise<void>
  /** Emulate `prefers-color-scheme` in one guest. */
  setColorScheme: (webContentsId: number, scheme: BrowserColorScheme) => Promise<void>
  /** Clear cookies or HTTP cache from a browser partition. */
  clearData: (partition: string, kind: 'cookies' | 'cache') => Promise<void>
  /** Copy the guest's visible page to the clipboard as an image. */
  capture: (webContentsId: number) => Promise<void>
  /** Perform one agent action on a guest over its CDP debugger. */
  automate: (webContentsId: number, operation: string, input: Record<string, unknown>) => Promise<unknown>
  /** Observe the agent pointer actions the shell performs on guests; returns a disposer. */
  onCursor: (listener: (cursor: BrowserCursor) => void) => () => void
}

/** One agent pointer action, in the guest's viewport CSS pixels (desktop `ipc.ts` `DesktopBrowserCursor`). */
export interface BrowserCursor {
  readonly webContentsId: number
  readonly action: 'click' | 'type' | 'scroll'
  readonly x: number
  readonly y: number
  readonly deltaY?: number
}

/**
 * The guest each session's pane holds while it is mounted, so an agent action
 * addressed to a session reaches the page its user sees.
 */
export const liveGuests = new Map<string, BrowserGuest>()

/**
 * The shell's browser bridge, present only inside the desktop shell.
 * @returns the bridge, or undefined when served over HTTP.
 */
export function desktopBrowser(): DesktopBrowserBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { avnDesktop?: { browser?: DesktopBrowserBridge } }).avnDesktop?.browser
}

/**
 * Whether this client runs inside the desktop shell.
 *
 * The `<webview>` tag exists only there; served over HTTP the element is
 * unknown and would render as an empty inline box, so the pane checks rather
 * than creating one that can never load.
 * @returns true in the desktop shell.
 */
export function isDesktopShell(): boolean {
  return desktopBrowser() !== undefined
}

/**
 * The storage partition a session's guest uses.
 *
 * Per session, so a site signed in to beside one session is not signed in
 * beside another. The prefix is the one the shell allowlists; a guest naming
 * anything else never attaches (desktop `browser-guests.ts`).
 * @param sessionId - session the guest belongs to.
 * @returns the partition name.
 */
export function browserPartition(sessionId: string): string {
  return `persist:avn-browser-${sessionId}`
}

/** Key prefix for the address each session's guest last showed. */
const LAST_URL_PREFIX = 'avn.sidebar-right.browser.url'

/**
 * The address a session's guest last showed, so a remounted pane reopens it.
 * @param sessionId - session whose address is read.
 * @returns the address, or undefined when none is saved or storage is unavailable.
 */
export function readLastUrl(sessionId: string): string | undefined {
  try {
    return localStorage.getItem(`${LAST_URL_PREFIX}.${sessionId}`) ?? undefined
  } catch {
    // Storage unavailable (private mode, blocked site data): the guest opens blank.
    return undefined
  }
}

/**
 * Remember the address a session's guest shows.
 * @param sessionId - session whose address is written.
 * @param url - the committed address.
 */
export function writeLastUrl(sessionId: string, url: string): void {
  try {
    localStorage.setItem(`${LAST_URL_PREFIX}.${sessionId}`, url)
  } catch {
    // Same unavailable storage as readLastUrl: the address is not restored.
  }
}
