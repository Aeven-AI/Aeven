/**
 * The Aeven extension's service worker: it connects to the Aeven desktop app
 * through the app's native messaging host and serves the agent's requests on the
 * browser it runs in.
 *
 * The agent works only in tabs it opened, kept in an "Aeven" tab group and
 * brought to the front so the user watches it work; it attaches
 * `chrome.debugger` to those tabs alone, and only while it acts: Chrome shows its
 * "started debugging this browser" bar while a debugger is attached, so a tab is
 * detached once the agent has left it idle for `IDLE_DETACH_MS`. History
 * and bookmarks are read on request; the app asks the user before it requests them.
 * Two kinds of connection carry the same messages: the desktop app's native
 * host, and an Aeven web page (`externally_connectable`), which is how hosted
 * Aeven reaches this browser; localhost pages may connect only to an unpacked
 * development install. Messages are `{ id, method, params }` requests answered on
 * the asking connection with `{ id, result }` or `{ id, error }`, and
 * `{ event, ... }` notifications sent to every connection.
 */

import { automate, ChromeTab, prepareTab, type BrowserAutomationInput } from '@aeven/browser-engine'

/** The native messaging host the Aeven desktop app registers. */
const HOST = 'io.aeven.browser'
/** The request and event set this extension speaks; the app refuses an older one. */
const PROTOCOL = 3
/** Title of the tab group the agent's tabs live in. */
const GROUP_TITLE = 'Aeven'
/** Session-storage key of the agent's tab ids, which survive the worker restarting. */
const TABS_KEY = 'agentTabs'
/** Local-storage key of this install's id, which tells the app's connections from different browsers apart. */
const INSTANCE_KEY = 'instance'
/** Origins of Aeven's own web pages, which may connect in any install. */
const AEVEN_ORIGIN = /^https:\/\/([a-z\d-]+\.)*aeven\.io$/
/** Longest wait before reconnecting to the app, in ms. */
const MAX_RETRY_MS = 60_000
/** How long an agent tab stays attached after its last operation, in ms; a task's steps follow within it. */
const IDLE_DETACH_MS = 10_000

let port: chrome.runtime.Port | undefined
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
const loading = chrome.storage.session.get(TABS_KEY).then((stored) => {
  for (const id of (stored[TABS_KEY] as number[] | undefined) ?? []) agentTabs.add(id)
})
/** This install's id, made once and kept. */
const instance = chrome.storage.local.get(INSTANCE_KEY).then(async (stored) => {
  const kept = stored[INSTANCE_KEY]
  if (typeof kept === 'string') return kept
  const made = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  await chrome.storage.local.set({ [INSTANCE_KEY]: made })
  return made
})

/** Persist the agent's tab ids. */
function saveTabs(): void {
  void chrome.storage.session.set({ [TABS_KEY]: [...agentTabs] })
}

/** Send one notification to every connection. */
function post(message: unknown): void {
  port?.postMessage(message)
  for (const page of pages) page.postMessage(message)
}

/** What this install says about itself on connecting and when asked. */
async function info(): Promise<{ instance: string; browser: string; version: string; protocol: number }> {
  return { instance: await instance, browser: browserName(), version: chrome.runtime.getManifest().version, protocol: PROTOCOL }
}

/**
 * Serve one connection's requests, which must be listened for as soon as it opens.
 * @param connection - the native host's or a web page's port.
 * @param admitted - settles true once the connection may be served; false leaves its requests unanswered.
 */
function serve(connection: chrome.runtime.Port, admitted: Promise<boolean> = Promise.resolve(true)): void {
  const serial = nextConnection++
  connection.onMessage.addListener((message: { id?: number; method?: string; params?: Record<string, unknown>; event?: string }) => {
    if (message.event === 'unavailable') return
    const { id, method } = message
    if (typeof id !== 'number' || typeof method !== 'string') return
    void admitted.then((allowed) => {
      if (allowed) void answer(serial, id, method, message.params ?? {}, (reply) => { connection.postMessage(reply) })
    })
  })
}

/** The browser this extension runs in, as the app names it to the user. */
function browserName(): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } }).userAgentData?.brands.map(brand => brand.brand) ?? []
  return ['Microsoft Edge', 'Brave', 'Opera', 'Vivaldi', 'Google Chrome', 'Chromium'].find(name => brands.includes(name)) ?? 'Chromium'
}

/** Connect to the app's host, retrying with backoff while the app is not running. */
function connect(): void {
  if (port !== undefined) return
  clearTimeout(retryTimer)
  const opened = chrome.runtime.connectNative(HOST)
  port = opened
  serve(opened)
  opened.onDisconnect.addListener(() => {
    if (port !== opened) return
    port = undefined
    // Web pages may still drive the tabs; with none, nothing does.
    if (pages.size === 0) detachAll()
    retryTimer = setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  })
  void info().then((about) => { if (port === opened) opened.postMessage({ event: 'hello', ...about }) })
}

/**
 * Answer one request from a connection.
 * @param connection - the asking connection's number.
 * @param id - the request id.
 * @param method - the request.
 * @param params - its parameters.
 */
async function answer(connection: number, id: number, method: string, params: Record<string, unknown>, reply: (message: { id: number; result?: unknown; error?: string }) => void): Promise<void> {
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
      const forward = (source: chrome.debugger.Debuggee, method: string, params?: unknown): void => { if (source.tabId === tabId) listener(method, params) }
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
 * Detach the debugger from a tab once no operation runs on it, which removes Chrome's debugging bar.
 * @param tabId - the tab.
 */
function detachWhenIdle(tabId: number): void {
  clearTimeout(idleTimers.get(tabId))
  if ([...running.values()].some(operation => operation.tabId === tabId)) return
  idleTimers.set(tabId, setTimeout(() => {
    idleTimers.delete(tabId)
    if (!attached.has(tabId) || [...running.values()].some(operation => operation.tabId === tabId)) return
    forget(tabId)
    // The tab may have closed or detached since; either way it is no longer attached.
    void chrome.debugger.detach({ tabId }).catch(() => undefined)
  }, IDLE_DETACH_MS))
}

/** Detach every agent tab: without a connection nothing drives them, so Chrome's debugging bar goes too. */
function detachAll(): void {
  for (const tabId of [...attached]) {
    forget(tabId)
    // The tab may have closed or detached since; either way it is no longer attached.
    void chrome.debugger.detach({ tabId }).catch(() => undefined)
  }
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
  const [existing] = await chrome.tabGroups.query({ title: GROUP_TITLE, windowId: tab.windowId })
  const groupId = await chrome.tabs.group(existing === undefined ? { tabIds: tab.id } : { tabIds: tab.id, groupId: existing.id })
  // The group stays open, so the agent's tabs are in view rather than folded away.
  await chrome.tabGroups.update(groupId, existing === undefined ? { title: GROUP_TITLE, color: 'grey', collapsed: false } : { collapsed: false })
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
      const controller = new AbortController()
      clearTimeout(idleTimers.get(tabId))
      running.set(key, { controller, tabId })
      try {
        const tab = await target(tabId)
        // This browser has no access to the computer's files, Downloads folder, or clipboard.
        return await automate(tab, params.operation, (params.input as BrowserAutomationInput | undefined) ?? {}, controller.signal, {})
      } finally {
        running.delete(key)
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
  serve(page, admitted)
  page.onDisconnect.addListener(() => {
    pages.delete(page)
    if (port === undefined && pages.size === 0) detachAll()
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
// The page the app opens when it starts the browser wakes this worker; it connects and closes that page.
chrome.runtime.onMessage.addListener((message: { wake?: boolean }, sender) => {
  if (message.wake !== true) return
  retryMs = 1000
  connect()
  if (sender.tab?.id !== undefined) void chrome.tabs.remove(sender.tab.id).catch(() => undefined)
})

// The worker can be stopped while the app is closed; the alarm and the browser's
// start wake it to try the app again.
chrome.alarms.create('aeven-connect', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(() => { connect() })
chrome.runtime.onStartup.addListener(() => { connect() })
chrome.runtime.onInstalled.addListener(() => { connect() })
connect()
