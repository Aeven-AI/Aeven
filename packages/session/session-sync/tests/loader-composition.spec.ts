/** Session handover through Loader compositions with independent durable homes. */
import { readFile } from 'node:fs/promises'
import { SessionId } from '@aeven/session'
import { createUserMessage } from '@aeven/llm'
import { expect, it, vi } from 'vitest'
import { MemorySyncNetwork } from '../../../sync/sync/tests/memory.ts'
import { host } from './harness.ts'

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
