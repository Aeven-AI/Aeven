/**
 * Input for a session another device of the account writes: every input command forwards it to that device
 * instead of resuming a local agent, an edit is checked against this device's copy first, a refused forward reads
 * as a busy agent, and input forwarded to this device runs through the same commands as local input.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@aeven/agent'
import type { Agent, ModelSelectionRef } from '@aeven/agent'
import { createUserMessage, MessageId } from '@aeven/llm'
import SessionStore, { SessionId } from '@aeven/session'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionRequestId } from '../src/types.ts'

const REMOTE = SessionId('remote-session')
const LOCAL = SessionId('local-session')

async function harness(options: { handoff?: boolean; signedIn?: boolean; claim?: boolean; binding?: 'remote' | 'folder' } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const copy = ctx.sessions.create(REMOTE, { meta: { owner: 'owner-1' } })
  const prompt = createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } })
  copy.append('turn/start', { turn: 1 })
  const promptSeq = copy.append('user/message', prompt, { surfaceOp: 'append' }).seq
  const session = ctx.sessions.create(LOCAL, { meta: { owner: 'owner-1' } })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const followup = vi.fn()
  const cancel = vi.fn()
  const agent = {
    id: session.id, session, inbox, status: 'running', ctx,
    steer: vi.fn(), followup, cancel,
    whenIdle: () => Promise.resolve(),
    runMaintenance: (job: () => Promise<void>) => job(),
  } as unknown as Agent
  ctx.agents.register(agent)
  const forward = vi.fn((_owner: string, _id: SessionId, _input: unknown) => Promise.resolve())
  if (options.handoff !== false) {
    ctx.provide('sessionHandoff', {
      runnerOf: (_owner: string, id: SessionId) => (id === REMOTE ? { device: 'laptop-id', name: 'laptop' } : undefined),
      forward,
      fetch: () => Promise.resolve(),
      claim: vi.fn((_owner: string, id: SessionId) => Promise.resolve({ claimed: id !== REMOTE || options.claim === true })),
    } as never)
  }
  if (options.signedIn !== false) ctx.provide('identityUsers', { actingUser: () => ({ id: 'owner-1' }) } as never)
  ctx.provide('workspaceRegistry', {
    get: () => undefined,
    list: () => options.binding === undefined ? [] : [{
      kind: options.binding, path: options.binding === 'folder' ? '/bound-here' : undefined, sessionIds: [REMOTE],
    }],
    placeSession: () => options.binding === undefined
      ? { state: 'unfiled' }
      : options.binding === 'folder'
        ? { state: 'filed', workspace: { kind: 'folder', path: '/bound-here', sessionIds: [REMOTE] } }
        : { state: 'pending', home: '/bound-elsewhere' },
    replicated: (id: SessionId) => options.binding === undefined && id === REMOTE,
  } as never)
  const enter = vi.fn(() => Promise.resolve('/bound-here'))
  ctx.provide('workingDirectory', {
    enter,
    local: () => ({ state: 'local', cwd: '/bound-here', root: '/bound-here' }),
  } as never)
  const selection: ModelSelectionRef = { current: { provider: 'fixture', model: 'fixture-model' }, assembled: undefined }
  const agents = {
    resolveAgent: (id: SessionId) => Promise.resolve(id === LOCAL ? { agent } : options.claim && id === REMOTE ? { agent: { ...agent, id: copy.id, session: copy } } : { error: new Error(`resumed ${id}`) }),
    selectionFor: () => selection,
    serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
    callerMayAccess: () => true,
  } as unknown as ApiSessionAgentController
  ctx.provide('llm', { resolveModelInfo: () => Promise.resolve({}), listProviders: () => [{ id: 'fixture' }] } as never)
  const controller = new SessionCommandController(ctx, agents, '/workspace')
  return { ctx, controller, agent, forward, promptSeq, followup, cancel, enter }
}

const requestId = 'request-1' as SessionRequestId

describe('input for a session another device writes', () => {
  it('continues locally after handover, in the folder this device holds', async () => {
    const { controller, forward, followup, enter } = await harness({ claim: true, binding: 'folder' })
    await expect(controller.prompt({ requestId, sessionId: REMOTE, mode: 'queue', content: [{ type: 'text', text: 'continue here' }] })).resolves.toEqual({ accepted: true })
    expect(enter).not.toHaveBeenCalled()
    expect(followup).toHaveBeenCalledOnce()
    expect(forward).not.toHaveBeenCalled()
  })

  it('keeps input on the existing runner when this device has no folder binding', async () => {
    const { controller, forward, followup, enter } = await harness({ claim: true, binding: 'remote' })
    await expect(controller.prompt({ requestId, sessionId: REMOTE, mode: 'queue', content: [{ type: 'text', text: 'continue there' }] })).resolves.toEqual({ accepted: true })
    expect(forward).toHaveBeenCalledOnce()
    expect(followup).not.toHaveBeenCalled()
    expect(enter).not.toHaveBeenCalled()
  })

  it('forwards every input command to the writing device instead of resuming the session here', async () => {
    const { controller, forward, promptSeq } = await harness()
    const prompt = { requestId, sessionId: REMOTE, mode: 'queue' as const, content: [{ type: 'text' as const, text: 'hello' }] }
    await expect(controller.prompt(prompt)).resolves.toEqual({ accepted: true })
    await expect(controller.retry({ sessionId: REMOTE })).resolves.toEqual({ accepted: true })
    await expect(controller.cancel({ sessionId: REMOTE })).resolves.toEqual({ accepted: true })
    const queue = { sessionId: REMOTE, itemId: MessageId('item'), action: { kind: 'remove' as const } }
    await expect(controller.updateQueue(queue)).resolves.toEqual({ accepted: true })
    const edit = { requestId, sessionId: REMOTE, messageSeq: promptSeq, text: 'changed' }
    await expect(controller.edit(edit)).resolves.toEqual({ accepted: true, rewindSeq: 2 })
    expect(forward.mock.calls.map(([owner, id, input]) => [owner, id, (input as { operation: string }).operation])).toEqual([
      ['owner-1', REMOTE, 'prompt'], ['owner-1', REMOTE, 'retry'], ['owner-1', REMOTE, 'cancel'],
      ['owner-1', REMOTE, 'queue'], ['owner-1', REMOTE, 'edit'],
    ])
    expect(forward.mock.calls[0]?.[2]).toEqual({ operation: 'prompt', request: prompt })
  })

  it('checks an edit against this device\'s copy, and reports a forward that failed as a busy agent', async () => {
    const { controller, forward } = await harness()
    await expect(controller.edit({ requestId, sessionId: REMOTE, messageSeq: 0, text: 'x' })).rejects.toMatchObject({ code: 'session/edit-unavailable' })
    forward.mockRejectedValueOnce(new Error('relay down'))
    await expect(controller.cancel({ sessionId: REMOTE })).rejects.toMatchObject({ code: 'session/agent-busy' })
  })

  it('handles input for a session no device of the account publishes here', async () => {
    const { controller, forward } = await harness()
    await expect(controller.retry({ sessionId: SessionId('unpublished') })).rejects.toThrow(/resumed unpublished/)
    expect(forward).not.toHaveBeenCalled()
  })

  it('handles the input here without a handoff provider or a signed-in caller', async () => {
    for (const options of [{ handoff: false }, { signedIn: false }]) {
      const { controller, forward } = await harness(options)
      await expect(controller.retry({ sessionId: REMOTE })).rejects.toThrow(/resumed remote-session/)
      expect(forward).not.toHaveBeenCalled()
    }
  })

  it('applies input forwarded to this device through the same commands as local input', async () => {
    const { controller, agent, followup, cancel } = await harness()
    await controller.applyForwarded(LOCAL, { operation: 'prompt', request: { requestId, mode: 'queue', content: [{ type: 'text', text: 'from the desktop' }] } })
    expect(followup).toHaveBeenCalledOnce()
    await controller.applyForwarded(LOCAL, { operation: 'cancel', request: {} })
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    await expect(controller.applyForwarded(LOCAL, { operation: 'queue', request: { itemId: 'gone', action: { kind: 'remove' } } }))
      .rejects.toMatchObject({ code: 'session/queue-item-not-found' })
    await expect(controller.applyForwarded(LOCAL, { operation: 'retry', request: {} })).rejects.toMatchObject({ code: 'session/retry-unavailable' })
    await expect(controller.applyForwarded(LOCAL, { operation: 'edit', request: { requestId, messageSeq: 99, text: 'x' } }))
      .rejects.toMatchObject({ code: 'session/edit-unavailable' })
    await expect(controller.applyForwarded(LOCAL, { operation: 'teleport', request: {} })).rejects.toThrow(/unknown forwarded session operation/)

    const queued = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    agent.inbox.append('next-turn', queued)
    await controller.applyForwarded(LOCAL, { operation: 'queue', request: { itemId: queued.id, action: { kind: 'remove' } } })
    expect(agent.inbox.nextTurn).toEqual([])
    agent.session.append('turn/start', { turn: 1 })
    const asked = agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'provider_unavailable', message: 'down' } } } as never)
    await controller.applyForwarded(LOCAL, { operation: 'retry', request: {} })
    await controller.applyForwarded(LOCAL, { operation: 'edit', request: { requestId, messageSeq: asked.seq, text: 'q2' } })
    expect(followup).toHaveBeenCalledTimes(3)
  })
})
