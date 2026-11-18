/** MemOS cores in worker threads: the same memory operations, off the calling thread, with Host callbacks intact. */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'
import { DEFAULT_CONFIG, resolveHome } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import type { EmbeddingProvider } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'
import type { HostLlmBridge, HostLlmCompleteInput } from '@deepseek-ai/memos-local-plugin/core/llm/host-bridge.js'
import { CoreWorkerPool, type CorePoolOptions } from '../src/core-pool.ts'
import type { CoreOpenSpec } from '../src/core-protocol.ts'
import { OwnerCores } from '../src/cores.ts'
import { LlmRouteContext } from '../src/host-llm.ts'
import { MEMOS_AGENT, MemosMemory, ownerProfile } from '../src/runtime.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

/** An OpenAI-compatible embedding endpoint returning one fixed vector per input. */
async function embeddingServer(): Promise<{ endpoint: string; requests: string[][] }> {
  const requests: string[][] = []
  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = []
    for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { input: string[] }
    requests.push(body.input)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: body.input.map(() => ({ embedding: [1, 0, 0] })) }))
  }
  const server = createServer((request, response) => {
    respond(request, response).catch(() => { response.destroy() })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error) reject(error); else resolve() })
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('embedding server did not bind TCP')
  return { endpoint: `http://127.0.0.1:${address.port}/embeddings`, requests }
}

interface Fixture {
  readonly pool: CoreWorkerPool
  readonly routes: LlmRouteContext
  readonly lost: string[][]
  readonly warnings: string[]
  /** Open one account's core on the pool, each account under its own home. */
  readonly open: (owner: string, overrides?: Partial<CoreOpenSpec>) => Promise<MemoryCore>
  readonly requests: string[][]
}

async function fixture(options: Partial<CorePoolOptions> = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'avn-core-pool-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const { endpoint, requests } = await embeddingServer()
  const routes = new LlmRouteContext()
  const lost: string[][] = []
  const warnings: string[] = []
  const pool = new CoreWorkerPool({
    workers: 1, gateTimeoutMs: 200, contexts: 16, bridge: null,
    inContext: () => routes.current() !== undefined,
    mayMaintain: () => false,
    lost: (owners) => { lost.push([...owners]) },
    warn: (message) => { warnings.push(message) },
    ...options,
  })
  cleanup.push(() => pool.close())
  const open = (owner: string, overrides: Partial<CoreOpenSpec> = {}): Promise<MemoryCore> => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.embedding = { ...config.embedding, provider: 'openai_compatible', apiKey: 'test-only', model: 'pool-test', endpoint }
    config.llm.fallbackToHost = false
    return pool.open(owner, {
      agent: MEMOS_AGENT,
      namespace: { agentKind: MEMOS_AGENT, profileId: 'aeven', profileLabel: 'Aeven' },
      home: resolveHome(MEMOS_AGENT, join(root, owner)),
      config, hostLlm: false, hostEmbeddings: false, autoRecovery: false,
      ...overrides,
    })
  }
  return { pool, routes, lost, warnings, open, requests }
}

function memoryOver(core: MemoryCore, routes: LlmRouteContext): MemosMemory {
  const memory = new MemosMemory({
    cores: new OwnerCores(async () => core), routes,
    toolLimits: { skills: 0, traces: 10, worldModels: 0 }, personFactsTtlMs: 0, warn: () => {}, info: () => {},
  })
  cleanup.push(() => memory.dispose())
  return memory
}

describe('MemOS cores in worker threads', () => {
  it('stores, reads, lists, and counts an account\'s memories through the worker', async () => {
    const { open, routes, requests } = await fixture()
    const core = await open('pool-owner')
    const memory = memoryOver(core, routes)
    const scope = { owner: 'pool-owner', sessionId: brandString<SessionId>('pool-session'), cwd: '/workspace' }
    const facts = ['Mira prefers jasmine tea.', 'Mira lives in Delft.', 'Mira speaks Dutch.']
    const { ids } = await memory.rememberMany({ scope, facts: facts.map(text => ({ text })), domain: 'person', signal: new AbortController().signal })
    expect(ids).toHaveLength(facts.length)
    expect(requests).toEqual([facts])
    const namespace = { agentKind: MEMOS_AGENT, profileId: ownerProfile(scope.owner) }
    expect(await core.getTrace(ids[0]!, namespace)).toMatchObject({ userText: facts[0] })
    const page = await memory.list({ owner: scope.owner, domains: ['person'], limit: 10, offset: 0, signal: new AbortController().signal })
    expect(page.total).toBe(3)
    expect(page.records.map(record => record.summary).sort()).toEqual([...facts].sort())
    const found = await memory.list({ owner: scope.owner, query: 'delft', limit: 10, offset: 0, signal: new AbortController().signal })
    expect(found.records.map(record => record.summary)).toEqual(['Mira lives in Delft.'])
  })

  it('returns nothing for a trace of another account and rebuilds MemOS errors by code', async () => {
    const { open } = await fixture()
    const core = await open('error-owner')
    expect(await core.getTrace('tr_missing')).toBeNull()
    await expect((core as unknown as { notAMethod: () => Promise<void> }).notAMethod()).rejects.toThrow('MemOS core has no method notAMethod')
  })

  it('spreads accounts over workers and keeps their databases apart', async () => {
    const { open, routes } = await fixture({ workers: 2 })
    const [first, second] = await Promise.all([open('owner-a'), open('owner-b')])
    const signal = new AbortController().signal
    const a = memoryOver(first, routes)
    const b = memoryOver(second, routes)
    await a.rememberMany({ scope: { owner: 'owner-a', sessionId: brandString<SessionId>('a') }, facts: [{ text: 'Only A knows this.' }], domain: 'person', signal })
    expect((await a.list({ owner: 'owner-a', limit: 10, offset: 0, signal })).total).toBe(1)
    expect((await b.list({ owner: 'owner-b', limit: 10, offset: 0, signal })).total).toBe(0)
  })

  it('rejects a call whose signal is already aborted without reaching the worker', async () => {
    const { open } = await fixture()
    const core = await open('abort-owner')
    const controller = new AbortController()
    controller.abort(new Error('caller gave up'))
    const searching = (core as unknown as { searchMemory: (query: object, options: { signal: AbortSignal }) => Promise<unknown> })
      .searchMemory({ query: 'tea' }, { signal: controller.signal })
    await expect(searching).rejects.toThrow('caller gave up')
  })

  it('embeds through the Host queue when the account is opened with hosted embeddings', async () => {
    const asked: { owner: string; texts: string[]; role: string }[] = []
    const embeddings = (owner: string): EmbeddingProvider => ({
      name: 'local',
      embed: async (texts, role) => {
        asked.push({ owner, texts: [...texts], role })
        return texts.map(() => [0, 1, 0])
      },
    })
    const { open, routes, requests } = await fixture({ embeddings })
    const core = await open('embed-owner', { hostEmbeddings: true })
    const memory = memoryOver(core, routes)
    const scope = { owner: 'embed-owner', sessionId: brandString<SessionId>('embed-session') }
    await memory.rememberMany({ scope, facts: [{ text: 'Noor plays the cello.' }], domain: 'person', signal: new AbortController().signal })
    expect(asked).toEqual([{ owner: 'embed-owner', texts: ['Noor plays the cello.'], role: 'document' }])
    expect(requests).toEqual([])
  })

  it('runs a worker\'s LLM request in the session route of the call that caused it', async () => {
    const seen: { route: unknown; op: string | undefined }[] = []
    const routes = new LlmRouteContext()
    const bridge: HostLlmBridge = {
      id: 'test.bridge',
      complete: async (input: HostLlmCompleteInput) => {
        seen.push({ route: routes.current(), op: input.op })
        return { text: '{}', model: 'test', durationMs: 1 }
      },
    }
    const { open } = await fixture({ bridge, inContext: () => routes.current() !== undefined })
    const config = structuredClone(DEFAULT_CONFIG)
    config.llm = { ...config.llm, provider: 'host' }
    config.embedding = { ...config.embedding, provider: 'openai_compatible', apiKey: 'test-only', model: 'pool-test', endpoint: 'http://127.0.0.1:9/embeddings' }
    const core = await open('llm-owner', { config, hostLlm: true })
    const route = { provider: 'aeven-cloud', model: 'Aeven-1.0-Flash' }
    const namespace = { agentKind: MEMOS_AGENT, profileId: ownerProfile('llm-owner') }
    await routes.run(route, async () => {
      const sessionId = await core.openSession({ agent: MEMOS_AGENT, namespace, meta: { namespace } })
      const episodeId = await core.openEpisode({ sessionId, userMessage: 'Remember that Sam moved to Lisbon.' })
      await core.onTurnEnd({
        agent: MEMOS_AGENT, sessionId, episodeId, namespace,
        agentText: 'Noted: Sam moved to Lisbon.', toolCalls: [], ts: Date.now(),
      })
    })
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(seen.every(entry => (entry.route as { model?: string } | undefined)?.model === 'Aeven-1.0-Flash')).toBe(true)
  })

  it('releases a stopped worker\'s accounts and opens them again on a new worker', async () => {
    const { pool, open, lost, warnings } = await fixture()
    const core = await open('crash-owner')
    const slots = (pool as unknown as { slots: { worker: { postMessage: (message: unknown) => void } }[] }).slots
    slots[0]!.worker.postMessage({ type: 'not-a-message' })
    await expect.poll(() => lost.length, { timeout: 10_000 }).toBe(1)
    expect(lost[0]).toEqual(['crash-owner'])
    expect(warnings[0]).toContain('a MemOS core worker stopped')
    await expect(core.listTraces({ limit: 1 })).rejects.toThrow('core worker stopped')
    const reopened = await open('crash-owner')
    expect(await reopened.listTraces({ limit: 1, includeAllNamespaces: true })).toEqual([])
  })
})
