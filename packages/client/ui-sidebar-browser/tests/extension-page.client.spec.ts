// The web page's link to the Aeven extension, which is how hosted Aeven reaches
// the reader's browser: tab ids carry the install, other Chromes are refused, and
// a cancelled operation is cancelled in the extension by its request id.

import { describe, expect, it } from 'vitest'
import { PageExtensionLink, pageExtensionBridge, type ExtensionPort } from '../src/client/extension-page.ts'
import type { DesktopBrowserRequestId } from '../src/client/guest.ts'

/** A port to a fake extension: answers by method, and records what the page sent. */
/** A request as the page sent it. */
interface SentRequest { id: number; method: string; params: Record<string, unknown> }

function fakePort(answer: (method: string, params: Record<string, unknown>) => unknown, options: { hold?: string[] } = {}) {
  const sent: SentRequest[] = []
  const messageListeners: Array<(message: unknown) => void> = []
  const disconnectListeners: Array<() => void> = []
  const port: ExtensionPort = {
    postMessage(message) {
      const request = message as SentRequest
      sent.push(request)
      if (options.hold?.includes(request.method) === true) return
      queueMicrotask(() => {
        const result = answer(request.method, request.params)
        const reply = result instanceof Error ? { id: request.id, error: result.message } : { id: request.id, result }
        for (const listener of messageListeners) listener(reply)
      })
    },
    disconnect() {},
    onMessage: { addListener(callback) { messageListeners.push(callback) } },
    onDisconnect: { addListener(callback) { disconnectListeners.push(callback) } },
  }
  return { port, sent, disconnect: () => { for (const listener of disconnectListeners) listener() } }
}

const INFO = { instance: 'abc123', browser: 'Brave', version: '1', protocol: 3 }

describe('the page link to the extension', () => {
  it('names tabs by install and tab, and lists them with their browser', async () => {
    const fake = fakePort(method => method === 'info' ? INFO
      : method === 'tabs.create' ? { tabId: 41 }
        : method === 'tabs.list' ? [{ tabId: 41, url: 'https://a.test/', title: 'A' }]
          : {})
    const bridge = pageExtensionBridge(new PageExtensionLink(() => fake.port))
    expect(await bridge.chromeOpen('extension', undefined, 'a.test')).toBe('abc123.41')
    expect(fake.sent.find(request => request.method === 'tabs.create')?.params).toEqual({ url: 'https://a.test' })
    expect(await bridge.chromeTabs('extension')).toEqual([{ targetId: 'abc123.41', url: 'https://a.test/', title: 'A', browser: 'Brave' }])
    await bridge.chromeClose('extension', undefined, 'abc123.41')
    expect(fake.sent.at(-1)).toMatchObject({ method: 'tabs.close', params: { tabId: 41 } })
  })

  it('refuses every Chrome but the extension, and tabs of another install', async () => {
    const fake = fakePort(method => method === 'info' ? INFO : {})
    const bridge = pageExtensionBridge(new PageExtensionLink(() => fake.port))
    await expect(bridge.chromeOpen('aeven', undefined, '')).rejects.toThrow('only through the Aeven extension')
    await expect(bridge.chromeAutomate('extension', undefined, 'other.41', 'read', {})).rejects.toThrow('a browser this page cannot reach')
    expect(fake.sent.some(request => request.method === 'operate')).toBe(false)
  })

  it('says the extension is not installed when the page cannot connect', async () => {
    const bridge = pageExtensionBridge(new PageExtensionLink(() => undefined))
    await expect(bridge.chromeTabs('extension')).rejects.toThrow('not installed in this browser')
    expect(await bridge.extensionStatus()).toEqual([])
  })

  it('cancels a running operation in the extension by its request id', async () => {
    const fake = fakePort(method => method === 'info' ? INFO : {}, { hold: ['operate'] })
    const bridge = pageExtensionBridge(new PageExtensionLink(() => fake.port))
    const requestId = 'r1' as DesktopBrowserRequestId
    const running = bridge.chromeAutomate('extension', undefined, 'abc123.41', 'click', { selector: 'a' }, requestId, 1000)
    await new Promise(resolve => setTimeout(resolve, 0))
    const operate = fake.sent.find(request => request.method === 'operate')
    expect(operate?.params).toEqual({ tabId: 41, operation: 'click', input: { selector: 'a' } })
    bridge.cancelAutomation('abc123.41', requestId)
    expect(fake.sent.at(-1)).toMatchObject({ method: 'operate.cancel', params: { requestId: operate?.id } })
    fake.disconnect()
    await expect(running).rejects.toThrow('the Aeven extension disconnected')
  })

  it('tags history entries with the browser they came from', async () => {
    const fake = fakePort(method => method === 'info' ? INFO : [{ url: 'https://a.test/', title: 'A' }])
    const bridge = pageExtensionBridge(new PageExtensionLink(() => fake.port))
    expect(await bridge.extensionRead('history', 'a', 5)).toEqual([{ url: 'https://a.test/', title: 'A', browser: 'Brave' }])
    expect(fake.sent.at(-1)).toMatchObject({ method: 'history.search', params: { text: 'a', maxResults: 5 } })
    expect(await bridge.extensionStatus()).toEqual([{ instance: 'abc123', browser: 'Brave' }])
  })
})
