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
import { observePage, type BrowserTarget, type CursorStep } from './browser-automation.ts'

/** The overlay page script, read once from the bundle built beside the main process (tsdown `overlay-page` entry, `overlay-page.iife.js`). */
let overlayPage: string | undefined

/**
 * The agent overlay as a classic page script for a Chrome tab.
 * @returns the script, which installs `window.__aevenOverlay` once per document.
 */
function overlayScript(): string {
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

/** How long a navigation the agent starts is given to load, in ms (ChatGPT `navigate_tab_*` default). */
const NAVIGATE_TIMEOUT_MS = 10_000

/** CDP modifier bits for key events. */
const MODIFIER_BITS = { alt: 1, control: 2, meta: 4, shift: 8 } as const

/** Named keys the engine sends, as CDP key fields. */
const NAMED_KEYS: Readonly<Record<string, { key: string; code: string; keyCode: number }>> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 }, Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 }, Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 }, Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 }, End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 }, PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, Down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, Right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
}

/** CDP fields of one key the engine names. */
function keyFields(name: string): { key: string; code: string; windowsVirtualKeyCode: number } {
  const named = NAMED_KEYS[name]
  if (named !== undefined) return { key: named.key, code: named.code, windowsVirtualKeyCode: named.keyCode }
  const upper = name.toUpperCase()
  const code = /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(name) ? `Digit${name}` : ''
  return { key: name, code, windowsVirtualKeyCode: name.length === 1 ? upper.charCodeAt(0) : 0 }
}

/** One browser-level CDP connection. */
class ChromeConnection {
  readonly #socket: WebSocket
  #nextId = 1
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  readonly #listeners = new Set<(method: string, params: any, sessionId: string | undefined) => void>()
  #closed = false

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string }
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
  onEvent(listener: (method: string, params: any, sessionId: string | undefined) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
}

/** A Chrome tab as an engine target. */
class ChromeTab implements BrowserTarget {
  readonly id: string
  readonly #connection: ChromeConnection
  readonly #sessionId: string
  #url: string
  #title: string
  #detached = false
  #overlayReady = false
  readonly #listeners = new Map<(event: any, method: string, params: any) => void, () => void>()
  readonly hostWebContents = null

  constructor(connection: ChromeConnection, targetId: string, sessionId: string, url: string, title: string) {
    this.id = targetId
    this.#connection = connection
    this.#sessionId = sessionId
    this.#url = url
    this.#title = title
    connection.onEvent((method, params, session) => {
      if (method === 'Target.targetInfoChanged' && params.targetInfo?.targetId === targetId) {
        this.#url = String(params.targetInfo.url)
        this.#title = String(params.targetInfo.title)
      }
      if (method === 'Target.detachedFromTarget' && params.sessionId === sessionId) this.#detached = true
      if (method === 'Page.frameNavigated' && session === sessionId && params.frame?.parentId === undefined) this.#overlayReady = false
    })
  }

  readonly debugger = {
    attach: (): void => {},
    isAttached: (): boolean => !this.#detached && !this.#connection.closed,
    sendCommand: (method: string, params?: object): Promise<any> => this.#connection.send(method, params ?? {}, this.#sessionId),
    on: (_event: 'message', listener: (event: any, method: string, params: any) => void): void => {
      this.#listeners.set(listener, this.#connection.onEvent((method, params, session) => {
        if (session === this.#sessionId) listener(undefined, method, params)
      }))
    },
    off: (_event: 'message', listener: (event: any, method: string, params: any) => void): void => {
      this.#listeners.get(listener)?.()
      this.#listeners.delete(listener)
    },
  }

  readonly session = {
    // A request with the tab's cookies runs in the page, which holds them.
    fetch: async (input: string, init?: { signal?: AbortSignal }): Promise<Response> => {
      init?.signal?.throwIfAborted()
      const reply = await this.debugger.sendCommand('Runtime.evaluate', {
        expression: `(async () => {
          const response = await fetch(${JSON.stringify(input)}, { credentials: "include" });
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          return { status: response.status, type: response.headers.get("content-type") ?? "", data: btoa(binary) };
        })()`,
        awaitPromise: true, returnByValue: true,
      }) as { result?: { value?: { status: number; type: string; data: string } }; exceptionDetails?: { text?: string } }
      const value = reply.result?.value
      if (value === undefined) throw new Error(reply.exceptionDetails?.text ?? 'the page could not fetch the document')
      return new Response(Buffer.from(value.data, 'base64'), { status: value.status, headers: { 'content-type': value.type } })
    },
  }

  getURL(): string { return this.#url }
  getTitle(): string { return this.#title }

  async insertText(text: string): Promise<void> {
    await this.debugger.sendCommand('Input.insertText', { text })
  }

  sendInputEvent(input: { type: 'keyDown' | 'char' | 'keyUp'; keyCode: string; modifiers?: Array<'alt' | 'control' | 'meta' | 'shift'> }): void {
    const modifiers = (input.modifiers ?? []).reduce((bits, name) => bits | MODIFIER_BITS[name], 0)
    const params = input.type === 'char'
      ? { type: 'char', text: input.keyCode, unmodifiedText: input.keyCode, modifiers }
      : { type: input.type === 'keyDown' ? 'rawKeyDown' : 'keyUp', ...keyFields(input.keyCode), modifiers }
    // Commands on one connection run in order, so the key's down, char, and up stay ordered.
    void this.debugger.sendCommand('Input.dispatchKeyEvent', params).catch(() => undefined)
  }

  emit(): boolean { return false }

  /** Put the overlay into the tab's page once per document, drawing the pointer alone. */
  async #overlay(): Promise<void> {
    if (this.#overlayReady) return
    await this.debugger.sendCommand('Runtime.evaluate', {
      expression: `if (!window.__aevenOverlay) { ${overlayScript()} } window.__aevenOverlay?.attach({ decorations: false }); true`,
      returnByValue: true,
    })
    this.#overlayReady = true
  }

  async presentCursor(step: CursorStep, wait: boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const point = JSON.stringify({ x: step.x, y: step.y })
    const call = step.action === 'move' ? `moveTo(${point})`
      : step.action === 'click' ? `click(${point})`
        : step.action === 'type' ? `type(${point})`
          : step.action === 'scroll' ? `scroll(${point})`
            : step.action === 'cancel' ? 'hide({ immediate: true })'
              : undefined
    if (call === undefined) return
    await this.#overlay()
    await this.debugger.sendCommand('Runtime.evaluate', { expression: `window.__aevenOverlay?.${call}`, returnByValue: true })
    if (!wait) return
    await Promise.race([
      this.debugger.sendCommand('Runtime.evaluate', { expression: 'window.__aevenOverlay?.arrived()', awaitPromise: true, returnByValue: true }),
      new Promise((resolve) => { setTimeout(resolve, timeoutMs) }),
      new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason as Error)
        else signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
      }),
    ])
  }

  async navigate(operation: 'navigate' | 'back' | 'forward' | 'reload', url: string, signal: AbortSignal): Promise<void> {
    let finish: () => void = () => {}
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(() => { finish() }, NAVIGATE_TIMEOUT_MS)
      const listener = (_event: unknown, method: string): void => {
        if (method === 'Page.loadEventFired' || method === 'Page.navigatedWithinDocument') finish()
      }
      finish = (): void => {
        clearTimeout(timer)
        this.debugger.off('message', listener)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      this.debugger.on('message', listener)
      signal.addEventListener('abort', finish, { once: true })
    })
    try {
      if (operation === 'navigate') {
        const address = /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
        const result = await this.debugger.sendCommand('Page.navigate', { url: address }) as { errorText?: string }
        if (result.errorText !== undefined && result.errorText !== '') throw new Error(`the page did not load: ${result.errorText}`)
      } else if (operation === 'reload') {
        await this.debugger.sendCommand('Page.reload', {})
      } else {
        const history = await this.debugger.sendCommand('Page.getNavigationHistory') as { currentIndex: number; entries: Array<{ id: number }> }
        const entry = history.entries[history.currentIndex + (operation === 'back' ? -1 : 1)]
        if (entry === undefined) throw new Error(`cannot go ${operation}: no ${operation === 'back' ? 'previous' : 'next'} page in history`)
        await this.debugger.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id })
      }
    } catch (error) {
      finish()
      throw error
    }
    await loaded
    signal.throwIfAborted()
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
    const tab = new ChromeTab(open, targetId, sessionId, targetInfo.url, targetInfo.title)
    // Dialogs, console output, and navigation events come from these domains.
    await tab.debugger.sendCommand('Page.enable')
    await tab.debugger.sendCommand('Runtime.enable')
    // The script installs the overlay once the document can hold it; the pointer's first step
    // switches it to drawing the pointer alone.
    await tab.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: overlayScript() })
    observePage(tab)
    return tab
  })()
  tabs.set(key, attaching)
  attaching.catch(() => { if (tabs.get(key) === attaching) tabs.delete(key) })
  return await attaching
}
