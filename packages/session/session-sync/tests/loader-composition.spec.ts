/** Session handover through Loader compositions with independent durable homes. */
import { readFile } from 'node:fs/promises'
import { SessionId } from '@aeven/session'
import { createUserMessage } from '@aeven/llm'
import { expect, it, vi } from 'vitest'
import { MemorySyncNetwork } from '../../../sync/sync/tests/memory.ts'
import { host } from './harness.ts'

it('continues an imported initialization-only draft that has no shared index entry', async () => {
  const network = new MemorySyncNetwork()
  const a = await host(network.device())
  const id = SessionId('imported-draft')
  await a.sessionPersistence.create({ version: 0, id, createdAt: Date.now(), owner: 'account', isSeeded: false, replica: true })
  await a.sessionPersistence.append(id, [{ type: 'sandbox/mode', seq: 0, time: Date.now(), data: { mode: 'off' } }] as never)
  const original = await a.sessionPersistence.readFrom(id, 0 as never)
  expect(a.sessionHandoff.catalog('account').some(entry => entry.header.id === id)).toBe(false)

  network.leases.set(`sessions/${id}`, { holder: 'another-device', expiresAt: Number.MAX_SAFE_INTEGER })
  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: false })
  await expect(a.sessionPersistence.prepare(id)).rejects.toThrow(/replicated from another device/)
  network.leases.delete(`sessions/${id}`)

  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
  expect((await a.sessionPersistence.readFrom(id, 0 as never)).events).toEqual(original.events)
  using prepared = await a.sessionPersistence.prepare(id)
  expect(prepared.session.id).toBe(id)
  expect(prepared.session.header.replica).not.toBe(true)
  expect(prepared.session.snapshotEvents()).toEqual(expect.arrayContaining([...original.events]))
})

it('does not promote an unindexed replica owned by another account', async () => {
  const network = new MemorySyncNetwork()
  const a = await host(network.device())
  const id = SessionId('foreign-draft')
  await a.sessionPersistence.create({ version: 0, id, createdAt: Date.now(), owner: 'another-account', isSeeded: false, replica: true })
  await a.sessionPersistence.append(id, [{ type: 'sandbox/mode', seq: 0, time: Date.now(), data: { mode: 'off' } }] as never)
  await expect(a.sessionHandoff.claim('account', id)).rejects.toThrow('session does not belong to this account')
  await expect(a.sessionPersistence.prepare(id)).rejects.toThrow(/replicated from another device/)
})

it('continues the same durable conversation on either device without a fork or an extra session', async () => {
  const network = new MemorySyncNetwork()
  const a = await host(network.device())
  const b = await host(network.device())
  const id = SessionId('same-conversation')
  let detach: (() => void) | undefined
  a.on('session-handoff/released', () => { detach?.(); detach = undefined })
  const original = a.sessions.prepare(id, { meta: { owner: 'account' } })
  detach = a.sessions.enter(original)
  a.sessions.announce(original)
  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
  await a.sessionHandoff.holdRunner('account', id, true)
  original.append('turn/start', { turn: 1 })
  original.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'from A' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  original.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await a.parallel('session/flush', original)
  await vi.waitFor(async () => { expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id]) })
  expect(await b.sessionHandoff.claim('account', id)).toEqual({ claimed: false })
  await a.sessionHandoff.holdRunner('account', id, false)
  const location = b.sessionPersistence.locate((await b.sessionPersistence.list())[0]!)!
  if (location.kind !== 'jsonl') throw new Error('expected a JSONL log')
  const prefix = await readFile(location.path)
  expect(await b.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
  expect(await readFile(location.path)).toEqual(prefix)
  using prepared = await b.sessionPersistence.prepare(id)
  const continued = prepared.session
  const leave = b.sessions.enter(continued)
  b.sessions.announce(continued)
  b.on('session-handoff/released', () => { leave() })
  await b.sessionHandoff.holdRunner('account', id, true)
  continued.append('turn/start', { turn: 2 })
  continued.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'from B' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  continued.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  await b.sessionHandoff.holdRunner('account', id, false)
  await vi.waitFor(async () => {
    const copy = await a.sessionPersistence.readFrom(id, 0 as never)
    expect(copy.events.filter(event => event.type === 'user/message')).toHaveLength(2)
  })
  expect((await a.sessionPersistence.list()).map(header => header.id)).toEqual([id])
  expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id])
  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
})
