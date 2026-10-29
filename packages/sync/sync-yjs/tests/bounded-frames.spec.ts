/** Large logical sync payloads survive bounded transport messages, partial acknowledgments, and receiver restarts. */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateDeviceId, generateVaultKey, opaqueIdOf, openEnvelope, readEnvelopeHeader, sealEnvelope } from '@aeven/sync-vault'
import { compactUpdates, prepareFrame, sealParts } from '../src/frames.ts'
import { SyncOffload } from '../src/offload.ts'
import { publishFrameLimit, publishRequestBytes, RelayConnection } from '../src/relay.ts'
import { SyncStore } from '../src/store.ts'
import { AccountVault, type VaultTuning } from '../src/vault.ts'
import { FakeRelay } from './fake-relay.ts'

const BUDGET = 2048
const tuning: VaultTuning = { compactAfter: 1000, snapshotAfter: 1000, applyFrames: 1, applyPauseMs: 0,
  pageFrames: 1, statusMs: 0, publishFrames: 5, publishBytes: BUDGET }
let relay: FakeRelay
let offload: SyncOffload
const roots: string[] = []
const devices: Array<{ store: SyncStore; vault: AccountVault; retired: boolean }> = []
const connections: RelayConnection[] = []

beforeEach(async () => {
  relay = await FakeRelay.start(BUDGET)
  offload = new SyncOffload()
})
afterEach(async () => {
  vi.restoreAllMocks()
  const closing = connections.splice(0)
  for (const connection of closing) connection.close()
  await Promise.all(closing.map(connection => connection.closed))
  for (const device of devices.splice(0)) {
    if (device.retired) continue
    await device.vault.dispose()
    device.store.close()
  }
  await offload.dispose()
  await relay.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function device(path?: string) {
  if (path === undefined) {
    const root = mkdtempSync(join(tmpdir(), 'bounded-sync-'))
    roots.push(root)
    path = join(root, 'sync.db')
  }
  const store = new SyncStore(path, 'bounded')
  const vault = new AccountVault(store, tuning, vi.fn(), vi.fn(), vi.fn(), offload)
  const target = { store, vault, retired: false }
  devices.push(target)
  return target
}

async function connect(target: ReturnType<typeof device>) {
  const connection = await RelayConnection.open(relay.url, 'ok-bounded', {
    frame: (seq, frame) => { target.vault.receiveFrame(seq, frame) }, closed: () => { target.vault.detach() },
  }, 2000, 2000)
  connections.push(connection)
  await target.vault.attach(connection)
  return connection
}

it('garbage-collects deleted values while preserving clocks and concurrent edits', () => {
  const doc = new Y.Doc({ gc: false })
  const updates: Uint8Array[] = []
  doc.on('update', (update) => { updates.push(update) })
  const peer = new Y.Doc()
  try {
    doc.getMap('sessions').set('session', 'initial')
    Y.applyUpdate(peer, updates[0]!)
    peer.getMap('sessions').set('offline', 'concurrent')
    for (let i = 0; i < 6; i++) doc.getMap('sessions').set('session', `${String(i)}${'x'.repeat(800_000)}`)
    doc.getMap('sessions').set('session', 'current')
    const merged = Y.mergeUpdates(updates)
    const compact = compactUpdates(updates)
    expect(merged.length).toBeGreaterThan(4 * 1024 * 1024)
    expect(compact.length).toBeLessThan(1024)
    expect(Y.encodeStateVectorFromUpdate(compact)).toEqual(Y.encodeStateVector(doc))
    Y.applyUpdate(peer, compact)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    expect(peer.getMap('sessions').toJSON()).toEqual(doc.getMap('sessions').toJSON())
  } finally {
    doc.destroy()
    peer.destroy()
  }
})

it('preserves updates whose causal predecessors have not arrived when compacting', () => {
  const doc = new Y.Doc()
  const restored = new Y.Doc()
  const updates: Uint8Array[] = []
  doc.on('update', (update) => { updates.push(update) })
  try {
    doc.getText('t').insert(0, 'first')
    doc.getText('t').insert(5, 'second')
    Y.applyUpdate(restored, compactUpdates([updates[1]!]))
    Y.applyUpdate(restored, updates[0]!)
    expect(restored.getText('t').toString()).toBe('firstsecond')
  } finally {
    doc.destroy()
    restored.destroy()
  }
})

it('recovers an oversized queued snapshot without changing its counter or covered relay position', async () => {
  const a = device()
  const key = Buffer.from(relay.account('bounded').key, 'base64url')
  a.store.setAccountKey(key)
  const id = opaqueIdOf(key, 'sessions/index')
  const doc = new Y.Doc({ gc: false })
  const updates: Uint8Array[] = []
  doc.on('update', (update) => { updates.push(update) })
  try {
    for (let i = 0; i < 6; i++) doc.getMap('sessions').set('one', `${String(i)}${'x'.repeat(800_000)}`)
    doc.getMap('sessions').set('one', 'retained')
    const original = sealEnvelope({ kind: 'snapshot', id, device: a.store.deviceId(), counter: a.store.nextCounter(id), accountKey: key, payload: Y.mergeUpdates(updates) })
    a.store.enqueue(original, 0)
    expect(original.length).toBeGreaterThan(4 * 1024 * 1024)
    await connect(a)
    await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })
    const stored = relay.account('bounded').frames.find(frame => frame.kind === 'snapshot')!
    expect(stored.data.length).toBeLessThan(1024)
    expect(readEnvelopeHeader(stored.data)).toEqual(readEnvelopeHeader(original))
    const restored = new Y.Doc()
    try {
      Y.applyUpdate(restored, openEnvelope(stored.data, key).payload)
      expect(restored.getMap('sessions').get('one')).toBe('retained')
    } finally { restored.destroy() }
    expect(relay.transportErrors).toEqual([])
  } finally { doc.destroy() }
})

it('keeps large document transactions atomic and every complete JSON request within its byte budget', async () => {
  const a = device()
  const b = device()
  await connect(a)
  await connect(b)
  const local = a.vault.openDocument('doc')
  const remote = b.vault.openDocument('doc')
  const observed: unknown[] = []
  remote.doc.getMap('m').observe(() => { observed.push(remote.doc.getMap('m').get('blob')) })
  const blob = new Uint8Array(randomBytes(9000))
  local.doc.transact(() => {
    local.doc.getMap('m').set('blob', blob)
    local.doc.getMap('m').set('committed', true)
  })
  await vi.waitFor(() => { expect(remote.doc.getMap('m').get('blob')).toEqual(blob) })
  expect(remote.doc.getMap('m').get('committed')).toBe(true)
  expect(observed).toHaveLength(1)
  await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })
  expect(relay.requests.every(request => request.bytes <= BUDGET)).toBe(true)
  expect(relay.transportErrors).toEqual([])
  local.close()
  remote.close()
})

it('retains a partially acknowledged snapshot and completes it after the receiver restarts', async () => {
  const a = device()
  const connection = await connect(a)
  const key = a.store.accountKey()!
  const id = a.vault.documentId('doc')
  const source = new Y.Doc()
  source.getMap('m').set('blob', new Uint8Array(randomBytes(9000)))
  const snapshot = sealEnvelope({ kind: 'snapshot', id, device: a.store.deviceId(), counter: a.store.nextCounter(id), accountKey: key, payload: Y.encodeStateAsUpdate(source) })
  source.destroy()
  const original = connection.request.bind(connection)
  let publishes = 0
  const spy = vi.spyOn(connection, 'request').mockImplementation((type, fields) => {
    if (type === 'publish' && ++publishes === 2) return Promise.reject(new Error('interrupted'))
    return original(type, fields)
  })
  a.store.enqueue(snapshot, 0)
  await a.vault.flush()
  expect(a.store.pending()).toBe(1)
  expect(relay.account('bounded').frames).toHaveLength(1)
  const b = device()
  const receiver = await connect(b)
  await vi.waitFor(() => { expect(b.store.relayCursor()).toBe(1) })
  expect(b.store.docUpdates(id)).toHaveLength(0)
  receiver.close()
  await receiver.closed
  await b.vault.dispose()
  b.store.close()
  b.retired = true
  const resumed = device(b.store.path)
  const remote = resumed.vault.openDocument('doc')
  await connect(resumed)
  spy.mockRestore()
  await a.vault.flush()
  await vi.waitFor(() => { expect(remote.doc.getMap('m').get('blob')).toHaveLength(9000) })
  expect(a.store.pending()).toBe(0)
  expect(resumed.store.docUpdates(id)).toHaveLength(1)
  expect(relay.requests.every(request => request.bytes <= BUDGET)).toBe(true)
  expect(relay.transportErrors).toEqual([])
  remote.close()
})

it('reassembles a stream payload across transport pages before exposing the next cursor', async () => {
  const a = device()
  const b = device()
  await connect(a)
  await connect(b)
  const payload = new Uint8Array(randomBytes(9000))
  a.vault.appendStream('sessions/one', payload)
  a.vault.appendStream('sessions/one', Uint8Array.of(42))
  await a.vault.flush()
  const first = await b.vault.readStream('sessions/one', 0)
  expect(first.batches[0]?.payload).toEqual(payload)
  const rest = first.more ? await b.vault.readStream('sessions/one', first.batches.at(-1)!.seq) : { batches: [] }
  expect([...first.batches.slice(1), ...rest.batches].map(batch => batch.payload)).toEqual([Uint8Array.of(42)])
})

it('reassembles local-network parts once they all arrive, including duplicates and reversed delivery', async () => {
  const a = device()
  const b = device()
  await connect(a)
  await connect(b)
  const frames: Uint8Array[] = []
  a.vault.setLanSender((frame) => { frames.push(frame) })
  const received: Uint8Array[] = []
  b.vault.watchStream('sessions/lan', (payload) => { received.push(payload) })
  const payload = new Uint8Array(randomBytes(9000))
  a.vault.appendStream('sessions/lan', payload)
  expect(frames.length).toBeGreaterThan(1)
  for (const part of frames.slice(1).reverse()) {
    b.vault.receiveLanFrame(part)
    b.vault.receiveLanFrame(part)
  }
  expect(received).toEqual([])
  b.vault.receiveLanFrame(frames[0]!)
  expect(received).toEqual([payload])
})

it('reserves JSON, base64url, pruning metadata, and request-id overhead at the exact frame limit', () => {
  const key = generateVaultKey()
  const input = { kind: 'stream' as const, id: opaqueIdOf(key, 's'), device: generateDeviceId(), counter: 1, accountKey: key, payload: new Uint8Array(3000) }
  const limit = publishFrameLimit(BUDGET)
  const parts = sealParts(input, limit)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.every(frame => frame.length <= limit)).toBe(true)
  for (const frame of parts) expect(publishRequestBytes([{ frame: Buffer.from(frame).toString('base64url'), covers: Number.MAX_SAFE_INTEGER }])).toBeLessThanOrEqual(BUDGET)
  expect(() => sealParts(input, 32)).toThrow(/fragment header/)
  const original = sealEnvelope(input)
  expect(prepareFrame(original, key, original.length)[0]).toBe(original)
})

it('does not expose a fragmented stream twice when the final publish acknowledgment is lost', async () => {
  const a = device()
  const b = device()
  const connection = await connect(a)
  await connect(b)
  const original = connection.request.bind(connection)
  let lost = false
  const spy = vi.spyOn(connection, 'request').mockImplementation(async (type, fields) => {
    const answer = await original(type, fields)
    if (type === 'publish' && !lost) {
      const items = fields?.frames as Array<{ frame: string }>
      const header = readEnvelopeHeader(Buffer.from(items.at(-1)!.frame, 'base64url'))
      if (header.fragment?.index === (header.fragment?.count ?? 0) - 1) {
        lost = true
        throw new Error('final acknowledgment lost')
      }
    }
    return answer
  })
  const payload = new Uint8Array(randomBytes(9000))
  a.vault.appendStream('sessions/retried', payload)
  await a.vault.flush()
  expect(lost).toBe(true)
  expect(a.store.pending()).toBe(1)
  spy.mockRestore()
  await a.vault.flush()
  a.vault.appendStream('sessions/retried', Uint8Array.of(42))
  await a.vault.flush()
  const batches: Uint8Array[] = []
  let cursor = 0
  for (;;) {
    const page = await b.vault.readStream('sessions/retried', cursor)
    batches.push(...page.batches.map(batch => batch.payload))
    cursor = page.batches.at(-1)?.seq ?? cursor
    if (!page.more) break
  }
  expect(batches).toEqual([payload, Uint8Array.of(42)])
  expect((await b.vault.readStream('sessions/retried', 0)).batches[0]?.payload).toEqual(payload)
})

it('prunes a snapshot prefix only after all its transport parts are stored', async () => {
  const a = device()
  const connection = await connect(a)
  const doc = a.vault.openDocument('doc')
  doc.doc.getMap('m').set('baseline', true)
  await a.vault.flush()
  const covers = relay.account('bounded').seq
  const id = a.vault.documentId('doc')
  const snapshotDoc = new Y.Doc()
  Y.applyUpdate(snapshotDoc, Y.encodeStateAsUpdate(doc.doc))
  snapshotDoc.getMap('m').set('blob', new Uint8Array(randomBytes(9000)))
  const snapshot = sealEnvelope({ kind: 'snapshot', id, device: a.store.deviceId(), accountKey: a.store.accountKey()!,
    counter: a.store.nextCounter(id), payload: Y.encodeStateAsUpdate(snapshotDoc) })
  snapshotDoc.destroy()
  const original = connection.request.bind(connection)
  let calls = 0
  const spy = vi.spyOn(connection, 'request').mockImplementation((type, fields) => {
    if (type === 'publish' && ++calls === 2) return Promise.reject(new Error('interrupted'))
    return original(type, fields)
  })
  a.store.enqueue(snapshot, covers)
  await a.vault.flush()
  expect(relay.account('bounded').frames.some(frame => frame.seq <= covers)).toBe(true)
  spy.mockRestore()
  await a.vault.flush()
  expect(relay.account('bounded').frames.every(frame => frame.seq > covers)).toBe(true)
  const fresh = device()
  const restored = fresh.vault.openDocument
  await connect(fresh)
  const remote = restored.call(fresh.vault, 'doc')
  await vi.waitFor(() => { expect(remote.doc.getMap('m').get('blob')).toHaveLength(9000) })
  expect(remote.doc.getMap('m').get('baseline')).toBe(true)
  doc.close()
  remote.close()
})

it('allocates maintenance snapshot counters with their outbox insertion', async () => {
  const a = device()
  const key = generateVaultKey()
  a.store.setAccountKey(key)
  const id = opaqueIdOf(key, 'doc')
  const doc = new Y.Doc()
  const updates: Uint8Array[] = []
  doc.on('update', (update) => { updates.push(update) })
  doc.getMap('m').set('k', 'first')
  doc.getMap('m').set('k', 'second')
  for (const update of updates) a.store.appendDocUpdate(id, update)
  for (let i = 0; i < 20; i++) a.store.nextCounter(id)
  await offload.maintain({ path: a.store.path, doc: id, compact: true,
    snapshot: { accountKey: key, device: a.store.deviceId(), covers: 10 } })
  const queued = a.store.outbox()[0]!
  expect(readEnvelopeHeader(queued.frame).counter).toBe(21)
  expect(queued.covers).toBe(10)
  expect(a.store.nextCounter(id)).toBe(22)
  expect(a.store.docUpdates(id)).toHaveLength(1)
  const restored = new Y.Doc()
  Y.applyUpdate(restored, a.store.docUpdates(id)[0]!)
  expect(restored.getMap('m').get('k')).toBe('second')
  restored.destroy()
  doc.destroy()
})
