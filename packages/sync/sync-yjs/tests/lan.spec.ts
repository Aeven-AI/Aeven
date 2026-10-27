/**
 * Local-network links: devices of one account that discover each other link only after both proved an active
 * device key, deliver frames to each other, settle a double link to one, link again after a dropped link, drop
 * a device the chain no longer holds, and refuse anything that does not follow the handshake. mDNS discovery
 * reports only devices of the same account.
 */
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { generateDeviceKeys, signBytes, verifyBytes, type DeviceKeys } from '@aeven/sync-vault'
import { LanTransport, MdnsDiscovery, type LanDiscovery, type LanPeer, type LanSelf, type LanTuning } from '../src/lan.ts'

const bonjour = vi.hoisted(() => ({ instances: [] as unknown[] }))
vi.mock('bonjour-service', () => ({
  Bonjour: class {
    readonly published: unknown[] = []
    readonly browser = Object.assign(new EventEmitter(), { stop: vi.fn() })
    onup: ((service: unknown) => void) | undefined
    readonly unpublishAll = vi.fn()
    readonly destroy = vi.fn()
    constructor() { bonjour.instances.push(this) }
    publish(config: unknown) { this.published.push(config) }
    find(_config: unknown, onup: (service: unknown) => void) {
      this.onup = onup
      return this.browser
    }
  },
}))

const TAG = 'account-tag'
const tuning: LanTuning = { port: 0, handshakeMs: 500, retryMs: 50, maxBytes: 65_536 }
const transports: LanTransport[] = []
afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.close()
  bonjour.instances.length = 0
})

/** The devices of one account; a device leaves the chain with `remove`. */
class Account {
  readonly keys = new Map<string, DeviceKeys>()
  readonly active = new Set<string>()

  device(): DeviceKeys {
    const keys = generateDeviceKeys()
    this.keys.set(keys.id, keys)
    this.active.add(keys.id)
    return keys
  }

  vault(keys: DeviceKeys, received: Uint8Array[] = []) {
    return {
      received,
      tag: () => TAG,
      device: () => keys.id as string,
      sign: (data: Uint8Array) => signBytes(keys.secretKeys.signing, data),
      verify: (device: string, data: Uint8Array, signature: Uint8Array) => {
        const peer = this.keys.get(device)
        return peer !== undefined && this.active.has(device) && verifyBytes(peer.publicKeys.signing, data, signature)
      },
      receive: (frame: Uint8Array) => { received.push(frame) },
    }
  }
}

/** Discovery over one in-process network; every started device sees the others with its tag. */
class MemoryDiscovery implements LanDiscovery {
  readonly started = new Map<string, { self: LanSelf; found: (peer: LanPeer) => void; lost: (device: string) => void }>()

  start(self: LanSelf, found: (peer: LanPeer) => void, lost: (device: string) => void): () => void {
    for (const other of this.started.values()) {
      if (other.self.tag !== self.tag) continue
      other.found({ device: self.device, host: '127.0.0.1', port: self.port })
      found({ device: other.self.device, host: '127.0.0.1', port: other.self.port })
    }
    this.started.set(self.device, { self, found, lost })
    return () => { this.started.delete(self.device) }
  }

  port(device: string): number {
    return this.started.get(device)?.self.port ?? 0
  }
}

async function start(vault: ReturnType<Account['vault']>, discovery: LanDiscovery, options: Partial<LanTuning> = {}): Promise<LanTransport> {
  const transport = await LanTransport.start(vault, discovery, { ...tuning, ...options })
  transports.push(transport)
  return transport
}

/** A raw client on a transport's port, recording whether the transport closed it. */
async function raw(port: number): Promise<{ socket: WebSocket; messages: unknown[]; closed: Promise<void> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}`)
  const messages: unknown[] = []
  socket.on('message', (data) => { messages.push(JSON.parse((data as Buffer).toString('utf8'))) })
  const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  await new Promise((resolve) => { socket.once('open', resolve) })
  return { socket, messages, closed }
}

describe('local-network links', () => {
  it('links devices of one account and delivers each frame to the other', async () => {
    const account = new Account()
    const discovery = new MemoryDiscovery()
    const a = account.vault(account.device())
    const b = account.vault(account.device())
    const first = await start(a, discovery)
    const second = await start(b, discovery)
    await vi.waitFor(() => {
      expect(first.peers()).toEqual([b.device()])
      expect(second.peers()).toEqual([a.device()])
    })
    first.send(Uint8Array.of(1, 2, 3))
    await vi.waitFor(() => { expect(b.received).toEqual([Uint8Array.of(1, 2, 3)]) })
    expect(a.received).toEqual([])
  })

  it('keeps one link when both devices dial each other at once', async () => {
    const account = new Account()
    const keys = [account.device(), account.device()]
    const [a, b] = keys.map(device => account.vault(device))
    const discovery: LanDiscovery = {
      start: (self, found) => {
        // Each side finds the other as soon as both listen, so both dial.
        queueMicrotask(() => {
          const other = self.device === a!.device() ? b! : a!
          const port = ports.get(other.device())
          if (port !== undefined) found({ device: other.device(), host: '127.0.0.1', port })
        })
        ports.set(self.device, self.port)
        return () => {}
      },
    }
    const ports = new Map<string, number>()
    const first = await start(a!, discovery)
    const second = await start(b!, discovery)
    ;(second as unknown as { found: (peer: LanPeer) => void }).found({ device: a!.device(), host: '127.0.0.1', port: ports.get(a!.device())! })
    ;(first as unknown as { found: (peer: LanPeer) => void }).found({ device: b!.device(), host: '127.0.0.1', port: ports.get(b!.device())! })
    await vi.waitFor(() => {
      expect(first.peers()).toEqual([b!.device()])
      expect(second.peers()).toEqual([a!.device()])
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    first.send(Uint8Array.of(7))
    await vi.waitFor(() => { expect(b!.received).toHaveLength(1) })
    expect(second.peers()).toHaveLength(1)
  })

  it('drops a device the chain no longer holds, and links again once a dropped device is back', async () => {
    const account = new Account()
    const discovery = new MemoryDiscovery()
    const bKeys = account.device()
    const a = account.vault(account.device())
    const b = account.vault(bKeys)
    const first = await start(a, discovery)
    const second = await start(b, discovery)
    await vi.waitFor(() => { expect(first.peers()).toEqual([b.device()]) })

    account.active.delete(bKeys.id)
    first.refresh()
    second.refresh()
    await vi.waitFor(() => { expect(first.peers()).toEqual([]) })
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(first.peers()).toEqual([])

    account.active.add(bKeys.id)
    first.refresh()
    discovery.started.get(a.device())?.found({ device: b.device(), host: '127.0.0.1', port: discovery.port(b.device()) })
    await vi.waitFor(() => { expect(first.peers()).toEqual([b.device()]) })
    await second.close()
    await vi.waitFor(() => { expect(first.peers()).toEqual([]) })
    const again = await start(b, discovery, { port: discovery.port(b.device()) || 0 })
    discovery.started.get(a.device())?.found({ device: b.device(), host: '127.0.0.1', port: discovery.port(b.device()) })
    await vi.waitFor(() => { expect(again.peers()).toEqual([a.device()]) })
    discovery.started.get(a.device())?.lost(b.device())
    await again.close()
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(first.peers()).toEqual([])
  })

  it('closes a link that does not follow the handshake', async () => {
    const account = new Account()
    const discovery = new MemoryDiscovery()
    const own = account.device()
    const peer = account.device()
    const vault = account.vault(own)
    const transport = await start(vault, discovery, { handshakeMs: 200 })
    const port = discovery.port(own.id)
    const hello = { t: 'hello', device: peer.id, nonce: 'n' }

    const refused: unknown[][] = [
      ['not json'],
      [null],
      [{ t: 'other' }],
      [{ t: 'frame', frame: 'AQ' }],
      [{ t: 'proof', signature: 'AA' }],
      [{ t: 'hello', device: own.id, nonce: 'n' }],
      [hello, hello],
      [hello, { t: 'proof', signature: 'AA' }],
    ]
    for (const messages of refused) {
      const client = await raw(port)
      for (const message of messages) client.socket.send(typeof message === 'string' ? message : JSON.stringify(message))
      await client.closed
    }
    const silent = await raw(port)
    transport.send(Uint8Array.of(1))
    await silent.closed
    expect(silent.messages).toMatchObject([{ t: 'hello', device: own.id }])

    const honest = await raw(port)
    await vi.waitFor(() => { expect(honest.messages).toHaveLength(1) })
    const challenge = (honest.messages[0] as { nonce: string }).nonce
    honest.socket.send(JSON.stringify(hello))
    const transcript = new TextEncoder().encode(`aeven-sync/lan\n${TAG}\n${challenge}\n${peer.id}`)
    honest.socket.send(JSON.stringify({ t: 'proof', signature: Buffer.from(signBytes(peer.secretKeys.signing, transcript)).toString('base64url') }))
    honest.socket.send(JSON.stringify({ t: 'frame', frame: 'CQ' }))
    await vi.waitFor(() => { expect(vault.received).toEqual([Uint8Array.of(9)]) })
    honest.socket.send(JSON.stringify({ t: 'proof', signature: 'AA' }))
    await honest.closed
  })

  it('refuses a dialed device that answers as another one, and fails to start on a taken port', async () => {
    const account = new Account()
    const discovery = new MemoryDiscovery()
    const a = account.vault(account.device())
    const b = account.vault(account.device())
    const first = await start(a, discovery)
    await start(b, discovery)
    await vi.waitFor(() => { expect(first.peers()).toHaveLength(1) })
    discovery.started.get(a.device())?.found({ device: 'someone-else', host: '127.0.0.1', port: discovery.port(b.device()) })
    const nobody: Server = createServer()
    await new Promise<void>((resolve) => { nobody.listen(0, resolve) })
    const closedPort = (nobody.address() as { port: number }).port
    await new Promise<void>((resolve) => { nobody.close(() => { resolve() }) })
    discovery.started.get(a.device())?.found({ device: 'gone', host: '127.0.0.1', port: closedPort })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(first.peers()).toEqual([b.device()])

    const taken: Server = createServer()
    await new Promise<void>((resolve) => { taken.listen(0, resolve) })
    const port = (taken.address() as { port: number }).port
    await expect(LanTransport.start(a, discovery, { ...tuning, port })).rejects.toThrow(/EADDRINUSE/)
    taken.close()
  })
})

describe('mDNS discovery', () => {
  interface FakeBonjour {
    published: unknown[]
    browser: EventEmitter & { stop: ReturnType<typeof vi.fn> }
    onup: (service: unknown) => void
    unpublishAll: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }

  it('advertises this device and reports only other devices of the account with an IPv4 address', () => {
    const found = vi.fn()
    const lost = vi.fn()
    const stop = new MdnsDiscovery().start({ device: 'me', tag: TAG, port: 4000 }, found, lost)
    const instance = bonjour.instances[0] as FakeBonjour
    expect(instance.published).toEqual([{ name: 'me', type: 'aeven-sync', port: 4000, txt: { a: TAG, d: 'me' } }])
    const service = (txt: unknown, extra: object = {}) => ({ port: 5000, txt, ...extra })
    instance.onup(service({ a: TAG, d: 'peer' }, { referer: { family: 'IPv4', address: '10.0.0.2' } }))
    instance.onup(service({ a: TAG, d: 'v6' }, { referer: { family: 'IPv6', address: 'fe80::1' }, addresses: ['fe80::1', '10.0.0.3'] }))
    instance.onup(service({ a: TAG, d: 'none' }, { addresses: ['fe80::1'] }))
    instance.onup(service({ a: TAG, d: 'bare' }))
    instance.onup(service({ a: 'other', d: 'x' }, { addresses: ['10.0.0.4'] }))
    instance.onup(service({ a: TAG, d: 'me' }, { addresses: ['10.0.0.5'] }))
    instance.onup(service({ a: TAG, d: 5 }, { addresses: ['10.0.0.6'] }))
    instance.onup(service(undefined, { addresses: ['10.0.0.7'] }))
    expect(found.mock.calls).toEqual([
      [{ device: 'peer', host: '10.0.0.2', port: 5000 }],
      [{ device: 'v6', host: '10.0.0.3', port: 5000 }],
    ])
    instance.browser.emit('down', service({ a: TAG, d: 'peer' }))
    instance.browser.emit('down', service({ a: 'other', d: 'x' }))
    expect(lost.mock.calls).toEqual([['peer']])
    stop()
    expect(instance.browser.stop).toHaveBeenCalled()
    expect(instance.unpublishAll).toHaveBeenCalled()
    expect(instance.destroy).toHaveBeenCalled()
  })
})
