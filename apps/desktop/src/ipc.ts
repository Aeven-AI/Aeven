/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'avn-desktop:locale-get',
  pluginsList: 'avn-desktop:plugins-list',
  pluginsAdd: 'avn-desktop:plugins-add',
  pluginsRemove: 'avn-desktop:plugins-remove',
  pluginsUpdate: 'avn-desktop:plugins-update',
  updatesCheck: 'avn-desktop:updates-check',
  updatesInstall: 'avn-desktop:updates-install',
  updatesState: 'avn-desktop:updates-state',
  browserOpenExternal: 'avn-desktop:browser-open-external',
  browserSetColorScheme: 'avn-desktop:browser-set-color-scheme',
  browserClearData: 'avn-desktop:browser-clear-data',
  browserCapture: 'avn-desktop:browser-capture',
  browserAutomate: 'avn-desktop:browser-automate',
  browserCursor: 'avn-desktop:browser-cursor',
} as const

/** `prefers-color-scheme` a browser guest is shown with; `system` clears the override. */
export type DesktopBrowserColorScheme = 'system' | 'light' | 'dark'

/** One agent pointer action the app window draws over a guest, in the guest's viewport CSS pixels. */
export interface DesktopBrowserCursor {
  /** The guest the action happens in. */
  readonly webContentsId: number
  /** What the pointer shows. */
  readonly action: 'click' | 'type' | 'scroll'
  readonly x: number
  readonly y: number
  /** Scroll direction for the scroll nudge. */
  readonly deltaY?: number
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
   * Observe the agent pointer actions the shell performs on guests.
   * @param listener - called with each action, before its input lands.
   * @returns disposer removing the listener.
   */
  onCursor(listener: (cursor: DesktopBrowserCursor) => void): () => void
}

/** Bridge the app renderer receives: the carrier marker and the browser operations. */
export interface AvnDesktopAppApi {
  readonly protocolVersion: 1
  readonly browser: AvnDesktopBrowserApi
}

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Narrow bridge exposed through context isolation. */
export interface AvnDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}
