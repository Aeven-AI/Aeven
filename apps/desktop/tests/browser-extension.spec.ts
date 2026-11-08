// The extension registry over a real local socket: each browser's extension
// connects through its native host, says which install it is, and the app keeps
// one connection per install, side by side across browsers.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTENSION_ID, ExtensionLinks, hasExtension, serveExtensions } from '../src/browser-extension.ts'

interface FakeInfo { instance?: string; browser: string; protocol: number }

let folder: string
let socketPath: string
let registry: ExtensionLinks
let stop: () => void
const clients: Socket[] = []

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'avn-ext-'))
  socketPath = join(folder, 'ext.sock')
  registry = new ExtensionLinks()
  stop = await serveExtensions(socketPath, registry)
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy()
  stop()
  await rm(folder, { recursive: true, force: true })
})

/**
 * Connect as an extension's native host would.
 * @param info - what the extension reports about itself.
 * @param options - whether it answers `info`, sends a hello, and what it answers other requests with.
 * @returns the host-side socket.
 */
async function fakeExtension(
  info: FakeInfo, options: { answerInfo?: boolean; hello?: boolean; answers?: Record<string, unknown> } = {},
): Promise<Socket> {
  const socket = connect(socketPath)
  clients.push(socket)
  await new Promise<void>((resolve) => { socket.once('connect', resolve) })
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk: string) => {
    buffer += chunk
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, newline)) as { id: number; method: string }
      buffer = buffer.slice(newline + 1)
      if (message.method === 'info') {
        if (options.answerInfo !== false) socket.write(`${JSON.stringify({ id: message.id, result: info })}\n`)
      } else if (options.answers !== undefined && message.method in options.answers) {
        socket.write(`${JSON.stringify({ id: message.id, result: options.answers[message.method] })}\n`)
      }
    }
  })
  if (options.hello === true) socket.write(`${JSON.stringify({ event: 'hello', ...info })}\n`)
  return socket
}

/** The registered installs and their browsers. */
function registered(): Array<[string | undefined, string | undefined]> {
  return registry.list().map(link => [link.info?.instance, link.info?.browser])
}

describe('extension connections', () => {
  it('registers a connection once the extension says which install it is', async () => {
    await fakeExtension({ instance: 'chrome1', browser: 'Google Chrome', protocol: 3 })
    expect(await registry.whenConnected(2000)).toBe(true)
    expect(registered()).toEqual([['chrome1', 'Google Chrome']])
    expect(registry.get('chrome1')?.info?.protocol).toBe(3)
  })

  it('registers from the hello alone when the extension does not answer info', async () => {
    await fakeExtension({ instance: 'brave1', browser: 'Brave', protocol: 3 }, { answerInfo: false, hello: true })
    await vi.waitFor(() => { expect(registered()).toEqual([['brave1', 'Brave']]) })
  })

  it('keeps different browsers side by side and picks among them by name', async () => {
    await fakeExtension({ instance: 'chrome1', browser: 'Google Chrome', protocol: 3 })
    await vi.waitFor(() => { expect(registry.list()).toHaveLength(1) })
    await fakeExtension({ instance: 'brave1', browser: 'Brave', protocol: 3 })
    await vi.waitFor(() => { expect(registry.list()).toHaveLength(2) })
    expect(registry.pick('')?.info?.instance).toBe('brave1')
    expect(registry.pick('google chrome')?.info?.instance).toBe('chrome1')
    expect(registry.pick('chrome')?.info?.instance).toBe('chrome1')
    expect(registry.pick('brave1')?.info?.browser).toBe('Brave')
    expect(registry.pick('Edge')).toBeUndefined()
  })

  it('replaces an install that connects again and closes its earlier connection', async () => {
    const first = await fakeExtension({ instance: 'chrome1', browser: 'Google Chrome', protocol: 2 })
    await vi.waitFor(() => { expect(registry.get('chrome1')?.info?.protocol).toBe(2) })
    const closed = new Promise<void>((resolve) => { first.once('close', () => { resolve() }) })
    await fakeExtension({ instance: 'chrome1', browser: 'Google Chrome', protocol: 3 })
    await closed
    await vi.waitFor(() => { expect(registry.get('chrome1')?.info?.protocol).toBe(3) })
    expect(registry.list()).toHaveLength(1)
  })

  it('treats an extension that names no install as the one install of its browser', async () => {
    await fakeExtension({ browser: 'Microsoft Edge', protocol: 2 })
    await vi.waitFor(() => { expect(registered()).toEqual([['default', 'Microsoft Edge']]) })
  })

  it('drops an install when its connection closes, failing what is pending', async () => {
    const socket = await fakeExtension({ instance: 'chrome1', browser: 'Google Chrome', protocol: 3 })
    await vi.waitFor(() => { expect(registry.list()).toHaveLength(1) })
    const link = registry.get('chrome1')
    const pending = link?.request('tabs.list')
    socket.destroy()
    await expect(pending).rejects.toThrow('the Aeven extension disconnected')
    await vi.waitFor(() => { expect(registry.list()).toEqual([]) })
  })

  it('answers requests through the install that was asked', async () => {
    await fakeExtension({ instance: 'chrome1', browser: 'Google Chrome', protocol: 3 }, { answers: { 'tabs.list': [{ tabId: 7, url: 'https://a.test/', title: 'A' }] } })
    await fakeExtension({ instance: 'brave1', browser: 'Brave', protocol: 3 }, { answers: { 'tabs.list': [] } })
    await vi.waitFor(() => { expect(registry.list()).toHaveLength(2) })
    expect(await registry.get('chrome1')?.request('tabs.list')).toEqual([{ tabId: 7, url: 'https://a.test/', title: 'A' }])
    expect(await registry.get('brave1')?.request('tabs.list')).toEqual([])
  })

  it('reports no connection when none arrives in time', async () => {
    expect(await registry.whenConnected(50)).toBe(false)
  })
})

describe('finding the browser that has the extension', () => {
  it('finds a store install by its extension folder', async () => {
    await mkdir(join(folder, 'data', 'Default', 'Extensions', EXTENSION_ID), { recursive: true })
    expect(await hasExtension(join(folder, 'data'), EXTENSION_ID)).toBe(true)
  })

  it('finds an unpacked install named in a profile preferences file', async () => {
    await mkdir(join(folder, 'data', 'Profile 2'), { recursive: true })
    await writeFile(join(folder, 'data', 'Profile 2', 'Secure Preferences'), JSON.stringify({ extensions: { settings: { [EXTENSION_ID]: { path: '/x' } } } }))
    expect(await hasExtension(join(folder, 'data'), EXTENSION_ID)).toBe(true)
  })

  it('finds nothing in profiles without it, or a browser that is not installed', async () => {
    await mkdir(join(folder, 'data', 'Default', 'Extensions', 'otherextensionid'), { recursive: true })
    await writeFile(join(folder, 'data', 'Default', 'Preferences'), '{}')
    expect(await hasExtension(join(folder, 'data'), EXTENSION_ID)).toBe(false)
    expect(await hasExtension(join(folder, 'missing'), EXTENSION_ID)).toBe(false)
  })
})
