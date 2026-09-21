/**
 * Independent verification for every desktop adapter.
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
 * @module @aeven/computer-use-desktop/verify
 */

import { stat, readFile } from 'node:fs/promises'
import type { Expectation, VerificationOutcome } from './types.ts'

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

/**
 * How the adapter answers an application-object question.
 *
 * Exists so the semantic expectations do not force every adapter to grow an
 * application-specific surface: a caller that can answer them supplies a reader,
 * and one that cannot reports the expectation as unsatisfied rather than guessing.
 */
export interface AppObjectReader {
  /**
   * Ask an application whether a collection holds an object matching the fields.
   * @param app - the application to ask, as the recipe names it.
   * @param collection - the collection to search.
   * @param match - field names to expected values.
   * @returns `matched` with what was observed, or a reason it could not be asked.
   */
  find(app: string, collection: string, match: Readonly<Record<string, string>>): Promise<{ matched: boolean, observed: string }>
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
  /**
   * Answers the semantic expectations. Optional: without it those expectations
   * report as unsatisfied, because an unanswerable check must never read as a pass.
   */
  appObjects?: AppObjectReader
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
      case 'appObject': {
        const reader = readers.appObjects
        if (reader === undefined) {
          return { expectation, satisfied: false, observed: 'no application-object reader is configured' }
        }
        const answer = await reader.find(expectation.app, expectation.collection, expectation.match)
        return { expectation, satisfied: answer.matched, observed: answer.observed }
      }
      case 'calendarHasEvent': {
        const reader = readers.appObjects
        if (reader === undefined) {
          return { expectation, satisfied: false, observed: 'no application-object reader is configured' }
        }
        const match = { ...expectation.match }
        if (expectation.count !== undefined) {
          match.atLeast = String(expectation.count)
        }
        const answer = await reader.find('Calendar', expectation.calendar ?? 'calendar', match)
        return { expectation, satisfied: answer.matched, observed: answer.observed }
      }
      case 'noteExists': {
        const reader = readers.appObjects
        if (reader === undefined) {
          return { expectation, satisfied: false, observed: 'no application-object reader is configured' }
        }
        const match: Record<string, string> = { name: expectation.name }
        if (expectation.folder !== undefined) {
          match.folder = expectation.folder
        }
        if (expectation.contains !== undefined) {
          match.contains = expectation.contains
        }
        const answer = await reader.find('Notes', 'notes', match)
        return { expectation, satisfied: answer.matched, observed: answer.observed }
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
