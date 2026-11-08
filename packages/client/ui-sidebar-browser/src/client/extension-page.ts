/**
 * The Aeven browser extension reached from an Aeven web page, which is how
 * hosted Aeven drives the reader's browser: the page connects to the extension
 * (`externally_connectable`) and sends it the requests the desktop app sends
 * through its native host. Only the browser this page runs in is reachable.
 *
 * The extension exposes `chrome.runtime.connect` to a page only when it is
 * installed and lists the page's origin, so its absence means not installed.
 */

import type { ChromeKind, DesktopBrowserBridge, DesktopBrowserRequestId } from './guest.ts'

/** The Aeven extension's id, fixed by the public key in its manifest. */
export const AEVEN_EXTENSION_ID = 'jagdfmhjejiccpmnfieenehhijhjjgnf'

/** How long a request other than an operation may take, in ms. */
const REQUEST_TIMEOUT_MS = 30_000
/** How long an operation may take when the tool states no deadline, in ms. */
const OPERATION_TIMEOUT_MS = 120_000

/** The part of a `chrome.runtime` port the link uses. */
export interface ExtensionPort {
  postMessage(message: unknown): void
  disconnect(): void
  readonly onMessage: { addListener(callback: (message: any) => void): void }
  readonly onDisconnect: { addListener(callback: () => void): void }
}

/** Opens a port to the extension, or answers undefined when it is not installed. */
export type ExtensionConnector = () => ExtensionPort | undefined

/** The browser bridge calls a web page can serve, all for the `extension` kind. */
export type PageExtensionBridge = Pick<DesktopBrowserBridge,
  'chromeTabs' | 'chromeOpen' | 'chromeClose' | 'chromeAutomate' | 'cancelAutomation' | 'extensionRead' | 'extensionStatus'>

/**
 * Connect to the extension through this page's `chrome.runtime`.
 * @returns the port, or undefined when the extension is not installed for this page.
 */
export function pageConnector(): ExtensionPort | undefined {
  const runtime = (globalThis as { chrome?: { runtime?: { connect?: (id: string) => ExtensionPort } } }).chrome?.runtime
  if (runtime?.connect === undefined) return undefined
  return runtime.connect(AEVEN_EXTENSION_ID)
}

/** One connection to the extension, reopened on the next request after it closes. */
export class PageExtensionLink {
  readonly #connector: ExtensionConnector
  #port: ExtensionPort | undefined
  #instance: string | undefined
  #browser = ''
  #nextId = 1
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  /** Extension request ids of running operations, by the tool's request id. */
  readonly #operations = new Map<DesktopBrowserRequestId, number>()

  /**
   * @param connector - opens a port to the extension.
   */
  constructor(connector: ExtensionConnector) {
    this.#connector = connector
  }

  #open(): ExtensionPort {
    if (this.#port !== undefined) return this.#port
    const port = this.#connector()
    if (port === undefined) throw new Error('the Aeven browser extension is not installed in this browser; install it to let Aeven use your browser')
    this.#port = port
    port.onMessage.addListener((message: { id?: number; result?: unknown; error?: string; event?: string; instance?: unknown; browser?: unknown }) => {
      if (message.event === 'hello') {
        if (typeof message.instance === 'string') this.#instance = message.instance
        if (typeof message.browser === 'string') this.#browser = message.browser
        return
      }
      if (typeof message.id !== 'number') return
      const pending = this.#pending.get(message.id)
      if (pending === undefined) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (typeof message.error === 'string') pending.reject(new Error(message.error))
      else pending.resolve(message.result)
    })
    port.onDisconnect.addListener(() => {
      if (this.#port !== port) return
      this.#port = undefined
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('the Aeven extension disconnected'))
      }
      this.#pending.clear()
    })
    return port
  }

  /**
   * Send one request.
   * @param method - the request.
   * @param params - its parameters.
   * @param timeoutMs - the longest wait for the answer.
   * @param started - receives the request's id as it is sent.
   * @returns the extension's result.
   * @throws {Error} when the extension is not installed, disconnects, fails the request, or does not answer in time.
   */
  request(method: string, params: object = {}, timeoutMs = REQUEST_TIMEOUT_MS, started?: (id: number) => void): Promise<any> {
    let port: ExtensionPort
    try {
      port = this.#open()
    } catch (error) {
      return Promise.reject(error as Error)
    }
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`the Aeven extension did not answer ${method}`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      started?.(id)
      port.postMessage({ id, method, params })
    })
  }

  /**
   * This install's id and browser, asking the extension when it has not said.
   * @returns them.
   */
  async about(): Promise<{ instance: string; browser: string }> {
    if (this.#instance === undefined) {
      const info = await this.request('info') as { instance?: unknown; browser?: unknown }
      this.#instance = typeof info.instance === 'string' ? info.instance : 'default'
      if (typeof info.browser === 'string') this.#browser = info.browser
    }
    return { instance: this.#instance, browser: this.#browser || 'Chromium' }
  }

  /**
   * Read a tab id this link listed.
   * @param targetId - `<install>.<tab>`.
   * @returns the browser's tab id.
   * @throws {Error} when the id names another browser's tab.
   */
  async tabId(targetId: string): Promise<number> {
    const { instance } = await this.about()
    const dot = targetId.lastIndexOf('.')
    const tabId = Number(targetId.slice(dot + 1))
    if (targetId.slice(0, dot) !== instance || !Number.isSafeInteger(tabId)) throw new Error('that tab is in a browser this page cannot reach; list the tabs again')
    return tabId
  }

  /**
   * Remember a running operation's extension request id, for cancelling it.
   * @param requestId - the tool's request id. @param id - the extension request id; undefined forgets it.
   */
  track(requestId: DesktopBrowserRequestId, id: number | undefined): void {
    if (id === undefined) this.#operations.delete(requestId)
    else this.#operations.set(requestId, id)
  }

  /**
   * Cancel a running operation.
   * @param requestId - the tool's request id.
   */
  cancel(requestId: DesktopBrowserRequestId): void {
    const id = this.#operations.get(requestId)
    if (id === undefined) return
    this.#operations.delete(requestId)
    void this.request('operate.cancel', { requestId: id }).catch(() => undefined)
  }
}

/**
 * The bridge a web page offers for extension tabs, over one link.
 * @param link - the page's link to the extension.
 * @returns bridge calls that refuse every Chrome but the extension's.
 */
export function pageExtensionBridge(link: PageExtensionLink): PageExtensionBridge {
  const onlyExtension = (kind: ChromeKind): void => {
    if (kind !== 'extension') throw new Error('in the web app the agent reaches your browser only through the Aeven extension; open the tab with browser extension')
  }
  return {
    async chromeTabs(kind) {
      onlyExtension(kind)
      const { instance, browser } = await link.about()
      const tabs = await link.request('tabs.list') as Array<{ tabId: number; url: string; title: string }>
      return tabs.map(tab => ({ targetId: `${instance}.${String(tab.tabId)}`, url: tab.url, title: tab.title, browser }))
    },
    async chromeOpen(kind, _browserUrl, url) {
      onlyExtension(kind)
      const { instance } = await link.about()
      const address = url === '' ? 'about:blank' : /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
      const { tabId } = await link.request('tabs.create', { url: address }) as { tabId: number }
      return `${instance}.${String(tabId)}`
    },
    async chromeClose(kind, _browserUrl, targetId) {
      onlyExtension(kind)
      await link.request('tabs.close', { tabId: await link.tabId(targetId) })
    },
    async chromeAutomate(kind, _browserUrl, targetId, operation, input, requestId, timeoutMs) {
      onlyExtension(kind)
      const tabId = await link.tabId(targetId)
      try {
        // The extension enforces nothing of the tool's deadline, so the link stops waiting a little after it.
        return await link.request('operate', { tabId, operation, input }, (timeoutMs ?? OPERATION_TIMEOUT_MS) + 5_000, (id) => {
          if (requestId !== undefined) link.track(requestId, id)
        })
      } finally {
        if (requestId !== undefined) link.track(requestId, undefined)
      }
    },
    cancelAutomation(_targetId, requestId) {
      link.cancel(requestId)
    },
    async extensionRead(what, query, limit) {
      const { browser } = await link.about()
      const entries = what === 'history'
        ? await link.request('history.search', { text: query, maxResults: limit }) as Array<Record<string, unknown>>
        : await link.request('bookmarks.search', { query, maxResults: limit }) as Array<Record<string, unknown>>
      return entries.map(entry => ({ ...entry, browser }))
    },
    async extensionStatus() {
      try {
        return [await link.about()]
      } catch {
        // Not installed, or not answering: no browser is connected.
        return []
      }
    },
  }
}
