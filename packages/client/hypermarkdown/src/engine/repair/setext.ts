import { patterns } from '../patterns.ts'

/**
 * Hold back a setext underline until the block says what it is.
 *
 * A last line of only "-" or "=" underlines the line above it, turning that
 * line into a heading, so a nested list marker would turn its own parent into
 * a heading for the instant before the rest of the item arrives. The line is
 * withheld only when real text sits above it: after a blank line the same
 * characters are a thematic break, which is unambiguous and renders straight
 * away.
 *
 * @param text - the block text whose last line may be a setext underline.
 * @param pending - whether the block is still being streamed; a closed block
 *   is returned unchanged.
 * @returns the text without its trailing underline line, or the text itself
 *   when the last line is not an underline below text.
 */
export function fixSetext(text: string, pending: boolean): string {
  let lastLine
  let lineStart
  let previousLine
  let previousStart

  if (!text || text === '' || ! pending) {
    return text
  }

  lineStart = text.lastIndexOf('\n')

  if (lineStart === -1) {
    return text
  }

  lastLine = text.substring(lineStart + 1)

  if (!patterns.setextRegex.test(lastLine)) {
    return text
  }

  // Only underlines text: after a blank line the same characters are a
  // thematic break, which is not ambiguous and renders straight away.
  previousStart = text.lastIndexOf('\n', lineStart - 1)
  previousLine = text.substring(previousStart + 1, lineStart)

  if (previousLine.trim() === '') {
    return text
  }

  return text.substring(0, lineStart + 1)
}
