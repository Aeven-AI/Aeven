/**
 * The Yjs sync provider on two Hosts with separate homes against an in-process relay: status and events,
 * turning sync on, joining and approving through the service, carrying edits, resuming after a restart, and
 * the failures a Host meets without a session token or a reachable relay.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { accountHomePath } from '@aeven/home-paths'
import { generateDeviceKeys } from '@aeven/sync-vault'
import type {} from '@aeven/credentials'
import type { Sync } from '@aeven/sync'
import YjsSync from '../src/index.ts'
import { SyncStore } from '../src/store.ts'
import { RelayConnection } from '../src/relay.ts'
import { FakeRelay } from './fake-relay.ts'

let relay: FakeRelay
const cleanups: Array<() => Promise<void> | void> = []
let accounts = 0
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => { await relay.stop() })
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})

interface Host {
  ctx: Context
  sync: Sync
  fiber: Fiber
  home: string
  statuses: string[]
  documents: string[]
}

/** Owners whose token never resolves, as when no client of the account holds a session. */
const signedOut = new Set<string>()
/** Owners whose credential lookup fails. */
const broken = new Set<string>()

async function host(options: { home?: string; relayUrl?: string } = {}): Promise<Host> {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'sync-host-'))
  if (options.home === undefined) cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
  vi.stubEnv('AVN_HOME', home)
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: (_ref: unknown, owner: string) => broken.has(owner)
      ? Promise.reject(new Error('credentials unavailable'))
      : Promise.resolve(signedOut.has(owner) ? undefined : { value: `ok-${owner}`, source: 'session' }),
  } as never)
  const statuses: string[] = []
  const documents: string[] = []
  ctx.on('sync/status', (owner) => { statuses.push(owner) })
  ctx.on('sync/document', (_owner, id) => { documents.push(id) })
  const fiber = ctx.plugin(YjsSync, {
    relayUrl: options.relayUrl ?? relay.url, credentialRef: 'AEVEN_TOKEN', deviceName: 'test-host', reconnectMs: 100, connectTimeoutMs: 2000, compactAfter: 50, snapshotAfter: 50, lan: false, lanPort: 0, lanRetryMs: 100, lanMaxBytes: 65_536,
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  return { ctx, sync: ctx.sync, fiber, home, statuses, documents }
}

const owner = (): string => `owner${String(++accounts)}`

describe('the Yjs sync provider', () => {
  it('reports an account it has never seen as unenrolled and refuses document work for it', async () => {
    const { sync } = await host()
    expect(sync.status('nobody')).toEqual({ state: 'unenrolled', devices: 0, pending: 0, recovery: false })
    await expect(sync.openDocument('nobody', 'x')).rejects.toThrow(/not enrolled/)
    expect(() => sync.documentId('nobody', 'x')).toThrow(/not enrolled/)
    await expect(sync.appendStream('nobody', 'x', Uint8Array.of(1))).rejects.toThrow(/not enrolled/)
    await expect(sync.readStream('nobody', 'x', 0)).rejects.toThrow(/not enrolled/)
    expect(() => sync.acceptJoins('nobody')).toThrow(/needs a connection/)
    expect(sync.joinRequests('nobody')).toEqual([])
    sync.rejectJoin('nobody', 'x')
    await expect(sync.approveJoin('nobody', 'x')).rejects.toThrow(/no join request/)
  })

  it('coordinates exclusive work across enrolled Hosts without exposing its logical name', async () => {
    const account = owner()
    const first = await host()
    await expect(first.sync.acquireLease(account, 'memory/maintenance', 30_000)).rejects.toThrow(/connected/)
    await expect(first.sync.releaseLease(account, 'memory/maintenance')).rejects.toThrow(/connected/)
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    const second = await host()
    const accept = first.sync.acceptJoins(account)
    const joining = await second.sync.join(account)
    await joining.code
    await vi.waitFor(() => { expect(first.sync.joinRequests(account)).toHaveLength(1) })
    await first.sync.approveJoin(account, first.sync.joinRequests(account)[0]!.id)
    await joining.admitted
    accept()
    await vi.waitFor(() => { expect(second.sync.status(account).state).toBe('online') })

    const winner = await first.sync.acquireLease(account, 'memory/maintenance', 30_000)
    expect(winner).toMatchObject({ granted: true, holder: first.sync.status(account).device })
    expect(await second.sync.acquireLease(account, 'memory/maintenance', 30_000)).toEqual({ ...winner, granted: false })
    await second.sync.releaseLease(account, 'memory/maintenance')
    expect((await second.sync.acquireLease(account, 'memory/maintenance', 30_000)).granted).toBe(false)
    expect((await first.sync.acquireLease(account, 'memory/maintenance', 30_000)).granted).toBe(true)
    expect([...relay.account(account).leases.keys()]).not.toContain('memory/maintenance')
    await first.sync.releaseLease(account, 'memory/maintenance')
    expect((await second.sync.acquireLease(account, 'memory/maintenance', 30_000)).granted).toBe(true)
    const lease = [...relay.account(account).leases.values()][0]!
    lease.expiresAt = 0
    expect((await first.sync.acquireLease(account, 'memory/maintenance', 30_000)).granted).toBe(true)
    relay.refusals.set('lease.acquire', ['server-error'])
    await expect(first.sync.acquireLease(account, 'memory/maintenance', 30_000)).rejects.toThrow(/server-error/)
    relay.replies.set('lease.acquire', [
      { granted: true, holder: 'someone-else', expiresAt: 1 },
      { granted: false, holder: 7, expiresAt: 1 },
      { granted: false, holder: 'someone-else', expiresAt: 1.5 },
      { granted: 'yes', holder: 'someone-else', expiresAt: 1 },
    ])
    for (let i = 0; i < 4; i++) {
      await expect(first.sync.acquireLease(account, 'memory/maintenance', 30_000)).rejects.toThrow(/invalid lease/)
    }
  })

  it('turns sync on, joins a second Host by code, and carries a document between them', async () => {
    const account = owner()
    const first = await host()
    expect(await first.sync.vaultExists(account)).toBe(false)
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    expect(first.statuses).toContain(account)
    expect(await first.sync.vaultExists(account)).toBe(true)
    const doc = await first.sync.openDocument(account, 'settings/account')
    relay.refusals.set('publish', ['server-error'])
    doc.doc.getMap('prefs').set('theme', 'dark')
    await vi.waitFor(() => { expect(relay.refusals.get('publish')).toEqual([]) })
    await first.sync.openDocument(account, 'settings/account').then((handle) => {
      handle.doc.getMap('prefs').set('retry', true)
      handle.close()
    })

    const second = await host()
    const opened: string[] = []
    second.ctx.on('sync/status', (owner) => {
      void second.sync.openDocument(owner, 'settings/account').then(() => { opened.push('opened') }, () => { opened.push('refused') })
    })
    const join = await second.sync.join(account)
    await expect(second.sync.join(account)).rejects.toThrow(/already asking/)
    expect(second.sync.status(account)).toMatchObject({ state: 'joining' })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(second.sync.status(account).state).toBe('joining')
    expect(opened.every(outcome => outcome === 'refused')).toBe(true)
    const stop = first.sync.acceptJoins(account)
    const code = await join.code
    await vi.waitFor(() => { expect(second.sync.status(account).joinCode).toBe(code) })
    await vi.waitFor(() => { expect(first.sync.joinRequests(account)).toHaveLength(1) })
    const [request] = first.sync.joinRequests(account)
    expect(request!.code).toBe(code)
    await first.sync.approveJoin(account, request!.id)
    stop()
    await join.admitted
    await vi.waitFor(() => { expect(second.sync.status(account)).toMatchObject({ state: 'online', devices: 2 }) })

    const copy = await second.sync.openDocument(account, 'settings/account')
    expect(copy.doc.getMap('prefs').get('theme')).toBe('dark')
    copy.doc.getMap('prefs').set('theme', 'light')
    await vi.waitFor(() => { expect(doc.doc.getMap('prefs').get('theme')).toBe('light') })
    expect(first.documents).toContain(first.sync.documentId(account, 'settings/account'))

    await vi.waitFor(async () => {
      expect(await first.sync.devices(account)).toEqual([
        { id: first.sync.status(account).device, name: 'test-host', current: true },
        { id: second.sync.status(account).device, name: 'test-host', current: false },
      ])
    })
    await second.sync.appendStream(account, 'sessions/s', Uint8Array.of(7))
    await vi.waitFor(() => { expect(second.sync.status(account).pending).toBe(0) })
    expect((await first.sync.readStream(account, 'sessions/s', 0)).batches.map(batch => batch.payload)).toEqual([Uint8Array.of(7)])
    doc.close()
    copy.close()

    await expect(first.sync.removeDevice(account, 'not-a-device' as never)).rejects.toThrow(/not active/)
    await first.sync.removeDevice(account, second.sync.status(account).device!)
    await vi.waitFor(() => { expect(second.sync.status(account).state).toBe('unenrolled') })
    expect((await first.sync.devices(account)).map(device => device.current)).toEqual([true])
    expect(first.sync.status(account).devices).toBe(1)
    await expect(second.sync.devices(account)).resolves.toEqual([])
    const kept = await first.sync.openDocument(account, 'settings/account')
    kept.doc.getMap('prefs').set('after-removal', true)
    await vi.waitFor(() => { expect(first.sync.status(account).pending).toBe(0) })
    kept.close()
  })

  it('restores the account on a new device with the recovery passkey, also after a key rotation', async () => {
    const account = owner()
    const prf = new Uint8Array(32).fill(7)
    const first = await host()
    await expect(first.sync.setRecovery(account, prf)).rejects.toThrow(/needs a connection/)
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    expect(first.sync.status(account).recovery).toBe(false)
    const doc = await first.sync.openDocument(account, 'notes')
    doc.doc.getMap('m').set('k', 'before')
    await vi.waitFor(() => { expect(first.sync.status(account).pending).toBe(0) })

    const second = await host()
    await expect(second.sync.recover(account, prf)).rejects.toThrow(/no recovery passkey/)
    await first.sync.setRecovery(account, prf)
    expect(first.sync.status(account).recovery).toBe(true)
    await expect(second.sync.recover(account, new Uint8Array(32).fill(8))).rejects.toThrow(/not the account's recovery passkey/)
    await second.sync.recover(account, prf)
    await vi.waitFor(() => { expect(second.sync.status(account)).toMatchObject({ state: 'online', devices: 2, recovery: true }) })
    const copy = await second.sync.openDocument(account, 'notes')
    expect(copy.doc.getMap('m').get('k')).toBe('before')

    const lost = first.sync.status(account).device!
    await second.sync.removeDevice(account, lost)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('unenrolled') })
    copy.doc.getMap('m').set('k', 'after')
    await vi.waitFor(() => { expect(second.sync.status(account).pending).toBe(0) })
    doc.close()
    copy.close()

    const third = await host()
    await third.sync.recover(account, prf)
    await vi.waitFor(() => { expect(third.sync.status(account).state).toBe('online') })
    const latest = await third.sync.openDocument(account, 'notes')
    await vi.waitFor(() => { expect(latest.doc.getMap('m').get('k')).toBe('after') })
    latest.close()

    const fourth = await host()
    const join = await fourth.sync.join(account)
    await expect(fourth.sync.recover(account, prf)).rejects.toThrow(/already asking/)
    join.cancel()
    await expect(join.admitted).rejects.toThrow(/ended/)
    relay.account(account).keys.delete('recovery')
    await vi.waitFor(async () => { await expect(fourth.sync.recover(account, prf)).rejects.toThrow(/no keyring for the recovery passkey/) })
  })

  it('needs a connection to remove a device', async () => {
    const { sync } = await host()
    await expect(sync.removeDevice('nobody', 'x' as never)).rejects.toThrow(/needs a connection/)
  })

  it('lets the user cancel a join or reject a request', async () => {
    const account = owner()
    const first = await host()
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    const second = await host()
    const join = await second.sync.join(account)
    const stop = first.sync.acceptJoins(account)
    await join.code
    await vi.waitFor(() => { expect(first.sync.joinRequests(account)).toHaveLength(1) })
    first.sync.rejectJoin(account, first.sync.joinRequests(account)[0]!.id)
    expect(first.sync.joinRequests(account)).toEqual([])
    stop()
    join.cancel()
    await expect(join.admitted).rejects.toThrow(/ended before/)
    expect(second.sync.status(account).state).toBe('unenrolled')
  })

  it('resumes an enrolled account after a restart', async () => {
    const account = owner()
    const first = await host()
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    const names = await first.sync.openDocument(account, 'devices')
    names.doc.getMap('names').delete(first.sync.status(account).device!)
    names.close()
    expect(await first.sync.devices(account)).toEqual([{ id: first.sync.status(account).device, name: '', current: true }])
    await first.fiber.dispose()
    const restarted = await host({ home: first.home })
    await vi.waitFor(() => { expect(restarted.sync.status(account).state).toBe('online') })
  })

  it('needs a session token to reach the relay', async () => {
    const account = owner()
    signedOut.add(account)
    const first = await host()
    await expect(first.sync.createVault(account)).rejects.toThrow(/signed-in session/)
    const failing = owner()
    broken.add(failing)
    await expect(first.sync.vaultExists(failing)).rejects.toThrow(/signed-in session/)
    await expect(first.sync.vaultExists(account)).rejects.toThrow(/signed-in session/)
    expect(first.sync.status(account).state).toBe('unenrolled')
  })

  it('keeps retrying while the relay is unreachable, and survives a refused catch-up and a bad chain entry', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sync-host-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    vi.stubEnv('AVN_HOME', home)
    const stranded = owner()
    const store = new SyncStore(accountHomePath(stranded, 'sync', 'sync.db'), stranded)
    store.setDeviceKeys(generateDeviceKeys())
    store.close()
    const unreachable = await host({ home, relayUrl: 'ws://127.0.0.1:9/sync' })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(unreachable.sync.status(stranded).state).toBe('unenrolled')

    const account = owner()
    const first = await host()
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    relay.broadcastRaw(account, JSON.stringify({ t: 'chain', entry: { index: 99 } }))
    relay.refusals.set('chain.get', ['server-error'])
    relay.broadcastRaw(account, 'not json')
    await vi.waitFor(() => { expect(relay.refusals.get('chain.get')).toEqual([]) })
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
  })

  it('skips account folders without a sync store or owner, and closes a connection it cannot use', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sync-host-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    vi.stubEnv('AVN_HOME', home)
    mkdirSync(join(home, 'accounts', 'no-sync-here'), { recursive: true })
    const ownerless = join(home, 'accounts', 'ownerless', 'sync')
    mkdirSync(ownerless, { recursive: true })
    const raw = new Database(join(ownerless, 'sync.db'))
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    raw.close()
    const waiting = owner()
    const store = new SyncStore(accountHomePath(waiting, 'sync', 'sync.db'), waiting)
    store.setDeviceKeys(generateDeviceKeys())
    store.close()
    const restored = await host({ home })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(restored.sync.status(waiting).state).toBe('unenrolled')
  })

  it('waits for an in-flight publish acknowledgement before closing account storage', async () => {
    const account = owner()
    const first = await host()
    await first.sync.createVault(account)
    await vi.waitFor(() => {
      expect(first.sync.status(account)).toMatchObject({ state: 'online', pending: 0 })
    })
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- request.call(this) supplies the connection.
    const request = RelayConnection.prototype.request
    const spy = vi.spyOn(RelayConnection.prototype, 'request').mockImplementation(async function (this: RelayConnection, type, fields) {
      const result = await request.call(this, type, fields)
      if (type === 'publish') {
        started.resolve(undefined)
        await finish.promise
      }
      return result
    })
    try {
      const document = await first.sync.openDocument(account, 'settings/pending')
      document.doc.getMap('values').set('name', 'pending')
      await started.promise
      const stopping = first.fiber.dispose()
      await vi.waitFor(() => { expect(relay.account(account).sockets.size).toBe(0) })
      finish.resolve(undefined)
      await stopping
      expect(first.sync.status(account).state).toBe('unenrolled')
    } finally {
      finish.resolve(undefined)
      spy.mockRestore()
    }
  })

  it('closes a connection that opens after the provider stopped', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sync-host-'))
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
    vi.stubEnv('AVN_HOME', home)
    const waiting = owner()
    const store = new SyncStore(accountHomePath(waiting, 'sync', 'sync.db'), waiting)
    store.setDeviceKeys(generateDeviceKeys())
    store.close()
    relay.handshakeDelayMs = 150
    const stopping = await host({ home })
    await new Promise(resolve => setTimeout(resolve, 50))
    await stopping.fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 200))
    relay.handshakeDelayMs = 0
    expect(relay.account(waiting).sockets.size).toBe(0)
  })

  it('allows a new join once a cancelled one ended, ignores other chain entries, and needs a connection to approve', async () => {
    const account = owner()
    const first = await host()
    await first.sync.createVault(account)
    await vi.waitFor(() => { expect(first.sync.status(account).state).toBe('online') })
    const second = await host()
    const old = await second.sync.join(account)
    relay.broadcastRaw(account, JSON.stringify({ t: 'chain', entry: { index: 7, body: { type: 'set-recovery' } } }))
    old.cancel()
    await expect(old.admitted).rejects.toThrow()
    const current = await second.sync.join(account)
    expect(second.sync.status(account).state).toBe('joining')
    const stop = first.sync.acceptJoins(account)
    await current.code
    await vi.waitFor(() => { expect(first.sync.joinRequests(account)).toHaveLength(1) })
    stop()
    relay.refusals.set('chain.get', ['server-error', 'server-error', 'server-error', 'server-error', 'server-error'])
    relay.broadcastRaw(account, 'not json')
    await vi.waitFor(() => { expect(first.sync.status(account).state).not.toBe('online') })
    await expect(first.sync.approveJoin(account, first.sync.joinRequests(account)[0]!.id)).rejects.toThrow(/needs a connection/)
    relay.refusals.delete('chain.get')
    current.cancel()
  })
})
