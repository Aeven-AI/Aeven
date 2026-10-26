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
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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

/** Hash input contents and target existence together with this cache implementation. */
function fingerprint(inputs: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(import.meta.filename))
  for (const file of [...new Set(inputs)].sort()) {
    hash.update(file).update('\0')
    try {
      const path = resolve(root, file)
      hash.update(statSync(path).isDirectory() ? '<directory>' : readFileSync(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      hash.update('<absent>')
    }
  }
  return hash.digest('hex')
}

/**
 * Record a successful check with the extra targets it discovered while running.
 * @param gate - stable cache key.
 * @param inputs - files known before scanning, including verifier code and configuration.
 * @param dependencies - files or directories discovered by the successful scan.
 */
export function recordGreen(gate: string, inputs: readonly string[], dependencies: readonly string[] = []): void {
  if (cacheDisabled()) return
  mkdirSync(dirname(cachePath(gate)), { recursive: true })
  writeFileSync(cachePath(gate), `${JSON.stringify({ version: 1, fingerprint: fingerprint([...inputs, ...dependencies]), dependencies })}\n`)
}

/**
 * Report whether this gate can be skipped, printing the reason when it can.
 * @param gate - Stable cache key, matching the `run-gates` leaf name.
 * @param inputs - Every repository-relative file the gate reads.
 * @returns true when the caller should exit successfully without running.
 */
export function skipIfUnchanged(gate: string, inputs: readonly string[]): boolean {
  if (cacheDisabled()) return false
  let recorded: { version?: unknown; fingerprint?: unknown; dependencies?: unknown } | null
  try {
    recorded = JSON.parse(readFileSync(cachePath(gate), 'utf8')) as typeof recorded
  } catch {
    // An absent or unreadable cache entry requires a full check.
    return false
  }
  if (recorded?.version !== 1 || typeof recorded.fingerprint !== 'string'
    || !Array.isArray(recorded.dependencies)
    || !recorded.dependencies.every((file: unknown): file is string => typeof file === 'string')) return false
  if (recorded.fingerprint !== fingerprint([...inputs, ...recorded.dependencies])) return false
  console.log(`${gate}: inputs unchanged since the last green run, skipped (AVN_GATE_CACHE=0 re-runs it).`)
  return true
}
