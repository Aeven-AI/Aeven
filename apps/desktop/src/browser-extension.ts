/**
 * The Aeven browser extension's side of the desktop app: the extension drives
 * tabs of any Chromium browser (Chrome, Brave, Edge, Arc) through
 * `chrome.debugger`, keeps the agent's tabs in an Aeven tab group, and
 * reads the user's history and bookmarks.
 *
 * The extension connects to a WebSocket this app serves on the loopback
 * interface, on the first free port of `EXTENSION_PORTS`. The server accepts only
 * the Aeven extension's origins, and both sides then prove they hold the pairing
 * secret stored in the Aeven home: each signs the other's random challenge
 * together with the port, so neither another local program nor a relay between
 * ports passes for either side. An extension that cannot prove the secret is
 * refused, and the app opens `connect.html` in that browser with the secret in
 * its fragment, once per browser while it serves; that page hands the secret to
 * the extension. No registry key or browser registration is written.
 *
 * The connection is the reader's choice (`ExtensionIntegration`), on until
 * they turn it off: turning it off closes the server and every connection.
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
 * and protocol), `tabs.updated`, `tabs.removed`, and `ping`, which keeps its
 * service worker running and is otherwise ignored. One JSON message per text frame.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { WebSocketServer, type WebSocket } from 'ws'

/**
 * The Aeven extension's ids: the Chrome Web Store item's, then the development
 * build's, which the public key in the repository manifest fixes.
 */
export const EXTENSION_IDS = ['cpgmlafibkmklfnpjpjbdgoegpljfofa', 'jagdfmhjejiccpmnfieenehhijhjjgnf'] as const

/**
 * The loopback ports the app serves the extension on, tried in order; the
 * extension tries the same list (`APP_PORTS` in apps/chrome-extension/src/background.ts).
 * A later port serves when an earlier one is taken, such as by the app of another
 * account on the same computer, whose secret this extension does not hold.
 */
export const EXTENSION_PORTS = [47820, 47821, 47822] as const

/** How long one request to the extension may take, in ms. */
const REQUEST_TIMEOUT_MS = 30_000
/** How long a new connection is given to say which install it is, in ms. */
const INFO_TIMEOUT_MS = 10_000
/** How long a browser Aeven started is given to connect its extension, in ms. */
const LAUNCH_CONNECT_TIMEOUT_MS = 20_000
/** How long a new connection is given to answer the challenge, in ms. */
const AUTH_TIMEOUT_MS = 10_000

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
 * One connected extension: its authenticated WebSocket. Requests are matched to
 * answers by id; the socket closing fails what is pending.
 */
export class ExtensionLink {
  readonly #socket: WebSocket
  #info: ExtensionInfo | undefined
  #nextId = 1
  #closed = false
  readonly #pending = new Map<number, PendingRequest>()
  readonly #listeners = new Set<(event: string, payload: unknown) => void>()
  readonly #closeListeners = new Set<() => void>()

  /**
   * @param socket - the extension's connection, after it proved the pairing secret.
   */
  constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on('message', (data, isBinary) => { if (!isBinary) this.#receive(String(data)) })
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
    this.#socket.terminate()
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

  #receive(text: string): void {
    let message: { id?: number; result?: unknown; error?: string; event?: string; [key: string]: unknown }
    try {
      message = JSON.parse(text) as typeof message
    } catch {
      // A frame that is not JSON is not a message of this protocol.
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
      this.#socket.send(JSON.stringify({ id, method, params }))
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
   * Take a newly authenticated connection; it counts once the extension says which install it is.
   * @param socket - the extension's connection.
   * @returns the link, registered when its `info` answer arrives.
   */
  adopt(socket: WebSocket): ExtensionLink {
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
    // The hello can arrive before this link listens, so the extension is also asked.
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

/** The `Origin` each Aeven extension build connects with. */
const EXTENSION_ORIGINS = new Set<string>(EXTENSION_IDS.map(id => `chrome-extension://${id}`))

/**
 * One side's answer to the other's challenge: HMAC-SHA256 under the pairing
 * secret of the side's role, the port, and the challenge. The extension computes
 * the same value (`sign` in apps/chrome-extension/src/background.ts).
 * @param secret - the pairing secret, 64 hex digits.
 * @param role - whose proof it is.
 * @param port - the port the connection uses.
 * @param challenge - the other side's challenge, 32 hex digits.
 * @returns the proof, 64 hex digits.
 */
export function pairingProof(secret: string, role: 'app' | 'extension', port: number, challenge: string): string {
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(`${role}:${String(port)}:${challenge}`).digest('hex')
}

/** What an extension answers the challenge with. */
interface AuthReply {
  readonly challenge: string
  readonly proof: string | undefined
  readonly browser: string
}

/**
 * Read an extension's answer to the challenge.
 * @param text - the frame.
 * @returns the answer, or undefined when the frame is not one.
 */
function readAuthReply(text: string): AuthReply | undefined {
  let message: { event?: unknown; nonce?: unknown; proof?: unknown; browser?: unknown }
  try {
    message = JSON.parse(text) as typeof message
  } catch {
    // A frame that is not JSON is no answer; the connection is refused like any wrong answer.
    return undefined
  }
  if (message.event !== 'auth' || typeof message.nonce !== 'string' || !/^[\da-f]{32}$/.test(message.nonce)) return undefined
  return {
    challenge: message.nonce,
    proof: typeof message.proof === 'string' && /^[\da-f]{64}$/.test(message.proof) ? message.proof : undefined,
    browser: typeof message.browser === 'string' ? message.browser.slice(0, 64) : '',
  }
}

/** How `serveExtensions` authenticates connections and reports refused ones. */
export interface ExtensionServerOptions {
  /** The ports to try, in order. */
  readonly ports: readonly number[]
  /** The pairing secret, 64 hex digits. */
  readonly secret: string
  /**
   * Called for each connection from an extension origin that did not prove the secret.
   * @param extensionId - the extension id its origin names.
   * @param browser - the browser it says it runs in.
   */
  readonly onUnpaired: (extensionId: string, browser: string) => void
}

/**
 * Listen on one loopback port for the extension's origins.
 * @param port - the port.
 * @returns the server, or undefined when the port is taken.
 */
async function listen(port: number): Promise<WebSocketServer | undefined> {
  return await new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port, verifyClient: ({ origin }: { origin: string }) => EXTENSION_ORIGINS.has(origin) })
    server.once('listening', () => { resolve(server) })
    server.once('error', (error: NodeJS.ErrnoException) => {
      server.close()
      if (error.code === 'EADDRINUSE') resolve(undefined)
      else reject(error)
    })
  })
}

/**
 * Authenticate one connection: send a challenge, check the extension's proof,
 * prove the secret back, and hand the socket to the registry. A wrong or missing
 * proof closes the connection.
 * @param socket - the new connection.
 * @param request - its upgrade request, whose origin the server already checked.
 * @param port - the port it arrived on.
 * @param options - the secret and the refusal report.
 * @param registry - the links an authenticated connection joins.
 */
function authenticate(
  socket: WebSocket, request: IncomingMessage, port: number, options: ExtensionServerOptions, registry: ExtensionLinks,
): void {
  const challenge = randomBytes(16).toString('hex')
  const timer = setTimeout(() => { socket.terminate() }, AUTH_TIMEOUT_MS)
  // Until the registry adopts it, a failing socket is only closed; the link's own listeners take over after.
  socket.on('error', () => { socket.terminate() })
  socket.once('message', (data, isBinary) => {
    clearTimeout(timer)
    const reply = isBinary ? undefined : readAuthReply(String(data))
    const expected = Buffer.from(pairingProof(options.secret, 'extension', port, challenge), 'hex')
    if (reply?.proof !== undefined && timingSafeEqual(Buffer.from(reply.proof, 'hex'), expected)) {
      socket.send(JSON.stringify({ event: 'authed', proof: pairingProof(options.secret, 'app', port, reply.challenge) }))
      registry.adopt(socket)
      return
    }
    socket.close(4001, 'unpaired')
    options.onUnpaired((request.headers.origin ?? '').slice('chrome-extension://'.length), reply?.browser ?? '')
  })
  socket.send(JSON.stringify({ event: 'challenge', nonce: challenge }))
}

/**
 * Serve extension connections on the first free loopback port.
 * @param registry - the links authenticated connections join.
 * @param options - the ports, the pairing secret, and the refusal report.
 * @returns the port served and a disposer closing the server and every connection.
 * @throws {Error} when every port is taken.
 */
export async function serveExtensions(
  registry: ExtensionLinks, options: ExtensionServerOptions,
): Promise<{ port: number; stop: () => void }> {
  for (const candidate of options.ports) {
    const server = await listen(candidate)
    if (server === undefined) continue
    // Port 0 lets the system choose; proofs name the port actually bound.
    const { port } = server.address() as AddressInfo
    server.on('error', (error) => { console.error('avn desktop: browser extension server failed', error) })
    server.on('connection', (socket, request) => { authenticate(socket, request, port, options, registry) })
    return {
      port,
      stop: () => {
        for (const client of server.clients) client.terminate()
        server.close()
        registry.closeAll()
      },
    }
  }
  throw new Error(`every port the browser extension connects to is taken: ${options.ports.join(', ')}`)
}

/**
 * The page that wakes the extension and hands it the pairing secret.
 * @param extensionId - the extension's id.
 * @param secret - the pairing secret; absent opens the page without one.
 * @returns its address.
 */
function connectPage(extensionId: string, secret: string | undefined): string {
  return `chrome-extension://${extensionId}/connect.html${secret === undefined ? '' : `#${secret}`}`
}

/**
 * Open a page in one browser.
 * @param install - the browser.
 * @param url - the page.
 * @param background - on macOS, leave the browser behind the windows in front.
 * @returns whether the browser was started.
 */
async function openInBrowser(install: BrowserInstall, url: string, background: boolean): Promise<boolean> {
  const [command, ...args] = background && install.launch[0] === 'open' ? ['open', '-g', ...install.launch.slice(1)] : install.launch
  if (command === undefined) return false
  return await new Promise<boolean>((resolve) => {
    execFile(command, [...args, url], { windowsHide: true }, (error) => { resolve(error === null) })
  })
}

/**
 * Hand the pairing secret to the extension of the browsers named like the one
 * that connected without it: each installed browser whose name starts with
 * `browser` and that has the extension opens the pairing page.
 * @param extensionId - the extension's id.
 * @param browser - the browser the extension says it runs in.
 * @param secret - the pairing secret.
 */
async function pairBrowser(extensionId: string, browser: string, secret: string): Promise<void> {
  const wanted = browser.toLowerCase()
  if (wanted === '') return
  for (const install of browserInstalls()) {
    if (!install.name.toLowerCase().startsWith(wanted) || !await hasExtension(install.data, extensionId)) continue
    await openInBrowser(install, connectPage(extensionId, secret), true)
  }
}

/** Native messaging host manifest folders of the Chromium browsers earlier releases registered with on macOS and Linux. */
function legacyHostFolders(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return ['Google/Chrome', 'Google/Chrome Canary', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data']
      .map(browser => join(support, browser, 'NativeMessagingHosts'))
  }
  if (process.platform === 'linux') {
    const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
    return ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map(browser => join(config, browser, 'NativeMessagingHosts'))
  }
  return []
}

/**
 * Remove the native messaging host earlier releases registered, so an extension
 * that has not updated yet finds no host instead of starting one that no longer
 * exists: the launcher and manifest in the home's `runtime` folder, each
 * browser's manifest, and on Windows the `io.aeven.browser` key under each
 * browser's `NativeMessagingHosts` key in `HKCU`. Does nothing once the launcher is gone.
 * @param avnHome - the Aeven home folder.
 */
// TODO: delete at the first tagged release, with the installs it cleans up.
export async function removeLegacyNativeHost(avnHome: string): Promise<void> {
  const windows = process.platform === 'win32'
  const launcher = join(avnHome, 'runtime', windows ? 'aeven-browser-host.bat' : 'aeven-browser-host')
  if (!await stat(launcher).then(() => true, () => false)) return
  if (windows) {
    for (const browser of ['Google\\Chrome', 'Chromium', 'BraveSoftware\\Brave-Browser', 'Microsoft\\Edge']) {
      await new Promise<void>((resolve) => {
        // Deleting a key that was never written fails, which leaves nothing to remove.
        execFile('reg', ['delete', `HKCU\\Software\\${browser}\\NativeMessagingHosts\\io.aeven.browser`, '/f'], { windowsHide: true }, () => { resolve() })
      })
    }
  }
  for (const folder of legacyHostFolders()) await rm(join(folder, 'io.aeven.browser.json'), { force: true })
  await rm(join(avnHome, 'runtime', 'io.aeven.browser.json'), { force: true })
  await rm(launcher, { force: true })
}

/**
 * Read the stored choice.
 * @param file - the JSON record of the choice.
 * @returns whether the integration is on; a missing or unreadable record reads as on.
 */
function readIntegrationChoice(file: string): boolean {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { enabled?: unknown }).enabled !== false
  } catch {
    // Absent until the reader first turns the integration off, and a record that does not parse is no decision.
    return true
  }
}

/**
 * The pairing secret, created on first use and readable only by this account.
 * @param file - where it is kept.
 * @returns the secret, 64 hex digits.
 */
async function pairingSecret(file: string): Promise<string> {
  const kept = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[\da-f]{64}$/.test(kept)) return kept
  const made = randomBytes(32).toString('hex')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${made}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return made
}

/** The pairing secret of the server now running, which the page that starts a browser hands to its extension. */
let servingSecret: string | undefined

/** What an `ExtensionIntegration` serves; the defaults are this computer's browsers and ports. */
export interface ExtensionIntegrationParts {
  /** The links authenticated connections join. */
  readonly registry: ExtensionLinks
  /** The loopback ports to try, in order. */
  readonly ports: readonly number[]
  /** Open the pairing page in the browsers named `browser` that have the extension `extensionId`. */
  readonly pair: (extensionId: string, browser: string, secret: string) => Promise<void>
}

/**
 * The reader's choice to let the browser extension reach this app, and the
 * server that follows it. The choice and the pairing secret are stored in the
 * Aeven home, which every install of the app on the computer shares.
 */
export class ExtensionIntegration {
  readonly #file: string
  readonly #secretFile: string
  readonly #parts: ExtensionIntegrationParts
  #enabled: boolean
  #stop: (() => void) | undefined
  /** The change in progress; each change starts after the one before it settles. */
  #settled: Promise<void> = Promise.resolve()

  /**
   * @param avnHome - the Aeven home folder.
   * @param parts - what is served.
   */
  constructor(avnHome: string, parts: ExtensionIntegrationParts = { registry: links, ports: EXTENSION_PORTS, pair: pairBrowser }) {
    this.#file = join(avnHome, 'desktop', 'browser-extension.json')
    this.#secretFile = join(avnHome, 'desktop', 'browser-extension-secret')
    this.#parts = parts
    this.#enabled = readIntegrationChoice(this.#file)
  }

  /** Whether the extension may connect. */
  get enabled(): boolean {
    return this.#enabled
  }

  /**
   * Apply the stored choice: when on, serve the extension.
   * @returns resolution once the server is listening, or at once when the integration is off.
   * @throws {Error} when every port is taken.
   */
  async start(): Promise<void> {
    await this.#change(async () => {
      if (this.#enabled) await this.#serve()
    })
  }

  /**
   * Store the choice and apply it. Turning it off closes the server and every
   * extension connection; turning it on serves again.
   * @param enabled - whether the integration is on.
   * @returns resolution after the choice is stored and applied.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.#change(async () => {
      await mkdir(dirname(this.#file), { recursive: true })
      await writeFile(this.#file, `${JSON.stringify({ enabled })}\n`)
      this.#enabled = enabled
      if (enabled) await this.#serve()
      else this.close()
    })
  }

  /** Close the server and every connection. */
  close(): void {
    this.#stop?.()
    this.#stop = undefined
    servingSecret = undefined
  }

  async #serve(): Promise<void> {
    if (this.#stop !== undefined) return
    const secret = await pairingSecret(this.#secretFile)
    // One pairing page per browser while the server runs; an extension retries every minute.
    const offered = new Set<string>()
    const { stop } = await serveExtensions(this.#parts.registry, {
      ports: this.#parts.ports,
      secret,
      onUnpaired: (extensionId, browser) => {
        const key = `${extensionId} ${browser}`
        if (offered.has(key)) return
        offered.add(key)
        void this.#parts.pair(extensionId, browser, secret).catch((error: unknown) => { console.error('avn desktop: browser extension pairing failed', error) })
      },
    })
    this.#stop = stop
    servingSecret = secret
  }

  async #change(step: () => Promise<void>): Promise<void> {
    const run = this.#settled.then(step)
    // A failed change is its caller's to report; the next change still runs.
    this.#settled = run.catch(() => undefined)
    await run
  }
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
 * extension's wake page so its worker connects at once; the page also hands it
 * the pairing secret while the server runs.
 * @returns the browser started, or undefined when no browser has the extension.
 */
async function launchExtensionBrowser(): Promise<string | undefined> {
  for (const install of browserInstalls()) {
    let extensionId: string | undefined
    for (const id of EXTENSION_IDS) if (extensionId === undefined && await hasExtension(install.data, id)) extensionId = id
    if (extensionId === undefined) continue
    if (await openInBrowser(install, connectPage(extensionId, servingSecret), false)) return install.name
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
