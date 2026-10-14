/** Answers the agent's `browser_*` tools with the session's own browser guest. */
import type { BrowserAutomationRequestEvent } from '@aeven/tool-browser/types'
import { desktopBrowser, livePaneCursors, webContentsIdOf, type BrowserGuest, type DesktopBrowserRequestId } from './guest.ts'
import { resolveAddress } from './url.ts'

/**
 * The id the shell echoes back to cancel one automation request. `crypto.randomUUID` is a
 * secure-context-only API, so the bytes come from `getRandomValues`, which every context has.
 * @returns a fresh opaque request id.
 */
function mintRequestId(): DesktopBrowserRequestId {
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
      if (request.operation === 'back') guest.goBack()
      else if (request.operation === 'forward') guest.goForward()
      else guest.reload()
      return { ok: true }
    }
    case 'upload':
    case 'wait':
    case 'sequence':
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
  }
}
