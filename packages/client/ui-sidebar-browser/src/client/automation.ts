/** Answers the agent's `browser_*` tools with the session's own browser guest. */
import type { BrowserAutomationRequestEvent } from '@aeven/tool-browser/types'
import {
  desktopBrowser, liveGuests, livePaneCursors, PANE_CONTROLS, webContentsIdOf, writeLastUrl,
  type BrowserGuest, type DesktopBrowserRequestId,
  type PaneControl,
} from './guest.ts'
import { resolveAddress } from './url.ts'

/**
 * The id the shell echoes back to cancel one automation request. `crypto.randomUUID` is a
 * secure-context-only API, so the bytes come from `getRandomValues`, which every context has.
 * @returns a fresh opaque request id.
 */
export function mintRequestId(): DesktopBrowserRequestId {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') as DesktopBrowserRequestId
}

/**
 * What the agent learns about the page from `status` and after `navigate`.
 * @param guest - the session's guest.
 * @returns the page's address, title, and load state.
 */
function status(guest: BrowserGuest) {
  return { open: true, url: guest.getURL(), title: guest.getTitle(), loading: guest.isLoading() }
}

/**
 * Resolve once a freshly mounted guest finishes its first load.
 * @param guest - the guest whose load is awaited.
 * @param signal - abandons the wait.
 * @returns after `did-stop-loading`.
 * @throws the signal's reason when it aborts first.
 */
export function firstLoad(guest: BrowserGuest, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = (): void => {
      guest.removeEventListener('did-stop-loading', done)
      reject(signal?.reason as Error)
    }
    if (signal?.aborted === true) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    guest.addEventListener('did-stop-loading', done, { once: true })
  })
}

/** How long after a history step or reload a load must have started, in ms (ChatGPT `classificationTimeoutMs`). */
const LOAD_CLASSIFICATION_MS = 250
/** How long a started load is given to finish, in ms (ChatGPT `navigate_tab_*` default `timeout_ms`). */
const LOAD_TIMEOUT_MS = 10_000

/**
 * Watch for the load a history step or reload starts, as ChatGPT's browser agent waits on it:
 * a load that starts within {@link LOAD_CLASSIFICATION_MS} is waited for until its DOM is ready
 * or it stops, up to {@link LOAD_TIMEOUT_MS}; a same-document navigation settles at once.
 * @param guest - the guest that navigates.
 * @param signal - abandons the wait.
 * @returns a promise that settles when the load does or the window passes; it never rejects.
 */
function settleLoad(guest: BrowserGuest, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let started = false
    let timer = setTimeout(() => { finish() }, LOAD_CLASSIFICATION_MS)
    const start = (): void => {
      if (started) return
      started = true
      clearTimeout(timer)
      timer = setTimeout(() => { finish() }, LOAD_TIMEOUT_MS)
    }
    const loaded = (): void => { if (started) finish() }
    const finish = (): void => {
      clearTimeout(timer)
      guest.removeEventListener('did-start-loading', start)
      guest.removeEventListener('dom-ready', loaded)
      guest.removeEventListener('did-stop-loading', loaded)
      guest.removeEventListener('did-navigate-in-page', finish)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    guest.addEventListener('did-start-loading', start)
    guest.addEventListener('dom-ready', loaded)
    guest.addEventListener('did-stop-loading', loaded)
    guest.addEventListener('did-navigate-in-page', finish)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Open a session's closed browser pane at the address the agent navigates to.
 *
 * The address is stored before the pane is asked for, so the guest the pane
 * creates starts on it instead of the page it last showed.
 * @param sessionId - session whose pane opens.
 * @param request - the `navigate` request.
 * @param show - asks the right column to show the session's browser.
 * @returns the opened page's status.
 * @throws {Error} when the address is not navigable, or the request's signal reason when it aborts first.
 */
export async function navigateClosed(
  sessionId: string,
  request: Pick<BrowserAutomationRequestEvent, 'input' | 'signal'>,
  show: () => void,
): Promise<unknown> {
  const address = typeof request.input.url === 'string' ? request.input.url : ''
  const url = resolveAddress(address)
  if (url === undefined) throw new Error(`not a navigable address: ${address}`)
  writeLastUrl(sessionId, url)
  show()
  const guest = await liveGuests.whenMounted(sessionId, request.signal)
  await firstLoad(guest, request.signal)
  return status(guest)
}

/**
 * Perform one agent action in a session's guest.
 * @param guest - the guest the session's pane holds.
 * @param request - the operation and the tool's arguments.
 * @returns the action's JSON result.
 * @throws {Error} when the address is not navigable or the shell refuses the action.
 */
export async function automate(guest: BrowserGuest, request: Pick<BrowserAutomationRequestEvent, 'operation' | 'input' | 'signal' | 'timeoutMs'>): Promise<unknown> {
  request.signal?.throwIfAborted()
  switch (request.operation) {
    case 'status':
      return status(guest)
    case 'navigate': {
      const address = typeof request.input.url === 'string' ? request.input.url : ''
      const url = resolveAddress(address)
      if (url === undefined) throw new Error(`not a navigable address: ${address}`)
      // A navigation is the agent using the browser, so the address bar shows it.
      await livePaneCursors.get(guest)?.announceNavigation(url, request.signal)
      request.signal?.throwIfAborted()
      const cancel = (): void => { guest.stop() }
      request.signal?.addEventListener('abort', cancel, { once: true })
      try {
        await guest.loadURL(url)
        request.signal?.throwIfAborted()
      } finally {
        request.signal?.removeEventListener('abort', cancel)
      }
      return status(guest)
    }
    case 'back':
    case 'forward':
    case 'reload': {
      const pane = livePaneCursors.get(guest)
      await pane?.announceControl(request.operation === 'reload' ? 'refresh' : request.operation, request.signal)
      request.signal?.throwIfAborted()
      if (request.operation === 'back' && !guest.canGoBack()) throw new Error('cannot go back: no previous page in history')
      if (request.operation === 'forward' && !guest.canGoForward()) throw new Error('cannot go forward: no next page in history')
      const load = settleLoad(guest, request.signal)
      if (request.operation === 'back') guest.goBack()
      else if (request.operation === 'forward') guest.goForward()
      else guest.reload()
      await load
      request.signal?.throwIfAborted()
      return status(guest)
    }
    case 'control': {
      const control = request.input.control
      if (typeof control !== 'string' || !(PANE_CONTROLS as readonly string[]).includes(control)) throw new Error(`control must be one of ${PANE_CONTROLS.join(', ')}`)
      const pane = livePaneCursors.get(guest)
      if (pane === undefined) throw new Error('the browser pane is not showing; open it from the right sidebar')
      const load = control === 'hard-reload' ? settleLoad(guest, request.signal) : undefined
      await pane.pressControl(control as PaneControl, request.signal)
      await load
      request.signal?.throwIfAborted()
      return { ok: true, ...status(guest) }
    }
    case 'upload':
    case 'wait':
    case 'sequence':
    case 'hover':
    case 'drag':
    case 'select':
    case 'check':
    case 'read':
    case 'content':
    case 'export':
    case 'clipboard':
    case 'console':
    case 'dialog':
    case 'webmcp':
    case 'snapshot':
    case 'screenshot':
    case 'click':
    case 'type':
    case 'press':
    case 'scroll':
    case 'evaluate': {
      const bridge = desktopBrowser()
      if (bridge === undefined) throw new Error('the browser runs only in the desktop app')
      const id = webContentsIdOf(guest)
      if (id === undefined) throw new Error('the browser has not finished opening; try again in a moment')
      request.signal?.throwIfAborted()
      const requestId = mintRequestId()
      const cancel = (): void => { bridge.cancelAutomation(id, requestId) }
      request.signal?.addEventListener('abort', cancel, { once: true })
      try {
        return await bridge.automate(id, request.operation, request.input, requestId, request.timeoutMs)
      } finally {
        request.signal?.removeEventListener('abort', cancel)
      }
    }
    // The plugin answers these before a guest is chosen: tabs, history, and bookmarks
    // address the session's browsers, and the handoff is the pane's modal.
    case 'tabs':
    case 'history':
    case 'bookmarks':
    case 'handoff':
      throw new Error(`${request.operation} is not an action on one tab`)
    default: {
      const unknown: never = request.operation
      throw new Error(`unknown browser operation ${String(unknown)}`)
    }
  }
}
