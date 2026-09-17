/**
 * Cold-session and degenerate-composition paths of the Session Controller:
 * metadata-only listing, Agent-free history reads, subagent ownership
 * isolation, and prompt failure mapping.
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdtemp as mkdtempAsync } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionLogOffset, SessionSeq } from '@aeven/session'
import AgentRegistry from '@aeven/agent'
import SessionProjectionRegistry from '@aeven/session-projection'
import SessionProjectionCache from '@aeven/session-projection-cache'
import Storage from '@aeven/storage'
import * as StorageDomain from '@aeven/storage-domain'
import * as StorageJson from '@aeven/storage-json'
import { SessionHistoryController } from '@aeven/api-session-controller/src/history.ts'
import { subagentIdentityProjectionDefinition } from '@aeven/subagent/src/projection.ts'
import { titleProjectionDefinition } from '@aeven/session-title'
import TypertRegistry from '@aeven/typert-registry'
import { createUserMessage, MessageId } from '@aeven/llm'
import { snapshotSubagentDescriptor } from '@aeven/subagent'
import type { Agent } from '@aeven/agent'
import type { SessionEvent, SessionHeader, SessionId } from '@aeven/session'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'
import {
  PersistenceCoordinator,
  SessionPersistenceRevision,
  type PersistenceBackend,
  type StoredPrefix,
} from '@aeven/session-persistence'
import {
  createSessionTestRemote,
  installSessionReadTestServices,
  testSessionPersistence,
} from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

function request<P>(payload: P): P {
  return payload
}

let nextRequestId = 1
function promptRequest(
  payload: Omit<SessionPromptRequest, 'requestId'>,
): SessionPromptRequest {
  return {
    ...payload,
    requestId: `cold-${String(nextRequestId++)}` as SessionRequestId,
  }
}

function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: sid(id), createdAt, cwd: '/proj', isSeeded: false, ...extra }
}

function providePersistence(ctx: Context, persistence: Record<string, unknown>): () => void {
  return ctx.provide('sessionPersistence', testSessionPersistence(ctx, persistence) as never)
}

describe('sessions.list cold merge', () => {
  it('serves cold rows from cached projections without reading a body', async () => {
    // Listing is a cache-first read: blankness and title come from the durable
    // projection cache, so a hit costs no body read and listing latency stays
    // independent of log size. This context mounts no `sessionPersistence`
    // refold path for the missed row, so the miss stays uncached here; the
    // title-recovery refold has its own coverage below.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const metas: SessionHeader[] = [
      header('cached-blank', 100),
      header('cached-conversation', 200),
      header('uncached', 300, { parentSession: sid('session-parent'), origin: 'subagent' }),
      header('missing-cwd', 800, {}),
    ]
    delete (metas[3] as { cwd?: string }).cwd
    const inspect = vi.fn()
    providePersistence(ctx, {
      list: () => Promise.resolve(metas),
      inspect,
    })
    ctx.provide('sessionProjectionCache', {
      cachedSnapshot: (meta: SessionHeader) => {
        if (meta.id === sid('cached-blank')) {
          return { asOfSeq: 0, values: { sessionListMetadata: { blank: true, lastPromptAt: null } } }
        }
        if (meta.id === sid('cached-conversation')) {
          return { asOfSeq: 1, values: { sessionListMetadata: { blank: false, lastPromptAt: 1000 } } }
        }
        return undefined
      },
    } as never)
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
    })
    const observe = vi.spyOn(ctx.sessionQuery, 'observeSession')

    const response = await remote.list(request({}))
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    const byId = Object.fromEntries(response.value.items.map(item => [item.sessionId, item]))
    expect(byId['cached-blank']).toMatchObject({ blank: true, updatedAt: 100, running: false })
    expect(byId['cached-conversation']).toMatchObject({ blank: false, updatedAt: 1000 })
    // A cache miss leaves blankness unknown; the row stays visible.
    expect(byId['uncached']).toMatchObject({
      blank: false,
      updatedAt: 300,
      parentSessionId: 'session-parent',
      origin: 'subagent',
    })
    expect(byId['missing-cwd']).toBeUndefined()
    // No body read of any kind happened while listing.
    expect(inspect).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
  })
})

describe('attached updatedAt tracks human prompts', () => {
  it('ignores pickup and non-prompt work after the latest human message', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    await new Promise(resolve => setTimeout(resolve, 0))

    // Old work, resumed just now: the log tail would report the pickup.
    const worked = 1_000_000
    const resumed = ctx.sessions.create(sid('resumed-untouched'), {
      seed: [
        { type: 'turn/start', seq: SessionSeq(0), time: worked, data: { turn: 1 } },
        {
          type: 'user/message', seq: SessionSeq(1), time: worked,
          data: createUserMessage({ content: [{ type: 'text', text: 'worked' }], source: { kind: 'user' } }),
          surfaceOp: 'append',
        },
        { type: 'turn/end', seq: SessionSeq(2), time: worked + 1, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
      meta: { cwd: '/proj', createdAt: 500 },
    })
    ctx.agents.register({ id: resumed.id, session: resumed, status: 'idle', ctx } as Agent)
    const boundary = resumed.snapshotEvents().at(-1)
    expect(boundary?.type).toBe('session/end-seed')
    expect(boundary?.time).toBeGreaterThan(worked)

    const listed = await remote.list(request({}))
    if (!listed.ok) throw new Error('list failed')
    const summary = listed.value.items.find(item => item.sessionId === 'resumed-untouched')
    expect(summary?.updatedAt).toBe(500)

    // A lifecycle boundary is not a human update.
    resumed.append('turn/start', { turn: 2 })
    const afterBoundary = await remote.list(request({}))
    if (!afterBoundary.ok) throw new Error('list failed')
    expect(afterBoundary.value.items.find(item => item.sessionId === 'resumed-untouched')?.updatedAt)
      .toBe(worked)

    const prompt = resumed.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'new prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const after = await remote.list(request({}))
    if (!after.ok) throw new Error('list failed')
    const moved = after.value.items.find(item => item.sessionId === 'resumed-untouched')
    expect(moved?.updatedAt).toBe(prompt.time)
  })
})

describe('cold history recovery view', () => {
  it('shows in-memory interruption repair without activating the session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const sessionId = sid('session-interrupted')
    const meta = header(sessionId, 1000)
    const stored: StoredPrefix<never> = {
      meta,
      inheritedEventCount: SessionLogOffset(0),
      events: [{ type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } }],
      revision: SessionPersistenceRevision('history-recovery-test:1'),
    }
    const backend: PersistenceBackend<never> = {
      name: 'history-recovery-test',
      loadStored: id => Promise.resolve(id === sessionId ? structuredClone(stored) : undefined),
      readStoredRevision: id => Promise.resolve(
        id === sessionId ? SessionPersistenceRevision('history-recovery-test:1') : undefined,
      ),
      appendBatch: () => Promise.resolve(),
      commitRepair: () => Promise.resolve(),
      list: () => Promise.resolve([structuredClone(meta)]),
    }
    const coordinator = new PersistenceCoordinator(ctx, backend)
    providePersistence(ctx, {
      list: (signal?: AbortSignal) => backend.list(signal),
      inspect: (id: SessionId, signal?: AbortSignal) => coordinator.inspect(id, signal),
      borrowSession: (id: SessionId, signal?: AbortSignal) => coordinator.borrowSession(id, signal),
      locate: () => undefined,
    })
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const history = await remote.page({
      address: { kind: 'session', sessionId },
      throughSeq: 1,
      beforeSeq: 2,
      maxMessages: 10,
    })
    if (!history.ok) throw new Error('history failed')
    expect(history.value.records.map(record => record.event)).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "turn": 1,
          },
          "seq": 0,
          "time": 1,
          "type": "turn/start",
        },
        {
          "data": {
            "reason": {
              "kind": "interrupted",
            },
            "turn": 1,
          },
          "seq": 1,
          "time": 1,
          "type": "turn/end",
        },
      ]
    `)
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('Remote Agent and Session lookup policy', () => {
  it('deduplicates a cold resume across Agent and Session parameters', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = sid('session-remote-cold')
    const meta = header(sessionId, 1000)
    const inspect = vi.fn(() => Promise.resolve({
      meta,
      inheritedEventCount: SessionLogOffset(0),
      events: [] as SessionEvent[],
    }))
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect,
      locate: () => undefined,
    })
    const resumedSession = { id: sessionId, header: meta, events: [] } as unknown as import('@aeven/session').Session
    const resumedAgent = { id: sessionId, session: resumedSession, status: 'idle', ctx } as Agent
    const release = Promise.withResolvers<undefined>()
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      await release.promise
      return { agent: resumedAgent, dispose: () => Promise.resolve() }
    })
    const defaultAgentLookup = ctx.typert.lookups.get('agent')
    const defaultSessionLookup = ctx.typert.lookups.get('session')
    createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    await vi.waitFor(() => {
      expect(ctx.typert.lookups.get('agent')).not.toBe(defaultAgentLookup)
      expect(ctx.typert.lookups.get('session')).not.toBe(defaultSessionLookup)
    })
    const agentLookup = ctx.typert.lookups.get('agent')
    const sessionLookup = ctx.typert.lookups.get('session')
    if (agentLookup === undefined || sessionLookup === undefined) throw new Error('core lookup providers were not mounted')

    const resolvedAgent = Promise.resolve(agentLookup.resolve(sessionId))
    const resolvedSession = Promise.resolve(sessionLookup.resolve(sessionId))
    await vi.waitFor(() => { expect(resume).toHaveBeenCalledOnce() })
    release.resolve(undefined)

    await expect(resolvedAgent).resolves.toBe(resumedAgent)
    await expect(resolvedSession).resolves.toBe(resumedSession)
    expect(inspect).toHaveBeenCalledOnce()
  })

  it('preserves the subagent ownership fence for cold and live Remote lookups', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const coldId = sid('session-remote-cold-child')
    const coldMeta = header(coldId, 1000, {
      parentSession: sid('session-parent'),
      origin: 'subagent',
    })
    const inspect = vi.fn(() => Promise.resolve({
      meta: coldMeta,
      inheritedEventCount: SessionLogOffset(0),
      events: [] as SessionEvent[],
    }))
    providePersistence(ctx, {
      list: () => Promise.resolve([coldMeta]),
      inspect,
      locate: () => undefined,
    })
    const liveSession = ctx.sessions.create(sid('session-remote-live-child'), {
      meta: { cwd: '/proj', parentSession: sid('session-parent'), origin: 'subagent' },
    })
    const liveAgent = { id: liveSession.id, session: liveSession, status: 'idle', ctx } as Agent
    ctx.agents.register(liveAgent)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const defaultAgentLookup = ctx.typert.lookups.get('agent')
    const defaultSessionLookup = ctx.typert.lookups.get('session')
    createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    await vi.waitFor(() => {
      expect(ctx.typert.lookups.get('agent')).not.toBe(defaultAgentLookup)
      expect(ctx.typert.lookups.get('session')).not.toBe(defaultSessionLookup)
    })
    const agentLookup = ctx.typert.lookups.get('agent')
    const sessionLookup = ctx.typert.lookups.get('session')
    if (agentLookup === undefined || sessionLookup === undefined) throw new Error('core lookup providers were not mounted')
    const ownershipFailure = {
      code: 'session/agent-busy',
      details: { reason: 'use subagent delivery for this child session' },
    }

    const coldFailure = Promise.resolve(agentLookup.resolve(coldId))
    const liveFailure = Promise.resolve(sessionLookup.resolve(liveSession.id))
    await expect(coldFailure).rejects.toMatchObject(ownershipFailure)
    await expect(liveFailure).rejects.toMatchObject(ownershipFailure)
    expect(resume).not.toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledOnce()
  })
})

describe('subagent ownership fence', () => {
  it('reads a cold child without an Agent and rejects generic resume or adoption', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = sid('session-child')
    const meta = header('session-child', 1000, {
      parentSession: sid('session-parent'),
      isSeeded: true,
      origin: 'subagent',
    })
    const events = [
      {
        type: 'turn/start',
        seq: SessionSeq(0),
        time: 1,
        data: {
          turn: 1,
          trigger: { kind: 'message', source: { kind: 'user' } },
        } as SessionEvent<'turn/start'>['data'],
      },
      {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 2,
        data: createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }),
        surfaceOp: 'append',
      },
      {
        type: 'subagent/descriptor',
        seq: SessionSeq(2),
        time: 3,
        data: snapshotSubagentDescriptor({
          mode: 'continuable',
          provider: 'spawn',
          label: 'child',
        }),
      },
      { type: 'turn/end', seq: SessionSeq(3), time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ] satisfies SessionEvent[]
    const inspect = vi.fn(() => Promise.resolve({
      meta,
      inheritedEventCount: SessionLogOffset(0),
      events,
    }))
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect,
      locate: () => undefined,
    })
    const resume = vi.spyOn(ctx.agents, 'resume')
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    ctx.sessionProjections.register(subagentIdentityProjectionDefinition)

    const history = await new SessionHistoryController(
      ctx,
      (observation) => { observation[Symbol.dispose]() },
    ).page({
      address: {
        kind: 'subagent',
        parentSessionId: meta.parentSession as SessionId,
        childSessionId: sessionId,
        mode: 'continuable',
      },
      throughSeq: 3,
    }, new AbortController().signal)
    expect(history.records.map(record => record.event.type))
      .toEqual(events.map(event => event.type))
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    const prompt = await remote.prompt(promptRequest({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'follow up' }],
    }))
    expect(prompt.ok).toBe(false)
    if (!prompt.ok) {
      expect(prompt.error).toMatchObject({
        code: 'session/agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      })
    }

    const create = await remote.create(request({ sessionId, cwd: '/proj' }))
    expect(create.ok).toBe(false)
    if (!create.ok) expect(create.error.code).toBe('session/agent-busy')
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(inspect).toHaveBeenCalledTimes(3)
  })

  it('no longer treats a descriptor-only cold child without origin as subagent-owned', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = sid('session-legacy-child')
    const meta = header('session-legacy-child', 1000, {
      parentSession: sid('session-parent'),
      isSeeded: true,
    })
    const events = [
      {
        type: 'subagent/descriptor',
        seq: SessionSeq(0),
        time: 1,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'child' },
      },
    ] satisfies SessionEvent[]
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({
        meta,
        inheritedEventCount: SessionLogOffset(0),
        events,
      }),
      locate: () => undefined,
    })
    // Stores whose headers predate `origin` classify a child only through the
    // descriptor event; the pre-release decision stops recognizing them, so
    // the ownership fence lets generic resume reach the registry instead of
    // answering `agent-busy`.
    const resume = vi.spyOn(ctx.agents, 'resume')
      .mockRejectedValue(new Error('registry unavailable in this bench'))
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const prompt = await remote.prompt(promptRequest({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'follow up' }],
    }))
    expect(resume).toHaveBeenCalledTimes(1)
    expect(prompt.ok).toBe(false)
    if (!prompt.ok) expect(prompt.error.code).toBe('gateway/internal')
  })

  it('rejects origin-marked and runtime-owned live children from generic controls', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const parentSession = ctx.sessions.create(sid('session-parent'), { meta: { cwd: '/proj' } })
    const parent = { id: parentSession.id, session: parentSession, status: 'idle', ctx } as Agent
    ctx.agents.register(parent)

    const originSession = ctx.sessions.create(sid('session-origin-child'), {
      meta: { cwd: '/proj', parentSession: parent.id, origin: 'subagent' },
    })
    const cancel = vi.fn()
    const updateInbox = vi.fn(() => 'applied' as const)
    const originChild = {
      id: originSession.id,
      session: originSession,
      status: 'idle',
      ctx,
      cancel,
      updateInbox,
    } as unknown as Agent
    ctx.agents.register(originChild)

    const startingSession = ctx.sessions.create(sid('session-starting-child'), {
      meta: { cwd: '/proj', parentSession: parent.id },
    })
    const startingChild = { id: startingSession.id, session: startingSession, status: 'idle', ctx } as Agent
    ctx.agents.enter(startingChild, parent)
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const stopped = await remote.cancel(request({ sessionId: originChild.id }))
    expect(stopped.ok).toBe(false)
    if (!stopped.ok) expect(stopped.error.code).toBe('session/agent-busy')
    expect(cancel).not.toHaveBeenCalled()

    const queued = await remote.updateQueue(request({
      sessionId: originChild.id,
      itemId: MessageId('queued-item'),
      action: { kind: 'remove' },
    }))
    expect(queued.ok).toBe(false)
    if (!queued.ok) expect(queued.error.code).toBe('session/agent-busy')
    expect(updateInbox).not.toHaveBeenCalled()

    const selection = await remote.selectModel(request({
      sessionId: startingChild.id,
      provider: 'p',
      model: 'm',
    }))
    expect(selection.ok).toBe(false)
    if (!selection.ok) expect(selection.error.code).toBe('session/agent-busy')

    const create = await remote.create(request({ sessionId: originChild.id, cwd: '/proj' }))
    expect(create.ok).toBe(false)
    if (!create.ok) expect(create.error.code).toBe('session/agent-busy')

    expect(ctx.agents.get(originChild.id)).toBe(originChild)
  })

  it('does not classify an ordinary fork from an inherited ancestor descriptor', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(sid('session-ordinary-fork'), {
      seed: [{
        type: 'subagent/descriptor',
        seq: SessionSeq(0),
        time: 1,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'ancestor' },
      }],
      inheritedEventCount: SessionLogOffset(1),
      meta: { cwd: '/proj', parentSession: sid('session-source'), isSeeded: true },
    })
    const followup = vi.fn()
    const agent = { id: session.id, session, status: 'idle', ctx, followup } as unknown as Agent
    ctx.agents.register(agent)
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const response = await remote.prompt(promptRequest({
      sessionId: agent.id,
      mode: 'queue',
      content: [{ type: 'text', text: 'ordinary work' }],
    }))
    expect(response.ok).toBe(true)
    expect(followup).toHaveBeenCalledOnce()
  })

  it('canonicalizes a supplied browser zone on the exact prompt and rejects invalid names', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(sid('session-browser-zone'), { meta: { cwd: '/proj' } })
    const followup = vi.fn()
    const agent = { id: session.id, session, status: 'idle', ctx, followup } as unknown as Agent
    ctx.agents.register(agent)
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const alias = 'US/Pacific'
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: alias })
      .resolvedOptions().timeZone
    const zonedRequest = promptRequest({
      sessionId: agent.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'zoned work' }],
      clientTimeZone: alias,
    })
    await expect(remote.prompt(zonedRequest)).resolves.toMatchObject({ ok: true })
    expect(followup).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: { kind: 'user', rpcId: zonedRequest.requestId, clientTimeZone: canonical },
    }))

    const utcRequest = promptRequest({
      sessionId: agent.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'UTC work' }],
      clientTimeZone: 'UTC',
    })
    await expect(remote.prompt(utcRequest)).resolves.toMatchObject({ ok: true })
    expect(followup).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: { kind: 'user', rpcId: utcRequest.requestId, clientTimeZone: 'UTC' },
    }))

    const unzonedRequest = promptRequest({
      sessionId: agent.id,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'headless work' }],
    })
    await expect(remote.prompt(unzonedRequest)).resolves.toMatchObject({ ok: true })
    expect(followup).toHaveBeenNthCalledWith(3, expect.objectContaining({
      source: { kind: 'user', rpcId: unzonedRequest.requestId },
    }))

    for (const clientTimeZone of ['', ' UTC', 'CST', 'Not/A_Real_Zone']) {
      const invalid = await remote.prompt(promptRequest({
        sessionId: agent.id,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: 'invalid zone' }],
        clientTimeZone,
      }))
      expect(invalid).toMatchObject({
        ok: false,
        error: {
          code: 'session/invalid-time-zone',
          message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
          details: { value: clientTimeZone },
        },
      })
    }
    expect(followup).toHaveBeenCalledTimes(3)
  })
})

describe('degenerate composition (no persistence, no factory)', () => {
  it('lists no cold rows and reports an absent point source as not found', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const listed = await remote.list(request({}))
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items).toEqual([])

    // No persistence means cold history cannot inspect a transcript.
    const response = await remote.page({
      address: { kind: 'session', sessionId: sid('session-ghost') },
      throughSeq: -1,
    })
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe('session/not-found')
    }
  })

  it('maps a missing direct persistence read to session-not-found', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const inspect = vi.fn()
    providePersistence(ctx, {
      list: () => Promise.resolve([]),
      inspect,
    })
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const response = await remote.page({
      address: { kind: 'session', sessionId: sid('session-missing') },
      throughSeq: -1,
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('session/not-found')
    expect(inspect).toHaveBeenCalledOnce()
  })
})

describe('sessions.prompt synchronous rejection', () => {
  it('maps a synchronous send throw (disposed/invalid input) to agent-busy with the reason attached', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(sid('session-throwing'))
    // A live structural stub whose delivery verbs throw synchronously, the
    // shape a disposed loop presents at this gateway boundary.
    ctx.agents.register({
      id: session.id,
      session,
      status: 'idle',
      ctx,
      followup: () => { throw new Error('agent "session-throwing" lifecycle disposed') },
      steer: () => { throw new Error('agent "session-throwing" lifecycle disposed') },
    } as unknown as Agent)
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    for (const mode of ['queue', 'steer'] as const) {
      const response = await remote.prompt(promptRequest({
        sessionId: session.id, mode, content: [{ type: 'text' as const, text: 'x' }],
      }))
      expect(response.ok).toBe(false)
      if (!response.ok) {
        expect(response.error.code).toBe('session/agent-busy')
        expect(response.error.message).toBe('prompt rejected')
        expect(response.error.details).toEqual({
          reason: 'Error: agent "session-throwing" lifecycle disposed',
        })
      }
    }
  })

  it('classifies a raced cold-resume ID collision as agent-busy', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = sid('race-resume')
    const meta: SessionHeader = header('race-resume', 1000)
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({
        meta,
        inheritedEventCount: SessionLogOffset(0),
        events: [] as SessionEvent[],
      }),
      locate: () => undefined,
    })
    // The raced winner: a live parent-owned subagent publishes the identity
    // while the generic cold resume is in flight, so the resume collides.
    const parentSession = ctx.sessions.create(sid('race-parent'), { meta: { cwd: '/proj' } })
    const parent = { id: parentSession.id, session: parentSession, status: 'idle', ctx } as Agent
    ctx.agents.register(parent)
    const childSession = ctx.sessions.create(sessionId, {
      meta: { cwd: '/proj', parentSession: parent.id, origin: 'subagent' },
    })
    const child = { id: sessionId, session: childSession, status: 'idle', ctx } as unknown as Agent
    vi.spyOn(ctx.agents, 'resume').mockImplementationOnce(async () => {
      // The parent's `enter()` wins the identity between the pre-resume
      // re-check and publication; the generic resume then collides.
      ctx.agents.register(child)
      throw new Error('session id already published')
    })
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

    const selection = await remote.selectModel(request({ sessionId, provider: 'p', model: 'm' }))
    expect(selection.ok).toBe(false)
    if (!selection.ok) {
      expect(selection.error).toMatchObject({
        code: 'session/agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      })
    }
  })
})

describe('cold titles are never lost (regression: session-<key> in the foldout)', () => {
  /**
   * Reported bug: sessions rendered as `session-<uuid>` in the foldout menu
   * instead of their title. The title was never lost — it is a durable
   * `session/title` event, mirrored into the durable projection cache — but the
   * listing could not reach it for two independent reasons, both fixed here:
   *
   * 1. A **seeded (fork)** Session's cache identity includes its inherited cut,
   *    which a `SessionHeader` cannot express, so the row was addressed under
   *    the unseeded identity, failed the match, and was discarded. The listing
   *    now carries the cut from the record (`SessionRecord.inheritedEventCount`).
   * 2. The size-bounded cold probe (1 KiB) cannot recover a content-heavy log,
   *    and it is also the only path that would write a missing cache row — so
   *    large Sessions could never self-heal.
   */
  function titledEvents(title: string, inheritedPrefix = 0): SessionEvent[] {
    // `inheritedPrefix` prepends fork-inherited filler so a seeded Session's cut
    // stays within its own log (the constructor rejects a cut beyond the log).
    const filler: SessionEvent[] = Array.from({ length: inheritedPrefix }, (_, index) => ({
      type: 'fixture/inherited', seq: SessionSeq(index), time: 1, data: {}, ignorable: true,
    })) as SessionEvent[]
    const base = inheritedPrefix
    return [
      ...filler,
      { type: 'turn/start', seq: SessionSeq(base), time: 700, data: { turn: 1 } },
      {
        type: 'user/message', seq: SessionSeq(base + 1), time: 800,
        data: createUserMessage({ content: [{ type: 'text', text: 'hello there' }], source: { kind: 'user' } }),
        surfaceOp: 'append',
      },
      {
        type: 'session/title', seq: SessionSeq(base + 2), time: 900,
        data: { title, messageSeqs: [SessionSeq(base + 1)], source: { kind: 'fallback' } },
      },
    ] as SessionEvent[]
  }

  /**
   * A context with the REAL durable projection cache mounted over a temp JSON
   * root, plus a persistence double listing one seeded or unseeded Session whose
   * cache row is pre-written at the record's own identity.
   */
  async function titledContext(options: {
    id: string
    seeded: boolean
    inheritedEventCount?: SessionLogOffset
    title: string
    /** Suffix read backing the listing's title refold, when the test exercises it. */
    readFrom?: () => Promise<unknown>
  }): Promise<Context> {
    const ctx = new Context()
    const root = await mkdtempAsync(join(tmpdir(), 'avn-cold-titles-'))
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
    installSessionReadTestServices(ctx)
    ctx.sessionProjections.register(titleProjectionDefinition as never)
    const meta = options.seeded
      ? { ...header(options.id, 100), isSeeded: true }
      : header(options.id, 100)
    // A cold log far above the 1 KiB probe budget: the listing must not need it.
    const logRoot = mkdtempSync(join(tmpdir(), 'avn-cold-titles-log-'))
    const path = join(logRoot, 'titled.log')
    writeFileSync(path, 'x'.repeat(8 * 1024))
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      // The real jsonl backend exposes a seeded Session's inherited cut from its
      // header line, so a faithful double does too — that is the contract the
      // listing relies on to address a fork child's cache row.
      listWithInheritedCuts: () => Promise.resolve([{
        header: meta,
        ...options.inheritedEventCount === undefined
          ? {}
          : { inheritedEventCount: options.inheritedEventCount },
      }]),
      locate: () => ({ kind: 'jsonl', path }),
      inspect: () => Promise.resolve({
        meta,
        events: titledEvents(options.title, options.inheritedEventCount ?? 0),
        ...options.inheritedEventCount === undefined
          ? {}
          : { inheritedEventCount: options.inheritedEventCount },
      }),
      ...options.readFrom === undefined ? {} : { readFrom: options.readFrom },
    })
    return ctx
  }

  it('lists a seeded (fork) cold Session with its title from the durable cache', async () => {
    const ctx = await titledContext({
      id: 'seeded-titled',
      seeded: true,
      inheritedEventCount: SessionLogOffset(7),
      title: 'Greeting (1)',
    })
    // The durable row is written at the SEEDED identity (cut 7), exactly as the
    // live cache does for a fork child.
    const prepared = ctx.sessions.prepare(sid('seeded-titled'), {
      seed: titledEvents('Greeting (1)', 7),
      meta: { ...header('seeded-titled', 100), isSeeded: true },
      inheritedEventCount: SessionLogOffset(7),
    })
    await ctx.sessionProjectionCache.write(prepared)
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const response = await remote.list(request({}))
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    const row = response.value.items.find(item => item.sessionId === sid('seeded-titled'))
    expect(row?.projections?.values.title).toBe('Greeting (1)')
  })

  it('never lists a raw session id as a title for a titled cold Session', async () => {
    const ctx = await titledContext({
      id: 'titled-cold',
      seeded: false,
      title: 'Fix the sidebar labels',
    })
    const prepared = ctx.sessions.prepare(sid('titled-cold'), {
      seed: titledEvents('Fix the sidebar labels'),
      meta: header('titled-cold', 100),
      inheritedEventCount: SessionLogOffset(0),
    })
    await ctx.sessionProjectionCache.write(prepared)
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const response = await remote.list(request({}))
    if (!response.ok) throw new Error('unreachable')
    const row = response.value.items.find(item => item.sessionId === sid('titled-cold'))
    expect(row?.projections?.values.title).toBe('Fix the sidebar labels')
  })

  it('refolds a titled cold Session from its log when the cache row is unreadable', async () => {
    // The cross-version case: a second harness process wrote this session's
    // checkpoint under a domain version this build does not accept, so the row
    // reads as absent. The durable `session/title` event still exists, so the
    // listing must recover the title instead of rendering the session untitled.
    // No cache row is ever written for this session, so `cachedSnapshot`
    // misses exactly as it does for a foreign-version document.
    const ctx = await titledContext({
      id: 'unreadable-cache',
      seeded: false,
      title: 'Recovered from the log',
      readFrom: () => Promise.resolve({
        meta: header('unreadable-cache', 100),
        fromSeq: SessionLogOffset(0),
        events: titledEvents('Recovered from the log'),
      }),
    })
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const response = await remote.list(request({}))
    if (!response.ok) throw new Error('unreachable')
    const row = response.value.items.find(item => item.sessionId === sid('unreadable-cache'))
    expect(row?.projections?.values.title).toBe('Recovered from the log')
  })

  it('keeps listing when the refold read fails', async () => {
    // A refold is best-effort: an unreadable log leaves the cache-only row in
    // place rather than failing the whole listing.
    const ctx = await titledContext({
      id: 'broken-log',
      seeded: false,
      title: 'Unreachable',
      readFrom: () => Promise.reject(new Error('log is gone')),
    })
    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    const response = await remote.list(request({}))
    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error('unreachable')
    const row = response.value.items.find(item => item.sessionId === sid('broken-log'))
    expect(row?.projections?.values.title).toBeUndefined()
  })
})
