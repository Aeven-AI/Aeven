/**
 * The summary blank bit means "conversation not started" (no turn has run),
 * not "log empty": standalone plugin events — command lifecycle records,
 * plan/mode, permission knob events, session titles — never flip it, so running /plan or /goal on a
 * fresh session keeps it list-hidden and reusable, while the first accepted
 * prompt's turn/start clears it. The host/session-added frame shares the
 * same predicate function (covered by the workspace spec's frame assertion).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@aeven/agent'
import type { Agent } from '@aeven/agent'
import SessionStore, { SessionId } from '@aeven/session'
import type { Session } from '@aeven/session'
import { CommandId } from '@aeven/commands/brand'
// Side-effect type imports: the configuration-event SessionEventMap merges.
import type {} from '@aeven/permission-presets'
import type {} from '@aeven/sandbox-policy'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote; attach: (session: Session) => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: (session) => {
      ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone (non-conversation) event family a fresh session can accumulate. */
function appendStandalone(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('plan/mode', { active: true })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // Permission configuration events from a /permission switch on a fresh session.
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
}

async function listBlank(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.blank
}

describe('summary blank = conversation not started', () => {
  it('lists shared conversation metadata before its body exists on this device', async () => {
    const { ctx, remote } = await harness()
    try {
      ctx.provide('identityUsers', { actingUser: () => ({ id: 'account' }) } as never)
      ctx.provide('sessionHandoff', {
        catalog: () => [{
          header: { id: SessionId('not-downloaded'), owner: 'account', version: 0, createdAt: 1, isSeeded: false, replica: true },
          next: 10, updatedAt: 3, title: 'Shared history',
        }],
        // Nothing in this account runs the shared conversation on another device.
        runnerOf: () => undefined,
      } as never)
      const result = await remote.list({})
      expect(result).toMatchObject({ ok: true, value: { items: [{
        sessionId: 'not-downloaded', replica: true, blank: false,
        projections: { asOfSeq: 9, values: { title: 'Shared history' } },
      }] } })
      expect(ctx.sessions.list()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('standalone events (command lifecycle, plan/mode, title) keep the session blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    expect(await listBlank(remote, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('the first turn clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    appendStandalone(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(remote, session.id)).toBe(false)
  })
})
