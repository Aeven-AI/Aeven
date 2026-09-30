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

/**
 * Appearance a guest is shown with. `dark` forces it: the shell both answers
 * `prefers-color-scheme: dark` and turns Chromium's auto-dark on, so a page that
 * ignores the media query is darkened too. `light` answers light and forces
 * auto-dark off; `system` clears both and leaves the page to the OS.
 */
export type BrowserColorScheme = 'system' | 'light' | 'dark'

/**
 * The shell's browser operations (desktop `ipc.ts` `AvnDesktopBrowserApi`),
 * restated because the client cannot import the desktop application.
 */
export interface DesktopBrowserBridge {
  /** Open an HTTP(S) address in the system browser. */
  openExternal: (url: string) => Promise<void>
  /** Show one guest with the reader's chosen appearance. */
  setColorScheme: (webContentsId: number, scheme: BrowserColorScheme) => Promise<void>
  /** Clear cookies or HTTP cache from a browser partition. */
  clearData: (partition: string, kind: 'cookies' | 'cache') => Promise<void>
  /** Copy the guest's visible page to the clipboard as an image. */
  capture: (webContentsId: number) => Promise<void>
  /**
   * Ask a search engine to complete a query. The shell performs the request
   * because no engine answers its completion endpoint with CORS headers, so a
   * page-origin request is refused.
   * @param url - the engine's completion endpoint.
   * @returns the response body.
   */
  suggest: (url: string) => Promise<string>
  /** Perform one agent action on a guest over its CDP debugger. */
  automate: (webContentsId: number, operation: string, input: Record<string, unknown>) => Promise<unknown>
  /** Observe the agent pointer actions the shell performs on guests; returns a disposer. */
  onCursor: (listener: (cursor: BrowserCursor) => void) => () => void
  /** Report that the pointer finished a `move`, or cannot be shown, so its input may land. */
  cursorArrived: (webContentsId: number, sequence: number) => void
}

/**
 * One agent pointer step, in the guest's viewport CSS pixels (desktop `ipc.ts`
 * `DesktopBrowserCursor`). A `move` is answered with
 * {@link DesktopBrowserBridge.cursorArrived} naming its `sequence`.
 */
export interface BrowserCursor {
  readonly webContentsId: number
  readonly action: 'move' | 'click' | 'type' | 'scroll'
  readonly sequence: number
  readonly x: number
  readonly y: number
  readonly deltaY?: number
}

/**
 * The guest each session's pane holds while it is mounted, so an agent action
 * addressed to a session reaches the page its user sees.
 */
export const liveGuests = new Map<string, BrowserGuest>()

/** Listeners for the end of each session's agent turn. */
const turnEndListeners = new Map<string, Set<() => void>>()

/**
 * Observe the end of a session's agent turn, when the agent releases the
 * browser and its pointer leaves.
 * @param sessionId - the session to watch.
 * @param listener - called at each turn end.
 * @returns disposer removing the listener.
 */
export function onTurnEnd(sessionId: string, listener: () => void): () => void {
  const listeners = turnEndListeners.get(sessionId) ?? new Set()
  listeners.add(listener)
  turnEndListeners.set(sessionId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && turnEndListeners.get(sessionId) === listeners) turnEndListeners.delete(sessionId)
  }
}

/**
 * Report that a session's agent turn ended.
 * @param sessionId - the session whose turn ended.
 */
export function endTurn(sessionId: string): void {
  for (const listener of turnEndListeners.get(sessionId) ?? []) listener()
}

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

/** Key prefix for the page appearance each session's guest was set to. */
const COLOR_SCHEME_PREFIX = 'avn.sidebar-right.browser.color-scheme'

/**
 * The page appearance a session's guest was set to. The override itself lives
 * on the guest's web contents — the shell emulates `prefers-color-scheme` there
 * — and a guest created for a remounted pane does not inherit it, so the choice
 * is kept here and re-applied on attach.
 * @param sessionId - session whose appearance is read.
 * @returns the stored scheme, or undefined when none is saved or storage is unavailable.
 */
export function readColorScheme(sessionId: string): BrowserColorScheme | undefined {
  try {
    const value = localStorage.getItem(`${COLOR_SCHEME_PREFIX}.${sessionId}`)
    return value === 'system' || value === 'light' || value === 'dark' ? value : undefined
  } catch {
    // Storage unavailable (private mode, blocked site data): the guest follows the OS.
    return undefined
  }
}

/**
 * Remember the page appearance a session's guest is set to.
 * @param sessionId - session whose appearance is written.
 * @param scheme - the chosen appearance.
 */
export function writeColorScheme(sessionId: string, scheme: BrowserColorScheme): void {
  try {
    localStorage.setItem(`${COLOR_SCHEME_PREFIX}.${sessionId}`, scheme)
  } catch {
    // Same unavailable storage as readColorScheme: the choice is not restored.
  }
}
