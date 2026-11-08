/**
 * Chrome tabs the agent drives with the same engine as the sidebar browser: Aeven's
 * own Chrome (the Host's `browser-chromium` profile, on its debugging port) and,
 * when the reader allows it, their everyday Chrome through Chrome's remote
 * debugging switch (`chrome://inspect/#remote-debugging`, Chrome 144+), which
 * Chrome confirms with its own prompt.
 *
 * Each Chrome is one browser-level CDP connection; each tab is a flattened CDP
 * session that implements {@link BrowserTarget}, so every engine operation, wait,
 * and timing applies unchanged. The pointer is the same overlay, injected into the
 * tab's page.
 */

import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ChromeTab, prepareTab } from '@aeven/browser-engine'

/**
 * The overlay page script, read once from the bundle built beside the main process
 * (tsdown `overlay-page` entry, `overlay-page.iife.js`).
 */
let overlayPage: string | undefined

/**
 * The agent overlay as a classic page script for a Chrome tab.
 * @returns the script, which installs `window.__aevenOverlay` once per document.
 */
export function overlayScript(): string {
  overlayPage ??= readFileSync(new URL('./overlay-page.iife.js', import.meta.url), 'utf8')
  return overlayPage
}

/** Which Chrome a tab lives in: Aeven's own profile, or the reader's everyday browser. */
export type ChromeKind = 'aeven' | 'user'

/** One Chrome tab as listed to the agent. */
export interface ChromeTabInfo {
  readonly targetId: string
  readonly url: string
  readonly title: string
}

/** One browser-level CDP connection. */

/** A listener of CDP events on a browser connection, with the session each came from. */
// oxlint-disable-next-line typescript/no-explicit-any -- event parameters depend on the method; each listener narrows them
type CdpEventListener = (method: string, params: any, sessionId: string | undefined) => void
class ChromeConnection {
  readonly #socket: WebSocket
  #nextId = 1
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  readonly #listeners = new Set<CdpEventListener>()
  #closed = false

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as
        { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string }
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id)
        this.#pending.delete(message.id)
        if (message.error !== undefined) pending?.reject(new Error(message.error.message))
        else pending?.resolve(message.result)
        return
      }
      if (message.method !== undefined) for (const listener of this.#listeners) listener(message.method, message.params, message.sessionId)
    })
    socket.addEventListener('close', () => {
      this.#closed = true
      for (const pending of this.#pending.values()) pending.reject(new Error('Chrome closed the debugging connection'))
      this.#pending.clear()
    })
  }

  /**
   * Connect to a browser's debugging WebSocket.
   * @param url - the browser target's `ws://` address.
   * @returns the open connection.
   */
  static async open(url: string): Promise<ChromeConnection> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => { resolve() }, { once: true })
      socket.addEventListener('error', () => { reject(new Error(`Chrome refused the debugging connection at ${url}`)) }, { once: true })
    })
    const connection = new ChromeConnection(socket)
    await connection.send('Target.setDiscoverTargets', { discover: true })
    return connection
  }

  /** Whether the connection has closed. */
  get closed(): boolean { return this.#closed }

  /**
   * Send one command.
   * @param method - CDP method.
   * @param params - its parameters.
   * @param sessionId - the tab session it addresses; absent for the browser.
   * @returns the command's result.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- a CDP result depends on the method; each caller narrows it
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.#closed) return Promise.reject(new Error('Chrome closed the debugging connection'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params, ...sessionId === undefined ? {} : { sessionId } }))
    })
  }

  /**
   * Observe events.
   * @param listener - receives each event with the session it belongs to.
   * @returns disposer.
   */
  onEvent(listener: CdpEventListener): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
}

/** Live connections and attached tabs by Chrome. */
const connections = new Map<ChromeKind, Promise<ChromeConnection>>()
const tabs = new Map<string, Promise<ChromeTab>>()

/**
 * The debugging WebSocket of a Chrome.
 * @param kind - which Chrome.
 * @param browserUrl - Aeven's Chrome's `http://` debugging endpoint.
 * @returns the browser target's `ws://` address.
 * @throws {Error} when that Chrome is not reachable.
 */
async function browserSocket(kind: ChromeKind, browserUrl: string | undefined): Promise<string> {
  if (kind === 'aeven') {
    if (browserUrl === undefined) throw new Error("Aeven's Chrome has no debugging endpoint on this Host")
    const version = await fetch(`${browserUrl}/json/version`).then(async response => await response.json() as { webSocketDebuggerUrl?: string }, () => undefined)
    if (version?.webSocketDebuggerUrl === undefined) throw new Error("Aeven's Chrome is not running")
    return version.webSocketDebuggerUrl
  }
  const profile = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')
      : join(homedir(), '.config', 'google-chrome')
  const active = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => undefined)
  const [port, path] = active?.split('\n').map(line => line.trim()) ?? []
  if (port === undefined || path === undefined || port === '' || path === '') {
    throw new Error('your Chrome does not allow remote debugging; turn it on at chrome://inspect/#remote-debugging (Chrome 144 or later)')
  }
  return `ws://127.0.0.1:${port}${path}`
}

/**
 * A Chrome's connection, opened on first use and reopened after it closes.
 * @param kind - which Chrome.
 * @param browserUrl - Aeven's Chrome's debugging endpoint.
 * @returns the connection.
 */
async function connection(kind: ChromeKind, browserUrl: string | undefined): Promise<ChromeConnection> {
  const live = connections.get(kind)
  if (live !== undefined) {
    const open = await live.catch(() => undefined)
    if (open !== undefined && !open.closed) return open
  }
  const opening = browserSocket(kind, browserUrl).then(async url => await ChromeConnection.open(url))
  connections.set(kind, opening)
  opening.catch(() => { if (connections.get(kind) === opening) connections.delete(kind) })
  return await opening
}

/**
 * The tabs of a Chrome.
 * @param kind - which Chrome.
 * @param browserUrl - Aeven's Chrome's debugging endpoint.
 * @returns its ordinary web tabs.
 */
export async function chromeTabs(kind: ChromeKind, browserUrl: string | undefined): Promise<ChromeTabInfo[]> {
  const open = await connection(kind, browserUrl)
  const { targetInfos } = await open.send('Target.getTargets') as { targetInfos: Array<{ targetId: string; type: string; url: string; title: string }> }
  return targetInfos.filter(target => target.type === 'page' && !/^(chrome|devtools|chrome-extension|chrome-untrusted):/.test(target.url))
    .map(target => ({ targetId: target.targetId, url: target.url, title: target.title }))
}

/**
 * Open a background tab.
 * @param kind - which Chrome.
 * @param browserUrl - Aeven's Chrome's debugging endpoint.
 * @param url - its first address; empty opens a blank tab.
 * @returns the new tab's id.
 */
export async function chromeOpenTab(kind: ChromeKind, browserUrl: string | undefined, url: string): Promise<string> {
  const open = await connection(kind, browserUrl)
  const address = url === '' ? 'about:blank' : /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
  const { targetId } = await open.send('Target.createTarget', { url: address, background: true }) as { targetId: string }
  return targetId
}

/**
 * Close a tab.
 * @param kind - which Chrome.
 * @param browserUrl - Aeven's Chrome's debugging endpoint.
 * @param targetId - the tab.
 */
export async function chromeCloseTab(kind: ChromeKind, browserUrl: string | undefined, targetId: string): Promise<void> {
  const open = await connection(kind, browserUrl)
  tabs.delete(`${kind}:${targetId}`)
  await open.send('Target.closeTarget', { targetId })
}

/**
 * A tab as an engine target, attached on first use.
 * @param kind - which Chrome.
 * @param browserUrl - Aeven's Chrome's debugging endpoint.
 * @param targetId - the tab.
 * @returns the target.
 */
export async function chromeTarget(kind: ChromeKind, browserUrl: string | undefined, targetId: string): Promise<ChromeTab> {
  const key = `${kind}:${targetId}`
  const live = tabs.get(key)
  if (live !== undefined) {
    const tab = await live.catch(() => undefined)
    if (tab?.debugger.isAttached() === true) return tab
  }
  const attaching = (async () => {
    const open = await connection(kind, browserUrl)
    const { targetInfo } = await open.send('Target.getTargetInfo', { targetId }) as { targetInfo: { url: string; title: string } }
    const { sessionId } = await open.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string }
    const tab = new ChromeTab({
      send: (method, params) => open.send(method, params, sessionId),
      subscribe: listener => open.onEvent((method, params, session) => { if (session === sessionId) listener(method, params) }),
      isOpen: () => !open.closed,
    }, targetId, targetInfo.url, targetInfo.title, overlayScript())
    open.onEvent((method, params) => {
      const event = params as { targetInfo?: { targetId?: string; url?: string; title?: string }; sessionId?: string }
      if (method === 'Target.targetInfoChanged' && event.targetInfo?.targetId === targetId) tab.setInfo(event.targetInfo.url ?? '', event.targetInfo.title ?? '')
      if (method === 'Target.detachedFromTarget' && event.sessionId === sessionId) tab.markDetached()
    })
    await prepareTab(tab, overlayScript())
    return tab
  })()
  tabs.set(key, attaching)
  attaching.catch(() => { if (tabs.get(key) === attaching) tabs.delete(key) })
  return await attaching
}
