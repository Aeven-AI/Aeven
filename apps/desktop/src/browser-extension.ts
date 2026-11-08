/**
 * The Aeven browser extension's side of the desktop app: the extension drives
 * tabs of any Chromium browser (Chrome, Brave, Edge, Arc) through
 * `chrome.debugger`, keeps the agent's tabs in a collapsed Aeven tab group, and
 * reads the user's history and bookmarks.
 *
 * The browser starts this app's native messaging host (`native-host.ts`), which
 * relays newline-delimited JSON between the extension and a local socket served
 * here. Only the extension id named in the host manifest may start the host, and
 * no network port is opened.
 *
 * Requests from the app: `tabs.list`, `tabs.create`, `tabs.close`, `operate`
 * (one whole engine operation, run by the extension), `operate.cancel`,
 * `history.search`, `bookmarks.search`; the extension answers `{ id, result }`
 * or `{ id, error }`. Events from the extension: `hello` (with its protocol),
 * `tabs.updated`, `tabs.removed`.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

/** The native messaging host name the extension connects to. */
export const NATIVE_HOST_NAME = 'io.aeven.browser'

/** The Aeven extension's id, fixed by the public key in its manifest. */
export const EXTENSION_ID = 'jagdfmhjejiccpmnfieenehhijhjjgnf'

/** How long one request to the extension may take, in ms. */
const REQUEST_TIMEOUT_MS = 30_000

/** One extension tab as listed to the agent. */
export interface ExtensionTabInfo {
  readonly tabId: number
  readonly url: string
  readonly title: string
}

/** The connected extension: one socket at a time, the newest replacing an older one. */
class ExtensionLink {
  #socket: Socket | undefined
  #browser = ''
  #protocol = 0
  #nextId = 1
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  readonly #listeners = new Set<(event: string, payload: any) => void>()

  /** Whether an extension is connected. */
  get connected(): boolean { return this.#socket !== undefined }

  /** The browser the connected extension runs in, as it reported itself. */
  get browser(): string { return this.#browser }

  /** The request set the connected extension speaks, 0 before it says. */
  get protocol(): number { return this.#protocol }

  /**
   * Take over a newly connected host socket.
   * @param socket - the host's connection.
   */
  adopt(socket: Socket): void {
    this.#socket?.destroy()
    this.#socket = socket
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line.trim() !== '') this.#receive(line)
      }
    })
    const drop = (): void => {
      if (this.#socket !== socket) return
      this.#socket = undefined
      this.#browser = ''
      this.#protocol = 0
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('the Aeven extension disconnected'))
      }
      this.#pending.clear()
      for (const listener of this.#listeners) listener('disconnected', {})
    }
    socket.on('close', drop)
    socket.on('error', drop)
  }

  #receive(line: string): void {
    let message: { id?: number; result?: unknown; error?: string; event?: string; [key: string]: unknown }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      // A line that is not JSON is not a message of this protocol; the relay forwards only whole lines.
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id)
      if (pending === undefined) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (typeof message.error === 'string') pending.reject(new Error(message.error))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.event !== 'string') return
    if (message.event === 'hello' && typeof message.browser === 'string') this.#browser = message.browser
    if (message.event === 'hello') this.#protocol = typeof message.protocol === 'number' ? message.protocol : 1
    for (const listener of this.#listeners) listener(message.event, message)
  }

  /**
   * Send one request.
   * @param method - the request.
   * @param params - its parameters.
   * @returns the extension's result.
   * @throws {Error} when no extension is connected, it fails the request, or it does not answer in time.
   */
  request(method: string, params: object = {}, options: { timeoutMs?: number; signal?: AbortSignal; onCancel?: (id: number) => void } = {}): Promise<any> {
    const socket = this.#socket
    if (socket === undefined) return Promise.reject(new Error('the Aeven browser extension is not connected; install it and keep the browser open'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`the Aeven extension did not answer ${method}`))
      }, options.timeoutMs ?? REQUEST_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      options.signal?.addEventListener('abort', () => { options.onCancel?.(id) }, { once: true })
      socket.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  /**
   * Observe the extension's events.
   * @param listener - receives each event and its payload.
   * @returns disposer.
   */
  onEvent(listener: (event: string, payload: any) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
}

const link = new ExtensionLink()
let server: Server | undefined

/**
 * The socket the native host connects to.
 * @param avnHome - the Aeven home folder.
 * @returns the socket path, or a named pipe on Windows.
 */
function socketPath(avnHome: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\aeven-browser-extension-${(process.env.USERNAME ?? 'user').replace(/[^\w-]/g, '')}`
    : join(avnHome, 'runtime', 'browser-extension.sock')
}

/** Native messaging host manifest folders of the Chromium browsers this platform may have, by browser data folder. */
function hostFolders(): Array<{ browser: string; folder: string }> {
  const home = homedir()
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return [
      ['Google/Chrome', 'Google/Chrome'], ['Google/Chrome Canary', 'Google/Chrome Canary'], ['Chromium', 'Chromium'],
      ['BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser'], ['Microsoft Edge', 'Microsoft Edge'], ['Arc/User Data', 'Arc/User Data'],
    ].map(([browser, folder]) => ({ browser: join(support, browser ?? ''), folder: join(support, folder ?? '', 'NativeMessagingHosts') }))
  }
  if (process.platform === 'linux') {
    const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
    return ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge']
      .map(browser => ({ browser: join(config, browser), folder: join(config, browser, 'NativeMessagingHosts') }))
  }
  return []
}

/** Windows registry keys that name the host manifest, per browser. */
const WINDOWS_HOST_KEYS = ['Google\\Chrome', 'Chromium', 'BraveSoftware\\Brave-Browser', 'Microsoft\\Edge']

/**
 * Register the native messaging host with every installed Chromium browser:
 * a launcher that runs this app's host script with its own runtime, and the
 * manifest each browser looks up.
 * @param avnHome - the Aeven home folder, where the launcher and socket live.
 */
async function installHost(avnHome: string): Promise<void> {
  const runtime = join(avnHome, 'runtime')
  await mkdir(runtime, { recursive: true })
  const script = fileURLToPath(new URL('./native-host.js', import.meta.url))
  const socket = socketPath(avnHome)
  const windows = process.platform === 'win32'
  const launcher = join(runtime, windows ? 'aeven-browser-host.bat' : 'aeven-browser-host')
  await writeFile(launcher, windows
    ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" "${socket}"\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${script}" "${socket}"\n`)
  if (!windows) await chmod(launcher, 0o755)
  const manifest = `${JSON.stringify({
    name: NATIVE_HOST_NAME, description: 'Aeven', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  }, null, 2)}\n`
  if (windows) {
    const file = join(runtime, `${NATIVE_HOST_NAME}.json`)
    await writeFile(file, manifest)
    for (const key of WINDOWS_HOST_KEYS) {
      await new Promise<void>((resolve) => {
        execFile('reg', ['add', `HKCU\\Software\\${key}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], () => { resolve() })
      })
    }
    return
  }
  for (const { browser, folder } of hostFolders()) {
    const installed = await stat(browser).then(() => true, () => false)
    if (!installed) continue
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `${NATIVE_HOST_NAME}.json`), manifest)
  }
}

/**
 * Serve the extension's host and register it with the installed browsers.
 * @param avnHome - the Aeven home folder.
 * @returns disposer closing the server.
 */
export async function startExtensionBridge(avnHome: string): Promise<() => void> {
  await installHost(avnHome)
  const path = socketPath(avnHome)
  if (process.platform !== 'win32') {
    await mkdir(dirname(path), { recursive: true })
    await rm(path, { force: true })
  }
  server = createServer((socket) => { link.adopt(socket) })
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(path, () => { resolve() })
  })
  if (process.platform !== 'win32') await chmod(path, 0o600)
  return () => { server?.close() }
}

/**
 * Whether the extension is connected.
 * @returns the browser it runs in, or undefined while none is connected.
 */
export function extensionBrowser(): string | undefined {
  return link.connected ? link.browser || 'Chromium' : undefined
}

/**
 * The agent's tabs in the extension's browser: those in its Aeven tab group.
 * @returns each tab's id, address, and title.
 */
export async function extensionTabs(): Promise<ExtensionTabInfo[]> {
  return await link.request('tabs.list') as ExtensionTabInfo[]
}

/**
 * Open a background tab in the Aeven tab group.
 * @param url - its first address; empty opens a blank tab.
 * @returns the new tab's id.
 */
export async function extensionOpenTab(url: string): Promise<number> {
  const address = url === '' ? 'about:blank' : /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
  const { tabId } = await link.request('tabs.create', { url: address }) as { tabId: number }
  return tabId
}

/**
 * Close one of the agent's tabs.
 * @param tabId - the tab.
 */
export async function extensionCloseTab(tabId: number): Promise<void> {
  await link.request('tabs.close', { tabId })
}

/** The request set the app needs from the extension: whole engine operations. */
const REQUIRED_PROTOCOL = 2

/**
 * Run one engine operation in an agent tab: the extension runs the engine itself.
 * @param tabId - the tab.
 * @param operation - the engine operation.
 * @param input - the tool's arguments.
 * @param signal - cancels the operation in the extension.
 * @returns the operation's result.
 * @throws {Error} when the extension is too old to run operations.
 */
export async function extensionOperate(tabId: number, operation: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  // The protocol comes with the extension's hello; when that was not recorded, the extension is asked.
  const protocol = link.protocol >= REQUIRED_PROTOCOL ? link.protocol
    : await link.request('info').then((info: { protocol?: unknown }) => typeof info.protocol === 'number' ? info.protocol : 1, () => 1)
  if (protocol < REQUIRED_PROTOCOL) throw new Error('the Aeven browser extension is out of date; update it from chrome://extensions or the Chrome Web Store')
  // The operation's own deadline is the caller's; the link only stops waiting a little after it.
  return await link.request('operate', { tabId, operation, input }, {
    timeoutMs: 120_000, signal,
    onCancel: (id) => { void link.request('operate.cancel', { requestId: id }).catch(() => undefined) },
  })
}

/**
 * Search the user's browser history.
 * @param query - words to match; empty lists the newest pages.
 * @param limit - most entries.
 * @returns matching pages, newest first.
 */
export async function extensionHistory(query: string, limit: number): Promise<unknown> {
  return await link.request('history.search', { text: query, maxResults: limit })
}

/**
 * Search the user's bookmarks.
 * @param query - words to match; empty lists recent bookmarks.
 * @param limit - most entries.
 * @returns matching bookmarks.
 */
export async function extensionBookmarks(query: string, limit: number): Promise<unknown> {
  return await link.request('bookmarks.search', { query, maxResults: limit })
}
