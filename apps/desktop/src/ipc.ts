/** Typed preload operations exposed only by the Electron shell. */

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
  browserSuggest: 'avn-desktop:browser-suggest',
  browserCursor: 'avn-desktop:browser-cursor',
  browserCursorArrived: 'avn-desktop:browser-cursor-arrived',
} as const

/** `prefers-color-scheme` a browser guest is shown with; `system` clears the override. */
export type DesktopBrowserColorScheme = 'system' | 'light' | 'dark'

/**
 * One agent pointer step the app window draws over a guest, in the guest's
 * viewport CSS pixels. A `move` glides the pointer to a point and is answered
 * with {@link AvnDesktopBrowserApi.cursorArrived} once it is there; the other
 * actions draw their effect at the point as the input lands.
 */
export interface DesktopBrowserCursor {
  /** The guest the action happens in. */
  readonly webContentsId: number
  /** What the pointer shows. */
  readonly action: 'move' | 'click' | 'type' | 'scroll'
  /** Per-shell step number; a `move`'s arrival report names it. */
  readonly sequence: number
  readonly x: number
  readonly y: number
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
   * @param operation - `snapshot`, `click`, `type`, `press`, `scroll`, or `evaluate`.
   * @param input - the tool's validated arguments.
   * @returns the action's JSON result.
   */
  automate(webContentsId: number, operation: string, input: Record<string, unknown>): Promise<unknown>
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
   * Report that the pointer finished a `move`, or that it cannot be shown, so
   * the input it announced may land. The shell stops waiting after a timeout
   * either way.
   * @param webContentsId - the guest the move was drawn over.
   * @param sequence - the `move`'s {@link DesktopBrowserCursor.sequence}.
   */
  cursorArrived(webContentsId: number, sequence: number): void
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
