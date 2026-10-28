/**
 * One account's vault on two devices against an in-process relay: frames under the account key apply on the other
 * device, frames it cannot open, replays, and its own frames are dropped while the cursor advances, a frame from
 * the local network applies, stream batches read back a page at a time, compaction and snapshots prune the relay,
 * and a frame the relay fails stays queued.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { brandString } from '@aeven/brand'
import { generateDeviceId, generateVaultKey, opaqueIdOf, sealEnvelope, type OpaqueId } from '@aeven/sync-vault'
import { SyncOffload } from '../src/offload.ts'
import { RelayConnection } from '../src/relay.ts'
import { SyncStore } from '../src/store.ts'
import { AccountVault, type VaultTuning } from '../src/vault.ts'
import { FakeRelay } from './fake-relay.ts'

let relay: FakeRelay
const dirs: string[] = []
const connections: RelayConnection[] = []
let accounts = 0
const offload = new SyncOffload()
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => {
  await offload.dispose()
  await relay.stop()
})
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const TUNING: VaultTuning = { compactAfter: 100, snapshotAfter: 100, applyFrames: 200, applyPauseMs: 0, pageFrames: 500, statusMs: 0, publishFrames: 100, publishBytes: 2_097_152 }

interface Device {
  store: SyncStore
  vault: AccountVault
  warn: ReturnType<typeof vi.fn>
  documents: string[]
}

function device(owner: string, tuning: VaultTuning = TUNING): Device {
  const dir = mkdtempSync(join(tmpdir(), 'sync-vault-'))
  dirs.push(dir)
  const store = new SyncStore(join(dir, 'sync.db'), owner)
  const warn = vi.fn()
  const documents: string[] = []
  const vault = new AccountVault(store, tuning, () => {}, (id) => { documents.push(id) }, warn, offload)
  return { store, vault, warn, documents }
}

async function connect(owner: string, target: Device): Promise<RelayConnection> {
  const connection = await RelayConnection.open(relay.url, `ok-${owner}`, {
    frame: (seq, frame) => { target.vault.receiveFrame(seq, frame) },
    closed: () => { target.vault.detach() },
  }, 2000, 2000)
  connections.push(connection)
  await target.vault.attach(connection)
  return connection
}

async function pair(tuning?: VaultTuning): Promise<{ owner: string; a: Device; b: Device }> {
  const owner = `vault-owner-${String(++accounts)}`
  const a = device(owner, tuning)
  const b = device(owner, tuning)
  await connect(owner, a)
  await connect(owner, b)
  return { owner, a, b }
}

describe('a vault on two devices', () => {
  it('takes the account key on connecting and carries edits both ways', async () => {
    const { owner, a, b } = await pair()
    expect(a.vault.status()).toMatchObject({ state: 'online' })
    expect(a.store.accountKey()).toEqual(new Uint8Array(Buffer.from(relay.account(owner).key, 'base64url')))
    const docA = a.vault.openDocument('settings/account')
    const docB = b.vault.openDocument('settings/account')
    docA.doc.getMap('prefs').set('theme', 'dark')
    await vi.waitFor(() => { expect(docB.doc.getMap('prefs').get('theme')).toBe('dark') })
    docB.doc.getMap('prefs').set('fontSize', 16)
    await vi.waitFor(() => { expect(docA.doc.getMap('prefs').get('fontSize')).toBe(16) })
    expect(b.documents).toContain(b.vault.documentId('settings/account'))
    docA.close()
    docB.close()
  })

  it('drops frames it cannot open, replays, and its own frames, while advancing the cursor', async () => {
    const { owner, a, b } = await pair()
    const id = b.vault.documentId('doc')
    b.vault.receiveFrame(500, sealEnvelope({ kind: 'update', id, accountKey: generateVaultKey(), device: generateDeviceId(), counter: 1, payload: Uint8Array.of(0) }))
    await vi.waitFor(() => { expect(b.warn).toHaveBeenCalledWith('sync: dropped relay frame 500', expect.any(Error)) })
    expect(b.store.relayCursor()).toBe(500)

    const doc = a.vault.openDocument('doc')
    doc.doc.getMap('m').set('k', 1)
    await vi.waitFor(() => { expect(b.store.docUpdates(id)).toHaveLength(1) })
    const frame = relay.account(owner).frames.at(-1)!.data
    b.vault.receiveFrame(900, new Uint8Array(frame))
    await vi.waitFor(() => { expect(b.store.relayCursor()).toBe(900) })
    expect(b.store.docUpdates(id)).toHaveLength(1)
    a.vault.receiveFrame(901, new Uint8Array(frame))
    await vi.waitFor(() => { expect(a.store.relayCursor()).toBe(901) })
    doc.close()
  })

  it('applies an update from a device on the local network and hands stream batches to their watchers', async () => {
    const { a, b } = await pair()
    const sent: Uint8Array[] = []
    a.vault.setLanSender((frame) => { sent.push(frame) })
    const doc = a.vault.openDocument('doc')
    doc.doc.getMap('m').set('k', 'lan')
    const batches: Uint8Array[] = []
    const stop = b.vault.watchStream('sessions/s', (payload) => { batches.push(payload) })
    a.vault.appendStream('sessions/s', Uint8Array.of(7))
    for (const frame of sent) b.vault.receiveLanFrame(frame)
    expect(batches).toEqual([Uint8Array.of(7)])
    expect(b.store.docUpdates(b.vault.documentId('doc'))).toHaveLength(1)
    b.vault.receiveLanFrame(Uint8Array.of(1, 2, 3))
    expect(b.warn).toHaveBeenCalledWith('sync: dropped a frame from a device on the local network', expect.anything())
    stop()
    doc.close()
  })

  it('appends stream batches behind queued frames and reads them back a page at a time', async () => {
    const { a, b } = await pair()
    for (const byte of [1, 2, 3]) a.vault.appendStream('sessions/s', Uint8Array.of(byte))
    await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })
    const first = await b.vault.readStream('sessions/s', 0)
    expect(first.batches.map(batch => batch.payload[0])).toEqual([1, 2])
    expect(first.more).toBe(true)
    const rest = await b.vault.readStream('sessions/s', first.batches.at(-1)!.seq)
    expect(rest.batches.map(batch => batch.payload[0])).toEqual([3])
  })

  it('compacts stored updates and queues a snapshot that prunes the relay', async () => {
    const { owner, a } = await pair({ ...TUNING, compactAfter: 3, snapshotAfter: 4 })
    const doc = a.vault.openDocument('doc')
    for (let i = 0; i < 6; i++) doc.doc.getMap('m').set('k', i)
    await vi.waitFor(() => { expect(relay.account(owner).frames.some(frame => frame.kind === 'snapshot')).toBe(true) })
    await vi.waitFor(() => { expect(a.store.docUpdates(a.vault.documentId('doc')).length).toBeLessThanOrEqual(3) })
    doc.close()
  })

  it('keeps frames queued when the relay fails them, and drops one the relay refuses outright', async () => {
    const { a } = await pair()
    relay.refusals.set('publish', ['server-error'])
    const doc = a.vault.openDocument('doc')
    doc.doc.getMap('m').set('k', 1)
    await vi.waitFor(() => { expect(a.warn).toHaveBeenCalledWith('sync: publishing frames failed; they stay queued', expect.anything()) })
    expect(a.store.pending()).toBe(1)
    relay.refusals.set('publish', ['bad-frame'])
    await a.vault.flush()
    expect(a.store.pending()).toBe(0)
    doc.close()
  })

  it('stops exchanging frames once the device turns sync off, and refuses document work', async () => {
    const owner = `vault-owner-${String(++accounts)}`
    const a = device(owner)
    expect(a.vault.status().state).toBe('starting')
    expect(() => a.vault.openDocument('doc')).toThrow(/does not sync/)
    await connect(owner, a)
    a.vault.setEnabled(false)
    expect(a.vault.status().state).toBe('disabled')
    expect(a.vault.ready()).toBe(false)
    a.vault.receiveFrame(1, Uint8Array.of(1))
    expect(a.store.relayCursor()).toBe(0)
    a.vault.setEnabled(true)
    expect(a.vault.status().state).toBe('offline')
  })
})

it('names a document by an id that hides its name', () => {
  const key = generateVaultKey()
  const id: OpaqueId = opaqueIdOf(key, 'memory/traces/ab')
  expect(id).not.toContain('memory')
  expect(opaqueIdOf(key, 'memory/traces/ab')).toBe(id)
  expect(opaqueIdOf(generateVaultKey(), 'memory/traces/ab')).not.toBe(id)
  expect(brandString<OpaqueId>(id)).toBe(id)
})
