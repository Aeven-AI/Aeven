import { patterns } from '../patterns.ts'

/**
 * Drop a backslash that is escaping a character not yet arrived.
 *
 * A trailing backslash is either an escape whose target is still in flight or
 * the hard-break form at the end of a line; either way it is markup rather
 * than text, so it is held back until the character after it lands. Only an
 * odd run of backslashes says that: an even one is a literal backslash, and
 * blank characters before it are looked past, since the backslash still ends
 * the last line of text.
 *
 * @param text - the block text whose trailing backslashes are being counted.
 * @param pending - whether the block is still being streamed; a closed block
 *   is returned unchanged.
 * @returns the text with one trailing backslash removed.
 */
export function fixTrailingEscape(text: string, pending: boolean): string {
  let i
  let count

  if (!text || text === '' || ! pending) {
    return text
  }

  // Look past any trailing blank line: a backslash at the end of the last
  // line is the hard-break form, and equally not text.
  i = text.length - 1

  while (i >= 0 && patterns.blankCharRegex.test(text.charAt(i))) {
    i--
  }

  count = 0

  while (i >= 0 && text.charAt(i) === '\\') {
    count++
    i--
  }

  if (count % 2 === 0) {
    return text
  }

  return text.substring(0, i + count) + text.substring(i + count + 1)
}
