import { patterns } from '../patterns.ts'

import { insideCodeSpan } from './code-spans.ts'
import { bulletMarker } from './utils.ts'

import type { PendingToken } from './types.ts'

/**
 * One "*" or "_" run found in a text, together with how much of it is still
 * unspent and whether its surroundings let it open or close emphasis.
 *
 * The flanking flags come from the characters either side of the run, with the
 * text boundaries counting as whitespace.
 */
export interface EmphasisRun {
  char: '*' | '_'
  index: number
  length: number
  remaining: number
  canOpen: boolean
  canClose: boolean
  canBoth: boolean
}

/**
 * An opener held on the emphasis stack while its closer is still arriving: the
 * run that opened the emphasis, and however many of its delimiter characters
 * are left to be spent by a closer later in the text.
 */
export interface EmphasisOpener {
  char: '*' | '_'
  index: number
  length: number
  remaining: number
  canBoth: boolean
}

/**
 * What repairing the emphasis of a text produced: the text with any dangling
 * trailing delimiter dropped, and the closers the caller still has to append
 * for the markers left open inside it.
 */
export interface EmphasisResult {
  text: string
  pending: PendingToken[]
}

/**
 * Balance the emphasis in a text that may still be arriving.
 *
 * Runs left dangling at the very end are stripped first, so a streamed
 * "**_bold" does not render as a thematic break. What remains is matched the
 * way CommonMark does it, nesting so the marker that opened last closes first,
 * and whatever is still open comes back as pending closers for the caller to
 * append now and drop once the real delimiter lands.
 *
 * @param text - the block text whose emphasis is being balanced.
 * @returns the trimmed text, plus a closer per marker still open in it.
 */
export function fixEmphasis(text: string): EmphasisResult {
  let i
  let j
  let use
  let run
  let runs
  let last
  let stack: EmphasisOpener[]
  let opener
  let pending: PendingToken[]
  let remaining: number

  // A line that is nothing but a tag opens an HTML block, and everything
  // up to the next blank line belongs to it as raw text — emphasis markers
  // in there are literal.
  if (insideHtmlBlock(text)) {
    return { text: text, pending: [] }
  }

  runs = emphasisRuns(text)

  // Runs sitting at the very end have nothing to emphasise yet. Dropping
  // one can expose another, as in "**_", so keep going until the text no
  // longer ends in a delimiter.
  while (runs.length > 0) {
    last = runs[runs.length - 1]!

    if (last.index + last.length !== text.length) {
      break
    }

    text = text.substring(0, last.index)
    runs = emphasisRuns(text)
  }

  stack = []
  pending = []

  for (i = 0; i < runs.length; i++) {
    run = runs[i]!

    remaining = run.length

    if (run.canClose) {
      j = stack.length - 1

      while (j >= 0 && remaining > 0) {
        opener = stack[j]!

        if (opener.char !== run.char || ! emphasisPairs(opener, run)) {
          j--
          continue
        }

        use = opener.remaining >= 2 && remaining >= 2 ? 2 : 1

        opener.remaining -= use
        remaining -= use

        // Delimiters between the pair are discarded, as CommonMark does.
        stack.length = j + 1

        if (opener.remaining === 0) {
          stack.pop()
          j = stack.length - 1
        }
      }
    }

    if (run.canOpen && remaining > 0) {
      stack.push({
        char: run.char,
        index: run.index,
        length: run.length,
        canBoth: run.canBoth,
        remaining: remaining,
      })
    }
  }

  for (i = 0; i < stack.length; i++) {
    opener = stack[i]!

    // Openers are removed from the stack as soon as their remainder reaches
    // zero, so every entry left here necessarily needs a closer.
    pending.push({
      close: true,
      index: opener.index,
      token: opener.char.repeat(opener.remaining),
    })
  }

  return { text: text, pending: pending }
}

/**
 * Every "*" and "_" run in a text, classified for emphasis.
 *
 * A run inside a code span is literal text, and a "*" acting as a list bullet
 * is not a delimiter either, so neither is reported. The text boundaries count
 * as whitespace for flanking purposes.
 *
 * @param text - the text to scan for emphasis delimiters.
 * @returns one entry per delimiter run, in source order.
 */
export function emphasisRuns(text: string): EmphasisRun[] {
  let i
  let run: EmphasisRun
  let runs: EmphasisRun[]
  let char: '*' | '_'
  let current
  let start
  let after
  let before
  let leftFlanking
  let rightFlanking
  let canOpen
  let canClose

  runs = []
  i = 0

  while (i < text.length) {
    current = text.charAt(i)

    if (current === '\\') {
      i += 2
      continue
    }

    if (current !== '*' && current !== '_') {
      i++
      continue
    }

    char = current

    start = i

    while (i < text.length && text.charAt(i) === char) {
      i++
    }

    if (insideCodeSpan(text, start)) {
      continue
    }

    if (char === '*' &&  bulletMarker(text, start)) {
      continue
    }

    // Text boundaries count as whitespace for flanking purposes.
    before = start === 0 ? ' ' : text.charAt(start - 1)
    after = i >= text.length ? ' ' : text.charAt(i)

    leftFlanking =
      !
      patterns.blankCharRegex.test(after) &&
      (!patterns.punctuationRegex.test(after) ||

        patterns.blankCharRegex.test(before) ||

        patterns.punctuationRegex.test(before))

    rightFlanking =
      !
      patterns.blankCharRegex.test(before) &&
      (!patterns.punctuationRegex.test(before) ||

        patterns.blankCharRegex.test(after) ||

        patterns.punctuationRegex.test(after))

    if (char === '*') {
      canOpen = leftFlanking
      canClose = rightFlanking
    } else {
      canOpen =
        leftFlanking &&
        (!rightFlanking || patterns.punctuationRegex.test(before))
      canClose =
        rightFlanking &&
        (!leftFlanking || patterns.punctuationRegex.test(after))
    }

    run = {
      char,
      index: start,
      length: i - start,
      remaining: i - start,
      canOpen,
      canClose,
      canBoth:  canOpen &&  canClose,
    }

    runs.push(run)
  }

  return runs
}

/**
 * Whether an opener and a closer of the same character may form emphasis.
 *
 * This is CommonMark's rule of three: when either run can both open and close,
 * their lengths may only sum to a multiple of three if both lengths are.
 *
 * @param opener - the run that would open the emphasis.
 * @param closer - the run that would close it.
 * @returns true when the two runs are allowed to pair.
 */
export function emphasisPairs(
  opener: EmphasisRun | EmphasisOpener,
  closer: EmphasisRun,
): boolean {
  if (!opener.canBoth && ! closer.canBoth) {
    return true
  }

  if ((opener.length + closer.length) % 3 !== 0) {
    return true
  }

  return opener.length % 3 === 0 && closer.length % 3 === 0
}

/**
 * Whether a text is inside an HTML block, where markup characters are literal.
 *
 * Only the first line of the current blank-line-delimited chunk is classified:
 * a line that is nothing but a tag, or that opens one of CommonMark's raw-block
 * tags, starts a block running to the next blank line, and emphasis markers in
 * there must be left alone.
 *
 * @param text - the block text whose current chunk is being classified.
 * @returns true when that chunk opens or continues a raw HTML block.
 */
export function insideHtmlBlock(text: string): boolean {
  let start
  let lineEnd
  let firstLine

  start = text.lastIndexOf('\n\n')
  start = start === -1 ? 0 : start + 2

  lineEnd = text.indexOf('\n', start)
  firstLine =
    lineEnd === -1 ? text.substring(start) : text.substring(start, lineEnd)

  return (
    patterns.htmlBlockStartRegex.test(firstLine) ||
    patterns.htmlBlockTagRegex.test(firstLine)
  )
}
