/**
 * The right sidebar browser's `<webview>` guests: which may attach, what they
 * may reach, and the operations the app renderer asks of them.
 *
 * A guest carries untrusted pages, so its preferences, navigation, and popups
 * are decided in this process, where the renderer cannot reach them.
 */

import {
  clipboard,
  ClipboardItem,
  ipcMain,
  session,
  shell,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import { automate } from './browser-automation.ts'
import { fetchSuggestions } from './browser-search.ts'
import { DESKTOP_IPC, type DesktopBrowserColorScheme, type DesktopBrowserDataKind } from './ipc.ts'

/** Storage partition prefix for the right sidebar's browser guests. */
const BROWSER_PARTITION_PREFIX = 'persist:avn-browser-'

/** Schemes a guest may display. */
const GUEST_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

/** CDP protocol version the guest debugger attaches with. */
const CDP_VERSION = '1.3'

/**
 * Whether a `<webview>` partition is one the browser owns.
 * @param partition - the partition the element asked for.
 * @returns true when the browser owns it.
 */
function isBrowserPartition(partition: string): boolean {
  return partition.startsWith(BROWSER_PARTITION_PREFIX)
}

/**
 * Whether a guest may display an address: web pages, local files, and the blank
 * page a guest starts on.
 * @param url - the address a guest navigates or redirects to.
 * @returns true when the guest may show it.
 */
function isGuestAddress(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    return GUEST_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    // An unparsable address names nothing a guest may display.
    return false
  }
}

/**
 * Apply the guest policy to every `<webview>` a window hosts.
 *
 * Attachment is allowlisted by partition: a guest naming any other partition
 * never attaches, so a renderer cannot host a page in the application's own
 * storage. An attached guest displays web pages and local files, and a popup
 * opens in the guest that asked for it rather than in a window of its own.
 * @param host - the window contents that may hold browser guests.
 */
export function hardenBrowserGuests(host: WebContents): void {
  host.on('will-attach-webview', (event, webPreferences, params) => {
    if (typeof params.partition !== 'string' || !isBrowserPartition(params.partition)) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.plugins = false
    // A guest never nests another guest.
    webPreferences.webviewTag = false
  })
  host.on('did-attach-webview', (_event, guest) => {
    void reportPageScroll(guest)
    guest.setWindowOpenHandler(({ url }) => {
      if (url !== 'about:blank' && isGuestAddress(url)) void guest.loadURL(url)
      return { action: 'deny' }
    })
    const keepToGuestAddress = (event: Electron.Event, url: string): void => {
      if (!isGuestAddress(url)) event.preventDefault()
    }
    guest.on('will-navigate', keepToGuestAddress)
    guest.on('will-redirect', keepToGuestAddress)
  })
}

/**
 * Resolve a guest the caller hosts, refusing every other web contents.
 * @param event - the IPC invocation naming the guest.
 * @param webContentsId - the id the renderer read from its `<webview>`.
 * @returns the guest's web contents.
 * @throws {Error} when the id is not a browser guest of the calling window.
 */
function hostedGuest(event: IpcMainInvokeEvent, webContentsId: unknown): WebContents {
  if (typeof webContentsId !== 'number') throw new Error('avn desktop: browser guest id must be a number')
  const guest = webContents.fromId(webContentsId)
  if (guest === undefined || guest.getType() !== 'webview' || guest.hostWebContents !== event.sender) {
    throw new Error('avn desktop: rejected an operation on a web contents the caller does not host')
  }
  return guest
}

/**
 * Attach the CDP debugger to a guest once, so emulation outlives navigation.
 * @param guest - the guest to drive.
 */
function attachDebugger(guest: WebContents): void {
  if (!guest.debugger.isAttached()) guest.debugger.attach(CDP_VERSION)
}

/**
 * Binding a guest's page calls to report that its content moved.
 *
 * The pane draws the pointer in its own coordinates, from where the page last
 * said an element was, so a page that scrolls moves the element without the pane
 * acting. Only the page knows that happened.
 */
const PAGE_SCROLL_BINDING = '__avnBrowserPageScroll'

/**
 * Source installed in every guest document. Scroll events do not bubble but they
 * do capture, so a listener on the window sees a scroll of any scroller in the
 * page, in any frame the document has. A binding call takes one string argument,
 * which carries where the page now is; the pane asks the page for the element
 * itself, because an offset cannot say where that element ended up.
 *
 * The marker makes the install idempotent: a document that gets the source both
 * from the injector and from a direct evaluation reports each scroll once.
 */
const PAGE_SCROLL_REPORTER = `if (!window.__avnPageScrolled) {
  window.__avnPageScrolled = true;
  addEventListener('scroll', () => { ${PAGE_SCROLL_BINDING}(String(window.scrollX) + ',' + String(window.scrollY)) }, { capture: true, passive: true });
}`

/** Guests already reporting their scrolls, so a repeated attach does not double them. */
const reportingGuests = new WeakSet<WebContents>()

/**
 * Report one guest's page scrolls to the window that hosts it.
 *
 * The binding is added once per guest, and the reporter is installed into every
 * document: `Page.addScriptToEvaluateOnNewDocument` covers the documents created
 * after it, and each navigation installs the reporter again into the document
 * that navigation opened, because an install that ran between two documents
 * would otherwise leave a binding nothing calls.
 * @param guest - the guest whose page scrolls are reported.
 */
async function reportPageScroll(guest: WebContents): Promise<void> {
  if (reportingGuests.has(guest)) return
  reportingGuests.add(guest)
  const report = (_event: Electron.Event, method: string, params: unknown): void => {
    if (method !== 'Runtime.bindingCalled') return
    if ((params as { name?: unknown }).name !== PAGE_SCROLL_BINDING) return
    guest.hostWebContents?.send(DESKTOP_IPC.browserPageScroll, guest.id)
  }
  guest.debugger.on('message', report)
  /** Put the reporter into the document now open. */
  const installReporter = (): void => {
    // A guest between documents has no context to evaluate in, and the navigation
    // it is starting installs the reporter when it opens its own document.
    void guest.debugger.sendCommand('Runtime.evaluate', { expression: PAGE_SCROLL_REPORTER }).catch(() => undefined)
  }
  try {
    attachDebugger(guest)
    // The binding is delivered as an event of the runtime domain, so that domain
    // has to be the one this debugger session is listening to.
    await guest.debugger.sendCommand('Runtime.enable')
    // The binding must exist before the reporter calls it.
    await guest.debugger.sendCommand('Runtime.addBinding', { name: PAGE_SCROLL_BINDING })
    await guest.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SCROLL_REPORTER })
  } catch (error) {
    // A guest that closed mid-attach takes its debugger with it; a later attach
    // of the same guest installs the reporter then.
    console.error('avn desktop: guest scroll reporter failed', error)
    reportingGuests.delete(guest)
    return
  }
  guest.debugger.once('detach', () => {
    reportingGuests.delete(guest)
    guest.debugger.off('message', report)
    guest.off('did-navigate', installReporter)
    guest.off('did-finish-load', installReporter)
  })
  guest.on('did-navigate', installReporter)
  guest.on('did-finish-load', installReporter)
  installReporter()
}

/**
 * Register the browser operations the app renderer invokes.
 * @param isAppSender - whether a message comes from the application window's own page.
 */
export function registerBrowserIpc(isAppSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean): void {
  const assertApp = (event: IpcMainInvokeEvent): void => {
    if (!isAppSender(event)) throw new Error('avn desktop: rejected browser IPC from an unowned renderer')
  }
  ipcMain.handle(DESKTOP_IPC.browserOpenExternal, async (event, url: unknown) => {
    assertApp(event)
    if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol)) {
      throw new Error('avn desktop: only an HTTP(S) address opens in the system browser')
    }
    await shell.openExternal(url)
  })
  ipcMain.handle(DESKTOP_IPC.browserSetColorScheme, async (event, webContentsId: unknown, scheme: unknown) => {
    assertApp(event)
    if (scheme !== 'system' && scheme !== 'light' && scheme !== 'dark') {
      throw new Error('avn desktop: color scheme must be system, light, or dark')
    }
    const guest = hostedGuest(event, webContentsId)
    attachDebugger(guest)
    const value: DesktopBrowserColorScheme | '' = scheme === 'system' ? '' : scheme
    await guest.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value }],
    })
    // A page that never asks the media query would ignore the call above, so
    // `dark` also turns Chromium's auto-dark on and paints that page dark.
    // `light` and `system` drive it off, which is the renderer's own default.
    await guest.debugger.sendCommand('Emulation.setAutoDarkModeOverride', { enabled: scheme === 'dark' })
  })
  ipcMain.handle(DESKTOP_IPC.browserClearData, async (event, partition: unknown, kind: unknown) => {
    assertApp(event)
    if (typeof partition !== 'string' || !isBrowserPartition(partition)) {
      throw new Error('avn desktop: only a browser partition can be cleared')
    }
    const target = session.fromPartition(partition)
    const clearing: DesktopBrowserDataKind | undefined = kind === 'cookies' || kind === 'cache' ? kind : undefined
    switch (clearing) {
      case 'cookies':
        await target.clearStorageData({ storages: ['cookies'] })
        return
      case 'cache':
        await target.clearCache()
        return
      case undefined:
        throw new Error('avn desktop: browser data kind must be cookies or cache')
    }
  })
  ipcMain.handle(DESKTOP_IPC.browserCapture, async (event, webContentsId: unknown) => {
    assertApp(event)
    const image = await hostedGuest(event, webContentsId).capturePage()
    const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': png })])
  })
  const pending = new Map<string, { guest: Electron.WebContents; controller: AbortController }>()
  ipcMain.on(DESKTOP_IPC.browserCancelAutomation, (event, webContentsId: unknown, requestId: unknown) => {
    if (!isAppSender(event) || typeof requestId !== 'string') return
    const request = pending.get(`${String(event.sender.id)}:${requestId}`)
    if (request !== undefined && request.guest.id === webContentsId) request.controller.abort(new Error('browser action cancelled'))
  })
  ipcMain.handle(DESKTOP_IPC.browserAutomate, async (event, webContentsId: unknown, operation: unknown, input: unknown, requestId: unknown, timeoutMs: unknown) => {
    assertApp(event)
    if (typeof operation !== 'string') throw new Error('avn desktop: browser operation must be a string')
    if (typeof input !== 'object' || input === null) throw new Error('avn desktop: browser input must be an object')
    if (requestId !== undefined && typeof requestId !== 'string') throw new Error('browser request id must be a string')
    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error('browser timeout must be positive')
    const guest = hostedGuest(event, webContentsId)
    const controller = new AbortController()
    const key = `${String(event.sender.id)}:${String(requestId)}`
    if (requestId !== undefined && pending.has(key)) throw new Error('browser request id is already pending')
    if (requestId !== undefined) pending.set(key, { guest, controller })
    const duration = typeof timeoutMs === 'number' ? timeoutMs : 20_000
    const timer = setTimeout(() => { controller.abort(new Error(`browser action timed out after ${String(duration)}ms`)) }, duration)
    const destroyed = (): void => { controller.abort(new Error('browser page closed')) }
    guest.once('destroyed', destroyed)
    let abort: () => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = (): void => {
        if (!guest.isDestroyed() && guest.debugger.isAttached()) {
          // Detaching releases pending CDP replies; it does not undo page timers or completed input.
          void guest.debugger.sendCommand('Runtime.terminateExecution').catch(() => { /* Detachment can reject the termination reply. */ })
          guest.debugger.detach()
        }
        reject(controller.signal.reason as Error)
      }
      controller.signal.addEventListener('abort', abort, { once: true })
    })
    try {
      const work = async (): Promise<unknown> => {
        if (!guest.debugger.isAttached()) await reportPageScroll(guest)
        controller.signal.throwIfAborted()
        return automate(guest, operation, input as Record<string, unknown>, controller.signal)
      }
      return await Promise.race([work(), cancelled])
    } finally {
      clearTimeout(timer)
      guest.off('destroyed', destroyed)
      controller.signal.removeEventListener('abort', abort)
      if (requestId !== undefined) pending.delete(key)
    }
  })
  ipcMain.handle(DESKTOP_IPC.browserSuggest, async (event, url: unknown) => {
    assertApp(event)
    return await fetchSuggestions(url)
  })
}
