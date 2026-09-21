/**
 * Reading a task set from disk.
 *
 * The sources are fetched rather than vendored: they are large, they change, and
 * their licenses are not ours to redistribute. So the reader takes a directory
 * that a caller has already cloned, walks the layout each source uses, and
 * normalizes every task it finds.
 *
 * A file that cannot be parsed is reported rather than skipped silently. A catalog
 * that quietly drops the tasks it failed to read would understate what the source
 * contains, and the count is the thing a reader uses to decide whether the catalog
 * is worth trusting.
 *
 * @module @aeven/computer-use-tasks
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  fromMacAgentBench,
  fromOsworld,
  type TaskIntent,
  type TaskSource,
} from './intent.ts'

export * from './intent.ts'
export * from './normalize.ts'

/** The result of reading one source. */
export interface ReadResult {
  /** Every task successfully normalized. */
  intents: TaskIntent[]
  /** Files that could not be read, with the reason, so a gap is never silent. */
  failures: Array<{ path: string, reason: string }>
}

/**
 * Recursively list every `.json` file under a directory.
 * @param root - the directory to walk.
 * @returns absolute file paths, in a stable order.
 */
export function listJsonFiles(root: string): string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(directory)
    } catch {
      return
    }
    for (const entry of entries.sort()) {
      const path = join(directory, entry)
      let isDirectory = false
      try {
        isDirectory = statSync(path).isDirectory()
      } catch {
        continue
      }
      if (isDirectory) {
        walk(path)
      } else if (entry.endsWith('.json')) {
        found.push(path)
      }
    }
  }
  walk(root)
  return found
}

/**
 * Read one task file, tolerating a file that is not a task.
 *
 * The sources keep their tasks in JSON files alongside JSON that is not a task, so
 * a reader that treated every parse failure as an error would be noisy. A file is
 * accepted only when it carries both an instruction and an id; anything else is
 * reported as skipped rather than as a failure, because that is what it is.
 * @param path - the file to read.
 * @returns the intent, or a reason it was not usable.
 */
export function readTaskFile(path: string, source: TaskSource): { intent?: TaskIntent, skipped?: string, failure?: string } {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { skipped: 'not a JSON object' }
  }
  const record = raw as { id?: unknown, instruction?: unknown }
  if (typeof record.id !== 'string' || typeof record.instruction !== 'string' || record.instruction.length === 0) {
    return { skipped: 'no id and instruction pair, so not a task file' }
  }
  const intent = source === 'macagentbench'
    ? fromMacAgentBench(raw as Parameters<typeof fromMacAgentBench>[0])
    : fromOsworld(raw as Parameters<typeof fromOsworld>[0], source)
  return { intent }
}

/**
 * Read every task under a source's directory.
 * @param root - a cloned source's root or task directory.
 * @param source - which benchmark this directory holds.
 * @returns the intents and the files that failed.
 */
export function readTaskSet(root: string, source: TaskSource): ReadResult {
  const intents: TaskIntent[] = []
  const failures: Array<{ path: string, reason: string }> = []
  for (const path of listJsonFiles(root)) {
    const result = readTaskFile(path, source)
    if (result.intent !== undefined) {
      intents.push(result.intent)
      continue
    }
    if (result.failure !== undefined) {
      failures.push({ path, reason: result.failure })
    }
  }
  return { intents, failures }
}

/**
 * Read several sources and merge their intents.
 * @param sources - each source's directory and kind.
 * @returns every intent found, plus every failure across the sources.
 */
export function readTaskSets(sources: readonly { root: string, source: TaskSource }[]): ReadResult {
  const intents: TaskIntent[] = []
  const failures: Array<{ path: string, reason: string }> = []
  for (const entry of sources) {
    const result = readTaskSet(entry.root, entry.source)
    intents.push(...result.intents)
    failures.push(...result.failures)
  }
  return { intents, failures }
}
