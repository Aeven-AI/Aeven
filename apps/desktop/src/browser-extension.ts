/**
 * The Aeven browser extension's side of the desktop app: the extension drives
 * tabs of any Chromium browser (Chrome, Brave, Edge, Arc) through
 * `chrome.debugger`, keeps the agent's tabs in an Aeven tab group, and
 * reads the user's history and bookmarks.
 *
 * The browser starts this app's native messaging host (`native-host.ts`), which
 * relays newline-delimited JSON between the extension and a local socket served
 * here. Only the extension id named in the host manifest may start the host, and
 * no network port is opened.
 *
 * Several browsers can be connected at once, one link per install of the
 * extension (`ExtensionLinks`); an agent tab's id names its install and tab. When
 * none is connected and the agent opens a tab, the browser that has the extension
 * is started.
 *
 * Requests from the app: `info`, `tabs.list`, `tabs.create`, `tabs.close`,
 * `operate` (one whole engine operation, run by the extension), `operate.cancel`,
 * `history.search`, `bookmarks.search`; the extension answers `{ id, result }`
 * or `{ id, error }`. Events from the extension: `hello` (its install, browser,
 * and protocol), `tabs.updated`, `tabs.removed`.
 */

import { createServer, type Socket } from 'node:net'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

/** The native messaging host name the extension connects to. */
export const NATIVE_HOST_NAME = 'io.aeven.browser'

/**
 * The Aeven extension's ids: the Chrome Web Store item's, then the development
 * build's, which the public key in the repository manifest fixes.
 */
export const EXTENSION_IDS = ['cpgmlafibkmklfnpjpjbdgoegpljfofa', 'jagdfmhjejiccpmnfieenehhijhjjgnf'] as const

/** How long one request to the extension may take, in ms. */
const REQUEST_TIMEOUT_MS = 30_000
/** How long a new connection is given to say which install it is, in ms. */
const INFO_TIMEOUT_MS = 10_000
/** How long a browser Aeven started is given to connect its extension, in ms. */
const LAUNCH_CONNECT_TIMEOUT_MS = 20_000

/** One extension tab as listed to the agent. */
export interface ExtensionTabInfo {
  /** `<install>.<tab>`: the install's id and the browser's tab id. */
  readonly targetId: string
  readonly url: string
  readonly title: string
  /** The browser the tab is in. */
  readonly browser: string
}

/** What a connected extension reports about itself (`info`, and its `hello`). */
export interface ExtensionInfo {
  /** Stable id of the extension's install in one browser profile; tab ids carry it. */
  readonly instance: string
  /** The browser it runs in, such as Google Chrome or Brave. */
  readonly browser: string
  /** The request set it speaks. */
  readonly protocol: number
}

/** A request waiting for the extension's answer. */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** How long a request may wait, and how its abort is reported. */
interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  onCancel?: (id: number) => void
}

/**
 * One connected extension: the socket of the native host its browser started.
 * Requests are matched to answers by id; the socket closing fails what is pending.
 */
export class ExtensionLink {
  readonly #socket: Socket
  #info: ExtensionInfo | undefined
  #nextId = 1
  #closed = false
  readonly #pending = new Map<number, PendingRequest>()
  readonly #listeners = new Set<(event: string, payload: unknown) => void>()
  readonly #closeListeners = new Set<() => void>()

  /**
   * @param socket - the host's connection.
   */
  constructor(socket: Socket) {
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
    socket.on('close', () => { this.#drop() })
    socket.on('error', () => { this.#drop() })
  }

  /** What the extension reported, once it has. */
  get info(): ExtensionInfo | undefined { return this.#info }

  /** Whether the socket closed. */
  get closed(): boolean { return this.#closed }

  /**
   * Record what the extension reported about itself.
   * @param value - an `info` result or `hello` event.
   * @returns the recorded info.
   */
  learn(value: { instance?: unknown; browser?: unknown; protocol?: unknown }): ExtensionInfo {
    // An extension older than instance ids is the one install of its browser.
    this.#info = {
      instance: typeof value.instance === 'string' && /^[\w-]{1,64}$/.test(value.instance) ? value.instance : 'default',
      browser: typeof value.browser === 'string' && value.browser !== '' ? value.browser : 'Chromium',
      protocol: typeof value.protocol === 'number' ? value.protocol : 1,
    }
    return this.#info
  }

  /** Close the connection, as when the same install connected again. */
  close(): void {
    this.#socket.destroy()
    this.#drop()
  }

  #drop(): void {
    if (this.#closed) return
    this.#closed = true
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('the Aeven extension disconnected'))
    }
    this.#pending.clear()
    for (const listener of this.#closeListeners) listener()
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
    for (const listener of this.#listeners) listener(message.event, message)
  }

  /**
   * Send one request.
   * @param method - the request.
   * @param params - its parameters.
   * @param options - its deadline, and a signal whose abort reports the request id to `onCancel`.
   * @returns the extension's result.
   * @throws {Error} when the connection closed, the extension fails the request, or it does not answer in time.
   */
  request(method: string, params: object = {}, options: RequestOptions = {}): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('the Aeven extension disconnected'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`the Aeven extension did not answer ${method}`))
      }, options.timeoutMs ?? REQUEST_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      options.signal?.addEventListener('abort', () => { options.onCancel?.(id) }, { once: true })
      this.#socket.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  /**
   * Observe the extension's events.
   * @param listener - receives each event and its payload.
   * @returns disposer.
   */
  onEvent(listener: (event: string, payload: unknown) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Observe the connection closing.
   * @param listener - called once when it closes.
   */
  onClose(listener: () => void): void {
    this.#closeListeners.add(listener)
  }
}

/**
 * The connected extensions, one per browser install: a browser that reconnects
 * replaces its earlier connection, and different browsers connect side by side.
 */
export class ExtensionLinks {
  readonly #links = new Map<string, ExtensionLink>()
  readonly #waiters = new Set<() => void>()

  /**
   * Take a newly connected host socket; it counts once the extension says which install it is.
   * @param socket - the host's connection.
   * @returns the link, registered when its `info` answer arrives.
   */
  adopt(socket: Socket): ExtensionLink {
    const link = new ExtensionLink(socket)
    const register = (value: { instance?: unknown; browser?: unknown; protocol?: unknown }): void => {
      if (link.closed) return
      const info = link.learn(value)
      const earlier = this.#links.get(info.instance)
      if (earlier === link) return
      this.#links.set(info.instance, link)
      earlier?.close()
      for (const waiter of this.#waiters) waiter()
    }
    link.onEvent((event, payload) => { if (event === 'hello') register(payload as { instance?: unknown; browser?: unknown; protocol?: unknown }) })
    link.onClose(() => {
      const instance = link.info?.instance
      if (instance !== undefined && this.#links.get(instance) === link) this.#links.delete(instance)
    })
    // The hello can precede this socket being served, so the extension is also asked.
    link.request('info', {}, { timeoutMs: INFO_TIMEOUT_MS }).then((value) => { register(value as { instance?: unknown }) }, () => {
      // An extension that never answers `info` stays unregistered; its socket closing drops it.
    })
    return link
  }

  /** The registered links, newest connection last. */
  list(): ExtensionLink[] {
    return [...this.#links.values()]
  }

  /**
   * The link of one install.
   * @param instance - the install's id.
   * @returns the link, or undefined while that install is not connected.
   */
  get(instance: string): ExtensionLink | undefined {
    return this.#links.get(instance)
  }

  /**
   * Choose the browser a new tab opens in.
   * @param browser - a browser name or install id the agent named; empty picks the newest connection.
   * @returns the link, or undefined when none matches.
   */
  pick(browser: string): ExtensionLink | undefined {
    const links = this.list()
    if (browser === '') return links.at(-1)
    const wanted = browser.toLowerCase()
    return links.find(link => link.info?.instance === browser)
      ?? links.findLast(link => link.info?.browser.toLowerCase() === wanted)
      ?? links.findLast(link => link.info?.browser.toLowerCase().includes(wanted) === true)
  }

  /**
   * Wait for any install to connect.
   * @param timeoutMs - the longest wait.
   * @returns whether one is connected.
   */
  async whenConnected(timeoutMs: number): Promise<boolean> {
    if (this.#links.size > 0) return true
    return await new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.#waiters.delete(done)
        resolve(this.#links.size > 0)
      }
      const timer = setTimeout(done, timeoutMs)
      this.#waiters.add(done)
    })
  }

  /** Close every connection. */
  closeAll(): void {
    for (const link of this.#links.values()) link.close()
    this.#links.clear()
  }
}

const links = new ExtensionLinks()

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
    name: NATIVE_HOST_NAME, description: 'Aeven', path: launcher, type: 'stdio', allowed_origins: EXTENSION_IDS.map(id => `chrome-extension://${id}/`),
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
 * Serve extension connections on a socket.
 * @param path - the socket path, or a named pipe on Windows.
 * @param registry - the links new connections join.
 * @returns disposer closing the server and every connection.
 */
export async function serveExtensions(path: string, registry: ExtensionLinks): Promise<() => void> {
  if (process.platform !== 'win32') {
    await mkdir(dirname(path), { recursive: true })
    await rm(path, { force: true })
  }
  const listening = createServer((socket) => { registry.adopt(socket) })
  await new Promise<void>((resolve, reject) => {
    listening.once('error', reject)
    listening.listen(path, () => { resolve() })
  })
  if (process.platform !== 'win32') await chmod(path, 0o600)
  return () => {
    listening.close()
    registry.closeAll()
  }
}

/**
 * Serve the extension's host and register it with the installed browsers.
 * @param avnHome - the Aeven home folder.
 * @returns disposer closing the server.
 */
export async function startExtensionBridge(avnHome: string): Promise<() => void> {
  await installHost(avnHome)
  const stop = await serveExtensions(socketPath(avnHome), links)
  return stop
}

/**
 * The browsers whose extension is connected.
 * @returns each install's id and browser name.
 */
export function extensionBrowsers(): Array<{ instance: string; browser: string }> {
  return links.list().flatMap(link => link.info === undefined ? [] : [{ instance: link.info.instance, browser: link.info.browser }])
}

/**
 * Read an extension tab id: the install's id, a dot, and the browser's tab id.
 * @param targetId - the id from a tab list.
 * @returns the install's link and the tab.
 * @throws {Error} when the id is malformed or its browser is not connected.
 */
function extensionTarget(targetId: string): { link: ExtensionLink; tabId: number } {
  const dot = targetId.lastIndexOf('.')
  const tabId = Number(targetId.slice(dot + 1))
  if (dot <= 0 || !Number.isSafeInteger(tabId)) throw new Error(`not an extension tab id: ${targetId}`)
  const link = links.get(targetId.slice(0, dot))
  if (link === undefined) throw new Error('the browser of that tab is no longer connected to Aeven; list the tabs again')
  return { link, tabId }
}

/**
 * The agent's tabs in every connected browser: those in its Aeven tab groups.
 * @returns each tab's id, address, title, and browser.
 */
export async function extensionTabs(): Promise<ExtensionTabInfo[]> {
  const listed = await Promise.all(links.list().map(async (link) => {
    const info = link.info
    if (info === undefined) return []
    // A browser that fails to list is left out; the others still answer.
    const tabs = await link.request('tabs.list').catch(() => []) as Array<{ tabId: number; url: string; title: string }>
    return tabs.map(tab => ({ targetId: `${info.instance}.${String(tab.tabId)}`, url: tab.url, title: tab.title, browser: info.browser }))
  }))
  return listed.flat()
}

/** A Chromium browser the extension may be installed in: its data folder and how to start it. */
interface BrowserInstall {
  readonly name: string
  readonly data: string
  readonly launch: readonly string[]
}

/** The Chromium browsers this platform may have, newest-first by preference. */
function browserInstalls(): BrowserInstall[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return ([
      ['Google Chrome', 'Google/Chrome'], ['Brave Browser', 'BraveSoftware/Brave-Browser'], ['Microsoft Edge', 'Microsoft Edge'],
      ['Arc', 'Arc/User Data'], ['Chromium', 'Chromium'], ['Google Chrome Canary', 'Google/Chrome Canary'],
    ] as const).map(([name, data]) => ({ name, data: join(support, data), launch: ['open', '-a', name] }))
  }
  if (process.platform === 'linux') {
    const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
    return ([
      ['Google Chrome', 'google-chrome', 'google-chrome'], ['Brave', 'BraveSoftware/Brave-Browser', 'brave-browser'],
      ['Microsoft Edge', 'microsoft-edge', 'microsoft-edge'], ['Chromium', 'chromium', 'chromium'],
    ] as const).map(([name, data, command]) => ({ name, data: join(config, data), launch: [command] }))
  }
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  return ([
    ['Google Chrome', 'Google\\Chrome\\User Data', 'chrome'], ['Brave', 'BraveSoftware\\Brave-Browser\\User Data', 'brave'],
    ['Microsoft Edge', 'Microsoft\\Edge\\User Data', 'msedge'],
  ] as const).map(([name, data, command]) => ({ name, data: join(local, data), launch: ['cmd', '/c', 'start', '', command] }))
}

/**
 * Whether a browser data folder has the extension in one of its profiles: a
 * store install has its own folder, an unpacked one is named in the profile's preferences.
 * @param data - the browser's data folder.
 * @param extensionId - the extension's id.
 * @returns whether any profile has it.
 */
export async function hasExtension(data: string, extensionId: string): Promise<boolean> {
  const entries = await readdir(data).catch(() => [] as string[])
  for (const profile of entries.filter(entry => entry === 'Default' || entry.startsWith('Profile '))) {
    if (await stat(join(data, profile, 'Extensions', extensionId)).then(() => true, () => false)) return true
    for (const file of ['Secure Preferences', 'Preferences']) {
      const text = await readFile(join(data, profile, file), 'utf8').catch(() => '')
      if (text.includes(extensionId)) return true
    }
  }
  return false
}

/**
 * Start the browser that has the extension, or bring it forward, opening the
 * extension's wake page so its worker connects at once.
 * @returns the browser started, or undefined when no browser has the extension.
 */
async function launchExtensionBrowser(): Promise<string | undefined> {
  for (const install of browserInstalls()) {
    let extensionId: string | undefined
    for (const id of EXTENSION_IDS) if (extensionId === undefined && await hasExtension(install.data, id)) extensionId = id
    if (extensionId === undefined) continue
    const [command, ...args] = install.launch
    if (command === undefined) continue
    const started = await new Promise<boolean>((resolve) => {
      execFile(command, [...args, `chrome-extension://${extensionId}/connect.html`], { windowsHide: true }, (error) => { resolve(error === null) })
    })
    if (started) return install.name
  }
  return undefined
}

/**
 * A connected browser to open a tab in, starting the one that has the extension when none is connected.
 * @param browser - a browser name or install id; empty picks the newest connection.
 * @returns the link.
 * @throws {Error} when no browser has the extension, it does not connect, or none matches the name.
 */
async function openingLink(browser: string): Promise<ExtensionLink> {
  if (links.list().length === 0) {
    const started = await launchExtensionBrowser()
    if (started === undefined) throw new Error('no browser on this computer has the Aeven extension; install it in Chrome, Brave, or Edge')
    if (!await links.whenConnected(LAUNCH_CONNECT_TIMEOUT_MS)) throw new Error(`${started} started, but its Aeven extension did not connect; check it is turned on in the browser's extensions page`)
  }
  const link = links.pick(browser)
  if (link === undefined) throw new Error(`no connected browser named ${browser}; connected: ${extensionBrowsers().map(entry => entry.browser).join(', ')}`)
  return link
}

/**
 * Open a tab in the Aeven tab group of a connected browser, in front.
 * @param url - its first address; empty opens a blank tab.
 * @param browser - which connected browser, by name or install id; empty picks the newest connection.
 * @returns the new tab's id.
 */
export async function extensionOpenTab(url: string, browser = ''): Promise<string> {
  const link = await openingLink(browser)
  const address = url === '' ? 'about:blank' : /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
  const { tabId } = await link.request('tabs.create', { url: address }) as { tabId: number }
  return `${link.info?.instance ?? 'default'}.${String(tabId)}`
}

/**
 * Close one of the agent's tabs.
 * @param targetId - the tab.
 */
export async function extensionCloseTab(targetId: string): Promise<void> {
  const { link, tabId } = extensionTarget(targetId)
  await link.request('tabs.close', { tabId })
}

/** The request set the app needs from the extension: whole engine operations. */
const REQUIRED_PROTOCOL = 2

/**
 * Run one engine operation in an agent tab: the extension runs the engine itself.
 * @param targetId - the tab.
 * @param operation - the engine operation.
 * @param input - the tool's arguments.
 * @param signal - cancels the operation in the extension.
 * @returns the operation's result.
 * @throws {Error} when the extension is too old to run operations.
 */
export async function extensionOperate(
  targetId: string, operation: string, input: Record<string, unknown>, signal: AbortSignal,
): Promise<unknown> {
  const { link, tabId } = extensionTarget(targetId)
  if ((link.info?.protocol ?? 0) < REQUIRED_PROTOCOL) throw new Error('the Aeven browser extension is out of date; update it from the browser\'s extensions page')
  // The operation's own deadline is the caller's; the link only stops waiting a little after it.
  return await link.request('operate', { tabId, operation, input }, {
    timeoutMs: 120_000, signal,
    onCancel: (id) => { void link.request('operate.cancel', { requestId: id }).catch(() => undefined) },
  })
}

/**
 * The text an entry is ordered by: its ISO date, or empty when it has none.
 * @param value - the entry's ordering field.
 * @returns the text.
 */
function orderKey(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Ask every connected browser and merge the answers, each entry naming its browser.
 * @param method - `history.search` or `bookmarks.search`.
 * @param params - the search.
 * @param limit - most entries in all.
 * @param order - the entry field ordering the merge, newest first.
 * @returns the entries.
 */
async function searchAll(method: string, params: object, limit: number, order: string): Promise<unknown[]> {
  const connected = links.list()
  if (connected.length === 0) throw new Error('the Aeven browser extension is not connected; install it and keep the browser open')
  const answers = await Promise.all(connected.map(async (link) => {
    const entries = await link.request(method, params).catch(() => []) as Array<Record<string, unknown>>
    return entries.map((entry): Record<string, unknown> => ({ ...entry, browser: link.info?.browser ?? 'Chromium' }))
  }))
  return answers.flat()
    .sort((left, right) => orderKey(right[order]).localeCompare(orderKey(left[order])))
    .slice(0, limit)
}

/**
 * Search the user's browser history in every connected browser.
 * @param query - words to match; empty lists the newest pages.
 * @param limit - most entries.
 * @returns matching pages, newest first.
 */
export async function extensionHistory(query: string, limit: number): Promise<unknown> {
  return await searchAll('history.search', { text: query, maxResults: limit }, limit, 'visitedAt')
}

/**
 * Search the user's bookmarks in every connected browser.
 * @param query - words to match; empty lists recent bookmarks.
 * @param limit - most entries.
 * @returns matching bookmarks.
 */
export async function extensionBookmarks(query: string, limit: number): Promise<unknown> {
  return await searchAll('bookmarks.search', { query, maxResults: limit }, limit, 'addedAt')
}
