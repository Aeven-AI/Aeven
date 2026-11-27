/**
 * The Aeven extension's service worker: it connects to the Aeven desktop app
 * over the WebSocket the app serves on the loopback interface and serves the
 * agent's requests on the browser it runs in.
 *
 * The agent works only in tabs it opened, kept in an "Aeven" tab group and
 * brought to the front so the user watches it work; it attaches
 * `chrome.debugger` to those tabs alone, and only while it acts: Chrome shows its
 * "started debugging this browser" bar while a debugger is attached, so a tab is
 * detached once the agent has left it idle for `IDLE_DETACH_MS`. While it is
 * attached, the tab shows the agent's indicator: a glow in the pointer's blue, a
 * status tag naming the current step, and the Æven tab icon, removed before the
 * debugger detaches. The app's `indicate` operation marks a step that waits for
 * the person (the indicator then stays) or the agent finishing, each with a
 * notification that brings the tab forward when clicked. The tab group's name
 * carries the same state as a mark: ⌛ working, ✋ waiting for the person, ✅
 * finished. History
 * and bookmarks are read on request; the app asks the user before it requests them.
 * Two kinds of connection carry the same messages: the desktop app's
 * WebSocket (or an older app's native host), and an Aeven web page (`externally_connectable`), which is how hosted
 * Aeven reaches this browser; localhost pages may connect only to an unpacked
 * development install. Messages are `{ id, method, params }` requests answered on
 * the asking connection with `{ id, result }` or `{ id, error }`, and
 * `{ event, ... }` notifications sent to every connection.
 *
 * The app's WebSocket counts only after both sides prove the pairing secret: the
 * app sends a challenge, this worker answers with its proof and a challenge of
 * its own, and the app proves the secret back, each proof also naming the port
 * (`pairingProof` in apps/desktop/src/browser-extension.ts). A program that
 * listens on the port without the secret gets no answer from this browser. The
 * secret arrives in the fragment of `connect.html`, which only a program running
 * on this computer can open, because no web page may navigate to it.
 *
 * When no port answers, the worker connects through the native messaging host
 * (`HOST`) that desktop apps before the WebSocket registered, so this extension
 * also works with those apps. Chrome disconnects that port at once when no app
 * registered the host, and the host disconnects when its app is not running.
 */

import { automate, ChromeTab, prepareTab, type BrowserAutomationInput } from '@aeven/browser-engine'
import { indicatorCopy } from './indicator-text.ts'

/**
 * The loopback ports the Aeven desktop app serves this extension on, tried in
 * order (`EXTENSION_PORTS` in apps/desktop/src/browser-extension.ts).
 */
const APP_PORTS = [47820, 47821, 47822]
/** The native messaging host desktop apps before the WebSocket register; the worker falls back to it. */
const HOST = 'io.aeven.browser'
/** The request and event set this extension speaks; the app refuses an older one. */
const PROTOCOL = 3
/** Name of the tab group the agent's tabs live in; a status mark from `GROUP_MARKS` may precede it. */
const GROUP_NAME = 'Æven'
/** The mark before the group's name while the agent works, while a step waits for the person, and when it finished. */
const GROUP_MARKS = { working: '⌛', input: '✋', done: '✅' } as const
/** Session-storage key of the agent's tab ids, which survive the worker restarting. */
const TABS_KEY = 'agentTabs'
/** Local-storage key of this install's id, which tells the app's connections from different browsers apart. */
const INSTANCE_KEY = 'instance'
/** Local-storage key of the pairing secret the app handed over, 64 hex digits. */
const SECRET_KEY = 'pairingSecret'
/** Origins of Aeven's own web pages, which may connect in any install. */
const AEVEN_ORIGIN = /^https:\/\/([a-z\d-]+\.)*aeven\.io$/
/** Longest wait before reconnecting to the app, in ms. */
const MAX_RETRY_MS = 60_000
/** How long an agent tab stays attached after its last operation, in ms; a task's steps follow within it. */
const IDLE_DETACH_MS = 10_000
/** How often the worker messages the app, in ms; Chrome stops a worker whose WebSocket is quiet for 30 seconds. */
const KEEPALIVE_MS = 20_000
/** How long the app is given to finish the pairing exchange on one port, in ms. */
const HANDSHAKE_MS = 5_000

/** One connection the worker serves requests on. */
interface Connection {
  send(message: unknown): void
  listen(listener: (message: unknown) => void): void
}

/** The connection to the desktop app: its authenticated WebSocket, or an older app's native host. */
let app: { send(message: unknown): void } | undefined
/** Whether a connection attempt is running. */
let connecting = false
/** Whether a pairing arrived during the running attempt, which then tries again at once. */
let retryNow = false
let keepalive: ReturnType<typeof setInterval> | undefined
/** Connected Aeven web pages. */
const pages = new Set<chrome.runtime.Port>()
let retryMs = 1000
let retryTimer: ReturnType<typeof setTimeout> | undefined
const agentTabs = new Set<number>()
const attached = new Set<number>()
/** Engine targets of the agent's tabs, attached on their first operation. */
const targets = new Map<number, ChromeTab>()
/** Number of the next connection, which keeps request ids of different connections apart. */
let nextConnection = 1
/** Operations in flight, by connection and request id, so the asking connection can cancel one. */
const running = new Map<string, { controller: AbortController; tabId: number }>()
/** Pending detaches of idle agent tabs. */
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()
/** The agent pointer as a page script, bundled beside this worker. */
let overlayScript: Promise<string> | undefined
/** The agent's indicator (glow, status tag, tab icon) as a page script, bundled beside this worker. */
let indicatorScript: Promise<string> | undefined
/** The status tag's font as base64 and the Æven icon as a data URL, read once from the extension's files. */
let indicatorAssets: Promise<{ font: string; icon: string }> | undefined
/** Agent tabs whose step waits for the person: their indicator stays on the page when the debugger detaches. */
const waiting = new Set<number>()
const loading = chrome.storage.session.get(TABS_KEY).then((stored) => {
  for (const id of (stored[TABS_KEY] as number[] | undefined) ?? []) agentTabs.add(id)
})
/** This install's id, made once and kept. */
const instance = chrome.storage.local.get(INSTANCE_KEY).then(async (stored) => {
  const kept = stored[INSTANCE_KEY]
  if (typeof kept === 'string') return kept
  const made = Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, '0')).join('')
  await chrome.storage.local.set({ [INSTANCE_KEY]: made })
  return made
})

/** Persist the agent's tab ids. */
function saveTabs(): void {
  void chrome.storage.session.set({ [TABS_KEY]: [...agentTabs] })
}

/** Send one notification to every connection. */
function post(message: unknown): void {
  app?.send(message)
  for (const page of pages) page.postMessage(message)
}

/** What this install says about itself on connecting and when asked. */
async function info(): Promise<{ instance: string; browser: string; version: string; protocol: number }> {
  return { instance: await instance, browser: browserName(), version: chrome.runtime.getManifest().version, protocol: PROTOCOL }
}

/**
 * Serve one connection's requests, which must be listened for as soon as it opens.
 * @param connection - the app's WebSocket or a web page's port.
 * @param admitted - settles true once the connection may be served; false leaves its requests unanswered.
 */
function serve(connection: Connection, admitted: Promise<boolean> = Promise.resolve(true)): void {
  const serial = nextConnection++
  connection.listen((received) => {
    const message = received as { id?: number; method?: string; params?: Record<string, unknown> } | undefined
    const id = message?.id
    const method = message?.method
    if (typeof id !== 'number' || typeof method !== 'string') return
    void admitted.then((allowed) => {
      if (allowed) void answer(serial, id, method, message?.params ?? {}, (reply) => { connection.send(reply) })
    })
  })
}

/**
 * A web page's port as a connection.
 * @param page - the port.
 * @returns the connection.
 */
function portConnection(page: chrome.runtime.Port): Connection {
  return { send: (message) => { page.postMessage(message) }, listen: (listener) => { page.onMessage.addListener(listener) } }
}

/**
 * Read one WebSocket frame.
 * @param data - the frame.
 * @returns the message, or undefined when the frame is not JSON text.
 */
function readFrame(data: unknown): unknown {
  if (typeof data !== 'string') return undefined
  try {
    return JSON.parse(data) as unknown
  } catch {
    // A frame that is not JSON is not a message of this protocol.
    return undefined
  }
}

/**
 * Random hex digits.
 * @param bytes - how many random bytes.
 * @returns twice as many hex digits.
 */
function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * A proof of the pairing secret: HMAC-SHA256 of `text` under the secret's bytes.
 * @param secret - the pairing secret, 64 hex digits.
 * @param text - the role, the port, and the challenge, colon-separated.
 * @returns the proof, 64 hex digits.
 */
async function sign(secret: string, text: string): Promise<string> {
  const bytes = new Uint8Array(secret.match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? [])
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Compare two proofs in time that does not depend on where they differ.
 * @param left - one proof.
 * @param right - the other.
 * @returns whether they are equal.
 */
function sameProof(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

/** The browser this extension runs in, as the app names it to the user. */
function browserName(): string {
  const agent = (navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } }).userAgentData
  const brands = agent?.brands.map(brand => brand.brand) ?? []
  return ['Microsoft Edge', 'Brave', 'Opera', 'Vivaldi', 'Google Chrome', 'Chromium'].find(name => brands.includes(name)) ?? 'Chromium'
}

/**
 * Open the app's WebSocket on one port and run the pairing exchange.
 * @param appPort - the port.
 * @param secret - the pairing secret, or undefined before the app handed one over.
 * @returns the socket once both sides proved the secret, with the frames that arrived since, or undefined.
 */
async function handshake(appPort: number, secret: string | undefined): Promise<{ socket: WebSocket; early: unknown[] } | undefined> {
  return await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(appPort)}/`)
    const challenge = randomHex(16)
    let answered = false
    let settled = false
    const finish = (authenticated: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.onclose = null
      socket.onerror = null
      if (!authenticated) {
        socket.onmessage = null
        socket.close()
        resolve(undefined)
        return
      }
      // The app's first requests follow its proof at once; they wait here until the worker serves the socket.
      const early: unknown[] = []
      socket.onmessage = (event) => { early.push(readFrame(event.data)) }
      resolve({ socket, early })
    }
    const timer = setTimeout(() => { finish(false) }, HANDSHAKE_MS)
    socket.onclose = () => { finish(false) }
    socket.onerror = () => { finish(false) }
    socket.onmessage = (event) => {
      const message = readFrame(event.data) as { event?: unknown; nonce?: unknown; proof?: unknown } | undefined
      if (!answered && message?.event === 'challenge' && typeof message.nonce === 'string') {
        answered = true
        // Without a secret the app refuses the answer, and opens the pairing page in this browser.
        const proof = secret === undefined ? Promise.resolve(undefined) : sign(secret, `extension:${String(appPort)}:${message.nonce}`)
        void proof.then((signed) => { socket.send(JSON.stringify({ event: 'auth', nonce: challenge, browser: browserName(), proof: signed })) })
        return
      }
      if (!answered || message?.event !== 'authed' || typeof message.proof !== 'string' || secret === undefined) {
        finish(false)
        return
      }
      const claimed = message.proof
      void sign(secret, `app:${String(appPort)}:${challenge}`).then((expected) => { finish(sameProof(claimed, expected)) })
    }
  })
}

/**
 * Serve the app on its authenticated WebSocket until it closes.
 * @param socket - the socket.
 * @param early - the frames that arrived before the worker served it.
 */
function adopt(socket: WebSocket, early: unknown[]): void {
  if (socket.readyState !== WebSocket.OPEN) {
    retry()
    return
  }
  const link = { send: (message: unknown) => { socket.send(JSON.stringify(message)) } }
  app = link
  retryMs = 1000
  let listener: ((message: unknown) => void) | undefined
  socket.onmessage = (event) => { listener?.(readFrame(event.data)) }
  serve({ send: (message) => { socket.send(JSON.stringify(message)) }, listen: (received) => { listener = received } })
  for (const message of early) listener?.(message)
  keepalive = setInterval(() => { socket.send(JSON.stringify({ event: 'ping' })) }, KEEPALIVE_MS)
  socket.onclose = () => {
    if (app !== link) return
    app = undefined
    clearInterval(keepalive)
    // Web pages may still drive the tabs; with none, nothing does.
    if (pages.size === 0) detachAll()
    retry()
  }
  void info().then((about) => { if (app === link) link.send({ event: 'hello', ...about }) })
}

/**
 * Serve an older desktop app through the native messaging host it registered,
 * until the port disconnects; the worker then tries the WebSocket again first.
 */
function connectNative(): void {
  const port = chrome.runtime.connectNative(HOST)
  const link = { send: (message: unknown) => { port.postMessage(message) } }
  app = link
  serve(portConnection(port))
  port.onDisconnect.addListener(() => {
    // Reading the error marks Chrome's "host not found" as handled; a missing host is the expected case with a newer app.
    void chrome.runtime.lastError
    if (app !== link) return
    app = undefined
    // Web pages may still drive the tabs; with none, nothing does.
    if (pages.size === 0) detachAll()
    retry()
  })
  void info().then((about) => { if (app === link) link.send({ event: 'hello', ...about }) })
}

/** Try the app again after the backoff, which doubles up to `MAX_RETRY_MS`. */
function retry(): void {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, retryMs)
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
}

/** Connect to the app, trying each port in order and then an older app's native host, and retry with backoff. */
function connect(): void {
  if (app !== undefined || connecting) return
  connecting = true
  clearTimeout(retryTimer)
  void (async () => {
    const stored = (await chrome.storage.local.get(SECRET_KEY))[SECRET_KEY]
    const secret = typeof stored === 'string' ? stored : undefined
    for (const appPort of APP_PORTS) {
      const opened = await handshake(appPort, secret)
      if (opened !== undefined) return opened
    }
    return undefined
  })().then((opened) => {
    connecting = false
    if (opened !== undefined) {
      adopt(opened.socket, opened.early)
      return
    }
    if (retryNow) {
      retryNow = false
      connect()
      return
    }
    connectNative()
  })
}

/**
 * Answer one request from a connection.
 * @param connection - the asking connection's number.
 * @param id - the request id.
 * @param method - the request.
 * @param params - its parameters.
 */
async function answer(
  connection: number, id: number, method: string, params: Record<string, unknown>,
  reply: (message: { id: number; result?: unknown; error?: string }) => void,
): Promise<void> {
  try {
    await loading
    reply({ id, result: await handle(method, params, `${String(connection)}:${String(id)}`, connection) })
    retryMs = 1000
  } catch (error) {
    reply({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * One of the agent's tabs as an engine target, attaching the debugger on first use.
 * @param tabId - the tab.
 * @returns the target.
 */
async function target(tabId: number): Promise<ChromeTab> {
  const live = targets.get(tabId)
  if (live !== undefined && attached.has(tabId)) return live
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.add(tabId)
  }
  overlayScript ??= fetch(chrome.runtime.getURL('overlay-page.iife.js')).then(async response => await response.text())
  const script = await overlayScript
  const tab = await chrome.tabs.get(tabId)
  const created = new ChromeTab({
    send: async (method, params) => await chrome.debugger.sendCommand({ tabId }, method, params),
    subscribe: (listener) => {
      const forward = (source: chrome.debugger.Debuggee, method: string, params?: unknown): void => {
        if (source.tabId === tabId) listener(method, params)
      }
      chrome.debugger.onEvent.addListener(forward)
      return () => { chrome.debugger.onEvent.removeListener(forward) }
    },
    isOpen: () => attached.has(tabId),
  }, `ext:${String(tabId)}`, tab.url ?? '', tab.title ?? '', script)
  targets.set(tabId, created)
  await prepareTab(created, script)
  return created
}

/**
 * Forget a tab's debugger session, after it detached or the extension detached it.
 * @param tabId - the tab.
 */
function forget(tabId: number): void {
  clearTimeout(idleTimers.get(tabId))
  idleTimers.delete(tabId)
  attached.delete(tabId)
  targets.get(tabId)?.markDetached()
  targets.delete(tabId)
}

/**
 * Whether an operation runs on a tab.
 * @param tabId - the tab.
 * @returns true while one does.
 */
function busy(tabId: number): boolean {
  return [...running.values()].some(operation => operation.tabId === tabId)
}

/**
 * Detach the debugger from an agent tab, removing its indicator first unless a step waits for the person there.
 * A tab an operation started on meanwhile stays attached.
 * @param tabId - the tab.
 */
function release(tabId: number): void {
  const cleared = waiting.has(tabId) ? Promise.resolve() : drawIndicator(tabId, undefined)
  if (!waiting.has(tabId)) void unmarkWorking(tabId)
  void cleared.then(() => {
    if (!attached.has(tabId) || busy(tabId)) return
    forget(tabId)
    // The tab may have closed or detached since; either way it is no longer attached.
    void chrome.debugger.detach({ tabId }).catch(() => undefined)
  })
}

/**
 * Take the working mark off an agent tab's group once the agent stopped acting there; a waiting or finished mark stays.
 * @param tabId - the tab.
 */
async function unmarkWorking(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.groupId < 0) return
  const found = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
  if (found?.title === `${GROUP_MARKS.working}${GROUP_NAME}`) await markGroup(tabId, undefined)
}

/**
 * Detach the debugger from a tab once no operation runs on it, which removes Chrome's debugging bar.
 * @param tabId - the tab.
 */
function detachWhenIdle(tabId: number): void {
  clearTimeout(idleTimers.get(tabId))
  if (busy(tabId)) return
  idleTimers.set(tabId, setTimeout(() => {
    idleTimers.delete(tabId)
    if (!attached.has(tabId) || busy(tabId)) return
    release(tabId)
  }, IDLE_DETACH_MS))
}

/** Detach every agent tab: without a connection nothing drives them, so Chrome's debugging bar goes too. */
function detachAll(): void {
  for (const tabId of [...attached]) release(tabId)
}

/** What the indicator shows, before the worker adds the tab icon. */
interface IndicatorView {
  readonly tone: 'working' | 'input' | 'done'
  readonly text: string
}

/**
 * One of the extension's files, base64-encoded.
 * @param path - the file, relative to the extension's root.
 * @returns its bytes as base64.
 */
async function base64Of(path: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(path))).arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

/**
 * Show or remove the agent's indicator in an attached agent tab: the glow around
 * the page, the status tag, and the Æven tab icon (`indicator-page.ts`). A tab
 * without the debugger is left as it is, since drawing would attach it and bring
 * back Chrome's debugging bar.
 * @param tabId - the tab.
 * @param view - what to show; undefined removes the indicator.
 */
async function drawIndicator(tabId: number, view: IndicatorView | undefined): Promise<void> {
  if (!attached.has(tabId)) return
  indicatorScript ??= fetch(chrome.runtime.getURL('indicator-page.iife.js')).then(async response => await response.text())
  indicatorAssets ??= Promise.all([base64Of('google-sans-flex-latin-wght-normal.woff2'), base64Of('icons/icon-32.png')])
    .then(([font, icon]) => ({ font, icon: `data:image/png;base64,${icon}` }))
  const [script, assets] = await Promise.all([indicatorScript, indicatorAssets])
  const evaluate = async (expression: string): Promise<unknown> =>
    ((await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression, returnByValue: true })) as { result?: { value?: unknown } }).result?.value
  const paint = async (): Promise<void> => {
    if (await evaluate('window.__aevenIndicator?.hasFont() === true') !== true) {
      await evaluate(`if (!window.__aevenIndicator) { ${script} } window.__aevenIndicator.loadFont(${JSON.stringify(assets.font)}); true`)
    }
    await evaluate(view === undefined ? 'window.__aevenIndicator.clear(); true' : `window.__aevenIndicator.show(${JSON.stringify({ ...view, icon: assets.icon })}); true`)
  }
  await paint().catch(() => {
    // The tab closed or its debugger detached during the call; nothing is left to draw on.
  })
}

/**
 * Notify the person about an agent tab; clicking the notification brings the tab forward.
 * @param tabId - the tab.
 * @param title - what happened.
 * @param message - the detail, or empty for the tab's title.
 */
function notify(tabId: number, title: string, message: string): void {
  void chrome.tabs.get(tabId).then(async (tab) => {
    await chrome.notifications.create(`aeven-tab-${String(tabId)}`, {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title, message: message === '' ? tab.title ?? '' : message,
    })
  }).catch(() => {
    // The tab closed before the notification could name it.
  })
}

/**
 * Show that a step in an agent tab waits for the person, that the agent finished, or neither.
 * @param tabId - the tab.
 * @param input - `state` (`input`, `done`, or `clear`) and an optional `message` the agent wrote.
 * @throws {Error} when the state is none of those.
 */
async function attention(tabId: number, input: Record<string, unknown>): Promise<void> {
  const state = input.state
  if (state === 'clear') {
    waiting.delete(tabId)
    void markGroup(tabId, undefined)
    await drawIndicator(tabId, undefined)
    return
  }
  if (state !== 'input' && state !== 'done') throw new Error('indicate needs a state of input, done, or clear')
  const message = typeof input.message === 'string' ? input.message.slice(0, 300) : ''
  const copy = indicatorCopy()
  const title = state === 'input' ? copy.input : copy.done
  if (state === 'input') waiting.add(tabId)
  else waiting.delete(tabId)
  void markGroup(tabId, state)
  await drawIndicator(tabId, { tone: state, text: message === '' ? title : `${title} · ${message}` })
  notify(tabId, title, message)
}

/**
 * A tab the agent opened, refusing any other.
 * @param value - the tab id the app named.
 * @returns the tab id.
 */
function agentTab(value: unknown): number {
  if (typeof value !== 'number' || !agentTabs.has(value)) throw new Error('the agent can only use tabs it opened in the Aeven tab group')
  return value
}

/**
 * Put a tab into the window's Aeven tab group, creating the group collapsed.
 * @param tab - the tab.
 */
async function group(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return
  const existing = (await chrome.tabGroups.query({ windowId: tab.windowId })).find(found => isAgentGroup(found.title))
  const groupId = await chrome.tabs.group(existing === undefined ? { tabIds: tab.id } : { tabIds: tab.id, groupId: existing.id })
  // The group stays open, so the agent's tabs are in view rather than folded away.
  await chrome.tabGroups.update(groupId, existing === undefined ? { title: GROUP_NAME, color: 'grey', collapsed: false } : { collapsed: false })
}

/**
 * Whether a tab group is the agent's: its name, with or without a status mark, or `Aeven`, as earlier releases named it.
 * @param title - the group's title.
 * @returns true for the agent's group.
 */
function isAgentGroup(title: string | undefined): boolean {
  return title === GROUP_NAME || title === 'Aeven' || Object.values(GROUP_MARKS).some(mark => title === `${mark}${GROUP_NAME}`)
}

/**
 * Put a status mark before the name of the agent's group an agent tab is in.
 * @param tabId - the tab.
 * @param mark - the state to show; undefined shows the name alone.
 */
async function markGroup(tabId: number, mark: keyof typeof GROUP_MARKS | undefined): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.groupId < 0) return
  const found = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
  if (found === undefined || !isAgentGroup(found.title)) return
  const title = mark === undefined ? GROUP_NAME : `${GROUP_MARKS[mark]}${GROUP_NAME}`
  if (found.title !== title) await chrome.tabGroups.update(tab.groupId, { title }).catch(() => undefined)
}

/**
 * Perform one request.
 * @param method - the request.
 * @param params - its parameters.
 * @param key - the request's connection and id, under which an operation can be cancelled.
 * @param connection - the asking connection's number.
 * @returns the result.
 */
async function handle(method: string, params: Record<string, unknown>, key: string, connection: number): Promise<unknown> {
  switch (method) {
    case 'info':
      return await info()
    case 'operate': {
      const tabId = agentTab(params.tabId)
      if (typeof params.operation !== 'string') throw new Error('operate needs an operation')
      // The app's notice that a step waits for the person or the agent finished; it attaches nothing.
      if (params.operation === 'indicate') {
        await attention(tabId, (params.input as Record<string, unknown> | undefined) ?? {})
        return {}
      }
      const controller = new AbortController()
      clearTimeout(idleTimers.get(tabId))
      running.set(key, { controller, tabId })
      const copy = indicatorCopy()
      const view: IndicatorView = { tone: 'working', text: copy.working(copy.steps[params.operation] ?? copy.steps.default) }
      try {
        const tab = await target(tabId)
        waiting.delete(tabId)
        void markGroup(tabId, 'working')
        await drawIndicator(tabId, view)
        // This browser has no access to the computer's files, Downloads folder, or clipboard.
        return await automate(tab, params.operation, (params.input as BrowserAutomationInput | undefined) ?? {}, controller.signal, {})
      } finally {
        running.delete(key)
        // A navigation replaced the document the indicator was drawn in.
        void drawIndicator(tabId, view)
        detachWhenIdle(tabId)
      }
    }
    case 'operate.cancel': {
      running.get(`${String(connection)}:${String(params.requestId)}`)?.controller.abort(new Error('the agent cancelled the action'))
      return {}
    }
    case 'tabs.list': {
      const listed = []
      for (const tabId of agentTabs) {
        const tab = await chrome.tabs.get(tabId).catch(() => undefined)
        if (tab === undefined) {
          agentTabs.delete(tabId)
          continue
        }
        listed.push({ tabId, url: tab.url ?? '', title: tab.title ?? '' })
      }
      saveTabs()
      return listed
    }
    case 'tabs.create': {
      // The tab comes to the front so the user sees the agent work in it.
      const tab = await chrome.tabs.create({ url: typeof params.url === 'string' ? params.url : 'about:blank', active: true })
      if (tab.id === undefined) throw new Error('the browser did not open a tab')
      agentTabs.add(tab.id)
      saveTabs()
      await group(tab)
      return { tabId: tab.id }
    }
    case 'tabs.close': {
      const tabId = agentTab(params.tabId)
      await chrome.tabs.remove(tabId)
      return {}
    }
    case 'history.search': {
      const items = await chrome.history.search({
        text: typeof params.text === 'string' ? params.text : '', startTime: 0,
        maxResults: typeof params.maxResults === 'number' ? params.maxResults : 20,
      })
      return items.map(item => ({
        url: item.url ?? '', title: item.title ?? '', visits: item.visitCount ?? 0,
        visitedAt: item.lastVisitTime === undefined ? null : new Date(item.lastVisitTime).toISOString(),
      }))
    }
    case 'bookmarks.search': {
      const limit = typeof params.maxResults === 'number' ? params.maxResults : 20
      const query = typeof params.query === 'string' ? params.query : ''
      const nodes = query === '' ? await chrome.bookmarks.getRecent(limit) : (await chrome.bookmarks.search(query)).slice(0, limit)
      return nodes.filter(node => node.url !== undefined).map(node => ({
        url: node.url ?? '', title: node.title, addedAt: node.dateAdded === undefined ? null : new Date(node.dateAdded).toISOString(),
      }))
    }
    default:
      throw new Error(`unknown request ${method}`)
  }
}

chrome.notifications.onClicked.addListener((id) => {
  const tabId = Number(/^aeven-tab-(\d+)$/.exec(id)?.[1])
  if (!Number.isSafeInteger(tabId)) return
  void chrome.notifications.clear(id)
  void chrome.tabs.update(tabId, { active: true }).then(async (tab) => {
    if (tab !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
  }).catch(() => {
    // The tab closed after the notification was shown.
  })
})
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) forget(source.tabId)
})
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!agentTabs.has(tabId) || (change.url === undefined && change.title === undefined)) return
  targets.get(tabId)?.setInfo(tab.url ?? '', tab.title ?? '')
  post({ event: 'tabs.updated', tabId, url: tab.url ?? '', title: tab.title ?? '' })
})
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!agentTabs.delete(tabId)) return
  forget(tabId)
  saveTabs()
  post({ event: 'tabs.removed', tabId })
})

chrome.runtime.onConnectExternal.addListener((page) => {
  const origin = page.sender?.origin ?? ''
  // Localhost serves any local program's pages, so only a development install trusts it.
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const admitted = AEVEN_ORIGIN.test(origin) ? Promise.resolve(true)
    : local ? chrome.management.getSelf().then(self => self.installType === 'development', () => false)
      : Promise.resolve(false)
  serve(portConnection(page), admitted)
  page.onDisconnect.addListener(() => {
    pages.delete(page)
    if (app === undefined && pages.size === 0) detachAll()
  })
  void admitted.then(async (allowed) => {
    if (!allowed) {
      page.disconnect()
      return
    }
    pages.add(page)
    page.postMessage({ event: 'hello', ...await info() })
  })
})
// The page the app opens wakes this worker and may carry the pairing secret; the worker
// keeps the secret, connects, and closes the page and its history entry.
chrome.runtime.onMessage.addListener((message, sender) => {
  const wake = message as { wake?: unknown; secret?: unknown }
  if (wake.wake !== true) return
  const secret = typeof wake.secret === 'string' && /^[\da-f]{64}$/.test(wake.secret) ? wake.secret : undefined
  void (secret === undefined ? Promise.resolve() : chrome.storage.local.set({ [SECRET_KEY]: secret })).then(() => {
    retryMs = 1000
    if (connecting) retryNow = true
    else connect()
  })
  if (sender.tab?.id !== undefined) void chrome.tabs.remove(sender.tab.id).catch(() => undefined)
  // The page may not be in the history at all; either way its entry, with the secret, is gone.
  if (sender.url !== undefined) void chrome.history.deleteUrl({ url: sender.url }).catch(() => undefined)
})

// The worker can be stopped while the app is closed; the alarm and the browser's
// start wake it to try the app again.
chrome.alarms.create('aeven-connect', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(() => { connect() })
chrome.runtime.onStartup.addListener(() => { connect() })
chrome.runtime.onInstalled.addListener(() => { connect() })
connect()
