/**
 * Restart benchmark on a copy of a real memory database: what an account's first recall after a Host start costs,
 * without and with the saved vector index, and what one compaction run removes.
 *
 * Usage: `node --import tsx/esm packages/memory/memory-memos/scripts/restart.ts <copy of memos.db>` — the file is
 * modified (index files are written beside it and compaction rewrites rows), so never pass a live database.
 */
import { existsSync, rmSync, statSync } from 'node:fs'
import { openDb } from '@deepseek-ai/memos-local-plugin/core/storage/connection.js'
import { indexedTopK } from '@deepseek-ai/memos-local-plugin/core/storage/vector-index.js'

const file = process.argv[2]
if (file === undefined || !existsSync(file)) throw new Error('pass the path of a copy of memos.db')

function query(dim: number): Float32Array {
  return Float32Array.from({ length: dim }, (_, index) => Math.sin(index * 12.9898) * 0.5)
}

function firstSearch(label: string): number {
  const db = openDb({ filepath: file!, agent: 'deepseek-harness' })
  try {
    const dim = (db.raw.prepare('SELECT length(vec_summary) / 4 AS dim FROM traces WHERE vec_summary IS NOT NULL LIMIT 1').get() as { dim: number }).dim
    const started = performance.now()
    for (const column of ['vec_summary', 'vec_action']) indexedTopK(db, 'traces', ['ts'], query(dim), 20, { vecColumn: column })
    const first = performance.now() - started
    const again = performance.now()
    for (const column of ['vec_summary', 'vec_action']) indexedTopK(db, 'traces', ['ts'], query(dim), 20, { vecColumn: column })
    console.log(`${label}: first search of both vector columns ${first.toFixed(0)} ms, next search ${(performance.now() - again).toFixed(0)} ms`)
    return first
  } finally {
    db.close()
  }
}

rmSync(`${file}-vectors`, { recursive: true, force: true })
const heap = (): string => `${(process.memoryUsage().rss / 1e6).toFixed(0)} MB RSS`
console.log(`database ${(statSync(file).size / 1e6).toFixed(0)} MB`)
firstSearch('start with no saved index')
console.log(`  saved index: ${(statSync(`${file}-vectors/traces.vec_summary.bin`).size / 1e6).toFixed(0)} MB per column, ${heap()}`)
// A new process has an empty module cache; the index module keeps entries per connection, so a new connection
// stands in for the restarted process.
firstSearch('restart with the saved index')
