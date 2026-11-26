/**
 * One account's vault on two devices against an in-process relay: frames under the account key apply on the other
 * device, frames it cannot open, replays, and its own frames are dropped while the cursor advances, a frame from
 * the local network applies, stream batches read back a page at a time, compaction and snapshots prune the relay,
 * and a frame the relay fails stays queued.
 */
import * as Y from 'yjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { brandString } from '@aeven/brand'
import { SyncKeyHolderMismatch } from '@aeven/sync'
import { generateDeviceId, generateVaultKey, opaqueIdOf, openEnvelope, sealEnvelope, type OpaqueId } from '@aeven/sync-vault'
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

const TUNING: VaultTuning = {
  firstDocuments: [],
  compactAfter: 100,
  compactBytes: 8_388_608,
  snapshotAfter: 100,
  churnUpdates: 10_000,
  churnWindowMs: 3_600_000,
  applyFrames: 200,
  applyPauseMs: 0,
  pageFrames: 500,
  statusMs: 0,
  publishFrames: 100,
  publishBytes: 2_097_152,
}

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
  const vault = new AccountVault(store, tuning, () => {
    if (vault.status().state !== 'starting' && vault.status().state !== 'disabled') {
      expect(vault.ready()).toBe(true)
      expect(() => vault.documentId('memory')).not.toThrow()
    }
  }, (id) => { documents.push(id) }, warn, offload, vi.fn())
  return { store, vault, warn, documents }
}

async function connect(owner: string, target: Device, beforeAttach?: (connection: RelayConnection) => void): Promise<RelayConnection> {
  const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: `ok-${owner}` }, {
    frame: (seq, frame) => { target.vault.receiveFrame(seq, frame) },
    closed: () => { target.vault.detach() },
  }, 2000, 2000, 0, 0)
  connections.push(connection)
  beforeAttach?.(connection)
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
  it('derives a shared folder password only after the account key arrives', async () => {
    const owner = `secret-owner-${String(++accounts)}`
    const a = device(owner)
    const b = device(owner)
    const label = 'file-sync/folder/example'
    expect(() => a.vault.secret(label)).toThrow('this device does not sync the account')
    await connect(owner, a)
    await connect(owner, b)
    expect(a.vault.secret(label)).toBe(b.vault.secret(label))
    expect(a.vault.secret(`${label}-other`)).not.toBe(a.vault.secret(label))
  })

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

  it('publishes on its next connection what its copy holds and the relay lost, and nothing once the relay holds everything', async () => {
    const owner = `reconcile-owner-${String(++accounts)}`
    const a = device(owner)
    const b = device(owner)
    const first = await connect(owner, a)
    await connect(owner, b)
    const id = a.vault.documentId('sessions/index')
    const docA = a.vault.openDocument('sessions/index')
    const docB = b.vault.openDocument('sessions/index')
    docA.doc.getMap('sessions').set('chat', { next: 1 })
    await vi.waitFor(() => { expect(docB.doc.getMap('sessions').get('chat')).toEqual({ next: 1 }) })
    // A later write reaches this device's store but not the relay, as an update the other devices refused does.
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(docA.doc))
    const lost: Uint8Array[] = []
    copy.on('update', (update: Uint8Array) => { lost.push(update) })
    copy.getMap('sessions').set('chat', { next: 767 })
    docA.close()
    for (const update of lost) a.store.appendDocUpdate(id, update)
    const forget = (): void => {
      const raw = new Database(a.store.path)
      raw.prepare("DELETE FROM meta WHERE key = 'reconciled'").run()
      raw.close()
    }
    forget()
    first.close()
    await vi.waitFor(() => { expect(a.vault.status().state).not.toBe('online') })
    const second = await connect(owner, a)
    await vi.waitFor(() => { expect(docB.doc.getMap('sessions').get('chat')).toEqual({ next: 767 }) })
    await vi.waitFor(() => { expect(a.store.reconciled()).toBe(true) })

    const published = relay.account(owner).frames.filter(frame => frame.id === id).length
    forget()
    second.close()
    await vi.waitFor(() => { expect(a.vault.status().state).not.toBe('online') })
    await connect(owner, a)
    await vi.waitFor(() => { expect(a.store.reconciled()).toBe(true) })
    expect(relay.account(owner).frames.filter(frame => frame.id === id)).toHaveLength(published)
    docB.close()
  })

  it('applies an update published under a counter that fell behind, because it carries what the copy lacks', async () => {
    const owner = `restart-owner-${String(++accounts)}`
    const a = device(owner)
    const b = device(owner)
    const first = await connect(owner, a)
    await connect(owner, b)
    const id = a.vault.documentId('sessions/index')
    const docA = a.vault.openDocument('sessions/index')
    const docB = b.vault.openDocument('sessions/index')
    docA.doc.getMap('sessions').set('chat', { next: 1 })
    await vi.waitFor(() => { expect(docB.doc.getMap('sessions').get('chat')).toEqual({ next: 1 }) })
    // The next write leaves under a counter below the one the other device accepted; it still carries new content.
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(docA.doc))
    const lost: Uint8Array[] = []
    copy.on('update', (update: Uint8Array) => { lost.push(update) })
    copy.getMap('sessions').set('chat', { next: 767 })
    docA.close()
    const accountKey = a.store.accountKey()!
    for (const update of lost) {
      a.store.appendDocUpdate(id, update)
      await first.request('publish', { frame: Buffer.from(sealEnvelope({ kind: 'update', id, accountKey, device: a.store.deviceId(), counter: 1, payload: update })).toString('base64url') })
    }
    await vi.waitFor(() => { expect(docB.doc.getMap('sessions').get('chat')).toEqual({ next: 767 }) })
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

  it('lets only the device that writes a document upload its snapshot, and counts again from that snapshot on the other', async () => {
    const { owner, a, b } = await pair({ ...TUNING, compactAfter: 1_000, snapshotAfter: 4 })
    const id = a.vault.documentId('doc')
    const docA = a.vault.openDocument('doc')
    const docB = b.vault.openDocument('doc')
    for (let i = 0; i < 6; i++) docA.doc.getMap('m').set('k', i)
    await vi.waitFor(() => { expect(docB.doc.getMap('m').get('k')).toBe(5) })
    await vi.waitFor(() => { expect(relay.account(owner).snapshots).toEqual([a.store.deviceId()]) })
    await vi.waitFor(() => { expect(a.store.pending() + b.store.pending()).toBe(0) })
    // B received the same six frames and A's snapshot; its count starts over at the snapshot instead of passing four.
    expect(b.store.countSinceSnapshot(id, 0)).toBeLessThanOrEqual(2)
    expect(relay.account(owner).snapshots).toEqual([a.store.deviceId()])
    docA.close()
    docB.close()
  })

  it('uploads a snapshot from a device that only receives once the writer left twice the count unanswered', async () => {
    const { owner, a, b } = await pair({ ...TUNING, compactAfter: 1_000, snapshotAfter: 4 })
    const id = a.vault.documentId('doc')
    const docB = b.vault.openDocument('doc')
    // Frames of another device that never snapshots, as while its own copy waits for a missing update.
    const writer = new Y.Doc()
    const updates: Uint8Array[] = []
    writer.on('update', (update: Uint8Array) => { updates.push(update) })
    for (let i = 0; i < 9; i++) writer.getMap('m').set('k', i)
    const key = a.store.accountKey()!
    const connection = await RelayConnection.open(relay.url, { scheme: 'Bearer', token: `ok-${owner}` }, { frame: () => {}, closed: () => {} }, 2000, 2000, 0, 0)
    connections.push(connection)
    const other = generateDeviceId()
    for (const [index, update] of updates.entries()) {
      const frame = sealEnvelope({ kind: 'update', id, accountKey: key, device: other, counter: index + 1, payload: update })
      await connection.request('publish', { frame: Buffer.from(frame).toString('base64url') })
    }
    await vi.waitFor(() => { expect(docB.doc.getMap('m').get('k')).toBe(8) })
    await vi.waitFor(() => { expect(relay.account(owner).snapshots.length).toBeGreaterThan(0) })
    expect(relay.account(owner).snapshots.every(device => device === a.store.deviceId() || device === b.store.deviceId())).toBe(true)
    docB.close()
  })

  it('warns once when a document takes more updates than the churn limit within the window', async () => {
    const { a } = await pair({ ...TUNING, churnUpdates: 5 })
    const doc = a.vault.openDocument('workspace-git/example')
    for (let i = 0; i < 12; i++) doc.doc.getMap('m').set('k', i)
    const churn = a.warn.mock.calls.filter(([message]) => String(message).includes('may be rewriting it in a loop'))
    expect(churn).toHaveLength(1)
    expect(String(churn[0]![0])).toContain('document workspace-git/example took 6 updates')
    doc.close()
  })

  it('merges a few large updates by their size, and merges a document that outgrew the limit before it is opened', async () => {
    const { a } = await pair({ ...TUNING, compactAfter: 1_000, compactBytes: 50_000 })
    const id = a.vault.documentId('doc')
    const doc = a.vault.openDocument('doc')
    const big = 'x'.repeat(20_000)
    // Four rewrites of one large value: far below the update-count threshold, above the byte one.
    for (let i = 0; i < 4; i++) doc.doc.getMap('m').set('k', `${String(i)}${big}`)
    await vi.waitFor(() => { expect(a.store.docUpdates(id).length).toBe(1) })
    expect(a.store.docUpdates(id)[0]!.byteLength).toBeLessThan(40_000)
    doc.close()
    // Updates stored while no one holds the document, as frames from another device are.
    for (let i = 0; i < 4; i++) {
      const other = new Y.Doc()
      other.getMap('n').set('k', `${String(i)}${big}`)
      a.store.appendDocUpdate(id, Y.encodeStateAsUpdate(other))
    }
    expect(a.store.docUpdates(id).length).toBe(5)
    await a.vault.settleDocument('doc')
    expect(a.store.docUpdates(id).length).toBe(1)
    const reopened = a.vault.openDocument('doc')
    expect(reopened.doc.getMap('m').get('k')).toBe(`3${big}`)
    expect(typeof reopened.doc.getMap('n').get('k')).toBe('string')
    reopened.close()
  })

  it('reads a document\'s map entries without opening it, then retires it and drops its later frames', async () => {
    const { a, b } = await pair()
    const doc = a.vault.openDocument('legacy')
    doc.doc.getMap('records').set('w1', { title: 'One', updatedAt: '1' })
    doc.doc.getMap('records').set('w1', { title: 'One renamed', updatedAt: '2' })
    doc.doc.getMap('archived').set('s1', { archived: true, at: 5 })
    doc.doc.getArray('order').insert(0, ['w1', 'w1', 'w1'])
    await vi.waitFor(async () => {
      const entries = await b.vault.documentEntries('legacy', ['records', 'archived'])
      expect(entries['records']!['w1']).toEqual(expect.arrayContaining([{ title: 'One renamed', updatedAt: '2' }]))
      expect(entries['archived']!['s1']).toEqual([{ archived: true, at: 5 }])
    })
    b.vault.retireDocument('legacy')
    expect(b.store.docUpdates(b.vault.documentId('legacy'))).toEqual([])
    doc.doc.getMap('records').set('w2', { title: 'Two', updatedAt: '3' })
    const other = a.vault.openDocument('other')
    other.doc.getMap('m').set('k', 1)
    // A frame written after the retired document's arrives; the retired one stored nothing.
    await vi.waitFor(() => { expect(b.store.docUpdates(b.vault.documentId('other')).length).toBeGreaterThan(0) })
    expect(b.store.docUpdates(b.vault.documentId('legacy'))).toEqual([])
    doc.close()
    other.close()
  })

  it('retains unacknowledged frames after permanent relay refusals', async () => {
    const { a } = await pair()
    relay.refusals.set('publish', ['bad-frame'])
    const doc = a.vault.openDocument('doc')
    doc.doc.getMap('m').set('k', 1)
    await vi.waitFor(() => { expect(a.warn).toHaveBeenCalledWith('sync: publishing frames failed; they stay queued', expect.anything()) })
    expect(a.store.pending()).toBe(1)
    expect(a.vault.status().error).toBe('upload')
    relay.refusals.set('publish', ['bad-frame'])
    await a.vault.flush()
    expect(a.store.pending()).toBe(1)
    await a.vault.flush()
    expect(a.store.pending()).toBe(0)
    expect(a.vault.status().error).toBeUndefined()
    doc.close()
  })

  it('reports catch-up until the relay history has been applied', async () => {
    const owner = `vault-owner-${String(++accounts)}`
    const a = device(owner)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await connect(owner, a, (connection) => {
      const request = connection.request.bind(connection)
      vi.spyOn(connection, 'request').mockImplementation(async (type, fields) => {
        if (type === 'sync') await held
        return await request(type, fields)
      })
    })
    try {
      expect(a.vault.status()).toMatchObject({ state: 'online', pending: 0, catchingUp: true })
    } finally {
      release()
    }
    await vi.waitFor(() => { expect(a.vault.status().catchingUp).toBeUndefined() })
  })

  it('closes a refused catch-up connection and preserves a visible download error', async () => {
    const owner = `vault-owner-${String(++accounts)}`
    const a = device(owner)
    relay.refusals.set('sync', ['server-error'])
    const connection = await connect(owner, a)
    await connection.closed
    expect(a.vault.status()).toMatchObject({ state: 'offline', error: 'download' })
    await connect(owner, a)
    await vi.waitFor(() => { expect(a.vault.status().catchingUp).toBeUndefined() })
    expect(a.vault.status().error).toBeUndefined()
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

describe('an account whose key passkeys hold', () => {
  const passkey = (n: number, extra: Record<string, string> = {}) => ({
    credentialId: Buffer.alloc(16, n).toString('base64url'),
    prf: new Uint8Array(Buffer.alloc(32, n)),
    ...extra,
  })

  /** A device whose start-over hook is a spy, so a test can see its Consumers asked to publish again. */
  function watched(owner: string): Device & { startedOver: ReturnType<typeof vi.fn> } {
    const dir = mkdtempSync(join(tmpdir(), 'sync-vault-'))
    dirs.push(dir)
    const store = new SyncStore(join(dir, 'sync.db'), owner)
    const warn = vi.fn()
    const startedOver = vi.fn()
    const vault = new AccountVault(store, TUNING, () => {}, () => {}, warn, offload, startedOver)
    return { store, vault, warn, documents: [], startedOver }
  }

  it('records the passkey provider and device so a locked device can name the passkey', async () => {
    const { owner, a } = await pair()
    await a.vault.protect(passkey(1, { aaguid: 'ea9b8d664d011d213ce4b6b48cb575d4', device: 'android' }))
    expect(a.vault.status().protection).toMatchObject({ mode: 'passkey', locked: false, passkeys: [passkey(1).credentialId] })
    const c = device(owner)
    await connect(owner, c)
    expect(c.vault.status().protection).toMatchObject({
      locked: true,
      holders: [{ id: passkey(1).credentialId, kind: 'passkey', aaguid: 'ea9b8d664d011d213ce4b6b48cb575d4', device: 'android', addedAt: expect.any(String) as string }],
    })
  })

  it('tells a device which passkeys also sign in', async () => {
    const { owner, a } = await pair()
    await a.vault.protect({ ...passkey(1), signIn: { publicKey: 'spki', alg: -7 } })
    await a.vault.addPasskey(passkey(2))
    const c = device(owner)
    await connect(owner, c)
    expect(c.vault.status().protection?.holders.map(holder => [holder.id, holder.signIn]))
      .toEqual([[passkey(1).credentialId, true], [passkey(2).credentialId, false]])
  })

  it('refuses a passkey that holds no copy of the key, and unlocks with one that does', async () => {
    const { owner, a } = await pair()
    await a.vault.protect(passkey(1))
    const c = device(owner)
    await connect(owner, c)
    expect(() => { c.vault.unlock(passkey(2)) }).toThrow(SyncKeyHolderMismatch)
    expect(c.vault.status().protection?.locked).toBe(true)
    c.vault.unlock(passkey(1))
    expect(c.vault.status().protection?.locked).toBe(false)
  })

  it('unlocks a new device with a recovery key while passkeys stay the only copies it lists as passkeys', async () => {
    const { owner, a } = await pair()
    await a.vault.protect(passkey(1))
    const recovery = { credentialId: 'recovery-AAAAAAAAAAAAAAAAAAAAAA', prf: new Uint8Array(randomBytes(32)), kind: 'recovery' as const }
    await a.vault.addPasskey(recovery)
    expect(a.vault.status().protection).toMatchObject({ passkeys: [passkey(1).credentialId], holders: [{ kind: 'passkey' }, { kind: 'recovery' }] })
    const c = device(owner)
    await connect(owner, c)
    c.vault.unlock(recovery)
    expect(c.vault.status().protection?.locked).toBe(false)
  })

  it('names a copy of the key and keeps the name on other devices', async () => {
    const { owner, a } = await pair()
    await a.vault.protect(passkey(1))
    await a.vault.renamePasskey(passkey(1).credentialId, 'Work laptop')
    expect(a.vault.status().protection?.holders[0]).toMatchObject({ name: 'Work laptop' })
    const c = device(owner)
    await connect(owner, c)
    expect(c.vault.status().protection?.holders[0]).toMatchObject({ name: 'Work laptop' })
  })

  it('starts over from a locked device: it takes a new relay key and its Consumers publish again', async () => {
    const owner = `vault-owner-${String(++accounts)}`
    const a = device(owner)
    await connect(owner, a)
    await a.vault.protect(passkey(1))
    const c = watched(owner)
    await connect(owner, c)
    expect(c.vault.status().protection?.locked).toBe(true)
    await c.vault.unprotect()
    expect(c.vault.status().protection).toMatchObject({ mode: 'server', locked: false, downgraded: false, holders: [] })
    expect(c.store.accountKey()).toEqual(new Uint8Array(Buffer.from(relay.account(owner).key, 'base64url')))
    expect(c.startedOver).toHaveBeenCalled()
  })
})

describe('a vault being disposed', () => {
  it('reads nothing from the store once disposal starts: no status report, socket close, or late frame touches it after the owner closes it', async () => {
    const owner = `dispose-owner-${String(++accounts)}`
    const dir = mkdtempSync(join(tmpdir(), 'sync-vault-'))
    dirs.push(dir)
    const store = new SyncStore(join(dir, 'sync.db'), owner)
    const reports: string[] = []
    let closed = false
    const vault = new AccountVault(store, { ...TUNING, statusMs: 40 }, () => {
      if (closed) throw new Error('status reported after the store closed')
      reports.push(vault.status().state)
    }, vi.fn(), vi.fn(), offload, vi.fn())
    const connection = await connect(owner, { store, vault, warn: vi.fn(), documents: [] })
    expect(vault.status().state).toBe('online')
    const before = reports.length
    await vault.dispose()
    store.close()
    closed = true
    vault.receiveFrame(1, new Uint8Array(8))
    connection.close()
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    expect(reports.length).toBe(before)
  })
})

describe('a copy stuck behind an update the relay lost', () => {
  it('asks the account for it, and the device that holds it republishes its whole copy', async () => {
    const owner = `repair-owner-${String(++accounts)}`
    const a = device(owner)
    const b = device(owner)
    const aConnection = await connect(owner, a)
    const bConnection = await connect(owner, b)
    const id = a.vault.documentId('automations')
    const docA = a.vault.openDocument('automations')
    const docB = b.vault.openDocument('automations')
    docA.doc.getMap('definitions').set('other', { v: 1 })
    await vi.waitFor(() => { expect(docB.doc.getMap('definitions').get('other')).toEqual({ v: 1 }) })
    bConnection.close()
    await vi.waitFor(() => { expect(b.vault.status().state).not.toBe('online') })
    docA.doc.getMap('definitions').set('radar', { name: 'Nightly AI radar' })
    docA.doc.getMap('definitions').set('radar', { name: 'Nightly AI radar', v: 2 })
    await vi.waitFor(() => { expect(relay.account(owner).frames.filter(frame => frame.id === id)).toHaveLength(3) })
    aConnection.close()
    await vi.waitFor(() => { expect(a.vault.status().state).not.toBe('online') })
    // The relay loses the middle frame; the last one builds on it, so B holds it as a pending update.
    const lost = relay.account(owner).frames.filter(frame => frame.id === id)[1]!.seq
    relay.account(owner).frames = relay.account(owner).frames.filter(frame => frame.seq !== lost)
    const bAgain = await connect(owner, b)
    await vi.waitFor(() => { expect(b.warn).toHaveBeenCalledWith(expect.stringContaining('waits for updates it never received'), expect.any(Error)) })
    expect(docB.doc.getMap('definitions').get('radar')).toBeUndefined()
    // A snapshot of B's copy, as a build without the snapshot guard published it, claims the clocks B waits for
    // and lets the relay delete A's frames: comparing with the relay's copy finds nothing missing.
    const snapshot = sealEnvelope({
      kind: 'snapshot', id, accountKey: b.store.accountKey()!, device: b.store.deviceId(), counter: b.store.nextCounter(id),
      payload: Y.mergeUpdates(b.store.docUpdates(id)),
    })
    await bAgain.request('publish', { frame: Buffer.from(snapshot).toString('base64url'), covers: relay.account(owner).seq })
    expect(relay.account(owner).frames.filter(frame => frame.id === id).map(frame => frame.kind)).toEqual(['snapshot'])
    await connect(owner, a)
    await vi.waitFor(() => { expect(docB.doc.getMap('definitions').get('radar')).toEqual({ name: 'Nightly AI radar', v: 2 }) }, { timeout: 5_000 })
    // The answer is A's whole copy in one update: applied alone, it holds every entry, so it completes B whatever
    // the relay's copy claims and whichever earlier updates of other writers the missing ones build on.
    const answer = relay.account(owner).frames.filter(frame => frame.id === id && frame.kind === 'update').at(-1)!
    const opened = openEnvelope(new Uint8Array(answer.data), a.store.accountKey()!)
    expect(opened.header.device).toBe(a.store.deviceId())
    const alone = new Y.Doc()
    Y.applyUpdate(alone, opened.payload)
    expect(alone.store.pendingStructs).toBeNull()
    expect(alone.getMap('definitions').toJSON()).toEqual({ other: { v: 1 }, radar: { name: 'Nightly AI radar', v: 2 } })
    const repairs = b.vault.openDocument('sync/repair')
    await vi.waitFor(() => { expect([...repairs.doc.getMap('requests').keys()]).toEqual([]) }, { timeout: 5_000 })
    repairs.close()
    docA.close()
    docB.close()
  })
})
