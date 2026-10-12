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

// The window hides its title bar and insets the traffic lights over the page,
// so the shell marks the document and the layout reserves that corner. Only
// this carrier sets it: the same client served over HTTP has no lights to clear.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset['avnDesktop'] = ''
})
