// The extension registry over a real loopback WebSocket: each browser's extension
// proves the pairing secret, says which install it is, and the app keeps one
// connection per install, side by side across browsers. A connection that cannot
// prove the secret, or comes from another origin, is refused.

import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { EXTENSION_IDS, ExtensionLinks, hasExtension, pairingProof, serveExtensions } from '../src/browser-extension.ts'

const [EXTENSION_ID] = EXTENSION_IDS
const SECRET = randomBytes(32).toString('hex')

interface FakeInfo { instance?: string; browser: string; protocol: number }

let folder: string
let port: number
let registry: ExtensionLinks
let stop: () => void
let unpaired: Array<[string, string]>
const clients: WebSocket[] = []

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'avn-ext-'))
  registry = new ExtensionLinks()
  unpaired = []
  const onUnpaired = (id: string, browser: string): void => { unpaired.push([id, browser]) }
  ;({ port, stop } = await serveExtensions(registry, { ports: [0], secret: SECRET, onUnpaired }))
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate()
  stop()
  await rm(folder, { recursive: true, force: true })
})

/**
 * Open a WebSocket to the server and run the extension's side of the pairing exchange.
 * @param options - the origin it connects with and the secret it proves; a missing secret sends no proof.
 * @returns the socket, whether the server proved the secret back (false when it refused), and the frames that
 * followed the proof, which the app sends at once.
 */
async function pair(
  options: { origin?: string; secret?: string | undefined } = {},
): Promise<{ socket: WebSocket; authed: boolean; early: Buffer[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/`, { origin: options.origin ?? `chrome-extension://${EXTENSION_ID}` })
  clients.push(socket)
  const challenge = randomBytes(16).toString('hex')
  const secret = 'secret' in options ? options.secret : SECRET
  const early: Buffer[] = []
  let proven = false
  const authed = await new Promise<boolean>((resolve) => {
    socket.on('error', () => { resolve(false) })
    socket.on('close', () => { resolve(false) })
    socket.on('message', (data: Buffer) => {
      if (proven) {
        early.push(data)
        return
      }
      const message = JSON.parse(String(data)) as { event?: string; nonce?: string; proof?: string }
      if (message.event === 'challenge' && message.nonce !== undefined) {
        const proof = secret === undefined ? undefined : pairingProof(secret, 'extension', port, message.nonce)
        socket.send(JSON.stringify({ event: 'auth', nonce: challenge, browser: 'Google Chrome', proof }))
      } else if (message.event === 'authed') {
        proven = message.proof === pairingProof(SECRET, 'app', port, challenge)
        resolve(proven)
      }
    })
  })
  socket.removeAllListeners('message')
  return { socket, authed, early }
}

/**
 * Connect as a paired extension would.
 * @param info - what the extension reports about itself.
 * @param options - whether it answers `info`, sends a hello, and what it answers other requests with.
 * @returns the extension's socket.
 */
async function fakeExtension(
  info: FakeInfo, options: { answerInfo?: boolean; hello?: boolean; answers?: Record<string, unknown> } = {},
): Promise<WebSocket> {
  const { socket, authed, early } = await pair()
  expect(authed).toBe(true)
  const receive = (data: Buffer): void => {
    const message = JSON.parse(String(data)) as { id: number; method: string }
    if (message.method === 'info') {
      if (options.answerInfo !== false) socket.send(JSON.stringify({ id: message.id, result: info }))
    } else if (options.answers !== undefined && message.method in options.answers) {
      socket.send(JSON.stringify({ id: message.id, result: options.answers[message.method] }))
    }
  }
  for (const data of early) receive(data)
  socket.on('message', receive)
  if (options.hello === true) socket.send(JSON.stringify({ event: 'hello', ...info }))
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
    socket.terminate()
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

  it('refuses an extension without the secret or with another one, and reports it for pairing', async () => {
    expect((await pair({ secret: undefined })).authed).toBe(false)
    expect((await pair({ secret: randomBytes(32).toString('hex') })).authed).toBe(false)
    expect(registry.list()).toEqual([])
    expect(unpaired).toEqual([[EXTENSION_ID, 'Google Chrome'], [EXTENSION_ID, 'Google Chrome']])
  })

  it('refuses a connection from any other origin before the exchange', async () => {
    expect((await pair({ origin: 'https://example.test' })).authed).toBe(false)
    expect(unpaired).toEqual([])
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
