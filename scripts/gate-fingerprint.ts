/**
 * Skip a corpus-wide gate whose inputs are byte-identical to its last green run:
 * `skipIfUnchanged(gate, inputs)`.
 *
 * A documentation gate walks thousands of files and parses them, so it costs tens
 * of seconds even when nothing it reads has changed — the ordinary case in a
 * working tree that touches one package. The fingerprint is a content hash of
 * every input plus the gate's own sources, so a cached skip is sound in both
 * directions: any edited input or edited gate code changes the hash and the gate
 * runs, and a hash that matches proves the tracked files are the bytes the last
 * green run accepted. The cache lives under `node_modules/.cache`, so a fresh
 * install discards it and the first run after one is a full run.
 *
 * `--no-cache` (or `AVN_GATE_CACHE=0`) forces the full run, which is what CI and
 * a debugging session use; `run-gates` never passes it, so everyday gate runs
 * stay incremental.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cacheDir = join(root, 'node_modules', '.cache', 'avn-gate-fingerprints')

/** The cache file for one gate. */
function cachePath(gate: string): string {
  return join(cacheDir, `${gate}.json`)
}

/** Whether the caller opted out of the cache for this run. */
function cacheDisabled(): boolean {
  return process.env.AVN_GATE_CACHE === '0' || process.argv.includes('--no-cache')
}

/** A content hash over the named repository-relative files and the gate's own sources
 * under `scripts/`; a missing input contributes its path alone, so a deleted file
 * still changes the hash. */
function fingerprint(inputs: readonly string[]): string {
  const hash = createHash('sha256')
  const gateSources = inputs.filter(file => file.startsWith('scripts/')).sort()
  for (const file of [...new Set([...inputs, ...gateSources])].sort()) {
    hash.update(file).update('\0')
    try {
      hash.update(readFileSync(join(root, file)))
    } catch {
      // Only ENOENT is expected: a tracked-then-deleted document still has to
      // change the hash, and the path alone already does that. Any other read
      // failure surfaces as a full run, which fails loudly on its own.
      hash.update('<absent>')
    }
  }
  return hash.digest('hex')
}

/** Record a green run for this gate under its current input fingerprint. */
export function recordGreen(gate: string, inputs: readonly string[]): void {
  if (cacheDisabled()) return
  mkdirSync(dirname(cachePath(gate)), { recursive: true })
  writeFileSync(cachePath(gate), `${JSON.stringify({ fingerprint: fingerprint(inputs) })}\n`)
}

/**
 * Report whether this gate can be skipped, printing the reason when it can.
 * @param gate - Stable cache key, matching the `run-gates` leaf name.
 * @param inputs - Every repository-relative file the gate reads.
 * @returns true when the caller should exit successfully without running.
 */
export function skipIfUnchanged(gate: string, inputs: readonly string[]): boolean {
  if (cacheDisabled()) return false
  let recorded: string | null = null
  try {
    recorded = (JSON.parse(readFileSync(cachePath(gate), 'utf8')) as { fingerprint?: string }).fingerprint ?? null
  } catch {
    // Only a missing or unreadable cache file is expected — the first run after
    // a fresh install, or a corrupt entry. Both mean "run the gate".
    recorded = null
  }
  if (recorded === null || recorded !== fingerprint(inputs)) return false
  console.log(`${gate}: inputs unchanged since the last green run, skipped (AVN_GATE_CACHE=0 re-runs it).`)
  return true
}
