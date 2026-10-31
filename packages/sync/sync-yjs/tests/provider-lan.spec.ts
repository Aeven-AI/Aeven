/**
 * Two Hosts of one account on one local network: once both hold the account key they link directly, an update
 * reaches the other Host while the relay refuses it, the relay carries it once it accepts again, a device that
 * turned sync off receives nothing more, and a Host whose link port is taken keeps syncing through the relay.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@aeven/credentials'
import type { Sync } from '@aeven/sync'
import YjsSync from '../src/index.ts'
import { FakeRelay } from './fake-relay.ts'

/** One in-process mDNS network shared by every Bonjour instance of this file. */
const mdns = vi.hoisted(() => {
  type Listener = (service: unknown) => void
  const services = new Map<string, Record<string, unknown>>()
  const browsers = new Set<{ up: Listener; emitter: { emit: (event: string, service: unknown) => void } }>()
  return { services, browsers }
})
vi.mock('bonjour-service', () => ({
  Bonjour: class {
    private readonly own = new Set<string>()
    publish(config: { name: string; port: number; txt: unknown }) {
      const service = { ...config, referer: { family: 'IPv4', address: '127.0.0.1' } }
      mdns.services.set(config.name, service)
      this.own.add(config.name)
      for (const browser of mdns.browsers) browser.up(service)
    }
    find(_config: unknown, up: (service: unknown) => void) {
      const emitter = Object.assign(new EventEmitter(), { stop: () => { mdns.browsers.delete(entry) } })
      const entry = { up, emitter }
      mdns.browsers.add(entry)
      for (const service of mdns.services.values()) up(service)
      return emitter
    }
    unpublishAll() {
      for (const name of this.own) {
        const service = mdns.services.get(name)
        mdns.services.delete(name)
        for (const browser of mdns.browsers) browser.emitter.emit('down', service)
      }
    }
    destroy() {}
  },
}))

let relay: FakeRelay
const cleanups: Array<() => Promise<void> | void> = []
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => { await relay.stop() })
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})

async function host(options: { lanPort?: number } = {}): Promise<{ ctx: Context; sync: Sync }> {
  const home = mkdtempSync(join(tmpdir(), 'sync-lan-'))
  cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
  vi.stubEnv('AVN_HOME', home)
  const ctx = new Context()
  ctx.provide('credentials', { resolve: (_ref: unknown, owner: string) => Promise.resolve({ value: `ok-${owner}`, source: 'session' }) } as never)
  const fiber = ctx.plugin(YjsSync, {
    relayUrl: relay.url, credentialRef: 'AEVEN_TOKEN', deviceName: 'lan-host', reconnectMs: 100, connectTimeoutMs: 2000,
    requestTimeoutMs: 2000, publishFrames: 100, publishBytes: 2_097_152, compactAfter: 50, snapshotAfter: 50,
    applyFrames: 200, applyPauseMs: 0, pageFrames: 500, statusMs: 0, lan: true, lanPort: options.lanPort ?? 0,
    lanRetryMs: 100, lanMaxBytes: 1_048_576,
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  return { ctx, sync: ctx.sync }
}

function signIn(target: { ctx: Context }, owner: string): void {
  target.ctx.emit('credentials/session-updated', credentialRef('AEVEN_TOKEN'), owner)
}

describe('Hosts of one account on one local network', () => {
  it('deliver an update directly while the relay holds it, and drop a removed device', async () => {
    const account = 'lan-owner-1'
    const first = await host()
    signIn(first, account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    const second = await host()
    signIn(second, account)
    await vi.waitFor(() => { expect(second.sync.status(account).state).toBe('online') })

    const changed: string[] = []
    second.ctx.on('sync/document', (_owner, id) => { changed.push(id) })
    const sent = await first.sync.openDocument(account, 'notes')
    const seen = await second.sync.openDocument(account, 'notes')
    // With the relay refusing every publish, an update can only arrive over the direct link.
    relay.refusals.set('publish', Array.from({ length: 10_000 }, () => 'server-error'))
    let probe = 0
    await vi.waitFor(() => {
      sent.doc.getMap('m').set('probe', ++probe)
      expect(seen.doc.getMap('m').has('probe')).toBe(true)
    }, { timeout: 5_000 })
    expect(first.sync.status(account).pending).toBeGreaterThan(0)
    expect(changed).toContain(second.sync.documentId(account, 'notes'))
    relay.refusals.set('publish', [])
    sent.doc.getMap('m').set('k', 'relayed too')
    await vi.waitFor(() => { expect(first.sync.status(account).pending).toBe(0) })
    expect(seen.doc.getMap('m').get('k')).toBe('relayed too')

    second.sync.setEnabled(account, false)
    expect(second.sync.status(account).state).toBe('disabled')
    sent.doc.getMap('m').set('k', 'private')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(seen.doc.getMap('m').get('k')).toBe('relayed too')
    sent.close()
    seen.close()
  })

  it('keeps syncing through the relay when the link port is taken', async () => {
    const taken: Server = createServer()
    await new Promise<void>((resolve) => { taken.listen(0, resolve) })
    cleanups.push(() => new Promise<void>((resolve) => { taken.close(() => { resolve() }) }))
    const port = (taken.address() as { port: number }).port
    const { ctx, sync } = await host({ lanPort: port })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    signIn({ ctx }, 'lan-owner-2')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not start'), 'lan-owner-2', expect.anything()) })
    await vi.waitFor(() => { expect(sync.status('lan-owner-2').state).toBe('online') })
  })
})
