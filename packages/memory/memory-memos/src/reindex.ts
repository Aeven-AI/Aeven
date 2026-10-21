/**
 * Re-embed an account's stored memory when the embedding model that indexed it changed.
 *
 * Vectors from two models are not comparable, and MemOS does not record which model wrote a vector, so a
 * model switch would leave every stored memory unreachable by vector search. Each account's data directory
 * keeps the fingerprint of the embedding that indexed it; a core opened under another fingerprint rebuilds
 * every vector through MemOS's `rebuildEmbeddings` in the background and records the new fingerprint once
 * the rebuild completes with no failed vector. An interrupted or partly failed rebuild leaves the old fingerprint, so
 * the next open starts over.
 * @module @aeven/memory-memos/reindex
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'

/** File in an account's MemOS data directory naming the embedding that indexed its vectors. */
export const EMBEDDING_INDEX_FILE = 'embedding-index.json'

/**
 * Version of the rebuild's coverage. Raised when a rebuild starts covering vectors an earlier one left behind,
 * so accounts indexed by the earlier rebuild run it again. Version 2 also re-embeds traces MemOS would not embed
 * today but that hold a vector from capture; version 3 gives remembered facts an action vector equal to their
 * summary vector, so they rank against conversation traces on equal terms.
 */
export const REINDEX_VERSION = 3

/** The embedding settings that decide which vectors are comparable. */
export interface EmbeddingFingerprint {
  /** {@link REINDEX_VERSION} of the rebuild that wrote the index. */
  readonly version: number
  readonly provider: string
  readonly model: string
  readonly queryPrefix: string
  readonly documentPrefix: string
  /** Estimated tokens per embedded piece, which decides how long texts are split. */
  readonly maxInputTokens: number
}

/** Where and how one account's rebuild runs. */
export interface ReindexOptions {
  /** The account's opened core. */
  readonly core: MemoryCore
  /** The account's MemOS data directory, which holds {@link EMBEDDING_INDEX_FILE}. */
  readonly dataDir: string
  /** The embedding this core embeds with. */
  readonly fingerprint: EmbeddingFingerprint
  /** Vectors rebuilt per `rebuildEmbeddings` call. */
  readonly batchSize: number
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
}

function sameFingerprint(left: EmbeddingFingerprint, right: EmbeddingFingerprint): boolean {
  return left.version === right.version && left.provider === right.provider && left.model === right.model
    && left.queryPrefix === right.queryPrefix && left.documentPrefix === right.documentPrefix
    && left.maxInputTokens === right.maxInputTokens
}

/**
 * Read the recorded fingerprint. A missing or unreadable file means the index was written by an unknown
 * embedding, which the caller treats as a change.
 */
async function recordedFingerprint(file: string): Promise<EmbeddingFingerprint | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // A missing file is an account indexed before fingerprints existed; any other read failure is
    // handled the same way, by rebuilding.
    return undefined
  }
  try {
    const value = JSON.parse(text) as Partial<EmbeddingFingerprint>
    if (typeof value.version !== 'number' || typeof value.provider !== 'string' || typeof value.model !== 'string'
      || typeof value.queryPrefix !== 'string' || typeof value.documentPrefix !== 'string'
      || typeof value.maxInputTokens !== 'number') return undefined
    return {
      version: value.version,
      provider: value.provider,
      model: value.model,
      queryPrefix: value.queryPrefix,
      documentPrefix: value.documentPrefix,
      maxInputTokens: value.maxInputTokens,
    }
  } catch {
    // A corrupt file names no embedding, so the index is rebuilt and the file rewritten.
    return undefined
  }
}

/**
 * Rebuild the account's vectors when its recorded fingerprint differs from the current one. Resolves when
 * the rebuild finished or stopped; failures are reported through `warn` and leave the old fingerprint.
 * @param options - the account's core, data directory, current fingerprint, and log sinks.
 * @returns after the account's index matches `fingerprint` or the rebuild stopped.
 */
export async function reindexIfEmbeddingChanged(options: ReindexOptions): Promise<void> {
  const file = join(options.dataDir, EMBEDDING_INDEX_FILE)
  const recorded = await recordedFingerprint(file)
  if (recorded !== undefined && sameFingerprint(recorded, options.fingerprint)) return
  const from = recorded === undefined ? 'an unrecorded embedding' : recorded.model
  options.info(`re-embedding memory indexed by ${from} with ${options.fingerprint.model}`)
  const startedAt = Date.now()
  let offset = 0
  let updated = 0
  let failed = 0
  try {
    for (;;) {
      const run = await options.core.rebuildEmbeddings({ mode: 'rebuild', limit: options.batchSize, offset })
      if (run.error !== undefined) {
        options.warn(`memory re-embedding stopped at ${offset}: ${run.error}`)
        return
      }
      updated += run.updated
      failed += run.failed
      if (run.done) break
      offset = run.nextOffset
    }
  } catch (error) {
    options.warn(`memory re-embedding stopped at ${offset}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (failed > 0) {
    // A vector that failed keeps the old model's values; the next open rebuilds again instead of trusting the index.
    options.warn(`memory re-embedding left ${failed} vectors on the old model; the index is rebuilt again on the next open`)
    return
  }
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(options.fingerprint, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
  options.info(`re-embedded ${updated} memory vectors in ${Date.now() - startedAt}ms`)
}
