import { patterns } from '../patterns.ts'

/**
 * Drop the checkbox of a task item that GFM would not accept.
 *
 * A task list checkbox counts only when the marker is followed by a space and
 * then item text, so a trailing "[x]" or a half-typed "[x" would otherwise
 * render as literal brackets at the end of the item. The bracket text is
 * removed and the item keeps its plain list content.
 *
 * @param text - the block text whose task markers are being normalised.
 * @returns the text with unusable task markers stripped.
 */
export function fixTasklist(text: string): string {
  const invalidTaskRegex = patterns.invalidTaskRegex

  return text.replace(invalidTaskRegex, '$1$2')
}
