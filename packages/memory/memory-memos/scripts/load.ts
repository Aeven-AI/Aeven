/**
 * Load benchmark for the MemOS cores: many accounts recall at once, with the cores in the calling process or on
 * worker threads. Prints each mode's recall latency and how long the calling thread's event loop was held, which is
 * the time no other account's turn could advance.
 *
 * Usage: `node --import tsx/esm packages/memory/memory-memos/scripts/load.ts [accounts] [traces] [rounds] [workers]`
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'
import { DEFAULT_CONFIG, resolveHome } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import { CoreWorkerPool } from '../src/core-pool.ts'
import { MEMOS_AGENT, ownerProfile } from '../src/runtime.ts'

const [accounts = 20, traces = 2_000, rounds = 5, workers = 8] = process.argv.slice(2).map(Number)
const DIMENSIONS = 384
const BATCH = 250
const TOPICS = ['garden', 'invoice', 'holiday', 'server', 'recipe'] as const

/** A deterministic unit vector per text, so equal texts embed equally in both modes. */
function vectorOf(text: string): number[] {
  let seed = 2166136261
  for (let index = 0; index < text.length; index++) seed = Math.imul(seed ^ text.charCodeAt(index), 16777619)
  const vector = Array.from({ length: DIMENSIONS }, () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9 | 0
    return (seed >>> 0) / 2 ** 32 - 0.5
  })
  const norm = Math.hypot(...vector)
  return vector.map(value => value / norm)
}

async function embeddingServer(): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = []
    for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { input: string[] }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: body.input.map(text => ({ embedding: vectorOf(text) })) }))
  }
  const server = createServer((request, response) => { respond(request, response).catch(() => { response.destroy() }) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('embedding server did not bind TCP')
  return {
    endpoint: `http://127.0.0.1:${address.port}/embeddings`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => { resolve() }) }),
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

async function run(mode: 'in-process' | 'workers', root: string, endpoint: string): Promise<void> {
  const config = structuredClone(DEFAULT_CONFIG)
  config.embedding = { ...config.embedding, provider: 'openai_compatible', apiKey: 'load-only', model: 'load', endpoint, dimensions: DIMENSIONS }
  config.llm.fallbackToHost = false
  const namespace = { agentKind: MEMOS_AGENT, profileId: 'aeven', profileLabel: 'Aeven' }
  const pool = mode === 'workers' ? new CoreWorkerPool({
    workers, gateTimeoutMs: 1_000, contexts: 16, bridge: null, inContext: () => false,
    mayMaintain: () => false, lost: () => {}, warn: (message) => { console.warn(message) },
  }) : undefined
  const owners = Array.from({ length: accounts }, (_, index) => `load-${String(index)}`)
  const cores = new Map<string, MemoryCore>()
  for (const owner of owners) {
    const home = resolveHome(MEMOS_AGENT, join(root, owner))
    const core = pool !== undefined
      ? await pool.open(owner, { agent: MEMOS_AGENT, namespace, home, config, hostLlm: false, hostEmbeddings: false, autoRecovery: false })
      : await bootstrapMemoryCore({ agent: MEMOS_AGENT, namespace, home, config, autoRecovery: false, initLogging: false })
    await core.init()
    cores.set(owner, core)
  }
  // Both modes read the same databases: the first mode to run writes them.
  const sample = cores.get(owners[0]!)!
  const existing = await sample.countTraces({ includeAllNamespaces: true })
  if (existing < traces) {
    const started = performance.now()
    // A few accounts write at a time: the embedding endpoint of this script answers on the calling thread.
    const queue = [...owners]
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let owner = queue.pop(); owner !== undefined; owner = queue.pop()) {
        const core = cores.get(owner)!
        for (let offset = 0; offset < traces; offset += BATCH) {
          await core.rememberFacts({
            namespace: { agentKind: MEMOS_AGENT, profileId: ownerProfile(owner), profileLabel: owner },
            sessionId: `load-session-${owner}`,
            facts: Array.from({ length: Math.min(BATCH, traces - offset) }, (_, index) => ({
              text: `${owner} fact ${String(offset + index)}: the ${TOPICS[(offset + index) % TOPICS.length]} note number ${String(offset + index)}`,
              tags: ['domain:person'],
            })),
            signal: new AbortController().signal,
          } as unknown as Parameters<MemoryCore['rememberFacts']>[0])
        }
      }
    }))
    console.log(`  wrote ${String(accounts * traces)} traces in ${((performance.now() - started) / 1000).toFixed(1)} s`)
  }
  const search = (owner: string, query: string): Promise<unknown> => cores.get(owner)!.searchMemory({
    agent: MEMOS_AGENT,
    namespace: { agentKind: MEMOS_AGENT, profileId: ownerProfile(owner), profileLabel: owner },
    query, reason: 'turn_start', contextHints: { __memosDeferLlmFilterToCaller: true }, llmFilterMalformedRetries: 0,
  } as unknown as Parameters<MemoryCore['searchMemory']>[0])
  // The first search of an account builds its vector index; the measured rounds search a warm index.
  await Promise.all(owners.map(owner => search(owner, 'warm the index')))
  const lag = monitorEventLoopDelay({ resolution: 10 })
  lag.enable()
  const latencies: number[] = []
  const started = performance.now()
  for (let round = 0; round < rounds; round++) {
    await Promise.all(owners.map(async (owner) => {
      const begin = performance.now()
      await search(owner, `what about the ${TOPICS[round % TOPICS.length]} note ${String(round)}`)
      latencies.push(performance.now() - begin)
    }))
  }
  const elapsed = performance.now() - started
  lag.disable()
  latencies.sort((a, b) => a - b)
  console.log(`  ${mode}: ${String(latencies.length)} recalls in ${(elapsed / 1000).toFixed(2)} s (${(latencies.length / (elapsed / 1000)).toFixed(1)}/s)`
    + ` | latency p50 ${percentile(latencies, 0.5).toFixed(0)} ms, p95 ${percentile(latencies, 0.95).toFixed(0)} ms, max ${(latencies.at(-1) ?? 0).toFixed(0)} ms`
    + ` | calling thread held: max ${(lag.max / 1e6).toFixed(0)} ms, p99 ${(lag.percentile(99) / 1e6).toFixed(0)} ms`)
  await Promise.all([...cores.values()].map(core => core.shutdown()))
  await pool?.close()
}

const root = await mkdtemp(join(tmpdir(), 'avn-memory-load-'))
const embedding = await embeddingServer()
console.log(`${String(accounts)} accounts x ${String(traces)} traces, ${String(rounds)} rounds of one recall per account at once, ${String(workers)} workers`)
try {
  await run('workers', root, embedding.endpoint)
  await run('in-process', root, embedding.endpoint)
} finally {
  await embedding.close()
  await rm(root, { recursive: true, force: true })
}
