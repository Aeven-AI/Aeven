/** Desktop custom-protocol API carrier: the marker and the right sidebar browser operations. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type AvnDesktopAppApi, type DesktopBrowserCursor } from './ipc.ts'

const api: AvnDesktopAppApi = {
  protocolVersion: 1,
  browser: {
    openExternal: url => ipcRenderer.invoke(DESKTOP_IPC.browserOpenExternal, url) as Promise<void>,
    setColorScheme: (webContentsId, scheme) =>
      ipcRenderer.invoke(DESKTOP_IPC.browserSetColorScheme, webContentsId, scheme) as Promise<void>,
    clearData: (partition, kind) => ipcRenderer.invoke(DESKTOP_IPC.browserClearData, partition, kind) as Promise<void>,
    capture: webContentsId => ipcRenderer.invoke(DESKTOP_IPC.browserCapture, webContentsId) as Promise<void>,
    automate: (webContentsId, operation, input) =>
      ipcRenderer.invoke(DESKTOP_IPC.browserAutomate, webContentsId, operation, input) as Promise<unknown>,
    onCursor(listener) {
      const handle = (_event: Electron.IpcRendererEvent, cursor: DesktopBrowserCursor): void => { listener(cursor) }
      ipcRenderer.on(DESKTOP_IPC.browserCursor, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.browserCursor, handle) }
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
