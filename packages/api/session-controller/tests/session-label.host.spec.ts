/**
 * Session Controller label delegation through the composed SessionLabelsService:
 * the verb writes one `session/label` event whose fold, not the unary response,
 * is what a client reads back.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionSeq } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import SessionLabelsService from '@aeven/session-labels'
import AgentRegistry from '@aeven/agent'
import type { Agent } from '@aeven/agent'
import type { Session, SessionId } from '@aeven/session'
import { createSessionTestRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

async function composed(withLabels = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  if (withLabels) await ctx.plugin(SessionLabelsService, { maxLabelBytes: 24 })
  return ctx
}

/** Register one live agent whose log holds `turns` completed turns. */
function liveAgent(ctx: Context, id: string, turns: number): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('sessions.label', () => {
  it('appends one normalized session/label event and echoes its seq', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-label', 1)
    const at = SessionSeq(0)

    const labelled = await remote(ctx).label({ sessionId: source.id, at, label: '  the   repro  ' })
    expect(labelled.ok).toBe(true)
    if (!labelled.ok) return
    expect(labelled.value.label).toBe('the repro')
    const event = source.snapshotEvents().findLast(item => item.type === 'session/label')
    expect(event?.seq).toBe(labelled.value.seq)
    expect(event?.data).toMatchObject({ at, label: 'the repro' })
    const view = ctx.sessionProjections.snapshot(source, ['sessionLabels']).values.sessionLabels
    expect(view).toEqual([{ at, label: 'the repro' }])
  })

  it('removes the bookmark when the text normalizes to nothing', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-label-clear', 1)
    const at = SessionSeq(1)

    const first = await remote(ctx).label({ sessionId: source.id, at, label: 'keep' })
    expect(first.ok).toBe(true)
    const cleared = await remote(ctx).label({ sessionId: source.id, at, label: '   ' })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.value.label).toBeNull()
    expect(ctx.sessionProjections.snapshot(source, ['sessionLabels']).values.sessionLabels).toEqual([])
  })

  it('bounds the label to the configured byte budget', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-label-long', 1)

    const labelled = await remote(ctx).label({ sessionId: source.id, at: SessionSeq(0), label: 'x'.repeat(100) })
    expect(labelled.ok).toBe(true)
    if (!labelled.ok) return
    expect(labelled.value.label).toBe('x'.repeat(24))
  })

  it('maps a point with no logged event to label-target-invalid', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-label-bad', 1)

    const response = await remote(ctx).label({ sessionId: source.id, at: 999, label: 'nowhere' })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error).toMatchObject({
      code: 'session/label-target-invalid',
      details: { sessionId: source.id },
    })
  })

  it('rejects a negative point as a bad request rather than a log lookup', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-label-negative', 1)

    const response = await remote(ctx).label({ sessionId: source.id, at: -1, label: 'before the log' })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('gateway/bad-request')
  })

  it('reports an unmounted labels service as internal, not as the caller’s mistake', async () => {
    const ctx = await composed(false)
    const source = liveAgent(ctx, 'session-label-unmounted', 1)

    const response = await remote(ctx).label({ sessionId: source.id, at: 0, label: 'unavailable' })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('gateway/internal')
  })
})
