// Small questions the repairs ask about a character before deciding whether it
// is markup at all.

/**
 * Whether the marker at an offset is escaped.
 *
 * An odd number of backslashes in front of it says it is, so "\*" is literal
 * asterisk text while "\\*" is a real delimiter — which is why the count is
 * taken rather than the single character before it examined.
 *
 * @param text - the text the marker sits in.
 * @param index - the offset of the marker being tested.
 * @returns true when an unpaired backslash precedes the marker.
 */
export function escapedMarker(text: string, index: number): boolean {
  let i
  let count

  count = 0
  i = index - 1

  while (i >= 0 && text.charAt(i) === '\\') {
    count++
    i--
  }

  return count % 2 === 1
}

/**
 * Whether a "*" at an offset opens a list item rather than emphasis.
 *
 * Nothing but spaces and tabs may precede it on its line, and a space, a tab
 * or the end of the text must follow it — while the character after it is
 * still unknown the opener assumes a bullet, so a nascent list is never
 * rewritten into emphasis.
 *
 * @param text - the text the "*" sits in.
 * @param index - the offset of the "*".
 * @returns true when the character can only be a list bullet.
 */
export function bulletMarker(text: string, index: number): boolean {
  let i
  let next

  i = index - 1

  while (i >= 0 && (text.charAt(i) === ' ' || text.charAt(i) === '\t')) {
    i--
  }

  if (i >= 0 && text.charAt(i) !== '\n') {
    return false
  }

  next = text.charAt(index + 1)

  return next === '' || next === ' ' || next === '\t'
}
