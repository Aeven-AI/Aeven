/**
 * The relay client's request, push, and close behavior against an in-process relay, and the local store's
 * durable state: ownership, keys, chain, document updates, outbox order, and replay counters.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { brandNumber, brandString } from '@aeven/brand'
import { createGenesis, generateDeviceKeys, type DeviceId, type KeyEpoch, type OpaqueId } from '@aeven/sync-vault'
import { RelayConnection, RelayError, type RelayHandlers } from '../src/relay.ts'
import { SyncStore } from '../src/store.ts'
import { FakeRelay } from './fake-relay.ts'

let relay: FakeRelay
const dirs: string[] = []
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => { await relay.stop() })
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function handlers(overrides: Partial<RelayHandlers> = {}): RelayHandlers {
  return { frame: vi.fn(), chain: vi.fn(), signal: vi.fn(), closed: vi.fn(), ...overrides }
}

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-store-'))
  dirs.push(dir)
  return join(dir, 'sync.db')
}

describe('RelayConnection', () => {
  it('answers requests and reports relay refusals by code', async () => {
    const connection = await RelayConnection.open(relay.url, 'ok-alice', handlers(), 2000)
    expect(await connection.request('chain.get')).toMatchObject({ t: 'ok', entries: [] })
    const refusal = await connection.request('nope').catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(RelayError)
    expect(refusal).toMatchObject({ code: 'bad-request' })
    connection.close()
    await connection.closed
  })

  it('refuses to open without an accepted token, and when nothing listens', async () => {
    await expect(RelayConnection.open(relay.url, 'bad', handlers(), 2000)).rejects.toMatchObject({ code: 'refused' })
    await expect(RelayConnection.open('ws://127.0.0.1:9/sync', 'ok-x', handlers(), 2000)).rejects.toThrow()
  })

  it('delivers pushed frames, chain entries, and signals, and ignores unknown pushes', async () => {
    const signal = vi.fn()
    const chain = vi.fn()
    const frameHandler = vi.fn()
    const receiver = await RelayConnection.open(relay.url, 'ok-bob', handlers({ signal, chain, frame: frameHandler }), 2000)
    const sender = await RelayConnection.open(relay.url, 'ok-bob', handlers(), 2000)
    await receiver.request('sync', { since: 0 })
    const genesis = createGenesis(generateDeviceKeys())
    await sender.request('chain.append', { entry: genesis })
    const frame = Buffer.concat([Buffer.from([1, 0, 2]), Buffer.from('{}'), Buffer.alloc(64)])
    await sender.request('publish', { frame: frame.toString('base64url') })
    await sender.request('signal', { data: { hello: 1 } })
    relay.broadcastRaw('bob', JSON.stringify({ t: 'later-push' }))
    relay.broadcastRaw('bob', JSON.stringify({ t: 'ok', rid: 999 }))
    await vi.waitFor(() => {
      expect(signal).toHaveBeenCalledOnce()
    })
    expect(signal.mock.calls[0]?.[1]).toEqual({ hello: 1 })
    expect(chain).toHaveBeenCalledWith(genesis)
    expect(frameHandler).toHaveBeenCalledWith(1, new Uint8Array(frame))
    receiver.close()
    sender.close()
  })

  it('drops a connection whose relay sends something other than JSON, failing pending requests', async () => {
    const closed = vi.fn()
    const connection = await RelayConnection.open(relay.url, 'ok-carol', handlers({ closed }), 2000)
    relay.unanswered.add('never-answered')
    const pending = connection.request('never-answered')
    relay.broadcastRaw('carol', 'not json')
    await connection.closed
    expect(closed).toHaveBeenCalled()
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    await expect(connection.request('chain.get')).rejects.toMatchObject({ code: 'closed' })
  })
})

it('treats a protocol error from the relay as a closed connection', async () => {
  const closed = vi.fn()
  const connection = await RelayConnection.open(relay.url, 'ok-dave', handlers({ closed }), 2000)
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

  it('reports no owner for a store that records none, and refuses an unknown schema', () => {
    const path = tempPath()
    const raw = new Database(path)
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    raw.close()
    expect(SyncStore.ownerOf(path)).toBeUndefined()
    const future = tempPath()
    const db = new Database(future)
    db.pragma('user_version = 99')
    db.close()
    expect(() => new SyncStore(future, owner)).toThrow(/schema 99/)
  })

  it('keeps device keys, keyring, chain, and the relay cursor', () => {
    const store = new SyncStore(tempPath(), owner)
    expect(store.deviceKeys()).toBeUndefined()
    const keys = generateDeviceKeys()
    store.setDeviceKeys(keys)
    expect(store.deviceKeys()).toEqual(keys)
    store.addKeys(new Map([[brandNumber<KeyEpoch>(0), new Uint8Array(32).fill(1)]]))
    store.addKeys(new Map([[brandNumber<KeyEpoch>(0), new Uint8Array(32).fill(2)], [brandNumber<KeyEpoch>(1), new Uint8Array(32).fill(3)]]))
    expect([...store.keyring()].map(([epoch, key]) => [epoch, key[0]])).toEqual([[0, 1], [1, 3]])
    const genesis = createGenesis(keys)
    store.setChain([genesis])
    expect(store.chain()).toEqual([genesis])
    expect(store.relayCursor()).toBe(0)
    store.setRelayCursor(42)
    expect(store.relayCursor()).toBe(42)
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
