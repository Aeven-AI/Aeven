/**
 * Reproduce turn-start retrieval on a copy of one account's memory, read-only for the account.
 *
 *   pnpm tsx packages/memory/memory-memos/scripts/recall-probe.ts <memos.db> <owner-account-id> <tag> "<query>" ["<query>" ...]
 *
 * The database is copied with SQLite's backup API, a MemOS core boots over the copy with the embedding, similarity, and
 * retrieval settings `@aeven/memory-memos` applies by default, and each query runs through the same `searchMemory`
 * turn-start path recall uses, MemOS's own filter deferred. For every query the probe reports how many stored memories
 * carry `<tag>` (for example `domain:world`), how many of them retrieval returned and at which ranks, and the cosine
 * rank each would have by summary vector alone, so a memory that similarity finds but the pipeline drops is visible
 * at once. Relevance judgment and rendering run after this stage and are not exercised.
 * @module @aeven/memory-memos/scripts/recall-probe
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { loadConfig } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import { MEMOS_AGENT, memosHome, ownerProfile } from '../src/runtime.ts'

const [source, owner, tag, ...queries] = process.argv.slice(2)
if (!source || !owner || !tag || queries.length === 0) {
  console.error('usage: recall-probe.ts <memos.db> <owner-account-id> <tag> "<query>" ["<query>" ...]')
  process.exit(1)
}

const root = mkdtempSync(join(tmpdir(), 'recall-probe-'))
const home = memosHome(root)
mkdirSync(home.dataDir, { recursive: true })
const original = new Database(source, { readonly: true, fileMustExist: true })
await original.backup(home.dbFile)
original.close()

// The settings `@aeven/memory-memos` applies over MemOS defaults (its Config defaults).
const loaded = (await loadConfig(home, MEMOS_AGENT)).config
const config = {
  ...loaded,
  embedding: {
    ...loaded.embedding,
    model: 'Xenova/multilingual-e5-small',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    device: 'cpu',
    dtype: 'q8',
    maxInputTokens: 512,
  },
  algorithm: {
    ...loaded.algorithm,
    lightweightMemory: { ...loaded.algorithm.lightweightMemory, enabled: false },
    retrieval: {
      ...loaded.algorithm.retrieval,
      tier1TopK: 1,
      tier2TopK: 40,
      includeCandidatePolicies: false,
      rememberedFactValue: 0.5,
      minTraceSim: 0.84,
      episodeGoalMinSim: 0.86,
    },
  },
}
const core = await bootstrapMemoryCore({
  agent: MEMOS_AGENT,
  namespace: { agentKind: MEMOS_AGENT, profileId: 'aeven', profileLabel: 'Aeven' },
  home,
  config,
  hostLlmBridge: null,
  autoRecovery: false,
  initLogging: false,
})
await core.init()

const db = new Database(home.dbFile, { readonly: true })
const tagged = new Set((db.prepare('SELECT id FROM traces WHERE instr(tags_json, ?) > 0').all(`"${tag}"`) as { id: string }[]).map(row => row.id))
const vectors = db.prepare('SELECT id, vec_summary AS vec FROM traces WHERE vec_summary IS NOT NULL').all() as { id: string; vec: Buffer }[]
// The transformers runtime is a dependency of the vendored MemOS core, so it resolves from there.
const memosRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/memos-local-plugin/package.json'))
const { pipeline } = memosRequire('@huggingface/transformers') as { pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<(text: string, options: Record<string, unknown>) => Promise<{ data: Float32Array }>> }
const extract = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8', device: 'cpu' })

for (const query of queries) {
  const queryVector = (await extract(`query: ${query}`, { pooling: 'mean', normalize: true })).data
  const cosineRanks = vectors
    .map((row) => {
      const vec = new Float32Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength / 4)
      let sum = 0
      for (let index = 0; index < queryVector.length; index++) sum += queryVector[index]! * vec[index]!
      return { id: row.id, score: sum }
    })
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, rank: index + 1 }))
    .filter(row => tagged.has(row.id))
    .slice(0, 5)
  const result = await core.searchMemory({
    agent: MEMOS_AGENT,
    namespace: { agentKind: MEMOS_AGENT, profileId: ownerProfile(owner), profileLabel: owner },
    sessionId: 'recall-probe' as never,
    query,
    reason: 'turn_start',
    contextHints: { __memosDeferLlmFilterToCaller: true },
    topK: { tier1: 1, tier2: 40, tier3: 2 },
  })
  const returned = result.hits.map((hit, index) => ({ hit, rank: index + 1 })).filter(({ hit }) => tagged.has(hit.refId))
  console.log(`\n# ${query}`)
  console.log(`tagged ${tag}: ${tagged.size} | best cosine ranks: ${cosineRanks.map(row => `${row.rank} (${row.score.toFixed(3)})`).join(', ')}`)
  console.log(`retrieval returned ${result.hits.length} hits; ${returned.length} tagged, at ranks ${returned.map(entry => entry.rank).join(', ') || 'none'}`)
  console.log(`top: ${result.hits.slice(0, 3).map(hit => hit.snippet.replace(/\s+/g, ' ').slice(0, 60)).join(' | ')}`)
}
db.close()
await core.shutdown()
