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
import type { DeviceId, OpaqueId } from '@aeven/sync-vault'
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
    const connection = await RelayConnection.open(relay.url, 'ok-alice', handlers(), 2000, 2000)
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
    await expect(RelayConnection.open(relay.url, 'bad', handlers(), 2000, 2000)).rejects.toMatchObject({ code: 'refused' })
    await expect(RelayConnection.open('ws://127.0.0.1:9/sync', 'ok-x', handlers(), 2000, 2000)).rejects.toThrow()
  })

  it('delivers pushed frames and ignores unknown pushes', async () => {
    const frameHandler = vi.fn()
    const receiver = await RelayConnection.open(relay.url, 'ok-bob', handlers({ frame: frameHandler }), 2000, 2000)
    const sender = await RelayConnection.open(relay.url, 'ok-bob', handlers(), 2000, 2000)
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
    const connection = await RelayConnection.open(relay.url, 'ok-erin', handlers({ closed }), 2000, 50)
    relay.unanswered.add('slow')
    await expect(connection.request('slow')).rejects.toMatchObject({ code: 'closed' })
    expect(closed).toHaveBeenCalled()
    relay.unanswered.delete('slow')
  })

  it('drops a connection whose relay sends something other than JSON, failing pending requests', async () => {
    const closed = vi.fn()
    const connection = await RelayConnection.open(relay.url, 'ok-carol', handlers({ closed }), 2000, 2000)
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
  const connection = await RelayConnection.open(relay.url, 'ok-dave', handlers({ closed }), 2000, 2000)
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

  it('keeps a device id, the account key, the enabled flag, and the relay cursor', () => {
    const store = new SyncStore(tempPath(), owner)
    const deviceId = store.deviceId()
    expect(store.deviceId()).toBe(deviceId)
    expect(store.enabled()).toBe(true)
    store.setEnabled(false)
    expect(store.enabled()).toBe(false)
    expect(store.accountKey()).toBeUndefined()
    expect(store.setAccountKey(new Uint8Array(32).fill(1))).toBe(false)
    expect(store.setAccountKey(new Uint8Array(32).fill(1))).toBe(false)
    expect(store.accountKey()).toEqual(new Uint8Array(32).fill(1))
    store.setRelayCursor(42)
    store.appendDocUpdate(brandString<OpaqueId>('doc'), Uint8Array.of(1))
    store.enqueue(Uint8Array.of(2))
    expect(store.setAccountKey(new Uint8Array(32).fill(2))).toBe(true)
    expect(store.relayCursor()).toBe(0)
    expect(store.pending()).toBe(0)
    expect(store.storedDocuments()).toEqual([])
    expect(store.deviceId()).toBe(deviceId)
    store.close()
  })

  it('stores document updates in order and lists the documents it holds', () => {
    const store = new SyncStore(tempPath(), owner)
    store.appendDocUpdate(id, Uint8Array.of(1))
    store.appendDocUpdate(id, Uint8Array.of(2))
    expect(store.docUpdateCount(id)).toBe(2)
    expect(store.docUpdates(id)).toEqual([Uint8Array.of(1), Uint8Array.of(2)])
    expect(store.storedDocuments()).toEqual([id])
    store.close()
  })

  it('counts frames per id, refuses replayed counters, and counts toward snapshots', () => {
    const store = new SyncStore(tempPath(), owner)
    expect([store.nextCounter(id), store.nextCounter(id)]).toEqual([1, 2])
    expect(store.acceptCounter(device, id, 3)).toBe(true)
    expect(store.acceptCounter(device, id, 3)).toBe(false)
    expect(store.acceptCounter(device, id, 4)).toBe(true)
    expect([store.countSinceSnapshot(id), store.countSinceSnapshot(id)]).toEqual([1, 2])
    store.resetSinceSnapshot(id)
    expect(store.countSinceSnapshot(id)).toBe(1)
    store.close()
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
