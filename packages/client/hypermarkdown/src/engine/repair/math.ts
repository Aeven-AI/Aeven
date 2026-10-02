import { patterns } from '../patterns.ts'

/**
 * Withhold a formula whose delimiter has not closed yet.
 *
 * Splitting on protected code, autolinks and HTML first keeps their contents
 * out of the scan. The block is then cut at the earliest still-open delimiter
 * and the pending marker is appended, so the reader sees a placeholder instead
 * of raw TeX that would snap into KaTeX a chunk later.
 *
 * @param text - the block text being scanned for an unfinished formula.
 * @param pending - whether the block is still being streamed; a closed block
 *   is returned unchanged.
 * @returns the text up to the open delimiter plus the pending marker, or the
 *   text itself when every formula in it is complete.
 */
export function fixMath(text: string, pending: boolean): string {
  let i

  let chunk
  let chunks

  let offset
  let openIndex
  let mathIndex

  const tokens = patterns.mathProtectedRegex

  if (!text || text === '' || ! pending) {
    return text
  }

  tokens.lastIndex = 0
  chunks = text.split(tokens)

  offset = 0
  openIndex = -1

  for (i = 0; i < chunks.length; i++) {
    chunk = chunks[i]!

    if (i % 2 === 0) {
      mathIndex = findOpenMath(chunk)

      if (mathIndex !== -1) {
        openIndex = offset + mathIndex
      }
    }

    offset += chunk.length
  }

  if (openIndex === -1) {
    return text
  }

  return text.substring(0, openIndex) + patterns.mathPendingMarker
}

/**
 * Find the first math delimiter that is still open.
 *
 * All three forms remark-math accepts are handled: "\\(" and "\\[" close on
 * their own escapes, "$$" on the next "$$", and a single "$" on the next
 * unescaped "$". A lone "$" followed by whitespace never opens at all, so
 * prose dollars are left alone.
 *
 * @param chunk - the text to scan, a protected-syntax-free slice of the block.
 * @returns the offset of the open delimiter, or -1 when every formula in the
 *   chunk is closed.
 */
export function findOpenMath(chunk: string): number {
  let i

  let char
  let next

  let closeIndex
  let closeToken

  i = 0

  while (i < chunk.length) {
    char = chunk.charAt(i)

    if (char === '\\') {
      next = chunk.charAt(i + 1)

      if (next === '(' || next === '[') {
        closeToken = next === '(' ? '\\)' : '\\]'
        closeIndex = chunk.indexOf(closeToken, i + 2)

        if (closeIndex === -1) {
          return i
        }

        i = closeIndex + closeToken.length
        continue
      }

      i += 2
      continue
    }

    if (char === '$') {
      if (chunk.charAt(i + 1) === '$') {
        closeIndex = chunk.indexOf('$$', i + 2)

        if (closeIndex === -1) {
          return i
        }

        i = closeIndex + 2
        continue
      }

      next = chunk.charAt(i + 1)

      // convertMath escapes a dollar that whitespace follows, so the parser
      // never opens maths on one: skipping it withholds nothing the settled
      // render would show as a formula.
      if (next !== '' && patterns.mathSpaceRegex.test(next)) {
        i++
        continue
      }

      closeIndex = findInlineClose(chunk, i + 1)

      if (closeIndex === -1) {
        return i
      }

      i = closeIndex + 1
      continue
    }

    i++
  }

  return -1
}

/**
 * Find the "$" that closes an inline formula.
 *
 * An escaped "$" is stepped over with its backslash, so a literal "\\$5" does
 * not close anything.
 *
 * @param chunk - the text to scan, starting just after the opening "$".
 * @param from - the offset to start scanning at.
 * @returns the offset of the closing "$", or -1 while it is still arriving.
 */
export function findInlineClose(chunk: string, from: number): number {
  let i
  let char

  for (i = from; i < chunk.length; i++) {
    char = chunk.charAt(i)

    if (char === '\\') {
      i++
      continue
    }

    if (char === '$') {
      return i
    }
  }

  return -1
}
