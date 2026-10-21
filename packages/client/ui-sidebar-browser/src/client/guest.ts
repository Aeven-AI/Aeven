/** The Electron `<webview>` guest: what the pane may call on it, where it stores, and the shell's browser bridge. */
import type { Branded } from '@aeven/brand'

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

/** Identity of one pending Electron browser action. */
export type DesktopBrowserRequestId = Branded<'DesktopBrowserRequestId'>

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
  automate: (
    webContentsId: number,
    operation: string,
    input: Record<string, unknown>,
    requestId?: DesktopBrowserRequestId,
    timeoutMs?: number,
  ) => Promise<unknown>
  /** Cancel the owned browser request. */
  cancelAutomation: (webContentsId: number, requestId: DesktopBrowserRequestId) => void
  /**
   * Acknowledge a cursor step after arrival or when the pane is invisible.
   * @param webContentsId - guest id.
   * @param sequence - announced step.
   */
  cursorArrived(webContentsId: number, sequence: number): void
  /** Observe pointer steps before native input; returns a disposer. */
  onCursor: (listener: (cursor: BrowserCursor) => void) => () => void
  /**
   * Observe the guests' pages scrolling; returns a disposer.
   *
   * The pointer is drawn in the pane's own coordinates, from where the page said
   * an element was, so a page that scrolls moves that element without the pane
   * acting: a resting pointer is put back on the element it names.
   */
  onPageScroll: (listener: (webContentsId: number) => void) => () => void
}

/**
 * One row of a menu the app page describes for the shell to pop (desktop
 * `ipc.ts` `DesktopMenuItem`), restated for the same reason as the bridge below.
 */
export type DesktopMenuItem =
  | { readonly type: 'separator' }
  | {
    readonly type: 'row'
    /** Value the page receives back when this row is chosen. */
    readonly id: string
    readonly label: string
    /** Whether the row can be chosen; a row that omits it can. */
    readonly enabled?: boolean
  }

/**
 * The shell's menu operations, as this client needs them.
 *
 * The page owns what a right-click means — the destinations its links carry,
 * the paths its file names name — while the shell owns the menu a desktop
 * draws. The page suppresses the platform's own menu on the elements it
 * answers for, so exactly one menu is ever up.
 */
export interface DesktopMenuBridge {
  /**
   * Pop one native menu for the app page.
   * @param items - the rows to show, in display order.
   * @returns the chosen row's id, or null when the reader dismissed the menu.
   */
  show: (items: readonly DesktopMenuItem[]) => Promise<string | null>
}

/**
 * The shell's report of the addresses the app page's own content opened,
 * as this client needs it. A window the page asks for never opens in the
 * shell: it is told the address instead, because where a link lands is the
 * client's decision.
 */
export interface DesktopLinksBridge {
  /**
   * Observe the external addresses the page's content asked to open.
   * @param listener - called with each absolute http(s) address.
   * @returns disposer removing the listener.
   */
  onOpen: (listener: (url: string) => void) => () => void
}

/**
 * One agent pointer step, in the guest's viewport CSS pixels (desktop `ipc.ts`
 * `DesktopBrowserCursor`). Visible arrival precedes discrete native input.
 */
export interface BrowserCursor {
  readonly webContentsId: number
  readonly action: 'move' | 'click' | 'type' | 'scroll' | 'control' | 'cancel'
  readonly sequence: number
  readonly x: number
  readonly y: number
  readonly deltaY?: number
  /** Selector of the element this action named, when it named one. */
  readonly selector?: string
  /**
   * The pane chrome control this action presses, by its `data-control` name, or
   * `navigate` for the address field. The pane places the pointer and clicks the
   * element, because a control is not part of the page.
   */
  readonly control?: string
  /** Address a `navigate` control types into the pane's address field. */
  readonly url?: string
}

/** Guests by session, with a wait for a pane that has not mounted yet. */
export class LiveGuests extends Map<string, BrowserGuest> {
  /** Callers waiting for a session's pane to mount its guest. */
  readonly #waiters = new Map<string, Set<(guest: BrowserGuest) => void>>()

  override set(sessionId: string, guest: BrowserGuest): this {
    super.set(sessionId, guest)
    const waiters = this.#waiters.get(sessionId)
    this.#waiters.delete(sessionId)
    for (const resolve of waiters ?? []) resolve(guest)
    return this
  }

  /**
   * The session's guest, once its pane mounts one.
   * @param sessionId - session whose guest is awaited.
   * @param signal - abandons the wait.
   * @returns the mounted guest.
   * @throws the signal's reason when it aborts first.
   */
  whenMounted(sessionId: string, signal?: AbortSignal): Promise<BrowserGuest> {
    const mounted = this.get(sessionId)
    if (mounted !== undefined) return Promise.resolve(mounted)
    return new Promise((resolve, reject) => {
      const waiters = this.#waiters.get(sessionId) ?? new Set()
      this.#waiters.set(sessionId, waiters)
      const settle = (guest: BrowserGuest): void => {
        signal?.removeEventListener('abort', abort)
        resolve(guest)
      }
      const abort = (): void => {
        waiters.delete(settle)
        reject(signal?.reason as Error)
      }
      if (signal?.aborted === true) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })
      waiters.add(settle)
    })
  }
}

/**
 * The guest each session's pane holds while it is mounted, so an agent action
 * addressed to a session reaches the page its user sees.
 */
export const liveGuests = new LiveGuests()

/**
 * Controls in the pane's own chrome the agent can drive, each of which the pane
 * shows the pointer pressing.
 */
export type PaneCursorControl = 'back' | 'forward' | 'refresh' | 'stop'

/**
 * What a pane can draw for the agent outside its guest.
 *
 * A pane's chrome is part of the browser the agent is using, so driving it is
 * something the reader should see the pointer do rather than something that
 * happens to the window around the page.
 */
export interface PaneCursorPresentation {
  /**
   * Glide the pointer onto one of the pane's controls and show it pressed.
   * @param signal - cancels the action while its pointer travels.
   * @param control - the control being driven.
   * @returns once the pointer has arrived and the press is drawn.
   */
  announceControl(control: PaneCursorControl, signal?: AbortSignal): Promise<void>
  /**
   * Glide the pointer to the address bar and type the address into it.
   *
   * The presentation draws the gesture only: the caller that owns the request
   * loads the page, exactly once, after this resolves.
   * @param url - the address being typed.
   * @param signal - cancels the action while its pointer travels.
   * @returns once the address has been typed and the gesture has settled.
   */
  announceNavigation(url: string, signal?: AbortSignal): Promise<void>
}

/**
 * A guest's web contents id, or undefined until the element is ready for one.
 *
 * Electron's `<webview>` throws from `getWebContentsId()` until the element is
 * in the DOM and has emitted `dom-ready`. Reading it a moment early used to
 * throw inside a mount effect and take the whole pane down, so every caller
 * goes through here and treats `undefined` as "not ready yet".
 * @param guest - the guest whose id is wanted.
 * @returns the id, or undefined while the guest has not attached.
 */
export function webContentsIdOf(guest: BrowserGuest): number | undefined {
  try {
    return guest.getWebContentsId()
  } catch {
    // The only failure here is the not-yet-attached throw above; the id has no
    // other way to fail.
    return undefined
  }
}

/**
 * The pane's own cursor surface, per mounted guest.
 *
 * Keyed by the guest element, not its web contents id: that id can only be read
 * once the element is attached and dom-ready, and a pane that asked for it while
 * mounting crashed instead of showing its browser at all.
 */
export const livePaneCursors = new Map<BrowserGuest, PaneCursorPresentation>()

/** Sessions whose agent is still working, and the listeners each change reports to. */
const pointerHolds = new Map<string, true>()
const holdListeners = new Map<string, Set<(hold: boolean) => void>>()

/**
 * Observe whether a session's agent is still working, which holds its pointer
 * on screen through the gaps between its actions.
 * @param sessionId - the session to watch.
 * @param listener - called with the current hold, then again at each change.
 * @returns disposer removing the listener.
 */
export function onPointerHold(sessionId: string, listener: (hold: boolean) => void): () => void {
  const listeners = holdListeners.get(sessionId) ?? new Set<(hold: boolean) => void>()
  listeners.add(listener)
  holdListeners.set(sessionId, listeners)
  listener(pointerHolds.get(sessionId) === true)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && holdListeners.get(sessionId) === listeners) holdListeners.delete(sessionId)
  }
}

/**
 * Report whether a session's agent is working.
 * @param sessionId - the session that started or finished work.
 * @param hold - whether its pointer is held on screen.
 */
export function setPointerHold(sessionId: string, hold: boolean): void {
  if ((pointerHolds.get(sessionId) === true) === hold) return
  if (hold) pointerHolds.set(sessionId, true)
  else pointerHolds.delete(sessionId)
  for (const listener of holdListeners.get(sessionId) ?? []) listener(hold)
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
 * The shell's menu bridge, present only inside the desktop shell.
 * @returns the bridge, or undefined when served over HTTP.
 */
export function desktopMenus(): DesktopMenuBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { avnDesktop?: { contextMenu?: DesktopMenuBridge } }).avnDesktop?.contextMenu
}

/**
 * The shell's link bridge, present only inside the desktop shell. Subscribing
 * is also what tells the shell this page takes the addresses its content opens
 * instead of handing them to the system browser.
 * @returns the bridge, or undefined when served over HTTP.
 */
export function desktopLinks(): DesktopLinksBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { avnDesktop?: { links?: DesktopLinksBridge } }).avnDesktop?.links
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
