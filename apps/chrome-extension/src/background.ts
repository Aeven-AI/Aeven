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
 * Messages are `{ id, method, params }` requests answered with `{ id, result }`
 * or `{ id, error }`, and `{ event, ... }` notifications.
 */

import { automate, ChromeTab, prepareTab, type BrowserAutomationInput } from '@aeven/browser-engine'

/** The native messaging host the Aeven desktop app registers. */
const HOST = 'io.aeven.browser'
/** The request and event set this extension speaks; the app refuses an older one. */
const PROTOCOL = 2
/** Title of the tab group the agent's tabs live in. */
const GROUP_TITLE = 'Aeven'
/** Session-storage key of the agent's tab ids, which survive the worker restarting. */
const TABS_KEY = 'agentTabs'
/** Longest wait before reconnecting to the app, in ms. */
const MAX_RETRY_MS = 60_000
/** How long an agent tab stays attached after its last operation, in ms; a task's steps follow within it. */
const IDLE_DETACH_MS = 10_000

let port: chrome.runtime.Port | undefined
let retryMs = 1000
let retryTimer: ReturnType<typeof setTimeout> | undefined
const agentTabs = new Set<number>()
const attached = new Set<number>()
/** Engine targets of the agent's tabs, attached on their first operation. */
const targets = new Map<number, ChromeTab>()
/** Operations in flight, by request id, so the app can cancel one. */
const running = new Map<number, { controller: AbortController; tabId: number }>()
/** Pending detaches of idle agent tabs. */
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()
/** The agent pointer as a page script, bundled beside this worker. */
let overlayScript: Promise<string> | undefined
const loading = chrome.storage.session.get(TABS_KEY).then((stored) => {
  for (const id of (stored[TABS_KEY] as number[] | undefined) ?? []) agentTabs.add(id)
})

/** Persist the agent's tab ids. */
function saveTabs(): void {
  void chrome.storage.session.set({ [TABS_KEY]: [...agentTabs] })
}

/** Send one message to the app, when connected. */
function post(message: unknown): void {
  port?.postMessage(message)
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
  opened.onMessage.addListener((message: { id?: number; method?: string; params?: Record<string, unknown>; event?: string }) => {
    if (message.event === 'unavailable') return
    if (typeof message.id === 'number' && typeof message.method === 'string') void answer(message.id, message.method, message.params ?? {}, post)
  })
  opened.onDisconnect.addListener(() => {
    if (port !== opened) return
    port = undefined
    // Without the app nothing drives the tabs, so the debugger and Chrome's bar go too.
    for (const tabId of [...attached]) {
      forget(tabId)
      void chrome.debugger.detach({ tabId }).catch(() => undefined)
    }
    retryTimer = setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  })
  post({ event: 'hello', browser: browserName(), version: chrome.runtime.getManifest().version, protocol: PROTOCOL })
}

/**
 * Answer one request from the app.
 * @param id - the request id.
 * @param method - the request.
 * @param params - its parameters.
 */
async function answer(id: number, method: string, params: Record<string, unknown>, reply: (message: unknown) => void): Promise<void> {
  try {
    await loading
    reply({ id, result: await handle(method, params, id) })
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
 * @returns the result.
 */
async function handle(method: string, params: Record<string, unknown>, id: number): Promise<unknown> {
  switch (method) {
    case 'info':
      return { protocol: PROTOCOL, browser: browserName(), version: chrome.runtime.getManifest().version }
    case 'operate': {
      const tabId = agentTab(params.tabId)
      if (typeof params.operation !== 'string') throw new Error('operate needs an operation')
      const controller = new AbortController()
      clearTimeout(idleTimers.get(tabId))
      running.set(id, { controller, tabId })
      try {
        const tab = await target(tabId)
        // This browser has no access to the computer's files, Downloads folder, or clipboard.
        return await automate(tab, params.operation, (params.input as BrowserAutomationInput | undefined) ?? {}, controller.signal, {})
      } finally {
        running.delete(id)
        detachWhenIdle(tabId)
      }
    }
    case 'operate.cancel': {
      running.get(params.requestId as number)?.controller.abort(new Error('the agent cancelled the action'))
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

// The worker can be stopped while the app is closed; the alarm and the browser's
// start wake it to try the app again.
chrome.alarms.create('aeven-connect', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(() => { connect() })
chrome.runtime.onStartup.addListener(() => { connect() })
chrome.runtime.onInstalled.addListener(() => { connect() })
connect()
