/** Desktop custom-protocol API carrier: the marker, the right sidebar browser operations, and menu commands. */

import { contextBridge, ipcRenderer } from 'electron'
import { DRAG_BAND_ATTRIBUTE, installDragBand } from './window-drag-band.ts'
import {
  DESKTOP_IPC,
  type AvnDesktopAppApi,
  type DesktopBrowserCursor,
  type DesktopCaptionAction,
  type DesktopMenuCommand,
  type DesktopProviderSignInState,
  type DesktopUpdateState,
} from './ipc.ts'

const api: AvnDesktopAppApi = {
  protocolVersion: 1,
  background: {
    get: () => ipcRenderer.invoke(DESKTOP_IPC.backgroundModeGet) as Promise<boolean>,
    set: enabled => ipcRenderer.invoke(DESKTOP_IPC.backgroundModeSet, enabled) as Promise<void>,
    onChange(listener) {
      const handle = (_event: Electron.IpcRendererEvent, enabled: boolean): void => { listener(enabled) }
      ipcRenderer.on(DESKTOP_IPC.backgroundModeState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backgroundModeState, handle) }
    },
  },
  onCommand(listener) {
    const handle = (_event: Electron.IpcRendererEvent, command: DesktopMenuCommand): void => { listener(command) }
    ipcRenderer.on(DESKTOP_IPC.menuCommand, handle)
    return () => { ipcRenderer.off(DESKTOP_IPC.menuCommand, handle) }
  },
  update: {
    get: () => ipcRenderer.invoke(DESKTOP_IPC.updatesGet) as Promise<DesktopUpdateState>,
    check: () => ipcRenderer.invoke(DESKTOP_IPC.updatesCheck) as Promise<DesktopUpdateState>,
    install: () => ipcRenderer.invoke(DESKTOP_IPC.updatesInstall) as Promise<void>,
    onChange(listener) {
      // Said once per page: until the shell knows a listener exists it holds the
      // states it publishes, which is what a page that never subscribes expects.
      ipcRenderer.send(DESKTOP_IPC.updatesListen)
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.updatesState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.updatesState, handle) }
    },
  },
  contextMenu: {
    show: items => ipcRenderer.invoke(DESKTOP_IPC.appMenuShow, items) as Promise<string | null>,
  },
  links: {
    onOpen(listener) {
      const handle = (_event: Electron.IpcRendererEvent, url: string): void => { listener(url) }
      ipcRenderer.on(DESKTOP_IPC.linksOpen, handle)
      // Said once per page: until the shell knows a listener exists it hands
      // addresses to the operating system, which is what a page that never
      // subscribes — another build's client, a Host served elsewhere — expects.
      ipcRenderer.send(DESKTOP_IPC.linksListen)
      return () => { ipcRenderer.off(DESKTOP_IPC.linksOpen, handle) }
    },
  },
  browser: {
    openExternal: url => ipcRenderer.invoke(DESKTOP_IPC.browserOpenExternal, url) as Promise<void>,
    setColorScheme: (webContentsId, scheme) =>
      ipcRenderer.invoke(DESKTOP_IPC.browserSetColorScheme, webContentsId, scheme) as Promise<void>,
    clearData: (partition, kind) => ipcRenderer.invoke(DESKTOP_IPC.browserClearData, partition, kind) as Promise<void>,
    capture: webContentsId => ipcRenderer.invoke(DESKTOP_IPC.browserCapture, webContentsId) as Promise<void>,
    automate: (webContentsId, operation, input, requestId, timeoutMs) =>
      ipcRenderer.invoke(DESKTOP_IPC.browserAutomate, webContentsId, operation, input, requestId, timeoutMs) as Promise<unknown>,
    cancelAutomation: (webContentsId, requestId) => { ipcRenderer.send(DESKTOP_IPC.browserCancelAutomation, webContentsId, requestId) },
    suggest: url => ipcRenderer.invoke(DESKTOP_IPC.browserSuggest, url) as Promise<string>,
    cursorArrived: (webContentsId, sequence) => { ipcRenderer.send(DESKTOP_IPC.browserCursorArrived, webContentsId, sequence) },
    onCursor(listener) {
      const handle = (_event: Electron.IpcRendererEvent, cursor: DesktopBrowserCursor): void => { listener(cursor) }
      ipcRenderer.on(DESKTOP_IPC.browserCursor, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.browserCursor, handle) }
    },
    onPageScroll(listener) {
      const handle = (_event: Electron.IpcRendererEvent, webContentsId: number): void => { listener(webContentsId) }
      ipcRenderer.on(DESKTOP_IPC.browserPageScroll, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.browserPageScroll, handle) }
    },
  },
}

contextBridge.exposeInMainWorld('avnDesktop', api)

/**
 * The window events `@aeven/client-ui-auth-aeven` follows while a provider
 * sign-in runs outside the page, by the state the shell reports.
 */
const PROVIDER_SIGN_IN_EVENTS: Readonly<Record<DesktopProviderSignInState, string>> = {
  'signed-in': 'aeven:provider-signed-in',
  ended: 'aeven:provider-sign-in-ended',
}

ipcRenderer.on(DESKTOP_IPC.providerSignIn, (_event: Electron.IpcRendererEvent, state: DesktopProviderSignInState) => {
  window.dispatchEvent(new Event(PROVIDER_SIGN_IN_EVENTS[state]))
})

/** The scheme the page renders in: its own `color-scheme`, else the system's. */
function pageScheme(): 'light' | 'dark' {
  const declared = getComputedStyle(document.documentElement).colorScheme.split(/\s+/u)
  if (declared.length === 1 && (declared[0] === 'light' || declared[0] === 'dark')) return declared[0]
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Keep the caption glyphs, the strip, and its controls legible as the page's scheme changes.
 * @param controls - the strip's shadow hosts, which take the scheme as an attribute.
 */
function reportCaptionScheme(controls: readonly HTMLElement[]): void {
  let reported: 'light' | 'dark' | undefined
  const report = (): void => {
    const scheme = pageScheme()
    if (scheme === reported) return
    reported = scheme
    for (const control of controls) control.dataset['scheme'] = scheme
    document.documentElement.dataset['avnCaptionScheme'] = scheme
    ipcRenderer.send(DESKTOP_IPC.captionScheme, scheme)
  }
  new MutationObserver(report).observe(document.documentElement, { attributes: true })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report)
  report()
}

/** Height of the Windows and Linux caption strip, matching the overlay (`CAPTION_BUTTONS_HEIGHT` in main.ts). */
const CAPTION_STRIP_HEIGHT = 32

/**
 * Clear the strip Windows draws its caption buttons in and make it the
 * window's drag area. The body gives up the strip's height, so every screen,
 * sign-in included, lays out below it with nothing in the client knowing. The
 * strip is #f2f2f2 in the light scheme and shows the body's own background in
 * the dark one. It is installed before the document has a `head`, so the style
 * element goes where the parser has got to.
 */
function installCaptionStrip(): void {
  const style = document.createElement('style')
  style.textContent = `
    html[data-avn-caption-buttons] body {
      padding-top: ${String(CAPTION_STRIP_HEIGHT)}px;
      box-sizing: border-box;
    }
    html[data-avn-caption-buttons][data-avn-caption-scheme='light'] [${DRAG_BAND_ATTRIBUTE}] {
      background: #f2f2f2;
    }
  `
  // The parser has no head yet, although lib.dom types `document.head` as
  // present, so the style goes on whichever element exists at this point.
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- a preload runs before the parser creates the head
  ;(document.head ?? document.documentElement).append(style)
  installDragBand(document, { height: CAPTION_STRIP_HEIGHT })
}

/**
 * Put the application menu's top-level entries in the caption strip, level
 * with the window buttons. Each label opens that entry's native submenu under
 * itself. The bar lives in a shadow root so the page's styles cannot reach it,
 * and a press never takes focus, so the composer keeps its caret and selection
 * for an Edit command to act on.
 * @returns the bar's host element.
 */
function installCaptionMenu(): HTMLElement {
  const host = document.createElement('div')
  host.dataset['avnCaptionMenu'] = ''
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host {
      position: fixed; top: 0; left: 4px; z-index: 2147483647;
      height: ${String(CAPTION_STRIP_HEIGHT)}px; display: flex; align-items: center;
      -webkit-app-region: no-drag;
      font: 12px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
      --label: #1a1a1a; --hover: rgba(0, 0, 0, 0.06); --open: rgba(0, 0, 0, 0.1);
    }
    :host([data-scheme='dark']) { --label: #e6e6e6; --hover: rgba(255, 255, 255, 0.08); --open: rgba(255, 255, 255, 0.14); }
    [role=menubar] { display: flex; }
    button {
      height: 24px; padding: 0 8px; border: 0; border-radius: 4px;
      background: transparent; color: var(--label); font: inherit; cursor: default;
    }
    button:hover { background: var(--hover); }
    button[aria-expanded='true'] { background: var(--open); }
  `
  const bar = document.createElement('div')
  bar.setAttribute('role', 'menubar')
  shadow.append(style, bar)
  void (ipcRenderer.invoke(DESKTOP_IPC.captionMenuLabels) as Promise<string[]>).then((labels) => {
    labels.forEach((label, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.tabIndex = -1
      button.textContent = label
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-haspopup', 'menu')
      button.setAttribute('aria-expanded', 'false')
      button.addEventListener('mousedown', (event) => { event.preventDefault() })
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-expanded') === 'true') return
        const rect = button.getBoundingClientRect()
        button.setAttribute('aria-expanded', 'true')
        void (ipcRenderer.invoke(DESKTOP_IPC.captionMenuOpen, index, rect.left, rect.bottom) as Promise<void>)
          .catch((error: unknown) => { console.error('avn desktop: caption menu failed', error) })
          .finally(() => { button.setAttribute('aria-expanded', 'false') })
      })
      bar.append(button)
    })
  })
  document.body.append(host)
  return host
}

/** Linux caption buttons in strip order, each with its 10px glyph. */
const CAPTION_BUTTONS: ReadonlyArray<{ action: DesktopCaptionAction; glyph: string }> = [
  { action: 'minimize', glyph: '<path d="M0 5.5h10"/>' },
  { action: 'maximize', glyph: '<rect x="0.5" y="0.5" width="9" height="9"/>' },
  { action: 'close', glyph: '<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>' },
]

/**
 * Put minimize, maximize and close buttons at the strip's right end of a
 * frameless Linux window, flat on the strip's own background. Like the menu
 * bar they live in a shadow root and never take focus.
 * @returns the buttons' host element.
 */
function installCaptionButtons(): HTMLElement {
  const host = document.createElement('div')
  host.dataset['avnCaptionControls'] = ''
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host {
      position: fixed; top: 0; right: 0; z-index: 2147483647;
      height: ${String(CAPTION_STRIP_HEIGHT)}px; display: flex;
      -webkit-app-region: no-drag;
      --glyph: #000000; --hover: rgba(0, 0, 0, 0.06); --press: rgba(0, 0, 0, 0.1);
    }
    :host([data-scheme='dark']) { --glyph: #f9fafb; --hover: rgba(255, 255, 255, 0.08); --press: rgba(255, 255, 255, 0.14); }
    button {
      width: 46px; height: 100%; padding: 0; border: 0; border-radius: 0;
      display: grid; place-items: center;
      background: transparent; color: var(--glyph); cursor: default;
    }
    button:hover { background: var(--hover); }
    button:active { background: var(--press); }
    svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1; }
  `
  shadow.append(style)
  const buttons = new Map<DesktopCaptionAction, HTMLButtonElement>()
  for (const { action, glyph } of CAPTION_BUTTONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.tabIndex = -1
    button.innerHTML = `<svg viewBox="0 0 10 10" aria-hidden="true">${glyph}</svg>`
    button.addEventListener('mousedown', (event) => { event.preventDefault() })
    button.addEventListener('click', () => { ipcRenderer.send(DESKTOP_IPC.captionWindowControl, action) })
    shadow.append(button)
    buttons.set(action, button)
  }
  void (ipcRenderer.invoke(DESKTOP_IPC.captionButtonLabels) as Promise<Record<DesktopCaptionAction, string>>).then((labels) => {
    for (const [action, button] of buttons) {
      button.setAttribute('aria-label', labels[action])
      button.title = labels[action]
    }
  })
  document.body.append(host)
  return host
}

/**
 * Run `apply` once the parser has created the document element. A preload runs
 * before that element exists, and the window's drag area is read from the
 * document as soon as it paints, so the markers cannot wait for
 * `DOMContentLoaded`.
 * @param apply - receives the document's root element, once.
 */
function whenDocumentElement(apply: (root: HTMLElement) => void): void {
  const root = document.documentElement
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- a preload has no root element yet
  if (root !== null) {
    apply(root)
    return
  }
  const observer = new MutationObserver(() => {
    const element = document.documentElement
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the same absent root element, observed while it appears
    if (element === null) return
    observer.disconnect()
    apply(element)
  })
  observer.observe(document, { childList: true })
}

// The shell marks the document as the desktop app. macOS hides the title bar
// and insets the traffic lights over the page's top-left, which the client's
// first-paint shell covers with the band that drags the window (the start
// screen draws its own). Windows and Linux hide it too and show a strip above
// the page; Windows draws its caption buttons there, and on Linux this preload
// draws them.
// Only this carrier sets these: the same client served over HTTP has no window
// to manage.
whenDocumentElement((root) => {
  root.dataset['avnDesktop'] = ''
  // macOS keeps the marker only: the app page and the boot cover each carry a
  // real drag element of their own, so the band exists from the first painted
  // frame without a second one stacked above their controls.
  if (process.platform === 'darwin') root.dataset['avnTrafficLights'] = ''
  if (process.platform === 'win32' || process.platform === 'linux') {
    root.dataset['avnCaptionButtons'] = ''
    installCaptionStrip()
  }
})

window.addEventListener('DOMContentLoaded', () => {
  if (process.platform === 'win32' || process.platform === 'linux') {
    const menuBar = installCaptionMenu()
    reportCaptionScheme(process.platform === 'linux' ? [menuBar, installCaptionButtons()] : [menuBar])
  }
})
