/** Desktop custom-protocol API carrier: the marker, the right sidebar browser operations, and menu commands. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type AvnDesktopAppApi, type DesktopBrowserCursor, type DesktopMenuCommand } from './ipc.ts'

const api: AvnDesktopAppApi = {
  protocolVersion: 1,
  onCommand(listener) {
    const handle = (_event: Electron.IpcRendererEvent, command: DesktopMenuCommand): void => { listener(command) }
    ipcRenderer.on(DESKTOP_IPC.menuCommand, handle)
    return () => { ipcRenderer.off(DESKTOP_IPC.menuCommand, handle) }
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

/** The scheme the page renders in: its own `color-scheme`, else the system's. */
function pageScheme(): 'light' | 'dark' {
  const declared = getComputedStyle(document.documentElement).colorScheme.split(/\s+/u)
  if (declared.length === 1 && (declared[0] === 'light' || declared[0] === 'dark')) return declared[0]
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Keep the Windows caption glyphs and the strip's menu bar legible as the page's scheme changes.
 * @param menuBar - the strip's menu bar, which takes the scheme as an attribute.
 */
function reportCaptionScheme(menuBar: HTMLElement): void {
  let reported: 'light' | 'dark' | undefined
  const report = (): void => {
    const scheme = pageScheme()
    if (scheme === reported) return
    reported = scheme
    menuBar.dataset['scheme'] = scheme
    ipcRenderer.send(DESKTOP_IPC.captionScheme, scheme)
  }
  new MutationObserver(report).observe(document.documentElement, { attributes: true })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report)
  report()
}

/** Height of the Windows caption strip, matching the overlay (`CAPTION_BUTTONS_HEIGHT` in main.ts). */
const CAPTION_STRIP_HEIGHT = 32

/**
 * Clear the strip Windows draws its caption buttons in and make it the
 * window's drag area. The body gives up the strip's height, so every screen,
 * sign-in included, lays out below it with nothing in the client knowing; the
 * strip shows the body's own background.
 */
function installCaptionStrip(): void {
  const style = document.createElement('style')
  style.textContent = `
    html[data-avn-caption-buttons] body {
      padding-top: ${String(CAPTION_STRIP_HEIGHT)}px;
      box-sizing: border-box;
    }
    html[data-avn-caption-buttons] body::before {
      content: '';
      position: fixed;
      top: 0;
      right: 0;
      left: 0;
      height: ${String(CAPTION_STRIP_HEIGHT)}px;
      -webkit-app-region: drag;
    }
  `
  document.head.append(style)
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

// The shell marks the document as the desktop app. macOS hides the title bar
// and insets the traffic lights over the page's top-left, which the layout
// keeps clear and drags by its header band. Windows hides it too and draws its
// caption buttons in a strip above the page. Linux keeps the standard frame.
// Only this carrier sets these: the same client served over HTTP has no window
// to manage.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset['avnDesktop'] = ''
  if (process.platform === 'darwin') document.documentElement.dataset['avnTrafficLights'] = ''
  if (process.platform === 'win32') {
    document.documentElement.dataset['avnCaptionButtons'] = ''
    installCaptionStrip()
    reportCaptionScheme(installCaptionMenu())
  }
})
