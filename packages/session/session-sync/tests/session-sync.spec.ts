/**
 * Conversation history across two devices of one account: each session is published by the device that
 * created it and imported elsewhere event for event; old sessions stay home; imported sessions are not
 * published again; gaps, offline reads, and persistence failures are reported rather than imported.
 */
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent, SessionHeader } from '@aeven/session'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import SessionSync from '../src/index.ts'
import { SessionMirror, type SessionSyncTuning } from '../src/mirror.ts'

const OWNER = 'owner-1'
const DAY = 86_400_000

/** A stored-log suffix as `readFrom` returns it. */
interface Suffix {
  meta: SessionHeader
  inheritedEventCount: number
  fromSeq: number
  events: SessionEvent[]
}

/** Session persistence with JSONL's contiguity rule, held in memory. */
class MemoryPersistence {
  readonly logs = new Map<string, { header: SessionHeader; inherited: number; events: SessionEvent[]; revision: number }>()
  failSnapshots = false

  list(): Promise<SessionHeader[]> {
    return Promise.resolve([...this.logs.values()].filter(log => log.events.length > 0).map(log => log.header))
  }

  listSnapshots(): Promise<Array<{ header: SessionHeader; revision: string }>> {
    if (this.failSnapshots) return Promise.reject(new Error('disk unavailable'))
    return Promise.resolve([...this.logs.values()].filter(log => log.events.length > 0).map(log => ({ header: log.header, revision: `r${String(log.revision)}` })))
  }

  create(header: SessionHeader, inherited?: number): Promise<void> {
    if (!this.logs.has(header.id)) this.logs.set(header.id, { header, inherited: inherited ?? 0, events: [], revision: 0 })
    return Promise.resolve()
  }

  append(id: string, events: readonly SessionEvent[]): Promise<void> {
    const log = this.logs.get(id)
    if (log === undefined) return Promise.reject(new Error(`no session ${id}`))
    if (log.events.length + events.length < log.inherited) return Promise.reject(new Error('incomplete inherited prefix'))
    if (events[0]?.seq !== log.events.length) return Promise.reject(new Error(`non-contiguous append to ${id}`))
    log.events.push(...events)
    log.revision++
    return Promise.resolve()
  }

  readFrom(id: string, from: number): Promise<Suffix> {
    const log = this.logs.get(id)
    if (log === undefined) return Promise.reject(new Error(`no session ${id}`))
    return Promise.resolve({ meta: log.header, inheritedEventCount: log.inherited, fromSeq: from, events: log.events.slice(from) })
  }

  start(id: string, createdAt: number, count: number, extra: Partial<SessionHeader> = {}): void {
    const header = { id, version: 0, createdAt, isSeeded: false, owner: OWNER, ...extra } as unknown as SessionHeader
    this.logs.set(id, { header, inherited: 0, events: [], revision: 0 })
    this.add(id, count)
  }

  add(id: string, count: number, size = 50): void {
    const log = this.logs.get(id)!
    for (let i = 0; i < count; i++) {
      log.events.push({ type: 'user/message', seq: log.events.length, time: 0, data: { text: 'x'.repeat(size) } } as unknown as SessionEvent)
    }
    log.revision++
  }
}

const tuning: SessionSyncTuning = { publishMs: 20, batchBytes: 2_000, backfillDays: 30, liveMs: 5 }
const mirrors: SessionMirror[] = []
afterEach(async () => { await Promise.all(mirrors.splice(0).map(mirror => mirror.dispose())) })

function mirror(device: MemorySyncDevice, persistence: MemoryPersistence, warn = vi.fn()): { mirror: SessionMirror; warn: typeof warn } {
  const created = new SessionMirror(OWNER, device.asSync(), persistence as never, tuning, warn)
  mirrors.push(created)
  return { mirror: created, warn }
}

const count = (persistence: MemoryPersistence, id: string): number => persistence.logs.get(id)?.events.length ?? 0

describe('session mirror', () => {
  it('publishes recent sessions in batches, imports them on the other device, and follows new turns both ways', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    const homeB = new MemoryPersistence()
    homeA.start('recent', Date.now(), 60, { cwd: '/work' })
    homeA.start('seeded', Date.now(), 4, { isSeeded: true })
    homeA.start('old', Date.now() - 90 * DAY, 4)
    homeA.start('someone-else', Date.now(), 4, { owner: 'other' })
    await mirror(a, homeA).mirror.start()
    await mirror(b, homeB).mirror.start()
    await vi.waitFor(() => { expect(count(homeB, 'recent')).toBe(60) })
    expect(network.streams.get('sessions/recent')!.length).toBeGreaterThan(1)
    expect(homeB.logs.get('recent')!.events).toEqual(homeA.logs.get('recent')!.events)
    expect(homeB.logs.get('recent')!.header).toMatchObject({ cwd: '/work', owner: OWNER, replica: true })
    await vi.waitFor(() => { expect(count(homeB, 'seeded')).toBe(4) })
    expect(count(homeB, 'old')).toBe(0)
    expect(count(homeB, 'someone-else')).toBe(0)

    homeA.add('recent', 3)
    await vi.waitFor(() => { expect(count(homeB, 'recent')).toBe(63) })
    homeB.start('from-b', Date.now(), 5)
    await vi.waitFor(() => { expect(count(homeA, 'from-b')).toBe(5) })
    const published = network.streams.get('sessions/recent')!.length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(network.streams.get('sessions/recent')!.length).toBe(published)
  })

  it('commits a fork inherited across many stream pages as one initial prefix', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    const homeB = new MemoryPersistence()
    homeA.start('large-fork', Date.now(), 0, { isSeeded: true })
    homeA.logs.get('large-fork')!.inherited = 12
    homeA.add('large-fork', 20, 900)
    await mirror(a, homeA).mirror.start()
    const append = vi.spyOn(homeB, 'append')
    await mirror(b, homeB).mirror.start()
    await vi.waitFor(() => { expect(count(homeB, 'large-fork')).toBe(20) })
    expect(network.streams.get('sessions/large-fork')!.length).toBeGreaterThan(6)
    expect(append.mock.calls[0]![1].length).toBeGreaterThanOrEqual(12)
    expect(homeB.logs.get('large-fork')!.header.replica).toBe(true)
    expect(homeB.logs.get('large-fork')!.events).toEqual(homeA.logs.get('large-fork')!.events)
  })

  it('retries a failed first append without registering the replica twice', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    const homeB = new MemoryPersistence()
    homeA.start('retry', Date.now(), 3)
    await mirror(a, homeA).mirror.start()
    const create = vi.spyOn(homeB, 'create').mockImplementation(async (header, inherited) => {
      if (homeB.logs.has(header.id)) throw new Error('session already registered')
      homeB.logs.set(header.id, { header, inherited: inherited ?? 0, events: [], revision: 0 })
    })
    vi.spyOn(homeB, 'append').mockRejectedValueOnce(new Error('disk unavailable'))
    const { mirror: receiver, warn } = mirror(b, homeB)
    await receiver.start()
    await new Promise(resolve => setTimeout(resolve, 200))
    console.log('DBG', JSON.stringify([...(await b.asSync().openDocument('o', 'sessions/index')).doc.getMap('sessions').keys()]), JSON.stringify([...(await a.asSync().openDocument('o', 'sessions/index')).doc.getMap('sessions').keys()]), network.streams.size, JSON.stringify(warn.mock.calls), homeB.logs.size, create.mock.calls.length)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk unavailable')) })
    receiver.reconnected()
    await vi.waitFor(() => { expect(count(homeB, 'retry')).toBe(3) })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('continues a session the device already holds part of, and catches up after reconnecting', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    const homeB = new MemoryPersistence()
    homeA.start('s', Date.now(), 0)
    homeA.add('s', 10, 900)
    homeA.start('huge', Date.now(), 0)
    homeA.add('huge', 1, 3_000)
    await mirror(a, homeA).mirror.start()
    await vi.waitFor(() => { expect(network.streams.get('sessions/huge')).toHaveLength(1) })
    homeB.start('s', Date.now(), 0)
    homeB.add('s', 4, 900)
    const second = mirror(b, homeB)
    b.setState('offline')
    await second.mirror.start()
    b.setState('online')
    second.mirror.reconnected()
    await vi.waitFor(() => { expect(count(homeB, 's')).toBe(10) })
  })

  it('reports a session whose published events have a gap, and offline reads, without importing them', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    homeA.start('s', Date.now(), 0)
    homeA.add('s', 6, 900)
    await mirror(a, homeA).mirror.start()
    await vi.waitFor(() => { expect(network.streams.get('sessions/s')!.length).toBeGreaterThan(1) })
    network.streams.set('sessions/s', network.streams.get('sessions/s')!.slice(1))
    const homeB = new MemoryPersistence()
    const { mirror: mirrorB, warn } = mirror(b, homeB)
    await mirrorB.start()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringMatching(/missing events 0–/)) })
    expect(count(homeB, 's')).toBe(0)

  })

  it('reports a stream it cannot read while offline', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const c = network.device()
    const sync = c.asSync()
    sync.readStream = () => Promise.reject(new Error('reading a stream needs a connection to the relay'))
    const warn = vi.fn()
    const offline = new SessionMirror(OWNER, sync, new MemoryPersistence() as never, tuning, warn)
    mirrors.push(offline)
    await offline.start()
    const homeA = new MemoryPersistence()
    homeA.start('s', Date.now(), 2)
    await mirror(a, homeA).mirror.start()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringMatching(/needs a connection/)) })
  })

  it('reports a listing failure and does nothing for a device that is not enrolled', async () => {
    const network = new MemorySyncNetwork()
    const home = new MemoryPersistence()
    home.start('s', Date.now(), 2)
    home.failSnapshots = true
    const { mirror: failing, warn } = mirror(network.device(), home)
    await failing.start()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('session sync: publishing sessions failed: Error: disk unavailable') })
    const idle = mirror(network.device('unenrolled'), new MemoryPersistence())
    await idle.mirror.start()
    await idle.mirror.publish()
    expect(idle.warn).not.toHaveBeenCalled()
  })

  it('skips a session whose log did not change and publishes nothing for an empty suffix', async () => {
    const network = new MemorySyncNetwork()
    const home = new MemoryPersistence()
    home.start('s', Date.now(), 2)
    const { mirror: created } = mirror(network.device(), home)
    await created.start()
    await vi.waitFor(() => { expect(network.streams.get('sessions/s')).toHaveLength(1) })
    home.logs.get('s')!.revision++
    await created.publish()
    await created.publish()
    expect(network.streams.get('sessions/s')).toHaveLength(1)
  })

  it('stops importing and publishing when disposed mid-pass', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    const homeB = new MemoryPersistence()
    const { mirror: mirrorB } = mirror(b, homeB)
    await mirrorB.start()
    homeA.start('s', Date.now(), 2)
    const { mirror: mirrorA } = mirror(a, homeA)
    await mirrorA.start()
    await vi.waitFor(() => { expect(count(homeB, 's')).toBe(2) })
    homeA.add('s', 1)
    const publishing = mirrorA.publish()
    const disposingA = mirrorA.dispose()
    await publishing
    await disposingA
    mirrorB.reconnected()
    await mirrorB.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(count(homeB, 's')).toBe(2)
  })

  it('stops an import and a publication that are waiting when disposed', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    homeA.start('s', Date.now(), 2)
    await mirror(a, homeA).mirror.start()
    const sync = b.asSync()
    const read = sync.readStream.bind(sync)
    const gate = Promise.withResolvers<undefined>()
    sync.readStream = async (owner, name, after) => { await gate.promise; return await read(owner, name, after) }
    const homeB = new MemoryPersistence()
    const receiver = new SessionMirror(OWNER, sync, homeB as never, tuning, vi.fn())
    await receiver.start()
    await vi.waitFor(() => { expect(network.streams.get('sessions/s')).toBeDefined() })
    receiver.reconnected()
    const stopping = receiver.dispose()
    gate.resolve(undefined)
    await stopping
    expect(count(homeB, 's')).toBe(0)

    const homeC = new MemoryPersistence()
    homeC.start('c', Date.now(), 1)
    const readFrom = homeC.readFrom.bind(homeC)
    const slow = Promise.withResolvers<undefined>()
    homeC.readFrom = async (id, from) => { await slow.promise; return await readFrom(id, from) }
    const publisher = new SessionMirror(OWNER, network.device().asSync(), homeC as never, tuning, vi.fn())
    await publisher.start()
    const closing = publisher.dispose()
    slow.resolve(undefined)
    await closing
    expect(network.streams.get('sessions/c')).toBeUndefined()

    const homeD = new MemoryPersistence()
    homeD.start('d', Date.now(), 1)
    const writer = network.device().asSync()
    const append = writer.appendStream.bind(writer)
    const sending = Promise.withResolvers<undefined>()
    const sent = Promise.withResolvers<undefined>()
    writer.appendStream = async (owner, name, payload) => {
      sent.resolve(undefined)
      await sending.promise
      await append(owner, name, payload)
    }
    const last = new SessionMirror(OWNER, writer, homeD as never, tuning, vi.fn())
    await last.start()
    await sent.promise
    const ending = last.dispose()
    sending.resolve(undefined)
    await ending
    const index = await network.device().asSync().openDocument(OWNER, 'sessions/index')
    expect(index.doc.getMap('sessions').has('d')).toBe(false)
  })

  it('stops when disposed before its index opened, and refuses to run before it started', async () => {
    const network = new MemorySyncNetwork()
    const { mirror: early } = mirror(network.device(), new MemoryPersistence())
    const starting = early.start()
    const disposing = early.dispose()
    await starting
    await disposing
    await early.publish()
    const { mirror: unstarted } = mirror(network.device(), new MemoryPersistence())
    await expect(unstarted.publish()).resolves.toBeUndefined()
  })
})

/** Content-addressed objects held in memory, verified on import like the local store. */
class MemoryAttachments {
  readonly objects = new Map<string, Uint8Array>()

  hold(data: Uint8Array): string {
    const id = `sha256:${createHash('sha256').update(data).digest('hex')}`
    this.objects.set(id, data)
    return id
  }

  hasObject(id: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(id))
  }

  readObject(id: string): Promise<Uint8Array> {
    const data = this.objects.get(id)
    return data === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(data)
  }

  importObject(id: string, data: Uint8Array): Promise<void> {
    if (`sha256:${createHash('sha256').update(data).digest('hex')}` !== id) return Promise.reject(new Error('corrupt'))
    this.objects.set(id, data)
    return Promise.resolve()
  }
}

describe('attachments of synced conversations', () => {
  it('sends the attachments a conversation references along with it, once, in chunks', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = new MemoryPersistence()
    const homeB = new MemoryPersistence()
    const storeA = new MemoryAttachments()
    const storeB = new MemoryAttachments()
    const image = storeA.hold(new Uint8Array(5_000).map((_, index) => index % 251))
    const empty = storeA.hold(new Uint8Array(0))
    const absent = `sha256:${'0'.repeat(64)}`
    const mirrorB = new SessionMirror(OWNER, b.asSync(), homeB as never, tuning, vi.fn(), storeB as never)
    const mirrorA = new SessionMirror(OWNER, a.asSync(), homeA as never, tuning, vi.fn(), storeA as never)
    mirrors.push(mirrorA, mirrorB)
    await mirrorB.start()
    homeA.start('s', Date.now(), 1)
    homeA.logs.get('s')!.events.push({ type: 'user/message', seq: 1, time: 0, data: { images: [{ attachmentId: image }, { attachmentId: empty }, { attachmentId: absent }] } } as never)
    homeA.logs.get('s')!.revision++
    await mirrorA.start()
    await vi.waitFor(() => { expect(storeB.objects.get(image)).toEqual(storeA.objects.get(image)) })
    expect(storeB.objects.get(empty)).toEqual(new Uint8Array(0))
    expect(storeB.objects.has(absent)).toBe(false)
    expect(network.streams.get(`attachments/${image}`)!.length).toBe(3)
    homeA.add('s', 1)
    homeA.logs.get('s')!.events.at(-1)!.data = { images: [{ attachmentId: image }] } as never
    await vi.waitFor(() => { expect(count(homeB, 's')).toBe(3) })
    expect(network.streams.get(`attachments/${image}`)!.length).toBe(3)
  })
})

describe('session-sync plugin', () => {
  it('publishes a running session\'s new events right after they commit, without waiting for the next scan', async () => {
    const network = new MemorySyncNetwork()
    const slow = { ...tuning, publishMs: 60_000 }
    const homeA = new MemoryPersistence()
    homeA.start('live', Date.now(), 1)
    const a = new SessionMirror(OWNER, network.device().asSync(), homeA as never, slow, vi.fn())
    const homeB = new MemoryPersistence()
    const b = new SessionMirror(OWNER, network.device().asSync(), homeB as never, slow, vi.fn())
    mirrors.push(a, b)
    a.appended(homeA.logs.get('live')!.header)
    await a.start()
    await b.start()
    await vi.waitFor(() => { expect(count(homeB, 'live')).toBe(1) })
    homeA.add('live', 3)
    const header = homeA.logs.get('live')!.header
    a.appended(header)
    a.appended(header)
    await vi.waitFor(() => { expect(count(homeB, 'live')).toBe(4) })
    // A scan and a live publication of the same session run one after the other and send each event once.
    homeA.add('live', 1)
    await new Promise<void>((resolve) => {
      a.appended(header)
      setTimeout(() => { void a.publish().then(resolve) }, 5)
    })
    await vi.waitFor(() => { expect(count(homeB, 'live')).toBe(5) })
    b.appended({ ...homeB.logs.get('live')!.header, replica: undefined } as never)
    // Another account's session, a replica, and a session another device writes are not this device's to publish.
    a.appended({ ...header, owner: 'someone-else' })
    a.appended({ ...header, replica: true })
    b.appended(homeB.logs.get('live')!.header)
    homeA.add('live', 1)
    a.appended(header)
    await a.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(count(homeB, 'live')).toBe(5)
  })

  it('reports a running session it could not publish', async () => {
    const network = new MemorySyncNetwork()
    const home = new MemoryPersistence()
    home.start('live', Date.now(), 1)
    const warn = vi.fn()
    const a = new SessionMirror(OWNER, network.device().asSync(), home as never, { ...tuning, publishMs: 60_000 }, warn)
    mirrors.push(a)
    await a.start()
    await vi.waitFor(() => { expect(network.streams.get('sessions/live')).toBeDefined() })
    home.add('live', 1)
    home.readFrom = () => Promise.reject(new Error('disk gone'))
    a.appended(home.logs.get('live')!.header)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk gone')) })
  })

  it('files an imported session into the workspace it belongs to on the device that published it', async () => {
    const network = new MemorySyncNetwork()
    const homeA = new MemoryPersistence()
    homeA.start('filed', Date.now(), 2)
    homeA.start('loose', Date.now(), 1)
    const filingA = { sessionHome: (id: string) => (id === 'filed' ? 'workspace-1' : undefined), fileSession: vi.fn() }
    const a = new SessionMirror(OWNER, network.device().asSync(), homeA as never, tuning, vi.fn(), undefined, filingA)
    mirrors.push(a)
    await a.start()
    let ready = false
    const fileSession = vi.fn((_id: string, _home: string) => Promise.resolve(ready))
    const homeB = new MemoryPersistence()
    const filingB = { sessionHome: () => undefined, fileSession }
    const b = new SessionMirror(OWNER, network.device().asSync(), homeB as never, tuning, vi.fn(), undefined, filingB)
    mirrors.push(b)
    await b.start()
    await vi.waitFor(() => { expect(fileSession).toHaveBeenCalledWith('filed', 'workspace-1') })
    // The workspace had not arrived; a later pass files the session once it has, and then stops asking.
    ready = true
    b.reconnected()
    await vi.waitFor(() => { expect(fileSession.mock.results.some(result => result.value instanceof Promise)).toBe(true) })
    const calls = fileSession.mock.calls.length
    b.reconnected()
    await new Promise(resolve => setTimeout(resolve, 30))
    b.reconnected()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fileSession.mock.calls.length).toBeLessThanOrEqual(calls + 1)
    expect(fileSession.mock.calls.every(([id]) => id === 'filed')).toBe(true)
  })

  it('forwards input for a session another device writes to that device, in order, with its attachments', async () => {
    const network = new MemorySyncNetwork()
    const syncA = network.device()
    const homeA = new MemoryPersistence()
    homeA.start('shared', Date.now(), 1)
    const delivered: Array<[string, unknown]> = []
    const collect = (id: string, input: unknown): void => { delivered.push([id, input]) }
    const a = new SessionMirror(OWNER, syncA.asSync(), homeA as never, tuning, vi.fn(), undefined, undefined, collect)
    const attachments = new MemoryAttachments()
    const image = `sha256:${'c'.repeat(64)}`
    attachments.objects.set(image, Uint8Array.of(4, 5))
    const homeB = new MemoryPersistence()
    const b = new SessionMirror(OWNER, network.device().asSync(), homeB as never, tuning, vi.fn(), attachments as never)
    mirrors.push(a, b)
    await a.start()
    const names = await syncA.asSync().openDocument(OWNER, 'devices')
    names.doc.getMap('names').set(syncA.id, { name: 'laptop' })
    await b.start()
    await vi.waitFor(() => { expect(b.runnerOf('shared' as never)).toEqual({ device: syncA.id, name: 'laptop' }) })
    expect(a.runnerOf('shared' as never)).toBeUndefined()
    expect(b.runnerOf('unknown' as never)).toBeUndefined()
    await b.forward('shared' as never, { operation: 'prompt', request: { text: 'first', image } })
    await b.forward('shared' as never, { operation: 'cancel', request: {} })
    await vi.waitFor(() => { expect(delivered.map(([, input]) => (input as { operation: string }).operation)).toEqual(['prompt', 'cancel']) })
    expect(network.streams.get(`attachments/${image}`)).toBeDefined()
    await expect(b.forward('unknown' as never, { operation: 'cancel', request: {} })).rejects.toThrow(/not written by another device/)
    const inbox = await network.device().asSync().openDocument(OWNER, 'sessions/inbox')
    await vi.waitFor(() => { expect(inbox.doc.getMap('inputs').size).toBe(0) })
  })

  it('fetches the attachments a forwarded input references before applying it, and applies it when fetching fails', async () => {
    const network = new MemorySyncNetwork()
    const homeA = new MemoryPersistence()
    homeA.start('pictured', Date.now(), 1)
    const attachmentsA = new MemoryAttachments()
    const held: boolean[] = []
    const image = new MemoryAttachments().hold(Uint8Array.of(7, 8, 9))
    const deliverA = (): void => { held.push(attachmentsA.objects.has(image)) }
    const syncA = network.device().asSync()
    const a = new SessionMirror(OWNER, syncA, homeA as never, tuning, vi.fn(), attachmentsA as never, undefined, deliverA)
    const attachmentsB = new MemoryAttachments()
    attachmentsB.hold(Uint8Array.of(7, 8, 9))
    const b = new SessionMirror(OWNER, network.device().asSync(), new MemoryPersistence() as never, tuning, vi.fn(), attachmentsB as never)
    mirrors.push(a, b)
    await a.start()
    await b.start()
    await vi.waitFor(() => { expect(b.runnerOf('pictured' as never)).toBeDefined() })
    await b.forward('pictured' as never, { operation: 'prompt', request: { content: [{ image }] } })
    await vi.waitFor(() => { expect(held).toEqual([true]) })
    attachmentsA.objects.clear()
    attachmentsA.importObject = () => Promise.reject(new Error('disk full'))
    await b.forward('pictured' as never, { operation: 'prompt', request: { content: [{ image }] } })
    await vi.waitFor(() => { expect(held).toEqual([true, false]) })
  })

  it('shares the live state of a session with the account\'s other devices, from the device writing it only', async () => {
    const network = new MemorySyncNetwork()
    const homeA = new MemoryPersistence()
    homeA.start('busy', Date.now(), 1)
    const a = new SessionMirror(OWNER, network.device().asSync(), homeA as never, tuning, vi.fn())
    const changes: string[] = []
    const onLive = (id: string): void => { changes.push(id) }
    const syncB = network.device().asSync()
    const b = new SessionMirror(OWNER, syncB, new MemoryPersistence() as never, tuning, vi.fn(), undefined, undefined, undefined, onLive)
    mirrors.push(a, b)
    b.publishLive('busy' as never, { running: true })
    await a.start()
    await b.start()
    await vi.waitFor(() => { expect(b.runnerOf('busy' as never)).toBeDefined() })
    a.publishLive('busy' as never, { running: true })
    await vi.waitFor(() => { expect(b.liveOf('busy' as never)).toEqual({ running: true }) })
    expect(changes).toContain('busy')
    // A device that does not write the session cannot speak for it, nor clear what the writer shared.
    b.publishLive('busy' as never, { running: false })
    b.publishLive('busy' as never, undefined)
    expect(b.liveOf('busy' as never)).toEqual({ running: true })
    expect(a.liveOf('busy' as never)).toBeUndefined()
    a.publishLive('busy' as never, undefined)
    await vi.waitFor(() => { expect(b.liveOf('busy' as never)).toBeUndefined() })
  })

  it('holds forwarded input until the writing device is back, and applies what waited when it starts', async () => {
    const network = new MemorySyncNetwork()
    const syncA = network.device()
    const homeA = new MemoryPersistence()
    homeA.start('later', Date.now(), 1)
    const first = new SessionMirror(OWNER, syncA.asSync(), homeA as never, tuning, vi.fn())
    mirrors.push(first)
    expect(first.runnerOf('later' as never)).toBeUndefined()
    await first.start()
    const b = new SessionMirror(OWNER, network.device().asSync(), new MemoryPersistence() as never, tuning, vi.fn())
    mirrors.push(b)
    await b.start()
    await vi.waitFor(() => { expect(b.runnerOf('later' as never)).toBeDefined() })
    await first.dispose()
    await b.forward('later' as never, { operation: 'prompt', request: { text: 'while away' } })
    await new Promise(resolve => setTimeout(resolve, 2))
    await b.forward('later' as never, { operation: 'cancel', request: {} })
    const delivered: string[] = []
    const collect = (_id: string, input: { operation: string }): void => { delivered.push(input.operation) }
    const again = new SessionMirror(OWNER, syncA.asSync(), homeA as never, tuning, vi.fn(), undefined, undefined, collect)
    mirrors.push(again)
    await again.start()
    await vi.waitFor(() => { expect(delivered).toEqual(['prompt', 'cancel']) })
  })

  it('starts a mirror when sync serves an account, catches up when it comes back online, and reports a failed start', async () => {
    const network = new MemorySyncNetwork()
    const device = network.device('connecting')
    const home = new MemoryPersistence()
    const ctx = new Context()
    const sync = device.asSync()
    let failOpen = false
    const openDocument = sync.openDocument.bind(sync)
    sync.openDocument = (owner: string, name: string) => failOpen ? Promise.reject(new Error('locked')) : openDocument(owner, name)
    ctx.provide('sync', sync)
    ctx.provide('sessionPersistence', home as never)
    const warnings: string[] = []
    const spy = vi.spyOn(ctx.logger, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
    const fiber = ctx.plugin(SessionSync, { publishMs: 250, batchBytes: 2_000, backfillDays: 30, liveMs: 5 })
    await fiber
    ctx.emit('sync/status', OWNER)
    device.setState('online')
    ctx.emit('sync/status', OWNER)
    home.start('s', Date.now(), 3)
    await vi.waitFor(() => { expect(network.streams.get('sessions/s')).toBeDefined() })
    // A commit to a session of the account publishes it at once; one without an account is not the mirror's.
    home.add('s', 1)
    ctx.emit('session-persistence/append', home.logs.get('s')!.header, [])
    ctx.emit('session-persistence/append', { ...home.logs.get('s')!.header, owner: undefined } as never, [])
    await vi.waitFor(() => { expect(network.streams.get('sessions/s')!.length).toBeGreaterThan(1) })
    // Input another device forwards for a session this Host writes reaches this Host's listeners.
    const inputs: unknown[] = []
    ctx.on('session-handoff/input', (owner, sessionId, input) => { inputs.push([owner, sessionId, input.operation]) })
    expect(ctx.sessionHandoff.runnerOf(OWNER, 's' as never)).toBeUndefined()
    const lives: string[] = []
    ctx.on('session-handoff/live', (_owner, sessionId) => { lives.push(sessionId) })
    ctx.sessionHandoff.publishLive(OWNER, 's' as never, { running: true })
    ctx.sessionHandoff.publishLive('nobody', 's' as never, { running: true })
    expect(ctx.sessionHandoff.liveOf(OWNER, 's' as never)).toBeUndefined()
    expect(ctx.sessionHandoff.liveOf('nobody', 's' as never)).toBeUndefined()
    expect(ctx.sessionHandoff.runnerOf('nobody', 's' as never)).toBeUndefined()
    await expect(ctx.sessionHandoff.forward('nobody', 's' as never, { operation: 'cancel', request: {} })).rejects.toThrow(/does not serve/)
    const other = new SessionMirror(OWNER, network.device().asSync(), new MemoryPersistence() as never, tuning, vi.fn())
    mirrors.push(other)
    await other.start()
    await vi.waitFor(() => { expect(other.runnerOf('s' as never)).toBeDefined() })
    await other.forward('s' as never, { operation: 'cancel', request: {} })
    await vi.waitFor(() => { expect(inputs).toEqual([[OWNER, 's', 'cancel']]) })
    const writer = await network.device().asSync().openDocument(OWNER, 'sessions/live')
    writer.doc.getMap('sessions').set('s', { device: 'elsewhere', live: { running: true } })
    await vi.waitFor(() => { expect(lives).toContain('s') })
    await expect(ctx.sessionHandoff.forward(OWNER, 's' as never, { operation: 'cancel', request: {} })).rejects.toThrow(/not written by another device/)
    device.setState('offline')
    ctx.emit('sync/status', OWNER)
    home.failSnapshots = true
    await vi.waitFor(() => { expect(warnings.some(warning => warning.includes('disk unavailable'))).toBe(true) })
    device.setState('unenrolled')
    ctx.emit('sync/status', 'not-enrolled')
    failOpen = true
    device.setState('online')
    ctx.emit('sync/status', 'other-owner')
    await vi.waitFor(() => { expect(warnings.some(warning => warning.includes('locked'))).toBe(true) })
    await fiber.dispose()
    spy.mockRestore()
  })
})
