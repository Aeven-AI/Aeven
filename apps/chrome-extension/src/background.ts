/**
 * The Aeven extension's service worker: it connects to the Aeven desktop app
 * through the app's native messaging host and serves the agent's requests on the
 * browser it runs in.
 *
 * The agent works only in tabs it opened, kept in a collapsed "Aeven" tab group
 * in the background; it attaches `chrome.debugger` to those tabs alone. History
 * and bookmarks are read on request; the app asks the user before it requests them.
 * Messages are `{ id, method, params }` requests answered with `{ id, result }`
 * or `{ id, error }`, and `{ event, ... }` notifications.
 */

/** The native messaging host the Aeven desktop app registers. */
const HOST = 'io.aeven.browser'
/** Title of the tab group the agent's tabs live in. */
const GROUP_TITLE = 'Aeven'
/** Session-storage key of the agent's tab ids, which survive the worker restarting. */
const TABS_KEY = 'agentTabs'
/** Longest wait before reconnecting to the app, in ms. */
const MAX_RETRY_MS = 60_000

let port: chrome.runtime.Port | undefined
let retryMs = 1000
let retryTimer: ReturnType<typeof setTimeout> | undefined
const agentTabs = new Set<number>()
const attached = new Set<number>()
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
    if (typeof message.id === 'number' && typeof message.method === 'string') void answer(message.id, message.method, message.params ?? {})
  })
  opened.onDisconnect.addListener(() => {
    if (port !== opened) return
    port = undefined
    attached.clear()
    retryTimer = setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  })
  post({ event: 'hello', browser: browserName(), version: chrome.runtime.getManifest().version })
}

/**
 * Answer one request from the app.
 * @param id - the request id.
 * @param method - the request.
 * @param params - its parameters.
 */
async function answer(id: number, method: string, params: Record<string, unknown>): Promise<void> {
  try {
    await loading
    post({ id, result: await handle(method, params) })
    retryMs = 1000
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) })
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
  if (existing === undefined) await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'grey', collapsed: true })
}

/**
 * Perform one request.
 * @param method - the request.
 * @param params - its parameters.
 * @returns the result.
 */
async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
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
      const tab = await chrome.tabs.create({ url: typeof params.url === 'string' ? params.url : 'about:blank', active: false })
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
    case 'debugger.attach': {
      const tabId = agentTab(params.tabId)
      if (!attached.has(tabId)) {
        await chrome.debugger.attach({ tabId }, '1.3')
        attached.add(tabId)
      }
      const tab = await chrome.tabs.get(tabId)
      return { url: tab.url ?? '', title: tab.title ?? '' }
    }
    case 'debugger.send': {
      const tabId = agentTab(params.tabId)
      if (typeof params.method !== 'string') throw new Error('debugger.send needs a method')
      return await chrome.debugger.sendCommand({ tabId }, params.method, (params.params as object | undefined) ?? {})
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

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== undefined && attached.has(source.tabId)) post({ event: 'debugger.event', tabId: source.tabId, method, params })
})
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined) return
  attached.delete(source.tabId)
  post({ event: 'debugger.detach', tabId: source.tabId })
})
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (agentTabs.has(tabId) && (change.url !== undefined || change.title !== undefined)) post({ event: 'tabs.updated', tabId, url: tab.url ?? '', title: tab.title ?? '' })
})
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!agentTabs.delete(tabId)) return
  attached.delete(tabId)
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
