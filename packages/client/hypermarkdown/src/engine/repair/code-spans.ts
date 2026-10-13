import { patterns } from '../patterns.ts'

import type { InlineTokenResult } from './types.ts'
import type { TextRange } from './tables.ts'

/**
 * One run of backticks in a text: where it starts, and how many backticks it
 * spans. A run is the unit a code span is delimited by, so "``code``" holds
 * two runs of width two rather than four lone backticks.
 */
export interface BacktickRun {
  index: number
  length: number
}

/**
 * The outcome of pairing backtick runs left to right: which runs found a
 * partner of equal width, and the position of the first run that found none.
 */
export interface BacktickPairs {
  paired: boolean[]
  unmatched: number
}

/**
 * Balance the backticks of one inline token pass.
 *
 * A text that ends in an open run — "use `code" — reports the closer its
 * caller should append, and a trailing run with nothing behind it is dropped
 * instead, so an appended closer can never merge into it. Runs are matched by
 * width, since a run of n only closes on another run of exactly n.
 *
 * @param text - the inline text whose backtick runs are being balanced.
 * @returns the possibly trimmed text, the backtick token a closer should use,
 *   whether a closer is owed, and the offset of the unmatched opener (-1 when
 *   every run paired).
 */
export function fixCodeSpan(text: string): InlineTokenResult {
  let last
  let runs
  let result
  let opener

  runs = backtickRuns(text)
  result = pairBacktickRuns(runs)

  // A trailing run that closes nothing is the start of content still on
  // its way. Drop it, or the closer appended below would merge into it and
  // "`` `" would become five backticks instead of an empty code span.
  if (runs.length > 0) {
    last = runs[runs.length - 1]

    if (
      last &&
      last.index + last.length === text.length &&
      result.paired[runs.length - 1] !== true
    ) {
      text = text.substring(0, last.index)
      runs = backtickRuns(text)
      result = pairBacktickRuns(runs)
    }
  }

  if (result.unmatched === -1) {
    return { text: text, token: '`', close: false, index: -1 }
  }

  opener = runs[result.unmatched]!

  return {
    text: text,
    token: '`'.repeat(opener.length),
    close: true,
    index: opener.index,
  }
}

/**
 * The code spans in a text, as half-open [start, end) offsets.
 *
 * Memoised on the text itself. Every caller asking "is this offset inside a
 * code span?" is asking about the same text — once per emphasis run, once per
 * inline token — and recomputing the runs for each of them turned one pass
 * over a document into a quadratic one. Within a pass the same string object
 * is handed back, so the equality check is a pointer comparison.
 */
let spanText: string | null = null
let spanRanges: TextRange[] = []

function codeSpans(text: string): TextRange[] {
  if (text === spanText) {
    return spanRanges
  }

  const runs = backtickRuns(text)
  const ranges: TextRange[] = []

  let i = 0

  while (i < runs.length) {
    const opener = runs[i]!

    let closer = -1

    for (let j = i + 1; j < runs.length; j++) {
      const candidate = runs[j]

      if (candidate!.length === opener.length) {
        closer = j
        break
      }
    }

    if (closer === -1) {
      // An unclosed run: everything after it reads as code so far.
      ranges.push({ start: opener.index, end: Number.MAX_SAFE_INTEGER })
      break
    }

    const closerRun = runs[closer]!

    ranges.push({ start: opener.index, end: closerRun.index })

    i = closer + 1
  }

  spanText = text
  spanRanges = ranges

  return ranges
}

/**
 * Whether an offset falls inside a code span.
 *
 * The spans are memoised per text, so the emphasis and inline-token passes
 * over one chunk each ask this question without rebuilding the runs, and the
 * lookup is a binary search over the sorted, non-overlapping ranges.
 *
 * @param text - the text whose code spans are being consulted.
 * @param index - the offset to test, relative to the start of text.
 * @returns true when the offset sits between an opening run and its closer.
 */
export function insideCodeSpan(text: string, index: number): boolean {
  const ranges = codeSpans(text)

  // Sorted and non-overlapping by construction, so a binary search settles it.
  let low = 0
  let high = ranges.length - 1

  while (low <= high) {
    const mid = (low + high) >> 1
    const range = ranges[mid]!

    if (index <= range.start) {
      high = mid - 1
    } else if (index >= range.end) {
      low = mid + 1
    } else {
      return true
    }
  }

  return false
}

/**
 * Every run of backticks in a text, in source order.
 *
 * A text that opens a fence — "```js" at the start of a line — is a block, not
 * inline code, so it reports no runs at all rather than a fence marker the
 * repair would try to close.
 *
 * @param text - the text to scan for backtick runs.
 * @returns one entry per run, holding its start offset and its width.
 */
export function backtickRuns(text: string): BacktickRun[] {
  let i
  let runs
  let start

  if (patterns.fenceLineRegex.test(text)) {
    return []
  }

  runs = []
  i = 0

  while (i < text.length) {
    if (text.charAt(i) !== '`') {
      i++
      continue
    }

    start = i

    while (i < text.length && text.charAt(i) === '`') {
      i++
    }

    runs.push({ index: start, length: i - start })
  }

  return runs
}

/**
 * Pair backtick runs left to right, the way CommonMark closes a code span: a
 * run of n is closed by the next run of exactly n, and everything between the
 * two is code.
 *
 * Pairing stops at the first run left without a partner, because that run is
 * holding everything after it open — which is what the caller has to close.
 *
 * @param runs - the backtick runs to pair, in source order.
 * @returns which runs found a partner, and the index of the first run that did
 *   not (-1 when every run paired).
 */
export function pairBacktickRuns(runs: BacktickRun[]): BacktickPairs {
  let i
  let j
  let paired
  let closerIndex
  let opener
  let candidate

  paired = []
  i = 0

  while (i < runs.length) {
    opener = runs[i]!

    closerIndex = -1

    for (j = i + 1; j < runs.length; j++) {
      candidate = runs[j]!

      if (candidate.length === opener.length) {
        closerIndex = j
        break
      }
    }

    if (closerIndex === -1) {
      return { paired: paired, unmatched: i }
    }

    paired[i] = true
    paired[closerIndex] = true

    i = closerIndex + 1
  }

  return { paired: paired, unmatched: -1 }
}
