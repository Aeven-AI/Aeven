/**
 * Approvals and questions across the devices of one account: the device running the turn lists a pending request
 * for the other devices, takes whichever answer comes first and withdraws the other presentation, waits a bounded
 * time for another device when nobody here answers, and leaves a session that does not sync alone. Another device
 * presents what the running device lists to its own clients, forwards their answer, and withdraws what is no
 * longer listed.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@aeven/agent'
import type { Agent } from '@aeven/agent'
import SessionStore, { SessionId } from '@aeven/session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InteractionRelay, type SharedInteraction } from '../src/interactions.ts'

afterEach(() => { vi.useRealTimers() })

async function harness(options: { owner?: string | null; handoff?: boolean; waitMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create(SessionId('asking'), options.owner === null ? {} : { meta: { owner: options.owner ?? 'owner-1' } })
  const agent = { id: session.id, session, ctx } as Agent
  const forward = vi.fn((_owner: string, _id: SessionId, _input: unknown) => Promise.resolve())
  if (options.handoff !== false) ctx.provide('sessionHandoff', { forward } as never)
  const changed = vi.fn()
  const relay = new InteractionRelay(ctx, changed, options.waitMs ?? 1_000)
  return { ctx, agent, relay, changed, forward }
}

const approve = (ctx: Context, agent: Agent, signal?: AbortSignal) =>
  ctx.waterfall(agent as never, 'approval/request', { agent, toolName: 'bash', ...signal === undefined ? {} : { signal } }, () => Promise.resolve('unavailable' as const))

describe('approvals and questions on the device running the turn', () => {
  it('takes another device\'s answer and withdraws the local prompt', async () => {
    const { ctx, agent, relay, changed } = await harness()
    let localSignal: AbortSignal | undefined
    ctx.on('approval/request', (request) => {
      localSignal = request.signal
      return new Promise(() => {})
    })
    const asked = approve(ctx, agent)
    await vi.waitFor(() => { expect(relay.pendingFor(agent.id)).toHaveLength(1) })
    const [shared] = relay.pendingFor(agent.id)
    expect(shared).toMatchObject({ event: 'approval/request', request: { toolName: 'bash' } })
    expect(relay.pendingFor(SessionId('other'))).toEqual([])
    relay.answer('unknown', 'allowed-once')
    relay.answer(shared!.id, 'maybe')
    relay.answer(shared!.id, 'allowed-once')
    await expect(asked).resolves.toBe('allowed-once')
    expect(localSignal?.aborted).toBe(true)
    expect(relay.pendingFor(agent.id)).toEqual([])
    expect(changed).toHaveBeenCalledWith(agent)
  })

  it('keeps a local answer, and leaves a session without an account or without sync to the local answerers', async () => {
    const { ctx, agent } = await harness()
    ctx.on('approval/request', () => Promise.resolve('rejected' as const))
    await expect(approve(ctx, agent)).resolves.toBe('rejected')
    for (const options of [{ owner: null }, { handoff: false }]) {
      const alone = await harness(options)
      await expect(approve(alone.ctx, alone.agent)).resolves.toBe('unavailable')
      expect(alone.relay.pendingFor(alone.agent.id)).toEqual([])
    }
  })

  it('waits for another device when nobody answers here, for a bounded time, and stops when the request ends', async () => {
    const { ctx, agent, relay } = await harness({ waitMs: 50 })
    const late = approve(ctx, agent)
    await vi.waitFor(() => { expect(relay.pendingFor(agent.id)).toHaveLength(1) })
    await new Promise(resolve => setTimeout(resolve, 5))
    relay.answer(relay.pendingFor(agent.id)[0]!.id, 'allowed-session')
    await expect(late).resolves.toBe('allowed-session')
    await expect(approve(ctx, agent)).resolves.toBe('unavailable')
    const ended = new AbortController()
    const withdrawn = approve(ctx, agent, ended.signal)
    await vi.waitFor(() => { expect(relay.pendingFor(agent.id)).toHaveLength(1) })
    await new Promise(resolve => setTimeout(resolve, 5))
    ended.abort()
    await expect(withdrawn).resolves.toBe('unavailable')
    const before = new AbortController()
    before.abort()
    await expect(approve(ctx, agent, before.signal)).resolves.toBe('unavailable')
  })

  it('relays questions the same way, failing as before when nobody anywhere answers', async () => {
    const { ctx, agent, relay } = await harness({ waitMs: 20 })
    const ask = () => ctx.waterfall(agent as never, 'user-questions/request', { agent, questions: [] }, () => Promise.reject(new Error('NO_PROVIDER')))
    const answered = ask()
    await vi.waitFor(() => { expect(relay.pendingFor(agent.id)).toHaveLength(1) })
    relay.answer(relay.pendingFor(agent.id)[0]!.id, { nope: true })
    relay.answer(relay.pendingFor(agent.id)[0]!.id, { answers: [] })
    await expect(answered).resolves.toEqual({ answers: [] })
    await expect(ask()).rejects.toThrow(/no user-questions answerer/)
  })
})

describe('approvals and questions on another device', () => {
  const listed: SharedInteraction = { id: 'i-1', event: 'approval/request', request: { toolName: 'bash' } }

  it('presents what the running device lists, forwards the answer, and asks each once', async () => {
    const { ctx, relay, forward } = await harness()
    const seen: Array<{ session: string; scoped: unknown }> = []
    ctx.on('approval/request', function (request) {
      seen.push({ session: String(request.agent.id), scoped: (request.agent as unknown as { ctx: { agent: unknown } }).ctx.agent })
      return Promise.resolve('allowed-once' as const)
    })
    relay.present('owner-1', SessionId('remote'), [listed])
    relay.present('owner-1', SessionId('remote'), [listed])
    await vi.waitFor(() => { expect(forward).toHaveBeenCalledOnce() })
    expect(forward).toHaveBeenCalledWith('owner-1', 'remote', { operation: 'interaction', request: { id: 'i-1', answer: 'allowed-once' } })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.session).toBe('remote')
    ctx.on('user-questions/request', () => Promise.resolve({ answers: [] }))
    relay.present('owner-1', SessionId('remote'), [listed, { id: 'q-1', event: 'user-questions/request', request: { questions: [] } }])
    await vi.waitFor(() => { expect(forward).toHaveBeenCalledTimes(2) })
    expect(forward).toHaveBeenLastCalledWith('owner-1', 'remote', { operation: 'interaction', request: { id: 'q-1', answer: { answers: [] } } })
    expect(relay.pendingFor(SessionId('remote'))).toEqual([])
  })

  it('withdraws what is no longer listed and forwards nothing nobody answered', async () => {
    const { ctx, relay, forward } = await harness()
    let signal: AbortSignal | undefined
    ctx.on('approval/request', (request) => {
      signal = request.signal
      return new Promise((resolve) => { request.signal?.addEventListener('abort', () => { resolve('unavailable') }) })
    })
    relay.present('owner-1', SessionId('remote'), [listed])
    await vi.waitFor(() => { expect(signal).toBeDefined() })
    relay.present('owner-1', SessionId('other'), [])
    expect(signal?.aborted).toBe(false)
    relay.present('owner-1', SessionId('remote'), [])
    expect(signal?.aborted).toBe(true)
    const quiet = await harness()
    quiet.relay.present('owner-1', SessionId('remote'), [listed, { id: 'q', event: 'user-questions/request', request: { questions: [] } }])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(quiet.forward).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
  })

  it('reports an answer that could not reach the running device, and withdraws presentations when it stops', async () => {
    const { ctx, relay, forward } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    forward.mockRejectedValueOnce(new Error('relay down'))
    ctx.on('approval/request', () => Promise.resolve('rejected' as const))
    relay.present('owner-1', SessionId('remote'), [listed])
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('relay down')) })
    const stopping = await harness()
    let signal: AbortSignal | undefined
    stopping.ctx.on('approval/request', (request) => {
      signal = request.signal
      return new Promise(() => {})
    })
    stopping.relay.present('owner-1', SessionId('remote'), [listed])
    await vi.waitFor(() => { expect(signal).toBeDefined() })
    await stopping.ctx.fiber.dispose()
    expect(signal?.aborted).toBe(true)
  })
})
