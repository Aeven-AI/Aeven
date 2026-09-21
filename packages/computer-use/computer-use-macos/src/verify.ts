/**
 * Independent verification for the macOS adapter.
 *
 * Every check here re-reads the observable from the operating system rather than
 * trusting whatever an action reported. That is the whole point: measured
 * behaviour showed an action can acknowledge delivery — `delivered_count: 42` —
 * while the file never changed, and a save can report success while writing
 * nothing until the window is fronted.
 *
 * Filesystem checks use `node:fs` directly: the filesystem is ungated, needs no
 * permission prompt, and is the strongest evidence available for "did the work
 * actually happen".
 *
 * @module @aeven/computer-use-macos/verify
 */

import { stat, readFile } from 'node:fs/promises'
import type { Expectation, VerificationOutcome } from '@aeven/computer-use-desktop'

/** How the adapter reads an element's value back for `nodeValueEquals`. */
export interface NodeValueReader {
  /**
   * Re-read one accessibility node's value.
   * @param token - the snapshot-scoped token to resolve.
   * @returns the node's current value, or `undefined` when the node is gone or
   * reports no value.
   */
  read(token: string): Promise<string | undefined>
}

/** How the adapter lists window titles for `windowTitled`. */
export interface WindowTitleReader {
  /**
   * List the titles of the windows currently on screen.
   * @returns every title the window server reports.
   */
  list(): Promise<readonly string[]>
}

/** The readers a verification run needs beyond the filesystem. */
export interface VerificationReaders {
  nodeValue: NodeValueReader
  windowTitles: WindowTitleReader
}

/**
 * Read a file's text, treating any failure as "not readable".
 * @param path - absolute path to read.
 * @returns the file's contents, or `undefined` when it cannot be read.
 */
async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Check one expectation against the operating system.
 *
 * Never throws: a check that cannot be completed reports `satisfied: false` with
 * an `error`, because a verification that could not run must not be mistaken for
 * one that passed.
 * @param expectation - the condition to check.
 * @param readers - readers for the non-filesystem observables.
 * @returns the outcome for this expectation.
 */
export async function checkExpectation(
  expectation: Expectation,
  readers: VerificationReaders,
): Promise<VerificationOutcome> {
  const outcome = async (): Promise<VerificationOutcome> => {
    switch (expectation.kind) {
      case 'fileExists': {
        try {
          await stat(expectation.path)
          return { expectation, satisfied: true, observed: 'present' }
        } catch {
          return { expectation, satisfied: false, observed: 'absent' }
        }
      }
      case 'fileContains': {
        const content = await tryReadFile(expectation.path)
        if (content === undefined) {
          return { expectation, satisfied: false, observed: 'unreadable' }
        }
        return {
          expectation,
          satisfied: content.includes(expectation.text),
          observed: `${String(content.length)} characters read`,
        }
      }
      case 'fileEquals': {
        const content = await tryReadFile(expectation.path)
        if (content === undefined) {
          return { expectation, satisfied: false, observed: 'unreadable' }
        }
        if (content === expectation.text) {
          return { expectation, satisfied: true, observed: `${String(content.length)} characters, exact match` }
        }
        return {
          expectation,
          satisfied: false,
          observed: `${String(content.length)} characters, expected ${String(expectation.text.length)}`,
        }
      }
      case 'fileNewerThan': {
        try {
          const stats = await stat(expectation.path)
          const modified = stats.mtimeMs
          return {
            expectation,
            satisfied: modified > expectation.sinceMs,
            observed: `modified at ${String(modified)}`,
          }
        } catch {
          return { expectation, satisfied: false, observed: 'absent' }
        }
      }
      case 'nodeValueEquals': {
        const value = await readers.nodeValue.read(expectation.token)
        if (value === undefined) {
          return { expectation, satisfied: false, observed: 'node not found' }
        }
        return { expectation, satisfied: value === expectation.value, observed: `value is ${JSON.stringify(value)}` }
      }
      case 'windowTitled': {
        const titles = await readers.windowTitles.list()
        const found = titles.some(title => title.includes(expectation.title))
        return {
          expectation,
          satisfied: found,
          observed: found ? `matched among ${String(titles.length)} windows` : `not among ${String(titles.length)} windows`,
        }
      }
    }
  }

  try {
    return await outcome()
  } catch (error) {
    return {
      expectation,
      satisfied: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Check a batch of expectations in order.
 * @param expectations - the conditions to check.
 * @param readers - readers for the non-filesystem observables.
 * @returns one outcome per expectation, in the same order.
 */
export async function checkExpectations(
  expectations: readonly Expectation[],
  readers: VerificationReaders,
): Promise<readonly VerificationOutcome[]> {
  const outcomes: VerificationOutcome[] = []
  for (const expectation of expectations) {
    outcomes.push(await checkExpectation(expectation, readers))
  }
  return outcomes
}
