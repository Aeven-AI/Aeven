/**
 * The Electron application menu: which roles and shell actions each platform
 * gets.
 *
 * Building the template is pure so its item inventory is testable without an
 * Electron process; the shell installs the result and supplies the actions.
 */

import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopMessages } from './locale.ts'

/** Window zoom step the View menu drives, in the units `setZoomLevel` takes. */
export type DesktopMenuZoom = 'in' | 'out' | 'reset'

/** Zoom increment one View-menu click applies, matching Electron's zoom roles. */
export const DESKTOP_MENU_ZOOM_STEP = 0.5

/**
 * AppKit appends its own full-screen item to any menu titled "View"
 * (electron/electron#3038), and in Electron that item never re-titles itself for
 * the window's state, so it reads "Enter Full Screen" while the window is
 * already full screen. A zero-width non-joiner keeps the visible title and stops
 * AppKit matching it, which leaves the shell owning the only full-screen item.
 */
const VIEW_MENU_TITLE_SUFFIX = '\u200C'

/** Address of the macOS full-screen item, so the shell can retitle it in place. */
export const FULL_SCREEN_ITEM_ID = 'view.full-screen'

/** Full-screen entry the shell owns on macOS, where AppKit's own item is suppressed. */
export interface DesktopMenuFullScreen {
  /** Label for the window's current state, re-read whenever the menu is built. */
  readonly label: string
  click(): void
}

/**
 * Shell actions the menu items invoke.
 *
 * The Desktop plugin window is deliberately absent: the menu carries product
 * surfaces, and configuration belongs in the page's own Settings.
 */
export interface DesktopMenuActions {
  checkForUpdates(): void
  /** Show the running versions: the AppKit about panel on macOS, a native dialog elsewhere. */
  showAbout(): void
  /** Ask the rendered page to open its Settings surface, which only the page owns. */
  openSettings(): void
  /** Ask the rendered page's composer to start or finish its local dictation. */
  startDictation(): void
  fullScreen: DesktopMenuFullScreen
  /**
   * Change the application window's zoom.
   * @param direction - `in`, `out`, or `reset` to the default level.
   */
  zoom(direction: DesktopMenuZoom): void
}

/** Everything one platform's menu template is built from. */
export interface DesktopMenuInput {
  /** Platform whose native menu conventions the template follows. */
  readonly platform: NodeJS.Platform
  /** Application name, used as the macOS application menu's label. */
  readonly applicationName: string
  readonly messages: DesktopMessages
  readonly actions: DesktopMenuActions
}

/** Items for the macOS application menu, which no other platform shows. */
function applicationMenu(input: DesktopMenuInput): MenuItemConstructorOptions {
  return {
    label: input.applicationName,
    submenu: [
      { label: input.messages.aboutMenu, click: () => { input.actions.showAbout() } },
      { label: input.messages.checkUpdatesMenu, click: () => { input.actions.checkForUpdates() } },
      { type: 'separator' },
      { label: input.messages.settingsMenu, accelerator: 'CmdOrCtrl+,', click: () => { input.actions.openSettings() } },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }
}

/** File menu: no application menu exists outside macOS, so Settings lives here. */
function fileMenu(input: DesktopMenuInput): MenuItemConstructorOptions {
  return {
    label: input.messages.fileMenu,
    submenu: input.platform === 'darwin'
      ? [{ role: 'close' }]
      : [
        { label: input.messages.settingsMenu, accelerator: 'CmdOrCtrl+,', click: () => { input.actions.openSettings() } },
        { type: 'separator' },
        { role: 'quit' },
      ],
  }
}

/** Edit menu: clipboard, selection, and the macOS speech roles. */
function editMenu(input: DesktopMenuInput): MenuItemConstructorOptions {
  return {
    label: input.messages.editMenu,
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      // The role, not a keystroke: Chromium already pastes the clipboard's
      // plain-text flavour for this chord into the focused editor, so the
      // accelerator binds the menu item to that same gesture rather than
      // inserting the text a second time.
      {
        label: input.messages.pasteAsTextMenu,
        accelerator: 'CmdOrCtrl+Shift+V',
        role: 'pasteAndMatchStyle',
      },
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
      { type: 'separator' },
      // AppKit also puts a "Start Dictation" item here, which drives macOS
      // dictation and needs the system setting enabled. This one drives the
      // page's own local whisper dictation, so its label says so.
      {
        label: input.messages.dictateMenu,
        accelerator: 'Alt+Cmd+D',
        click: () => { input.actions.startDictation() },
      },
      ...input.platform === 'darwin'
        ? [
          { type: 'separator' as const },
          {
            label: input.messages.speechMenu,
            submenu: [
              { role: 'startSpeaking' as const },
              { role: 'stopSpeaking' as const },
            ],
          },
        ]
        : [],
    ],
  }
}

/**
 * View menu: window contents, dev tools, and zoom.
 *
 * Zoom is not left to Electron's zoom roles. Those act on the focused web
 * contents, which in this shell is the sidebar browser's `webview` guest
 * whenever the user last clicked a page, so the application window would look
 * stuck while only the guest changed size.
 */
function viewMenu(input: DesktopMenuInput): MenuItemConstructorOptions {
  const darwin = input.platform === 'darwin'
  return {
    label: darwin ? `${input.messages.viewMenu}${VIEW_MENU_TITLE_SUFFIX}` : input.messages.viewMenu,
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: input.messages.actualSizeMenu,
        accelerator: 'CmdOrCtrl+0',
        click: () => { input.actions.zoom('reset') },
      },
      {
        label: input.messages.zoomInMenu,
        accelerator: 'CmdOrCtrl+=',
        click: () => { input.actions.zoom('in') },
      },
      {
        // The same item holds both spellings of the chord: only one accelerator
        // per item, and a hidden duplicate costs no menu height.
        label: input.messages.zoomInMenu,
        accelerator: 'CmdOrCtrl+Plus',
        visible: false,
        click: () => { input.actions.zoom('in') },
      },
      {
        label: input.messages.zoomOutMenu,
        accelerator: 'CmdOrCtrl+-',
        click: () => { input.actions.zoom('out') },
      },
      { type: 'separator' },
      darwin
        ? {
          id: FULL_SCREEN_ITEM_ID,
          label: input.actions.fullScreen.label,
          accelerator: 'Ctrl+Cmd+F',
          click: () => { input.actions.fullScreen.click() },
        }
        : { role: 'togglefullscreen' },
    ],
  }
}

/**
 * Help menu: the manual update check and, where no application menu exists to
 * carry it, the About item.
 */
function helpMenu(input: DesktopMenuInput): MenuItemConstructorOptions {
  const checkForUpdates = {
    label: input.messages.checkUpdatesMenu,
    click: () => { input.actions.checkForUpdates() },
  }
  return {
    role: 'help',
    // macOS carries About in the application menu, so Help holds the check alone there.
    submenu: input.platform === 'darwin'
      ? [checkForUpdates]
      : [
        checkForUpdates,
        { type: 'separator' },
        { label: input.messages.aboutMenu, click: () => { input.actions.showAbout() } },
      ],
  }
}

/**
 * Build the application menu for one platform.
 * @param input - platform, application name, locale copy, and shell actions.
 * @returns a template for `Menu.buildFromTemplate`.
 */
export function applicationMenuTemplate(input: DesktopMenuInput): MenuItemConstructorOptions[] {
  return [
    ...input.platform === 'darwin' ? [applicationMenu(input)] : [],
    fileMenu(input),
    editMenu(input),
    viewMenu(input),
    { role: 'windowMenu' },
    helpMenu(input),
  ]
}
