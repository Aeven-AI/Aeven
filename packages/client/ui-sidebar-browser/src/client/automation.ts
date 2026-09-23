/** Answers the agent's `browser_*` tools with the session's own browser guest. */
import type { BrowserAutomationRequestEvent } from '@aeven/tool-browser/types'
import { desktopBrowser, type BrowserGuest } from './guest.ts'
import { resolveAddress } from './url.ts'

/**
 * Wait until the guest stops loading.
 * @param guest - the guest that is navigating.
 * @returns once `did-stop-loading` fires.
 */
function stopped(guest: BrowserGuest): Promise<void> {
  return new Promise((resolve) => { guest.addEventListener('did-stop-loading', () => { resolve() }, { once: true }) })
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
export async function automate(guest: BrowserGuest, request: Pick<BrowserAutomationRequestEvent, 'operation' | 'input'>): Promise<unknown> {
  switch (request.operation) {
    case 'status':
      return status(guest)
    case 'navigate': {
      const url = resolveAddress(String(request.input.url ?? ''))
      if (url === undefined) throw new Error(`not a navigable http(s) address: ${String(request.input.url)}`)
      const loaded = stopped(guest)
      await guest.loadURL(url)
      await loaded
      return status(guest)
    }
    case 'snapshot':
    case 'click':
    case 'type':
    case 'press':
    case 'scroll':
    case 'evaluate': {
      const bridge = desktopBrowser()
      if (bridge === undefined) throw new Error('the browser runs only in the desktop app')
      return bridge.automate(guest.getWebContentsId(), request.operation, request.input)
    }
  }
}
