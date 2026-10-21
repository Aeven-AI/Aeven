/**
 * On-demand measurement of the local embedding model against one account's real memory, read-only.
 *
 *   pnpm tsx packages/memory/memory-memos/scripts/embedding-eval.ts calibrate <memos.db>
 *   pnpm tsx packages/memory/memory-memos/scripts/embedding-eval.ts compare <memos.db> <cases.jsonl>
 *
 * `calibrate` maps MemOS's MiniLM cosine cutoffs to multilingual-e5-small by quantile matching over the same memory
 * texts: for each cutoff it finds the e5 value that keeps the same share of query-memory and memory-memory pairs. The
 * result is the provisional source of `embedding.similarity` in `@aeven/memory-memos`; matching a share of pairs does
 * not show that the kept pairs are relevant, which `compare` and live checks have to.
 *
 * `compare` embeds every memory summary with each model and counts, per case, how many of the top ten match the case's
 * pattern. A case file holds one {"label", "query", "pattern"} object per line, `pattern` a case-insensitive regular
 * expression. Cases built from a person's own conversations are private data: keep them beside that person's memory,
 * never in this repository; `embedding-eval.example.jsonl` shows the format.
 * @module @aeven/memory-memos/scripts/embedding-eval
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'

type Extractor = (text: string, options: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array }>

// The transformers runtime is a dependency of the vendored MemOS core, so it resolves from there.
const memosRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/memos-local-plugin/package.json'))
const { pipeline } = memosRequire('@huggingface/transformers') as {
  pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<Extractor>
}

const MODELS = [
  { label: 'MiniLM-en', model: 'Xenova/all-MiniLM-L6-v2', query: '', passage: '' },
  { label: 'MiniLM-ml', model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', query: '', passage: '' },
  { label: 'e5', model: 'Xenova/multilingual-e5-small', query: 'query: ', passage: 'passage: ' },
] as const

const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0
  for (let index = 0; index < a.length; index++) sum += a[index]! * b[index]!
  return sum
}

async function embedAll(extract: Extractor, texts: readonly string[], prefix: string): Promise<Float32Array[]> {
  const vectors: Float32Array[] = []
  for (const text of texts) vectors.push((await extract(prefix + text, { pooling: 'mean', normalize: true })).data)
  return vectors
}

function memoryTexts(file: string, limit: number): string[] {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return (db.prepare(`SELECT COALESCE(NULLIF(trim(summary), ''), user_text) AS text FROM traces
      WHERE length(COALESCE(NULLIF(trim(summary), ''), user_text)) > 15 ORDER BY random() LIMIT ?`).all(limit) as { text: string }[])
      .map(row => row.text.replace(/\s+/g, ' ').slice(0, 1500))
  } finally {
    db.close()
  }
}

/** The e5 cutoff that keeps the same share of pairs as `cutoff` keeps under MiniLM. */
function mapCutoff(cutoff: number, mini: readonly number[], e5: readonly number[]): number {
  const share = mini.filter(score => score >= cutoff).length / mini.length
  const sorted = [...e5].sort((a, b) => b - a)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * sorted.length) - 1))]!
}

function pairs(left: readonly Float32Array[], right: readonly Float32Array[], same: boolean): number[] {
  const scores: number[] = []
  for (let i = 0; i < left.length; i++) for (let j = same ? i + 1 : 0; j < right.length; j++) scores.push(dot(left[i]!, right[j]!))
  return scores
}

async function calibrate(file: string): Promise<void> {
  const docs = memoryTexts(file, 300)
  const queries = memoryTexts(file, 120)
  const [mini, e5] = [MODELS[0], MODELS[2]]
  const miniExtract = await pipeline('feature-extraction', mini.model, { dtype: 'q8', device: 'cpu' })
  const e5Extract = await pipeline('feature-extraction', e5.model, { dtype: 'q8', device: 'cpu' })
  const miniDocs = await embedAll(miniExtract, docs, '')
  const e5Docs = await embedAll(e5Extract, docs, e5.passage)
  const miniQueries = await embedAll(miniExtract, queries, '')
  const e5Queries = await embedAll(e5Extract, queries, e5.query)
  const queryDoc = [pairs(miniQueries, miniDocs, false), pairs(e5Queries, e5Docs, false)] as const
  const docDoc = [pairs(miniDocs, miniDocs, true), pairs(e5Docs, e5Docs, true)] as const
  for (const [name, cutoff, [m, e]] of [
    ['retrieval.minTraceSim', 0.35, queryDoc],
    ['retrieval.episodeGoalMinSim', 0.45, queryDoc],
    ['l2Induction.minSimilarity', 0.72, docDoc],
    ['feedback.mergeSimilarity', 0.72, docDoc],
    ['l3Abstraction.clusterMinSimilarity', 0.6, docDoc],
  ] as const) console.log(`${name.padEnd(36)} MiniLM ${cutoff}  ->  e5 ${mapCutoff(cutoff, m, e).toFixed(3)}`)
}

async function compare(file: string, casesFile: string): Promise<void> {
  const cases = readFileSync(casesFile, 'utf8').split('\n').filter(line => line.trim())
    .map(line => JSON.parse(line) as { label: string; query: string; pattern: string })
  const docs = memoryTexts(file, 100_000)
  const totals = new Map<string, number>()
  const rows = cases.map(item => ({ item, cells: [] as number[] }))
  for (const model of MODELS) {
    const extract = await pipeline('feature-extraction', model.model, { dtype: 'q8', device: 'cpu' })
    const vectors = await embedAll(extract, docs, model.passage)
    for (const row of rows) {
      const query = (await extract(model.query + row.item.query, { pooling: 'mean', normalize: true })).data
      const pattern = new RegExp(row.item.pattern, 'iu')
      const top = vectors.map((vector, index) => ({ index, score: dot(query, vector) })).sort((a, b) => b.score - a.score).slice(0, 10)
      const hits = top.filter(entry => pattern.test(docs[entry.index]!)).length
      row.cells.push(hits)
      totals.set(model.label, (totals.get(model.label) ?? 0) + hits)
    }
  }
  console.log(['case'.padEnd(18), ...MODELS.map(model => model.label.padStart(11))].join(''))
  for (const row of rows) console.log([row.item.label.padEnd(18), ...row.cells.map(hits => `${hits}/10`.padStart(11))].join(''))
  console.log(['TOTAL'.padEnd(18), ...MODELS.map(model => `${totals.get(model.label) ?? 0}/${rows.length * 10}`.padStart(11))].join(''))
}

const [command, file, casesFile] = process.argv.slice(2)
if (command === 'calibrate' && file) await calibrate(file)
else if (command === 'compare' && file && casesFile) await compare(file, casesFile)
else {
  console.error('usage: embedding-eval.ts calibrate <memos.db> | compare <memos.db> <cases.jsonl>')
  process.exitCode = 1
}
