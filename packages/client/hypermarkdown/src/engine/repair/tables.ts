import { indexLines, terminated, type Line } from '../line-index.ts'
import { patterns } from '../patterns.ts'
import { isTableRow, isTableText } from '../table/rows.ts'

import type { BlockType } from '../types.ts'

/**
 * A half-open offset range into a text: the character at `end` is the first
 * one outside it.
 */
export interface TextRange {
  start: number
  end: number
}

/**
 * Repair the table syntax of a buffer, in whichever form the caller needs.
 *
 * A "table" block holds one streaming table and is converted row by row. A
 * "renderer" buffer is a whole document, scanned for runs of pipe-carrying
 * lines so each run can be cleaned, and given a header when it has none, while
 * fenced code blocks are left untouched. Any other block type is not table
 * material and comes back as it was.
 *
 * @param mdBuffer - the markdown buffer to repair.
 * @param blocktype - the caller's context: one streaming table block, a whole
 *   document, or a type this repair does not apply to.
 * @param pending - whether the content is still being streamed, which decides
 *   how much of a half-arrived table can be shown.
 * @returns the repaired buffer.
 */
export function repairTableSyntax(
  mdBuffer: string,
  blocktype: BlockType | 'renderer',
  pending: boolean,
): string {
  if (blocktype === 'table') {
    return convertTable(mdBuffer, pending)
  }

  if (blocktype === 'renderer') {
    let lines
    let headed

    let matchIndex

    let result
    let pointer

    let trimmed

    let replacement
    let bufferLength
    let fencedRanges

    let delimiterLine

    result = ''

    pointer = 0

    bufferLength = mdBuffer.length

    fencedRanges = collectFencedRanges(mdBuffer)

    for (const run of findTableRuns(mdBuffer)) {
      matchIndex = run.start

      const runText = mdBuffer.slice(run.start, run.end)

      if (pointer < matchIndex) {
        result += mdBuffer.slice(pointer, matchIndex)
      }

      if (isInsideFenced(matchIndex, fencedRanges)) {
        result += runText
      } else {
        // Same cleaning as the streaming path, so a whole document renders
        // the table a stream would have rendered.
        const cleaned = runText
          .split('\n')
          .map(dropTrailingComment)
          .join('\n')

        trimmed = cleaned.trim()
        lines = trimmed.split('\n')

        delimiterLine = lines[1] || ''
        headed = checkHeaded(delimiterLine)

        if (!headed) {
          replacement = convertTableHeadless(cleaned, lines)
          replacement = replacement + '\n'
          result += replacement
        } else {
          result += cleaned
        }
      }

      pointer = run.end
    }

    if (pointer < bufferLength) {
      result += mdBuffer.slice(pointer, bufferLength)
    }

    mdBuffer = result

    return mdBuffer
  }

  return mdBuffer
}

/**
 * Convert one streaming table block into GFM table syntax.
 *
 * The buffer is cleaned of trailing HTML comments first, because what leaves
 * this function is what the parser sees and a comment after the last pipe
 * counts as one more cell. A table whose second line is a real delimiter row
 * keeps its header; a headless one gets a synthetic header and delimiter, so
 * its rows render as a table instead of as literal pipes.
 *
 * @param mdBuffer - the table block being converted.
 * @param pending - whether the block is still being streamed.
 * @returns the converted table, or the buffer as it stands when it holds no
 *   unescaped pipe or is not made of table rows.
 */
export function convertTable(mdBuffer: string, pending: boolean): string {
  let headed

  let lines
  let headerLine
  let delimiterLine

  // Cleaned on the buffer, not just on the split copy: what leaves this
  // function is the buffer, and the parser downstream sees that.
  mdBuffer = mdBuffer.split('\n').map(dropTrailingComment).join('\n')

  const trimmed = mdBuffer.trim()

  if (!patterns.closeRegex.test(trimmed)) {
    return mdBuffer
  }

  // A block typed as a table from its first row can still turn out to be
  // prose: the row that opened it may be followed by an ordinary sentence, and
  // rebuilding that as rows would invent a table nobody wrote.
  if (!isTableText(trimmed)) {
    return mdBuffer
  }

  lines = trimmed.split('\n')
  headerLine = lines[0] || ''
  delimiterLine = lines[1] || ''

  headed = checkHeaded(delimiterLine)

  if (!headed) {
    mdBuffer = convertTableHeadless(mdBuffer, lines)

    return mdBuffer
  } else {
    mdBuffer = convertTableWithHeader(pending, mdBuffer, headerLine, lines)

    return mdBuffer
  }
}

/**
 * Drop an HTML comment sitting after a row's last pipe.
 *
 * GFM counts everything after the final pipe as one more cell, so a header
 * annotated with `| | | | | <!-- note -->` has five cells against the
 * delimiter's four, the counts disagree and the whole thing stops being a
 * table — it renders as literal pipes instead. The comment is invisible
 * either way, so removing it costs nothing and keeps the table.
 */
function dropTrailingComment(line: string): string {
  const trimmed = line.trimEnd()

  if (!trimmed.endsWith('-->')) {
    return line
  }

  const start = trimmed.lastIndexOf('<!--')

  if (start === -1) {
    return line
  }

  const before = trimmed.slice(0, start)

  // Only when the comment really is trailing, after the row's own last pipe.
  return before.trimEnd().endsWith('|') ? before.trimEnd() : line
}

/**
 * Whether a line is the delimiter row of a table with a header.
 *
 * The line must be a pipe row — any blockquote marker stripped — whose every
 * cell is dashes with optional alignment colons, as in "| :--- | ---: |".
 *
 * @param delimiterLine - the candidate line, normally the second of a table.
 * @returns true when the line can serve as a delimiter row.
 */
export function checkHeaded(delimiterLine: string): boolean {
  let cells
  let normalized

  normalized = delimiterLine.trim().replace(/^>\s?/, '').trim()

  if (!normalized.includes('|')) {
    return false
  }

  cells = normalized
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(patterns.closeRegex)
    .map(cell => cell.trim())

  return (
    cells.length > 0 && cells.every(cell =>  /^:?-+:?$/.test(cell))
  )
}

/**
 * Render a run of rows that has no header as a GFM table.
 *
 * The outer pipes of each row are normalised first, so a row written as
 * "a | b" counts its columns correctly, and the widest row decides how many
 * synthetic columns the header and delimiter carry. Leading whitespace goes on
 * every emitted line and a trailing blank line is kept, so the replacement
 * holds its place in the surrounding markdown — and stays a table when that
 * place is inside a list item.
 *
 * @param mdBuffer - the table text being replaced.
 * @param lines - the same text split into lines, already cleaned.
 * @returns the table with a synthetic header and delimiter, or the buffer
 *   itself when no row carries a column.
 */
export function convertTableHeadless(
  mdBuffer: string,
  lines: string[],
): string {
  let white

  let trimmed
  let bodyRows

  let tableContent

  let columns
  let dummyHeader
  let dummyDelimiter

  let columnsMax = 0

  // Normalise the outer pipes first: a headless row may arrive as "a | b",
  // and counting columns before adding them reports one column too few.
  bodyRows = lines
    .map((line) => {
      trimmed = line.trim()
      if (trimmed && !trimmed.endsWith('|')) {
        trimmed += ' |'
      }
      if (trimmed && !trimmed.startsWith('|')) {
        trimmed = '| ' + trimmed
      }
      return trimmed
    })
    .filter(line => line !== '')

  bodyRows.forEach((line) => {
    columns = line.split(patterns.closeRegex).length - 2
    if (columns > columnsMax) {
      columnsMax = columns
    }
  })

  if (columnsMax < 1) {
    return mdBuffer
  } else {
    dummyHeader = '|' + ' |'.repeat(columnsMax)
    dummyDelimiter = '|' + ' :--- |'.repeat(columnsMax)

    white = mdBuffer.match(patterns.whiteRegex)?.[0] ?? ''

    // Every line carries the run's indentation, not just the first: a run
    // inside a list item is a table only while its delimiter row sits at the
    // same indent as its rows, and an indent on the header alone left the
    // synthetic rows showing as literal text.
    tableContent = [dummyHeader, dummyDelimiter, ...bodyRows].join('\n' + white)

    if (!mdBuffer.endsWith('|\n\n')) {
      return white + tableContent
    } else {
      return white + tableContent + '\n\n'
    }
  }
}

/**
 * The run of two or more table rows a table repair starts from.
 *
 * A run is table material only when every line in it carries its own leading
 * pipe — see {@link isTableRow}. Pipe-carrying lines that are not rows are
 * ordinary text: a shell pipeline in a bullet list, a regex alternation, a
 * TypeScript union, a `||` in a code snippet. Without the row requirement a
 * pair of such lines was rebuilt as a table with a synthetic header, which is
 * how prose turned into a table nobody wrote.
 *
 * This is what `(?:[^\n]*\|[^\n]*\n)+` used to find, minus its cost: every
 * pipe on a line was another way for the engine to split that line, so a
 * pipe-dense row whose run came up short — the ordinary shape of a table only
 * half-arrived — was re-read once per pipe, and a pair of such rows once per
 * pair of pipes. Counting pipes per line instead reads each line once.
 */
function findTableRuns(text: string): TextRange[] {
  const runs: TextRange[] = []
  const lines = indexLines(text)

  let runStart = -1
  let runLength = 0
  let wholeRun = true

  const close = (end: number) => {
    // The pattern needed one line for the leading `+` and one for the
    // alternation that follows it, whichever branch matched.
    if (runLength >= 2 && wholeRun) {
      runs.push({ start: runStart, end })
    }

    runStart = -1
    runLength = 0
    wholeRun = true
  }

  for (const line of lines) {
    // An unterminated line cannot be part of a run: every row in the pattern
    // carried its own "\n". It also ends the run it would have extended.
    if (!terminated(line) || !line.text.includes('|')) {
      close(line.start)
      continue
    }

    if (runStart === -1) {
      runStart = line.start
    }

    runLength++

    if (!isTableRow(line.text)) {
      wholeRun = false
    }
  }

  close(text.length)

  return runs
}

/** How far a line is indented, counting only the spaces and tabs "[ \t]*" did. */
function indentWidth(text: string): number {
  let width = 0

  while (text.charAt(width) === ' ' || text.charAt(width) === '\t') {
    width++
  }

  return width
}

/** A line that opens a fence: indentation, then "```" or "~~~", then anything. */
function fenceOpen(line: Line): string | null {
  const indent = indentWidth(line.text)
  const marker = line.text.slice(indent, indent + 3)

  if (marker !== '```' && marker !== '~~~') {
    return null
  }

  // The pattern closed on a back-reference to both, so they are the identity
  // of the fence: an opener is only closed by its own indent and marker.
  return line.text.slice(0, indent) + '\u0000' + marker
}

/** A line that closes one: the opener's exact indent and marker, nothing after. */
function fenceClose(line: Line): string | null {
  const key = fenceOpen(line)

  if (key === null) {
    return null
  }

  const rest = line.text.slice(key.indexOf('\u0000') + 3)

  return indentWidth(rest) === rest.length ? key : null
}

/**
 * The spans of every complete fenced code block in a text.
 *
 * An opener is only closed by a line carrying its own indentation and its own
 * marker, and the two are never adjacent — an empty fence does not close — so
 * each marker's closing lines are gathered once and then read forward as the
 * openers are visited, rather than the whole tail being rescanned per fence. A
 * CRLF line cannot close a fence.
 *
 * @param text - the text to scan for fenced blocks.
 * @returns one range per complete fence, each including the newline above a
 *   fence that does not start the text.
 */
export function collectFencedRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  const lines = indexLines(text)

  // Where each opener's closing line can be, gathered up front. The lazy
  // `[\s\S]*?` this replaces rescanned the whole tail for every fence that
  // never closed, so a buffer of unterminated fences cost one full pass each.
  const closers = new Map<string, number[]>()

  lines.forEach((line, index) => {
    // "[ \t]*(?=\n|$)" would not step over a carriage return, so a CRLF line
    // never closed a fence.
    const key = text.charAt(line.end) === '\r' ? null : fenceClose(line)

    if (key !== null) {
      const found = closers.get(key)

      if (found) {
        found.push(index)
      } else {
        closers.set(key, [index])
      }
    }
  })

  // Openers are visited in order, so each key's list is only ever read
  // forward: the cursors together cost one pass over the closing lines.
  const cursors = new Map<string, number>()

  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    const key = terminated(line) ? fenceOpen(line) : null

    if (key === null) {
      index++
      continue
    }

    const candidates = closers.get(key)

    if (!candidates) {
      index++
      continue
    }

    let cursor = cursors.get(key) ?? 0

    // The opening line took its own newline with it and the closing line needs
    // one of its own in front, so the two are never adjacent: under the old
    // pattern an empty fence did not match at all, and the line below an
    // opener is read as content even when it looks like a closer.
    while (cursor < candidates.length && candidates[cursor]! <= index + 1) {
      cursor++
    }

    cursors.set(key, cursor)

    if (cursor === candidates.length) {
      index++
      continue
    }

    const closing = candidates[cursor]!

    ranges.push({
      // The pattern opened on "(?:^|\n)", so a fence below the first line
      // takes the newline above it with it.
      start: line.start === 0 ? 0 : line.start - 1,
      end: lines[closing]!.end,
    })

    index = closing + 1
  }

  return ranges
}

/**
 * Whether an offset falls inside one of the collected fence ranges.
 *
 * @param index - the offset to test against the ranges.
 * @param ranges - fence ranges from `collectFencedRanges`, in source order.
 * @returns true when the offset is inside a fenced block, so table repair must
 *   leave that line alone.
 */
export function isInsideFenced(index: number, ranges: TextRange[]): boolean {
  let i
  let range

  if (!ranges || ranges.length === 0) {
    return false
  }

  for (i = 0; i < ranges.length; i++) {
    range = ranges[i]
    if (!range) {
      continue
    }
    if (index >= range.start && index < range.end) {
      return true
    }
  }

  return false
}

/**
 * Show a table with a header row while its delimiter is still arriving.
 *
 * A stand-in delimiter and placeholder body row are built from the header's
 * own column count, which keeps the table visible instead of flickering into
 * literal pipes; once the real delimiter lands the buffer is returned as it
 * is, and a header with no rows stays a header with its own alignment.
 *
 * @param pending - whether the block is still being streamed.
 * @param mdBuffer - the table text as it currently stands.
 * @param headerLine - the table's header row.
 * @param lines - the buffer split into cleaned lines.
 * @returns the table with a synthetic delimiter and placeholder row, or the
 *   buffer unchanged when it already has a body.
 */
export function convertTableWithHeader(
  pending: boolean,

  mdBuffer: string,
  headerLine: string,
  lines: string[],
): string {
  let white

  let delimiter
  let tableContent

  const headerRow = headerLine
  const bodyRows = lines.slice(2)

  const headerColumnCount = headerRow.split(patterns.closeRegex).length

  // Stand-in delimiter and placeholder row so a table shows up while its
  // real delimiter is still arriving. Once closed the table is whatever it
  // is — a header with no rows stays that way, keeping its own alignment.
  if (pending && headerColumnCount > 0 && lines.length < 3) {
    white = mdBuffer.match(patterns.whiteRegex)?.[0] ?? ''
    delimiter = '|' + ' :--- |'.repeat(headerColumnCount - 2)
    tableContent = [headerRow, delimiter, ...bodyRows].join('\n')

    return white + tableContent + '\n|'
  } else {
    return mdBuffer
  }
}

/**
 * Hold back a table row that is still being typed.
 *
 * A last line that is only the start of a row — the "| :" under
 * "| A | B |" — would render as a cell holding a colon, so it is cut away
 * until the row says what it is. A line already carrying "---" is a delimiter
 * row and is left alone.
 *
 * @param text - the table text whose last line is being inspected.
 * @param pending - whether the block is still being streamed; a closed block
 *   is returned unchanged.
 * @returns the text without its partial last row, or the text itself when the
 *   last line is complete or is a delimiter.
 */
export function fixPartialRow(text: string, pending: boolean): string {
  let lastLine
  let lineStart

  if (!text || text === '' || ! pending) {
    return text
  }

  lineStart = text.lastIndexOf('\n')
  lastLine = text.substring(lineStart + 1)

  if (!patterns.partialRowRegex.test(lastLine)) {
    return text
  }

  if (lastLine.indexOf('---') !== -1) {
    return text
  }

  return text.substring(0, lineStart + 1)
}

/**
 * Hold back a buffer that has started a table but has not committed to one.
 *
 * A lone pipe with no blank line after it — "before | unfinished" — is not a
 * table yet, and rendering it would show the raw fence character. The buffer
 * is cut back to the first pipe; once a blank line arrives the text is a real
 * table-and-prose pair and is returned unchanged.
 *
 * @param text - the block text to inspect for a lone pipe.
 * @returns the text before its first pipe, or the full text when it already
 *   holds a blank line or no pipe at all.
 */
export function fixTempTable(text: string): string {
  if (text.includes('\n\n')) {
    return text
  }
  const pipeIndex = text.search(patterns.pipeRegex)
  if (pipeIndex === -1) {
    return text
  }
  return text.substring(0, pipeIndex)
}
