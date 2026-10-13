// One pass over a buffer's lines, so scanners that used to be written as
// backtracking regexes can walk the document instead.
//
// The regexes these replace all shared a shape: a per-line pattern under a
// quantifier, or a lazy `[\s\S]*?` hunting for a terminator. Both make the
// engine re-read the same characters once per candidate start, which is the
// polynomial blow-up CodeQL reports. A line index is built once, in linear
// time, and every scan below reads it forward only.

/**
 * One line of a buffer, with the offsets a forward-only scan needs.
 *
 * Positions are kept rather than substrings so a scanner can slice out of the
 * original buffer and map any match back to its source offset.
 */
export interface Line {
  /** Index of the line's first character. */
  start: number
  /** Index just past the line's last character, before "\r" or "\n". */
  end: number
  /** Index just past the line's terminator, or the buffer length. */
  next: number
  /** The line itself, without its terminator. */
  text: string
}

/**
 * Index a buffer by line in one forward pass.
 *
 * Splitting on "\n" alone would lose the offsets into the original buffer, and
 * the scans built on this index report positions in that buffer. A "\r" before
 * the newline is excluded from the line's text but stays inside its span, so
 * reassembling lines reproduces the input exactly. The last line has no
 * terminator and is always produced, even when the buffer is empty.
 * @param text - the buffer to index.
 * @returns one entry per line, in order, each carrying its offsets and text.
 */
export function indexLines(text: string): Line[] {
  const lines: Line[] = []

  let start = 0

  for (;;) {
    const newline = text.indexOf('\n', start)
    const terminated = newline !== -1
    const stop = terminated ? newline : text.length
    const end = stop > start && text.charAt(stop - 1) === '\r' ? stop - 1 : stop

    lines.push({
      start,
      end,
      next: terminated ? newline + 1 : text.length,
      text: text.slice(start, end),
    })

    if (!terminated) {
      return lines
    }

    start = newline + 1
  }
}

/**
 * Whether the line carries a terminator, as `[^\n]*\n` in a pattern demands.
 *
 * A pattern that matches a whole line only succeeds when that line ends in a
 * newline, so a scan reproducing it has to ask before treating the last line of
 * a buffer as a match.
 * @param line - the indexed line to test.
 * @returns true when the line is followed by its terminator.
 */
export function terminated(line: Line): boolean {
  return line.next > line.end
}
