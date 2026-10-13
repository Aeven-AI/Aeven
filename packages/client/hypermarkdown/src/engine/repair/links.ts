import { patterns } from '../patterns.ts'

/**
 * Withhold a link whose syntax has not finished arriving.
 *
 * Splitting on protected code, autolinks and HTML first keeps their contents
 * out of the scan. From the earliest offset that begins a link which cannot
 * render yet, the rest of the block is cut away, because what follows would be
 * parsed as part of the same construct — a half-typed destination would
 * otherwise stream as raw markup and GFM would autolink the truncated address.
 *
 * @param text - the block text being scanned for an unfinished link.
 * @param pending - whether the block is still being streamed; a closed block
 *   is returned unchanged.
 * @returns the text up to the unfinished link, or the text itself when every
 *   link in it can render already.
 */
export function fixLinkRefs(text: string, pending: boolean): string {
  let i

  let chunk
  let chunks

  let offset
  let openIndex
  let linkIndex

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
      linkIndex = findOpenLink(chunk, i === chunks.length - 1, text)

      if (linkIndex !== -1) {
        openIndex = offset + linkIndex
      }
    }

    offset += chunk.length
  }

  if (openIndex === -1) {
    return text
  }

  return text.substring(0, openIndex)
}

/**
 * Find the first offset at which a link has begun but cannot yet be rendered.
 *
 * A "<" with no ">" yet holds its whole construct back, a "[" with no "]"
 * likewise, and once the brackets close the character after them decides:
 * "(" means the destination must close too, "[" means the reference label must
 * already be defined. A construct cut off by the end of the chunk is reported
 * only when the chunk is the tail of the text, since a later chunk may
 * complete it.
 *
 * @param chunk - the text to scan, a protected-syntax-free slice of the block.
 * @param isTail - whether this chunk ends the whole text, so an unterminated
 *   construct here really is unterminated.
 * @param fullText - the whole block, searched for reference definitions.
 * @returns the offset of the unfinished construct, or -1 when the chunk holds
 *   only complete links and text.
 */
export function findOpenLink(
  chunk: string,
  isTail: boolean,
  fullText: string,
): number {
  let i
  let char
  let next
  let start
  let label
  let labelEnd
  let closeIndex

  i = 0

  while (i < chunk.length) {
    char = chunk.charAt(i)

    if (char === '\\') {
      i += 2
      continue
    }

    // "<" opens either an angle autolink or raw HTML. Both read as stray
    // markup until the ">" lands, and GFM autolinks the half-typed URL
    // inside an unfinished one, so hold the whole construct back.
    if (char === '<') {
      next = chunk.charAt(i + 1)

      if (next !== '' && ! patterns.angleOpenRegex.test(next)) {
        i++
        continue
      }

      closeIndex = findUnescaped(chunk, '>', i + 1)

      if (closeIndex === -1) {
        return  isTail ? i : -1
      }

      i = closeIndex + 1
      continue
    }

    if (char !== '[') {
      i++
      continue
    }

    start = i

    if (i > 0 && chunk.charAt(i - 1) === '!') {
      start = i - 1
    }

    closeIndex = findUnescaped(chunk, ']', i + 1)

    if (closeIndex === -1) {
      return start
    }

    // What follows "]" decides whether these brackets are a link at all,
    // so one character past it is still undecided.
    if (closeIndex + 1 >= chunk.length) {
      return  isTail ? start : -1
    }

    char = chunk.charAt(closeIndex + 1)

    if (char === '(') {
      closeIndex = findClosingParen(chunk, closeIndex + 2)

      if (closeIndex === -1) {
        return start
      }

      i = closeIndex + 1
      continue
    }

    if (char === '[') {
      labelEnd = findUnescaped(chunk, ']', closeIndex + 2)

      if (labelEnd === -1) {
        return start
      }

      // A reference link is only a link once its definition has arrived;
      // until then it would stream as "[text][label]". Holding it back
      // also holds back what follows, so a reference whose definition
      // never comes keeps the rest of the block waiting until the block
      // closes — at which point everything renders.
      label = chunk.substring(closeIndex + 2, labelEnd)

      if (!hasDefinition(fullText, label)) {
        return start
      }

      i = labelEnd + 1
      continue
    }

    i = closeIndex + 1
  }

  return -1
}

/**
 * Whether a reference link label is defined in the document.
 *
 * Labels are case-insensitive, so the comparison is case-folded, and the
 * definition must carry a destination: a bare "[label]:" still leaves the link
 * with nowhere to point, and remark keeps the whole thing as text. A
 * definition on the last line is ignored, because that line is still being
 * written and only resolves once it has ended.
 *
 * @param fullText - the whole block, definitions and all.
 * @param label - the reference label, as it appeared between the second pair
 *   of brackets.
 * @returns true when a usable definition for the label has already arrived.
 */
export function hasDefinition(fullText: string, label: string): boolean {
  let i
  let line
  let lines
  let needle

  needle = '[' + label.trim().toLowerCase() + ']:'
  lines = fullText.split('\n')

  for (i = 0; i < lines.length; i++) {
    line = lines[i]!.trim()

    // The destination has to be there too, or the link still has nowhere
    // to point and remark leaves the whole thing as text.
    if (line.toLowerCase().indexOf(needle) === 0) {
      // The last line is still being written; remark only resolves a
      // definition once the line that holds it has ended.
      if (i === lines.length - 1) {
        continue
      }

      if (line.substring(needle.length).trim() !== '') {
        return true
      }
    }
  }

  return false
}

/**
 * Find the first occurrence of a character that is not backslash-escaped.
 *
 * An escaped character is stepped over together with the backslash in front of
 * it, so "\\]" closes nothing.
 *
 * @param chunk - the text to scan.
 * @param target - the character being looked for, such as "]" or ">".
 * @param from - the offset to start scanning at.
 * @returns the offset of the first unescaped occurrence, or -1 when the text
 *   holds none.
 */
export function findUnescaped(
  chunk: string,
  target: string,
  from: number,
): number {
  let i
  let char

  for (i = from; i < chunk.length; i++) {
    char = chunk.charAt(i)

    if (char === '\\') {
      i++
      continue
    }

    if (char === target) {
      return i
    }
  }

  return -1
}

/**
 * Find the ")" that closes a link destination.
 *
 * Destinations may contain balanced parens, as in "/path(inner)", so depth is
 * counted from one rather than stopping at the first ")", and an escaped
 * character is stepped over with its backslash.
 *
 * @param chunk - the text to scan, starting just inside the opening paren.
 * @param from - the offset to start scanning at.
 * @returns the offset of the matching ")", or -1 while it is still arriving.
 */
export function findClosingParen(chunk: string, from: number): number {
  let i
  let char
  let depth

  depth = 1

  for (i = from; i < chunk.length; i++) {
    char = chunk.charAt(i)

    if (char === '\\') {
      i++
      continue
    }

    if (char === '(') {
      depth++
      continue
    }

    if (char === ')') {
      depth--

      if (depth === 0) {
        return i
      }
    }
  }

  return -1
}
