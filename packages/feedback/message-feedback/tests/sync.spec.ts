/**
 * Message feedback across two devices of one account: a rating made on one device appears on the other, a
 * removal travels the same way, the newer change wins, and feedback on a Session without an account stays
 * on its device.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@aeven/llm/brand'
import type { SessionId } from '@aeven/session'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import type { SyncedFeedback } from '../src/sync.ts'
import { messageFixture, setupHarness, type TestHarness } from './helpers.ts'

const OWNER = 'owner-1'
const harnesses: TestHarness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.dispose())) })

async function device(sync: MemorySyncDevice, cwd: string, owner: string | null = OWNER) {
  const harness = await setupHarness()
  harnesses.push(harness)
  harness.ctx.provide('sync', sync.asSync())
  const fixture = messageFixture('shared', { createdAt: 5, cwd, ...owner === null ? {} : { owner } })
  harness.persistence.persist(fixture.session)
  harness.ctx.emit('sync/status', OWNER)
  return { ...harness, fixture }
}

const items = async (harness: TestHarness, sessionId: SessionId) => {
  const listed = await harness.ctx.messageFeedback.list({ sessionId })
  return listed.ok ? listed.value.items : []
}

describe('message feedback sync', () => {
  it('carries a rating and its removal to the account\'s other device, whatever folder each device files it under', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device(), '/Users/a/project')
    const b = await device(network.device(), '/home/b/project')
    const messageId = a.fixture.assistantMessageIds[0]
    const put = await a.ctx.messageFeedback.put({ sessionId: a.fixture.session.id, messageId, rating: 'positive', note: 'nice', ifVersion: null })
    if (!put.ok) throw new Error('put failed')
    await vi.waitFor(async () => { expect(await items(b, b.fixture.session.id)).toMatchObject([{ messageId, rating: 'positive', note: 'nice' }]) })
    const [copy] = await items(b, b.fixture.session.id)
    await b.ctx.messageFeedback.delete({ sessionId: b.fixture.session.id, messageId, ifVersion: copy!.version })
    await vi.waitFor(async () => { expect(await items(a, a.fixture.session.id)).toEqual([]) })
  })

  it('keeps the newer change and ignores entries it cannot use', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device(), '/a')
    const messageId = a.fixture.assistantMessageIds[0]
    const put = await a.ctx.messageFeedback.put({ sessionId: a.fixture.session.id, messageId, rating: 'negative', ifVersion: null })
    if (!put.ok) throw new Error('put failed')
    const writer = await network.device().asSync().openDocument(OWNER, 'feedback')
    const map = writer.doc.getMap<SyncedFeedback>('messages')
    const older: SyncedFeedback = { sessionCreatedAt: 5, item: { ...put.value, rating: 'positive', updatedAt: put.value.updatedAt - 1 }, changedAt: put.value.updatedAt - 1 }
    map.set(`shared\n${messageId}`, older)
    map.set(`shared\n${messageId}`, { sessionCreatedAt: 5, changedAt: put.value.updatedAt - 1 })
    map.set(`shared\n${'absent' as MessageId}`, { sessionCreatedAt: 5, changedAt: Date.now() })
    map.set('no-separator', { sessionCreatedAt: 5, changedAt: Date.now() })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(await items(a, a.fixture.session.id)).toMatchObject([{ messageId, rating: 'negative' }])

    const table = (a.ctx.messageFeedback as unknown as { table: { put: () => Promise<void> } }).table
    const failing = vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('disk full'))
    map.set(`shared\n${messageId}`, { sessionCreatedAt: 5, changedAt: put.value.updatedAt + 10 })
    await vi.waitFor(() => { expect(failing).toHaveBeenCalled() })
    expect(await items(a, a.fixture.session.id)).toMatchObject([{ messageId, rating: 'negative' }])
  })

  it('keeps feedback on a Session without an account on its device, and waits for a vault it can open', async () => {
    const network = new MemorySyncNetwork()
    const unowned = await device(network.device(), '/a', null)
    const messageId = unowned.fixture.assistantMessageIds[0]
    await unowned.ctx.messageFeedback.put({ sessionId: unowned.fixture.session.id, messageId, rating: 'positive', ifVersion: null })
    const reader = await network.device().asSync().openDocument(OWNER, 'feedback')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reader.doc.getMap('messages').size).toBe(0)

    const idle = await device(network.device('disabled'), '/b')
    expect(await items(idle, idle.fixture.session.id)).toEqual([])
    const sync = network.device().asSync()
    const open = sync.openDocument.bind(sync)
    const opening = vi.fn(open).mockRejectedValueOnce(new Error('locked'))
    sync.openDocument = opening
    const retried = await setupHarness()
    harnesses.push(retried)
    retried.ctx.provide('sync', sync)
    const fixture = messageFixture('mine', { owner: OWNER })
    retried.persistence.persist(fixture.session)
    retried.ctx.emit('sync/status', OWNER)
    await vi.waitFor(() => { expect(opening).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    retried.ctx.emit('sync/status', OWNER)
    await retried.ctx.messageFeedback.put({ sessionId: fixture.session.id, messageId: fixture.assistantMessageIds[0], rating: 'positive', ifVersion: null })
    await vi.waitFor(() => { expect(reader.doc.getMap('messages').size).toBe(1) })
  })
})
