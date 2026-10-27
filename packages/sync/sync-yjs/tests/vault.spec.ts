/**
 * One account's vault across devices against an in-process relay: creation, approval of a new device, edits
 * reaching the other device, removal and key rotation, refused and replayed frames, outbox order, snapshots,
 * compaction, and streams.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { brandNumber, brandString } from '@aeven/brand'
import {
  createChainEntry, generateDeviceKeys, generateVaultKey, opaqueIdOf, sealEnvelope, verifyChain,
  type DeviceKeys, type KeyEpoch, type OpaqueId,
} from '@aeven/sync-vault'
import { JoinApprover, JoinRequester } from '../src/join.ts'
import { RelayConnection } from '../src/relay.ts'
import { SyncStore } from '../src/store.ts'
import { AccountVault, type VaultTuning } from '../src/vault.ts'
import { FakeRelay } from './fake-relay.ts'

let relay: FakeRelay
const dirs: string[] = []
const opened: RelayConnection[] = []
let accountNumber = 0
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => { await relay.stop() })
afterEach(() => {
  for (const connection of opened.splice(0)) connection.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Device {
  vault: AccountVault
  store: SyncStore
  warn: ReturnType<typeof vi.fn>
  documents: string[]
  connect(): Promise<RelayConnection>
}

function device(owner: string, tuning: VaultTuning = { compactAfter: 100, snapshotAfter: 100 }): Device {
  const dir = mkdtempSync(join(tmpdir(), 'sync-vault-'))
  dirs.push(dir)
  const store = new SyncStore(join(dir, 'sync.db'), owner)
  const warn = vi.fn()
  const documents: string[] = []
  const vault = new AccountVault(store, tuning, () => {}, () => {}, (id) => { documents.push(id) }, warn)
  return {
    vault, store, warn, documents,
    async connect() {
      const connection: RelayConnection = await RelayConnection.open(relay.url, `ok-${owner}`, {
        frame: (seq, frame) => { vault.receiveFrame(seq, frame) },
        chain: (entry) => { vault.receiveChainEntry(entry) },
        signal: (from, data) => { vault.receiveSignal(connection, from, data) },
        closed: () => { vault.detach() },
      }, 2000)
      opened.push(connection)
      await vault.attach(connection)
      return connection
    },
  }
}

async function plain(owner: string, handlers: Partial<Parameters<typeof RelayConnection.open>[2]> = {}): Promise<RelayConnection> {
  const connection = await RelayConnection.open(relay.url, `ok-${owner}`, { frame() {}, chain() {}, signal() {}, closed() {}, ...handlers }, 2000)
  opened.push(connection)
  return connection
}

/** A new account with device A enrolled and connected. */
async function account(tuning?: VaultTuning): Promise<{ owner: string; a: Device; connectionA: RelayConnection }> {
  const owner = `acct${String(++accountNumber)}`
  const a = device(owner, tuning)
  await a.vault.create(await plain(owner))
  const connectionA = await a.connect()
  return { owner, a, connectionA }
}

/** Admit device B through the code exchange, with A's add-device screen open. */
async function admit(owner: string, a: Device, connectionA: RelayConnection, b: Device): Promise<RelayConnection> {
  const stop = a.vault.acceptJoins(connectionA)
  const keys = b.vault.prepareJoin()
  const holder: { requester?: JoinRequester } = {}
  let admitted = false
  const joining = await plain(owner, {
    signal: (from, data) => { holder.requester?.receive(from, data) },
    chain: (entry) => { if (entry.body.type === 'add-device' && entry.body.device.id === keys.id) admitted = true },
  })
  holder.requester = new JoinRequester(joining, keys)
  await holder.requester.start()
  const code = await holder.requester.code
  await vi.waitFor(() => { expect(a.vault.joinRequests()).toHaveLength(1) })
  const request = a.vault.joinRequests()[0]!
  expect(request.code).toBe(code)
  await a.vault.admit(connectionA, a.vault.takeJoinRequest(request.id)!.keys)
  stop()
  await vi.waitFor(() => { expect(admitted).toBe(true) })
  joining.close()
  return b.connect()
}

describe('a vault on two devices', () => {
  it('creates a vault, admits a second device by code, and carries edits both ways', async () => {
    const { owner, a, connectionA } = await account()
    expect(a.vault.status()).toMatchObject({ state: 'online', devices: 1, pending: 0 })
    const docA = a.vault.openDocument('settings/account')
    docA.doc.getMap('prefs').set('theme', 'dark')
    await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })

    const b = device(owner)
    expect(b.vault.status()).toEqual({ state: 'unenrolled', devices: 0, pending: 0 })
    expect(b.vault.hasKeys()).toBe(false)
    await admit(owner, a, connectionA, b)
    expect(b.vault.status()).toMatchObject({ state: 'online', devices: 2 })
    await vi.waitFor(() => { expect(a.vault.status().devices).toBe(2) })

    const docB = b.vault.openDocument('settings/account')
    expect(docB.doc.getMap('prefs').get('theme')).toBe('dark')
    docB.doc.getMap('prefs').set('fontSize', 16)
    await vi.waitFor(() => { expect(docA.doc.getMap('prefs').get('fontSize')).toBe(16) })
    expect(a.documents).toContain(a.vault.documentId('settings/account'))

    const second = a.vault.openDocument('settings/account')
    docA.close()
    docA.close()
    expect(second.doc.getMap('prefs').get('fontSize')).toBe(16)
    second.close()
    a.vault.dispose()
    b.vault.dispose()
  })

  it('refuses enrollment operations that do not fit the device', async () => {
    const { owner, a, connectionA } = await account()
    await expect(a.vault.create(connectionA)).rejects.toThrow(/already belongs/)
    expect(() => a.vault.prepareJoin()).toThrow(/already enrolled/)
    const fresh = device(owner)
    expect(() => fresh.vault.openDocument('x')).toThrow(/not enrolled/)
    expect(fresh.vault.prepareJoin()).toBe(fresh.vault.prepareJoin())
    expect(fresh.vault.hasKeys()).toBe(true)
    expect(fresh.vault.joinRequests()).toEqual([])
    expect(fresh.vault.takeJoinRequest('missing')).toBeUndefined()
    fresh.vault.receiveSignal(connectionA, 1, { type: 'join-request', commitment: 'c' })
    fresh.vault.receiveFrame(1, new Uint8Array(10))
    expect(fresh.vault.joinRequests()).toEqual([])
    await expect(fresh.vault.readStream('s', 0)).rejects.toThrow()
  })

  it('stops admitting a removed device, and warns when the rotated keyring is missing', async () => {
    const { owner, a, connectionA } = await account()
    const b = device(owner)
    await admit(owner, a, connectionA, b)
    const state = verifyChain(a.store.chain())
    const removal = createChainEntry(state, { type: 'remove-device', device: b.vault.status().device!, epoch: brandNumber<KeyEpoch>(1) }, { kind: 'device', device: a.store.deviceKeys()! })
    await connectionA.request('chain.append', { entry: removal })
    relay.account(owner).keys.delete(a.vault.status().device!)
    a.vault.receiveChainEntry(removal)
    await vi.waitFor(() => { expect(b.vault.status().state).toBe('unenrolled') })
    expect(b.vault.enrolled()).toBe(false)
    await vi.waitFor(() => { expect(a.warn).toHaveBeenCalledWith('sync: fetching the rotated keyring failed', expect.any(Error)) })
    const removedId = b.vault.status().device
    expect(b.vault.prepareJoin().id).not.toBe(removedId)
  })

  it('ignores a chain entry on a device that holds no chain', () => {
    const fresh = device('nochain')
    fresh.vault.receiveChainEntry(verifyChain([]) as never)
    expect(fresh.vault.status().state).toBe('unenrolled')
  })
})

describe('frames', () => {
  it('drops frames it cannot open, replays, and its own frames, while advancing the cursor', async () => {
    const { owner, a, connectionA } = await account()
    const b = device(owner)
    await admit(owner, a, connectionA, b)
    const keyring = a.store.keyring()
    const genesis = keyring.get(brandNumber<KeyEpoch>(0))!
    const id = opaqueIdOf(genesis, 'doc')
    const outsider = generateDeviceKeys()
    b.vault.receiveFrame(500, sealEnvelope({ kind: 'update', id, epoch: brandNumber<KeyEpoch>(0), vaultKey: genesis, sender: outsider, counter: 1, payload: Uint8Array.of(0) }))
    expect(b.warn).toHaveBeenCalledWith('sync: dropped relay frame 500', expect.any(Error))
    expect(b.store.relayCursor()).toBe(500)

    const doc = a.vault.openDocument('doc')
    doc.doc.getMap('m').set('k', 1)
    await vi.waitFor(() => { expect(b.store.docUpdates(id)).toHaveLength(1) })
    const frame = a.store.outbox().length === 0 ? relay.account(owner).frames.at(-1)!.data : undefined
    b.vault.receiveFrame(900, new Uint8Array(frame!))
    expect(b.store.docUpdates(id)).toHaveLength(1)
    a.vault.receiveFrame(901, new Uint8Array(frame!))
    expect(a.store.relayCursor()).toBe(901)
    doc.close()
  })

  it('keeps a frame queued when the relay fails it and drops one the relay refuses outright', async () => {
    const { owner, a } = await account()
    relay.refusals.set('publish', ['server-error'])
    const doc = a.vault.openDocument('doc')
    doc.doc.getMap('m').set('k', 1)
    await vi.waitFor(() => { expect(a.warn).toHaveBeenCalledWith('sync: publishing a frame failed; it stays queued', expect.anything()) })
    expect(a.store.pending()).toBe(1)
    relay.refusals.set('publish', ['too-large'])
    await a.vault.flush()
    expect(a.warn).toHaveBeenCalledWith('sync: the relay refused a frame (too-large); dropping it', expect.anything())
    expect(a.store.pending()).toBe(0)
    a.vault.detach()
    doc.doc.getMap('m').set('k', 2)
    await a.vault.flush()
    expect(a.store.pending()).toBe(1)
    expect(relay.account(owner).frames).toHaveLength(0)
    doc.close()
  })

  it('compacts stored updates and queues a snapshot that prunes the relay', async () => {
    const { owner, a } = await account({ compactAfter: 3, snapshotAfter: 4 })
    const doc = a.vault.openDocument('doc')
    for (let i = 0; i < 6; i++) doc.doc.getMap('m').set('k', i)
    await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })
    const id = a.vault.documentId('doc')
    expect(a.store.docUpdates(id).length).toBeLessThanOrEqual(3)
    expect(relay.account(owner).frames.some(frame => frame.kind === 'snapshot')).toBe(true)
    doc.close()
  })

  it('appends stream batches behind queued frames and reads them back a page at a time', async () => {
    const { a } = await account()
    for (const value of [1, 2, 3]) a.vault.appendStream('sessions/s1', Uint8Array.of(value))
    await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })
    const first = await a.vault.readStream('sessions/s1', 0)
    expect(first.batches.map(batch => batch.payload)).toEqual([Uint8Array.of(1), Uint8Array.of(2)])
    expect(first.more).toBe(true)
    const rest = await a.vault.readStream('sessions/s1', first.batches.at(-1)!.seq)
    expect(rest).toMatchObject({ batches: [{ payload: Uint8Array.of(3) }], more: false })
  })

  it('refuses to seal or name documents without its genesis key', () => {
    const owner = 'nokeys'
    const lonely = device(owner)
    const keys: DeviceKeys = generateDeviceKeys()
    lonely.store.setDeviceKeys(keys)
    lonely.store.setChain([createChainEntry(verifyChain([]), { type: 'genesis', device: { id: keys.id, signing: Buffer.from(keys.publicKeys.signing).toString('base64url'), agreement: Buffer.from(keys.publicKeys.agreement).toString('base64url') } }, { kind: 'device', device: keys })])
    const reopened = new AccountVault(lonely.store, { compactAfter: 10, snapshotAfter: 10 }, () => {}, () => {}, () => {}, vi.fn())
    expect(() => reopened.documentId('x')).toThrow(/genesis key/)
    lonely.store.addKeys(new Map([[brandNumber<KeyEpoch>(5), generateVaultKey()]]))
    expect(() => { reopened.appendStream('x', Uint8Array.of(1)) }).toThrow(/genesis key/)
  })

  it('refuses to seal under an epoch it does not hold', () => {
    const owner = 'noepoch'
    const lonely = device(owner)
    const keys = generateDeviceKeys()
    lonely.store.setDeviceKeys(keys)
    const genesis = createChainEntry(verifyChain([]), { type: 'genesis', device: { id: keys.id, signing: Buffer.from(keys.publicKeys.signing).toString('base64url'), agreement: Buffer.from(keys.publicKeys.agreement).toString('base64url') } }, { kind: 'device', device: keys })
    const other = generateDeviceKeys()
    const added = createChainEntry(verifyChain([genesis]), { type: 'add-device', device: { id: other.id, signing: Buffer.from(other.publicKeys.signing).toString('base64url'), agreement: Buffer.from(other.publicKeys.agreement).toString('base64url') } }, { kind: 'device', device: keys })
    const removed = createChainEntry(verifyChain([genesis, added]), { type: 'remove-device', device: other.id, epoch: brandNumber<KeyEpoch>(1) }, { kind: 'device', device: keys })
    lonely.store.setChain([genesis, added, removed])
    lonely.store.addKeys(new Map([[brandNumber<KeyEpoch>(0), generateVaultKey()]]))
    const reopened = new AccountVault(lonely.store, { compactAfter: 10, snapshotAfter: 10 }, () => {}, () => {}, () => {}, vi.fn())
    expect(() => { reopened.appendStream('x', Uint8Array.of(1)) }).toThrow(/lacks epoch 1/)
  })
})

describe('the approval exchange', () => {
  const keys = generateDeviceKeys()

  it('answers only while accepting, verifies the reveal, and ignores signals it does not know', async () => {
    const connection = await plain('signals')
    const changed = vi.fn()
    const approver = new JoinApprover(keys, changed)
    const joining = generateDeviceKeys()
    const sent = vi.spyOn(connection, 'request')
    approver.receive(connection, 7, { type: 'join-request', commitment: 'x' })
    expect(sent).not.toHaveBeenCalled()
    const stop = approver.accept(connection)
    const again = approver.accept(connection)
    approver.receive(connection, 7, { type: 'join-request', commitment: 'not-a-commitment' })
    expect(sent).toHaveBeenCalledWith('signal', expect.objectContaining({ to: 7 }))
    const challenge = (sent.mock.calls.at(-1)![1] as { data: { challenge: string } }).data
    expect(challenge).toMatchObject({ type: 'join-challenge' })
    approver.receive(connection, 7, { type: 'join-reveal', signing: Buffer.from(joining.publicKeys.signing).toString('base64url'), agreement: Buffer.from(joining.publicKeys.agreement).toString('base64url'), opening: Buffer.alloc(32).toString('base64url') })
    approver.receive(connection, 8, { type: 'join-reveal', signing: 'a', agreement: 'b', opening: 'c' })
    for (const signal of [null, 'text', { type: 'join-request' }, { type: 'join-challenge', challenge: 'a' }, { type: 'join-reveal', signing: 'a' }, { type: 'other' }]) approver.receive(connection, 9, signal)
    expect(approver.pending()).toEqual([])
    expect(approver.take('missing')).toBeUndefined()
    expect(changed).not.toHaveBeenCalled()
    stop()
    stop()
    again()
    connection.close()
    await connection.closed
    approver.accept(connection)()
    const late = approver.accept(connection)
    approver.receive(connection, 7, { type: 'join-request', commitment: 'y' })
    late()
  })

  it('repeats its request when an add-device screen opens and answers the first challenge only', async () => {
    const connection = await plain('requester')
    const requester = new JoinRequester(connection, keys)
    const sent = vi.spyOn(connection, 'request')
    requester.receive(1, { type: 'join-open' })
    expect((sent.mock.calls[0]?.[1] as { data: { type: string } }).data.type).toBe('join-request')
    const approver = generateDeviceKeys()
    const challenge = { type: 'join-challenge', challenge: Buffer.alloc(32, 1).toString('base64url'), signing: Buffer.from(approver.publicKeys.signing).toString('base64url'), agreement: Buffer.from(approver.publicKeys.agreement).toString('base64url') }
    requester.receive(2, challenge)
    requester.receive(3, challenge)
    requester.receive(4, { type: 'join-open' })
    requester.receive(5, { type: 'unknown' })
    expect(await requester.code).toMatch(/^\d{6}$/)
    expect(sent.mock.calls.filter(([, fields]) => (fields as { to?: number }).to !== undefined)).toHaveLength(1)
    connection.close()
    await connection.closed
    const closedRequester = new JoinRequester(connection, keys)
    closedRequester.receive(1, { type: 'join-open' })
    closedRequester.receive(2, challenge)
    await expect(closedRequester.code).resolves.toMatch(/^\d{6}$/)
  })
})

describe('catching up', () => {
  it('leaves a device that is waiting for admission unenrolled after connecting', async () => {
    const { owner } = await account()
    const waiting = device(owner)
    waiting.vault.prepareJoin()
    await waiting.connect()
    expect(waiting.vault.status().state).toBe('unenrolled')
  })

  it('keeps a cursor that is already ahead, and stays offline when detached while catching up', async () => {
    const { owner, a } = await account()
    a.vault.detach()
    a.store.setRelayCursor(10_000)
    const connection = await plain(owner)
    const attaching = a.vault.attach(connection)
    a.vault.detach()
    await attaching
    expect(a.store.relayCursor()).toBe(10_000)
    expect(a.vault.status().state).toBe('offline')
  })

  it('stores no document update for a stream batch it receives', async () => {
    const { owner, a, connectionA } = await account()
    const b = device(owner)
    await admit(owner, a, connectionA, b)
    a.vault.appendStream('sessions/s', Uint8Array.of(1))
    await vi.waitFor(() => { expect(a.store.pending()).toBe(0) })
    const stream = relay.account(owner).frames.find(frame => frame.kind === 'stream')!
    b.vault.receiveFrame(stream.seq, new Uint8Array(stream.data))
    expect(b.store.docUpdates(a.vault.documentId('sessions/s'))).toEqual([])
  })
})

it('names a document by an id that hides its name', async () => {
  const { a } = await account()
  const id: OpaqueId = a.vault.documentId('memory/traces/ab')
  expect(id).not.toContain('memory')
  expect(brandString<OpaqueId>(id)).toBe(id)
})
