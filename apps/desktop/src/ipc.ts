/** Typed preload operations exposed only by the Electron shell. */
import type { Branded } from '@aeven/brand'

/** One application-menu command the shell sends to the page it renders. */
export type DesktopMenuCommand = 'open-settings' | 'start-dictation'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  menuCommand: 'avn-desktop:menu-command',
  appMenuShow: 'avn-desktop:app-menu-show',
  linksOpen: 'avn-desktop:links-open',
  linksListen: 'avn-desktop:links-listen',
  browserOpenExternal: 'avn-desktop:browser-open-external',
  browserSetColorScheme: 'avn-desktop:browser-set-color-scheme',
  browserClearData: 'avn-desktop:browser-clear-data',
  browserCapture: 'avn-desktop:browser-capture',
  browserAutomate: 'avn-desktop:browser-automate',
  browserCancelAutomation: 'avn-desktop:browser-cancel-automation',
  browserSuggest: 'avn-desktop:browser-suggest',
  browserCursor: 'avn-desktop:browser-cursor',
  browserCursorArrived: 'avn-desktop:browser-cursor-arrived',
  browserPageScroll: 'avn-desktop:browser-page-scroll',
  captionScheme: 'avn-desktop:caption-scheme',
  captionMenuLabels: 'avn-desktop:caption-menu-labels',
  captionMenuOpen: 'avn-desktop:caption-menu-open',
  captionWindowControl: 'avn-desktop:caption-window-control',
  captionButtonLabels: 'avn-desktop:caption-button-labels',
  backgroundModeGet: 'avn-desktop:background-mode-get',
  backgroundModeSet: 'avn-desktop:background-mode-set',
  backgroundModeState: 'avn-desktop:background-mode-state',
} as const

/** Window operation a page-drawn Linux caption button asks for; `maximize` toggles. */
export type DesktopCaptionAction = 'minimize' | 'maximize' | 'close'

/** `prefers-color-scheme` a browser guest is shown with; `system` clears the override. */
export type DesktopBrowserColorScheme = 'system' | 'light' | 'dark'

/**
 * One row of a menu the app page describes for the shell to pop.
 *
 * The app page knows what its own links and file names mean — an address it
 * can show in the sidebar's browser, a file it can reveal — and the shell
 * knows how to draw a native menu. A row carries only what it takes to draw
 * one, because the page performs the action itself once the reader chooses.
 */
export type DesktopMenuItem =
  | { readonly type: 'separator' }
  | {
    readonly type: 'row'
    /** Value the page receives back when this row is chosen; unique within its menu. */
    readonly id: string
    readonly label: string
    /** Whether the row can be chosen; a row that omits it can. */
    readonly enabled?: boolean
  }

/**
 * One agent pointer step the app window draws over a guest, in the guest's
 * viewport CSS pixels. A `move` glides the pointer to a point; discrete input waits for visible arrival.
 */
export interface DesktopBrowserCursor {
  /** The guest the action happens in. */
  readonly webContentsId: number
  /** What the pointer shows. */
  readonly action: 'move' | 'click' | 'type' | 'scroll' | 'control' | 'cancel'
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
  automate(
    webContentsId: number, operation: string, input: Record<string, unknown>,
    requestId?: DesktopBrowserRequestId, timeoutMs?: number,
  ): Promise<unknown>
  /** Cancel the owned browser request. @param webContentsId - guest id. @param requestId - pending request id. */
  cancelAutomation(webContentsId: number, requestId: DesktopBrowserRequestId): void
  /**
   * Ask a search engine to complete a query: the endpoint's response body.
   * @param url - the engine's completion endpoint.
   * @returns the response body, for the renderer to parse.
   */
  suggest(url: string): Promise<string>
  /**
   * Acknowledge a cursor step after arrival or when the pane is invisible.
   * @param webContentsId - guest id. @param sequence - announced step.
   */
  cursorArrived(webContentsId: number, sequence: number): void
  /** Observe pointer steps before native input. @param listener - action observer. @returns observer disposer. */
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
  readonly background: AvnDesktopBackgroundApi
  readonly browser: AvnDesktopBrowserApi
  readonly contextMenu: AvnDesktopContextMenuApi
  readonly links: AvnDesktopLinksApi
  /**
   * Observe the application menu's commands, which the shell issues on the page's behalf.
   * @param listener - called with each command the menu sends.
   * @returns disposer removing the listener.
   */
  onCommand(listener: (command: DesktopMenuCommand) => void): () => void
}

/**
 * Native menus the app page describes.
 *
 * The page owns what a right-click means — its links carry destinations the
 * sidebar's browser, the system browser, or the clipboard can take, and its
 * file names carry paths a desktop can open — while the shell owns the menu
 * itself. The page suppresses the platform's own menu on the elements it
 * answers for, so exactly one menu is ever up.
 */
export interface AvnDesktopContextMenuApi {
  /**
   * Pop one native menu for the app page and settle on the row the reader chose.
   * @param items - the rows to show, in display order.
   * @returns the chosen row's id, or null when the reader dismissed the menu.
   */
  show(items: readonly DesktopMenuItem[]): Promise<string | null>
}

/**
 * External addresses the app page's own content asked to open.
 *
 * A window the page asks for never opens here: the page is told the address
 * instead, because it owns where a link lands — the sidebar's browser, the
 * Host's Chromium, or the operating system's default browser.
 */
export interface AvnDesktopLinksApi {
  /**
   * Observe the external addresses the page's content asked to open.
   * @param listener - called with each absolute http(s) address.
   * @returns disposer removing the listener.
   */
  onOpen(listener: (url: string) => void): () => void
}

/**
 * Background mode, which the app page's Settings presents: whether the
 * application keeps running in the menu bar after its last window closes.
 */
export interface AvnDesktopBackgroundApi {
  /** @returns whether background mode is on. */
  get(): Promise<boolean>
  /**
   * Turn background mode on or off.
   * @param enabled - the new value.
   * @returns resolution after the choice is stored.
   */
  set(enabled: boolean): Promise<void>
  /**
   * Observe changes made from any window.
   * @param listener - called with each new value.
   * @returns disposer removing the listener.
   */
  onChange(listener: (enabled: boolean) => void): () => void
}
