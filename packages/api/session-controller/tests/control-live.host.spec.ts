/**
 * A session's live state across devices of one account: the device writing it shares whether a turn runs and what
 * waits in its queue, and clears it once nothing is live; a device showing a session another device writes turns
 * that shared state into the same queue frames and running status its own sessions produce.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@aeven/agent'
import type { Agent } from '@aeven/agent'
import { createUserMessage } from '@aeven/llm'
import SessionStore, { SessionId } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import { describe, expect, it, vi } from 'vitest'
import { SessionControlController } from '../src/control.ts'

async function harness(options: { owner?: string; handoff?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  const session = ctx.sessions.create(SessionId('live-session'), options.owner === undefined ? {} : { meta: { owner: options.owner } })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent = { id: session.id, session, inbox, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  const published: Array<[string, string, unknown]> = []
  let shared: unknown
  if (options.handoff !== false) {
    ctx.provide('sessionHandoff', {
      publishLive: (owner: string, id: string, live: unknown) => { published.push([owner, id, live]) },
      liveOf: () => shared,
    } as never)
  }
  const control = new SessionControlController(ctx)
  return { ctx, control, agent, inbox, published, share: (value: unknown) => { shared = value } }
}

const message = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

describe('live session state across devices', () => {
  it('shares a running turn and its queue, and clears them once nothing is live', async () => {
    const { ctx, agent, inbox, published } = await harness({ owner: 'owner-1' })
    ;(agent as { status: string }).status = 'running'
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    const queued = message('next')
    inbox.append('next-turn', queued)
    inbox.remove(queued.id)
    ;(agent as { status: string }).status = 'idle'
    ctx.emit('agent/status', { agent, status: 'idle' } as never)
    const queueLength = (live: unknown): number | undefined =>
      (live === undefined ? undefined : (live as { queue: unknown[] }).queue.length)
    const shared = published.map(([owner, id, live]): [string, string, number | undefined] => [owner, id, queueLength(live)])
    expect(shared).toEqual([
      ['owner-1', 'live-session', 0], ['owner-1', 'live-session', 1], ['owner-1', 'live-session', 0], ['owner-1', 'live-session', undefined],
    ])
  })

  it('shares nothing for a session without an account or without a handoff provider', async () => {
    const unowned = await harness()
    unowned.ctx.emit('agent/status', { agent: unowned.agent, status: 'running' } as never)
    expect(unowned.published).toEqual([])
    const alone = await harness({ owner: 'owner-1', handoff: false })
    expect(() => { alone.ctx.emit('agent/status', { agent: alone.agent, status: 'running' } as never) }).not.toThrow()
  })

  it('shows another device\'s running turn and queue for the session it writes', async () => {
    const { ctx, control, share } = await harness({ owner: 'owner-1' })
    const status = vi.fn()
    ctx.on('api-session/status', status)
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    await iterator.next()
    const queued = message('from the laptop')
    share({ running: true, queue: [{ id: queued.id, placement: 'queued', message: { id: queued.id, content: [] } }] })
    ctx.emit('session-handoff/live', 'owner-1', SessionId('remote-session'))
    const frame = await iterator.next()
    expect(frame.value).toMatchObject({ type: 'queue', sessionId: 'remote-session', items: [{ id: queued.id }] })
    expect(status).toHaveBeenCalledWith('remote-session', true)
    share('not an object')
    ctx.emit('session-handoff/live', 'owner-1', SessionId('remote-session'))
    expect((await iterator.next()).value).toMatchObject({ type: 'queue', items: [] })
    expect(status).toHaveBeenLastCalledWith('remote-session', false)
    share({ running: true, queue: 'nope' })
    ctx.emit('session-handoff/live', 'owner-1', SessionId('remote-session'))
    expect((await iterator.next()).value).toMatchObject({ type: 'queue', items: [] })
    abort.abort()
  })
})
