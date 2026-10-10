/** Typed preload operations exposed only by the Electron shell. */
import type { Branded } from '@aeven/brand'

/** One application-menu command the shell sends to the page it renders. */
export type DesktopMenuCommand = 'open-settings' | 'start-dictation'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  menuCommand: 'avn-desktop:menu-command',
  updatesCheck: 'avn-desktop:updates-check',
  updatesInstall: 'avn-desktop:updates-install',
  updatesState: 'avn-desktop:updates-state',
  browserOpenExternal: 'avn-desktop:browser-open-external',
  browserSetColorScheme: 'avn-desktop:browser-set-color-scheme',
  browserClearData: 'avn-desktop:browser-clear-data',
  browserCapture: 'avn-desktop:browser-capture',
  browserAutomate: 'avn-desktop:browser-automate',
  browserCancelAutomation: 'avn-desktop:browser-cancel-automation',
  browserSuggest: 'avn-desktop:browser-suggest',
  browserCursor: 'avn-desktop:browser-cursor',
  browserPageScroll: 'avn-desktop:browser-page-scroll',
} as const

/** `prefers-color-scheme` a browser guest is shown with; `system` clears the override. */
export type DesktopBrowserColorScheme = 'system' | 'light' | 'dark'

/**
 * One agent pointer step the app window draws over a guest, in the guest's
 * viewport CSS pixels. A `move` glides the pointer to a point; action effects
 * animate independently of native input completion.
 */
export interface DesktopBrowserCursor {
  /** The guest the action happens in. */
  readonly webContentsId: number
  /** What the pointer shows. */
  readonly action: 'move' | 'click' | 'type' | 'scroll' | 'control'
  /** Per-shell pointer step number. */
  readonly sequence: number
  readonly x: number
  readonly y: number
  /**
   * The pane's own chrome control this action presses, by its `data-control` name
   * (`back`, `forward`, `refresh`, `capture`, `more`, `zoom-in`, `zoom-out`,
   * `zoom-reset`). A control lives in the app's chrome row rather than in the
   * page, so its position is the pane's to know: the shell names the control, and
   * the pane animates to it and clicks it.
   */
  readonly control?: string
  /** Address a `navigate` control types into the pane's address field. */
  readonly url?: string
  /** Scroll direction and distance for the scroll nudge. */
  readonly deltaY?: number
  /**
   * Selector of the element the action named, so the pane can ask where that
   * element is after a layout change instead of leaving the pointer at a pixel
   * whose meaning moved.
   */
  readonly selector?: string
}

/** Storage a browser guest's partition can be cleared of. */
export type DesktopBrowserDataKind = 'cookies' | 'cache'

/** Identity of one pending Electron browser action. */
export type DesktopBrowserRequestId = Branded<'DesktopBrowserRequestId'>

/**
 * Right sidebar browser operations the app renderer cannot perform on the
 * `<webview>` element itself. Every guest is addressed by its web contents id,
 * and the shell refuses any id that is not a browser guest of the caller.
 */
export interface AvnDesktopBrowserApi {
  /**
   * Open an HTTP(S) address in the operating system's default browser.
   * @param url - absolute address to open.
   */
  openExternal(url: string): Promise<void>
  /**
   * Emulate `prefers-color-scheme` in one guest.
   * @param webContentsId - the guest's web contents id.
   * @param scheme - scheme to emulate, or `system` to follow the OS.
   */
  setColorScheme(webContentsId: number, scheme: DesktopBrowserColorScheme): Promise<void>
  /**
   * Clear one kind of stored data from a browser partition.
   * @param partition - the guest's `persist:avn-browser-…` partition.
   * @param kind - the data to clear.
   */
  clearData(partition: string, kind: DesktopBrowserDataKind): Promise<void>
  /**
   * Capture the guest's visible page onto the system clipboard as an image.
   * @param webContentsId - the guest's web contents id.
   */
  capture(webContentsId: number): Promise<void>
  /**
   * Perform one agent action on a guest over its CDP debugger.
   * @param webContentsId - the guest's web contents id.
   * @param operation - `snapshot`, `click`, `type`, `press`, `scroll`, `evaluate`, `upload`, `wait`, or `sequence`.
   * @param input - the tool's validated arguments.
   * @param requestId - id used to cancel a pending request.
   * @param timeoutMs - execution deadline in milliseconds.
   * @returns the action's JSON result.
   */
  automate(webContentsId: number, operation: string, input: Record<string, unknown>, requestId?: DesktopBrowserRequestId, timeoutMs?: number): Promise<unknown>
  /** Cancel the owned browser request. @param webContentsId - guest id. @param requestId - pending request id. */
  cancelAutomation(webContentsId: number, requestId: DesktopBrowserRequestId): void
  /**
   * Ask a search engine to complete a query: the endpoint's response body.
   * @param url - the engine's completion endpoint.
   * @returns the response body, for the renderer to parse.
   */
  suggest(url: string): Promise<string>
  /**
   * Observe the agent pointer actions the shell performs on guests.
   * @param listener - called with each action, before its input lands.
   * @returns disposer removing the listener.
   */
  onCursor(listener: (cursor: DesktopBrowserCursor) => void): () => void
  /**
   * Observe the guests' pages scrolling.
   *
   * The pane draws the pointer in its own coordinates, from where the page last
   * said an element was: a page that scrolls moves that element without the pane
   * acting, so the pane is told that the page moved and asks again.
   * @param listener - called with the web contents id of the guest whose page scrolled.
   * @returns disposer removing the listener.
   */
  onPageScroll(listener: (webContentsId: number) => void): () => void

}

/** Bridge the app renderer receives: the carrier marker, the browser operations, and menu commands. */
export interface AvnDesktopAppApi {
  readonly protocolVersion: 1
  readonly browser: AvnDesktopBrowserApi
  /**
   * Observe the application menu's commands, which the shell issues on the page's behalf.
   * @param listener - called with each command the menu sends.
   * @returns disposer removing the listener.
   */
  onCommand(listener: (command: DesktopMenuCommand) => void): () => void
}

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}
