import { patterns } from '../patterns.ts'

/**
 * Hold back a list marker that has no item text behind it yet.
 *
 * "1." reads as the digit 1 until its delimiter and item text land, and "- "
 * reads as a stray dash, so a last line that is nothing but a marker is cut
 * away. Digits alone are prose rather than a marker, and a nested marker
 * opening inside an item — "-   -" — is trimmed back to its parent's text.
 *
 * @param text - the block text whose last line is being inspected.
 * @param pending - whether the block is still being streamed; a closed block
 *   is returned unchanged.
 * @returns the text with the nascent marker removed.
 */
export function fixPartialMarker(text: string, pending: boolean): string {
  let lastLine
  let lineStart

  const bareNumber = /^[ \t>]*\d{2,9}[ \t]*$/

  if (!text || text === '' || ! pending) {
    return text
  }

  lineStart = text.lastIndexOf('\n')
  lastLine = text.substring(lineStart + 1)

  if (patterns.markerOnlyRegex.test(lastLine)) {
    // A multi-digit document is prose, but the same digits after an earlier
    // list item may still be an ordered marker whose delimiter is arriving.
    if (lineStart === -1 && bareNumber.test(lastLine)) {
      return text
    }

    return text.substring(0, lineStart + 1)
  }

  // A nested marker opening inside an item — "-   -" — is equally a marker
  // with no item text behind it yet.
  return text.replace(patterns.nestedMarkerRegex, '$1')
}
