/**
 * The relay client's request, push, and close behavior against an in-process relay, and the local store's
 * durable state: ownership, the account key and device id, document updates, outbox order, and replay counters.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { brandString } from '@aeven/brand'
import { generateVaultKey, type DeviceId, type OpaqueId } from '@aeven/sync-vault'
import { WebSocketServer } from 'ws'
import { RelayConnection, RelayError, type RelayHandlers } from '../src/relay.ts'
import { SyncStore } from '../src/store.ts'
import { FakeRelay } from './fake-relay.ts'

let relay: FakeRelay
const dirs: string[] = []
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => { await relay.stop() })
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function handlers(overrides: Partial<RelayHandlers> = {}): RelayHandlers {
  return { frame: vi.fn(), closed: vi.fn(), ...overrides }
}

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-store-'))
  dirs.push(dir)
  return join(dir, 'sync.db')
}

describe('RelayConnection', () => {
  it('answers requests and reports relay refusals by code', async () => {
    const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-alice' }, handlers(), 2000, 2000, 0, 0)
    const reply: unknown = await connection.request('key.get')
    const key = expect.any(String) as unknown
    expect(reply).toMatchObject({ t: 'ok', key })
    const refusal: unknown = await connection.request('nope').catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(RelayError)
    expect(refusal).toMatchObject({ code: 'bad-request' })
    connection.close()
    await connection.closed
  })

  it('refuses to open without an accepted token, and when nothing listens', async () => {
    await expect(RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'bad' },
      handlers(), 2000, 2000, 0, 0)).rejects.toMatchObject({ code: 'refused' })
    await expect(RelayConnection.open('ws://127.0.0.1:9/sync', { scheme: 'Bearer', token: 'ok-x' },
      handlers(), 2000, 2000, 0, 0)).rejects.toThrow()
  })

  it('delivers pushed frames and ignores unknown pushes', async () => {
    const frameHandler = vi.fn()
    const receiver = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-bob' },
      handlers({ frame: frameHandler }), 2000, 2000, 0, 0)
    const sender = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-bob' }, handlers(), 2000, 2000, 0, 0)
    await receiver.request('sync', { since: 0 })
    const frame = Buffer.concat([Buffer.from([2, 0, 2]), Buffer.from('{}'), Buffer.alloc(28)])
    relay.broadcastRaw('bob', JSON.stringify({ t: 'later-push' }))
    relay.broadcastRaw('bob', JSON.stringify({ t: 'ok', rid: 999 }))
    await sender.request('publish', { frames: [{ frame: frame.toString('base64url') }] })
    await vi.waitFor(() => { expect(frameHandler).toHaveBeenCalledWith(1, new Uint8Array(frame)) })
    receiver.close()
    sender.close()
  })

  it('closes the connection when an answer does not arrive in time', async () => {
    const closed = vi.fn()
    const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-erin' }, handlers({ closed }), 2000, 50, 0, 0)
    relay.unanswered.add('slow')
    await expect(connection.request('slow')).rejects.toMatchObject({ code: 'closed' })
    expect(closed).toHaveBeenCalled()
    relay.unanswered.delete('slow')
  })

  it('keeps a connection open past the silence window while the relay answers its pings', async () => {
    const closed = vi.fn()
    const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-frank' },
      handlers({ closed }), 2000, 2000, 50, 200)
    await new Promise((resolve) => { setTimeout(resolve, 600) })
    expect(closed).not.toHaveBeenCalled()
    connection.close()
    await connection.closed
  })

  it('closes a connection the relay leaves silent for the silence window', async () => {
    const silent = new WebSocketServer({ host: '127.0.0.1', port: 0, autoPong: false })
    await new Promise<void>((resolve) => { silent.once('listening', () => { resolve() }) })
    const { port } = silent.address() as { port: number }
    try {
      const closed = vi.fn()
      const connection = await RelayConnection.open(`ws://127.0.0.1:${String(port)}/sync`, { scheme: 'Bearer', token: 'ok-gina' },
        handlers({ closed }), 2000, 2000, 50, 200)
      await connection.closed
      expect(closed).toHaveBeenCalled()
    } finally {
      for (const client of silent.clients) client.terminate()
      await new Promise<void>((resolve) => { silent.close(() => { resolve() }) })
    }
  })

  it('drops a connection whose relay sends something other than JSON, failing pending requests', async () => {
    const closed = vi.fn()
    const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-carol' },
      handlers({ closed }), 2000, 2000, 0, 0)
    relay.unanswered.add('never-answered')
    const pending = connection.request('never-answered')
    relay.broadcastRaw('carol', 'not json')
    await connection.closed
    expect(closed).toHaveBeenCalled()
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    await expect(connection.request('key.get')).rejects.toMatchObject({ code: 'closed' })
  })
})

it('treats a protocol error from the relay as a closed connection', async () => {
  const closed = vi.fn()
  const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: 'ok-dave' }, handlers({ closed }), 2000, 2000, 0, 0)
  relay.corrupt('dave')
  await connection.closed
  expect(closed).toHaveBeenCalled()
})

describe('SyncStore', () => {
  const owner = 'owner-1'
  const id = brandString<OpaqueId>('doc')
  const device = brandString<DeviceId>('dev')

  it('belongs to one account and reports it without opening for writing', () => {
    const path = tempPath()
    new SyncStore(path, owner).close()
    expect(SyncStore.ownerOf(path)).toBe(owner)
    expect(() => new SyncStore(path, 'someone-else')).toThrow(/belongs to another account/)
    const reopened = new SyncStore(path, owner)
    reopened.close()
  })

  it('reports no owner for a store that records none, and starts over from a store of another schema', () => {
    const path = tempPath()
    const raw = new Database(path)
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    raw.close()
    expect(SyncStore.ownerOf(path)).toBeUndefined()
    const future = tempPath()
    const db = new Database(future)
    db.pragma('user_version = 99')
    db.close()
    const restarted = new SyncStore(future, owner)
    expect(restarted.relayCursor()).toBe(0)
    restarted.close()
  })

  it('rewrites its file without free pages once they exceed the given share, and keeps what is stored', () => {
    const store = new SyncStore(tempPath(), owner)
    const kept = brandString<OpaqueId>('kept')
    const grown = brandString<OpaqueId>('grown')
    store.appendDocUpdate(kept, Uint8Array.of(7))
    expect(store.reclaim(0.5)).toBe(false)
    for (let index = 0; index < 64; index++) store.appendDocUpdate(grown, new Uint8Array(65_536).fill(index))
    store.retireDocument(grown)
    expect(store.reclaim(0.5)).toBe(true)
    expect(store.reclaim(0.5)).toBe(false)
    expect(store.docUpdates(kept)).toEqual([Uint8Array.of(7)])
    store.close()
  })

  it('answers the account key and the sync preference without reading the database again until either is written', () => {
    const path = tempPath()
    const store = new SyncStore(path, owner)
    store.setAccountKey(new Uint8Array(32).fill(1), 'server')
    expect(store.accountKey()).toEqual(new Uint8Array(32).fill(1))
    expect(store.enabled()).toBe(true)
    // Another connection changes both rows, which nothing in the product does: the answers stay as last read.
    const other = new Database(path)
    other.prepare("UPDATE meta SET value = ? WHERE key = 'key'").run(Buffer.alloc(32, 9).toString('base64url'))
    other.prepare("INSERT INTO meta (key, value) VALUES ('enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = excluded.value").run()
    other.close()
    expect(store.accountKey()).toEqual(new Uint8Array(32).fill(1))
    expect(store.enabled()).toBe(true)
    // A caller that changes the bytes it received does not change the next answer.
    store.accountKey()!.fill(7)
    expect(store.accountKey()).toEqual(new Uint8Array(32).fill(1))
    // Each write through the store is read back.
    store.setEnabled(false)
    expect(store.enabled()).toBe(false)
    store.setEnabled(true)
    expect(store.enabled()).toBe(true)
    expect(store.setAccountKey(new Uint8Array(32).fill(2), 'server')).toBe(true)
    expect(store.accountKey()).toEqual(new Uint8Array(32).fill(2))
    expect(store.dropAccountKey()).toBe(true)
    expect(store.accountKey()).toBeUndefined()
    store.close()
  })

  it('keeps a device id, the account key, the enabled flag, and the relay cursor', () => {
    const store = new SyncStore(tempPath(), owner)
    const deviceId = store.deviceId()
    expect(store.deviceId()).toBe(deviceId)
    expect(store.enabled()).toBe(true)
    store.setEnabled(false)
    expect(store.enabled()).toBe(false)
    expect(store.accountKey()).toBeUndefined()
    expect(store.setAccountKey(new Uint8Array(32).fill(1), 'server')).toBe(false)
    expect(store.setAccountKey(new Uint8Array(32).fill(1), 'server')).toBe(false)
    expect(store.accountKey()).toEqual(new Uint8Array(32).fill(1))
    store.setRelayCursor(42)
    store.appendDocUpdate(brandString<OpaqueId>('doc'), Uint8Array.of(1))
    store.enqueue(Uint8Array.of(2))
    expect(store.setAccountKey(new Uint8Array(32).fill(2), 'server')).toBe(true)
    expect(store.relayCursor()).toBe(0)
    expect(store.pending()).toBe(0)
    expect([...store.storedDocuments().keys()]).toEqual([])
    expect(store.deviceId()).toBe(deviceId)
    store.close()
  })

  it('stores document updates in order and lists the documents it holds', () => {
    const store = new SyncStore(tempPath(), owner)
    store.appendDocUpdate(id, Uint8Array.of(1))
    store.appendDocUpdate(id, Uint8Array.of(2))
    expect(store.docUpdateCount(id)).toBe(2)
    expect(store.docUpdates(id)).toEqual([Uint8Array.of(1), Uint8Array.of(2)])
    expect([...store.storedDocuments().keys()]).toEqual([id])
    store.close()
  })

  it('counts frames per id, refuses replayed counters, and counts toward snapshots', () => {
    const store = new SyncStore(tempPath(), owner)
    const [first, second] = [store.nextCounter(id), store.nextCounter(id)]
    expect(second).toBeGreaterThan(first)
    expect(store.acceptCounter(device, id, 3)).toBe(true)
    expect(store.acceptCounter(device, id, 3)).toBe(false)
    expect(store.acceptCounter(device, id, 4)).toBe(true)
    expect([store.countSinceSnapshot(id), store.countSinceSnapshot(id)]).toEqual([1, 2])
    store.resetSinceSnapshot(id)
    expect(store.countSinceSnapshot(id)).toBe(1)
    store.close()
  })

  it('never repeats a counter, also after dropping and taking back the same account key', () => {
    const store = new SyncStore(tempPath(), owner)
    const key = generateVaultKey()
    store.setAccountKey(key, 'passkey')
    const before = store.nextCounter(id)
    expect(store.dropAccountKey()).toBe(true)
    store.setAccountKey(key, 'passkey')
    expect(store.nextCounter(id)).toBeGreaterThan(before)
    store.close()
  })

  it('starts the counters of a store whose counters were lost above every counter allocated before', () => {
    const path = tempPath()
    const store = new SyncStore(path, owner)
    const before = store.nextCounter(id)
    store.close()
    const raw = new Database(path)
    raw.exec('DELETE FROM counters')
    raw.close()
    const reopened = new SyncStore(path, owner)
    expect(reopened.nextCounter(id)).toBeGreaterThan(before)
    reopened.close()
  })

  it('keeps the outbox in order with snapshot coverage until acknowledged', () => {
    const store = new SyncStore(tempPath(), owner)
    store.transaction(() => {
      store.enqueue(Uint8Array.of(1))
      store.enqueue(Uint8Array.of(2), 7)
    })
    const [first, second] = store.outbox()
    expect([first?.frame, first?.covers]).toEqual([Uint8Array.of(1), undefined])
    expect([second?.frame, second?.covers]).toEqual([Uint8Array.of(2), 7])
    expect(second!.seq).toBeGreaterThan(first!.seq)
    expect(store.outbox(1)).toEqual([first])
    expect(store.pending()).toBe(2)
    store.acknowledge(first!.seq)
    expect(store.pending()).toBe(1)
    store.close()
  })
})
