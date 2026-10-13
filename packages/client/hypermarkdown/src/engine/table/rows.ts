import { patterns } from '../patterns.ts'

/**
 * Whether one line is a table row rather than prose.
 *
 * A row is recognised by its own leading pipe, the marker a model writes when
 * it means a row: GFM itself needs a delimiter row before a run of pipe lines
 * is a table, and without one the same characters appear in shell pipelines,
 * regex alternations and TypeScript unions. A leading pipe is what separates
 * the two, so a run of these lines is table material and anything else is
 * text.
 * @param line - one line of the markdown, indentation included.
 * @returns true when the line opens with a pipe, after up to three spaces of
 *   indentation and any blockquote markers.
 */
export function isTableRow(line: string): boolean {
  return patterns.tableRowRegex.test(line)
}

/**
 * Whether a text is table material: at least one line, every line that carries
 * content a table row.
 *
 * The text is one candidate table — a streaming block's head, or a whole
 * document. Blank lines are not rows and do not disqualify it, because a
 * still-arriving row may be nothing but whitespace and a buffer may carry the
 * blank line that ended the block before it.
 * @param text - the markdown to inspect.
 * @returns true when the text holds at least one row and every content line is
 *   one.
 */
export function isTableText(text: string): boolean {
  let rows = 0

  for (const line of text.split(patterns.lineSplitRegex)) {
    if (patterns.blankOnlyRegex.test(line)) {
      continue
    }

    if (!isTableRow(line)) {
      return false
    }

    rows++
  }

  return rows > 0
}
