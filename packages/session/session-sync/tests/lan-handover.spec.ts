/** A conversation stays readable and writable on a local network while the relay is unreachable. */
import { SessionId } from '@aeven/session'
import type { Session } from '@aeven/session'
import { createUserMessage } from '@aeven/llm'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MemorySyncNetwork } from '../../../sync/sync/tests/memory.ts'
import { host } from './harness.ts'

/**
 * Append one complete turn with a user message.
 * @param session - the log to append to.
 * @param turn - the turn number.
 * @param text - what the user said.
 */
function appendTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/**
 * @param ctx - a Host.
 * @param id - the conversation.
 * @returns how many user messages its durable log holds.
 */
async function said(ctx: Context, id: SessionId): Promise<number> {
  const { events } = await ctx.sessionPersistence.readFrom(id, 0 as never)
  return events.filter(event => event.type === 'user/message').length
}

it('continues a conversation on the other device while the relay is unreachable', async () => {
  const network = new MemorySyncNetwork()
  const deviceA = network.device()
  const deviceB = network.device()
  deviceA.lan = true
  deviceB.lan = true
  const a = await host(deviceA)
  const b = await host(deviceB)
  const id = SessionId('lan-conversation')
  let detach: (() => void) | undefined
  a.on('session-handoff/released', () => { detach?.(); detach = undefined })
  const original = a.sessions.prepare(id, { meta: { owner: 'account' } })
  detach = a.sessions.enter(original)
  a.sessions.announce(original)
  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
  await a.sessionHandoff.holdRunner('account', id, true)
  appendTurn(original, 1, 'from A, online')
  await a.parallel('session/flush', original)
  await vi.waitFor(async () => { expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id]) })
  await vi.waitFor(async () => { expect(await said(b, id)).toBe(1) })
  await a.sessionHandoff.holdRunner('account', id, false)

  // Both devices stay on the same network, but the server they sync through stops answering.
  deviceA.relay = false
  deviceB.relay = false

  await a.sessionHandoff.holdRunner('account', id, true)
  appendTurn(original, 2, 'from A, no relay')
  await a.parallel('session/flush', original)
  await vi.waitFor(async () => { expect(await said(b, id)).toBe(2) })
  await a.sessionHandoff.holdRunner('account', id, false)

  // B holds the whole log and no turn runs on A, so B continues the same conversation, not a copy.
  await vi.waitFor(async () => { expect(await b.sessionHandoff.claim('account', id)).toEqual({ claimed: true }) })
  expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id])
  await b.sessionHandoff.holdRunner('account', id, true)
  const prepared = await b.sessionPersistence.prepare(id)
  const leave = b.sessions.enter(prepared.session)
  b.sessions.announce(prepared.session)
  b.on('session-handoff/released', () => { leave() })
  appendTurn(prepared.session, 3, 'from B, no relay')
  await b.parallel('session/flush', prepared.session)
  await vi.waitFor(async () => { expect(await said(a, id)).toBe(3) })
  await b.sessionHandoff.holdRunner('account', id, false)

  expect((await a.sessionPersistence.list()).map(header => header.id)).toEqual([id])
  expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id])
})
