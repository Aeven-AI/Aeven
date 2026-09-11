import { patterns } from '../patterns.ts'

/**
 * Reading the shape of a list out of its source.
 *
 * A streaming list is re-examined on every chunk, so these answer from the
 * buffer alone and never hold state of their own.
 * @param md - the list block source to examine.
 * @returns true when the buffer is a single top-level list of more than one
 *   item whose items all share one marker family, so its settled items can be
 *   cached and only the last one re-parsed.
 */
export function listCacheable(md: string): boolean {
  let i
  let line
  let lines
  let marker
  let indent
  let baseIndent
  let itemCount

  lines = md.split(patterns.lineSplitRegex)

  marker = null
  baseIndent = null
  itemCount = 0

  for (i = 0; i < lines.length; i++) {
    line = lines[i]!

    if (line.trim() === '') {
      continue
    }

    indent = line.match(patterns.listIndentOnlyRegex)![0].length

    if (baseIndent === null) {
      if (!patterns.listItemRegex.test(line)) {
        return false
      }
      baseIndent = indent
    }

    if (patterns.listItemRegex.test(line) && indent <= baseIndent) {
      if (marker === null) {
        marker = listMarkerFamily(line)
      } else if (listMarkerFamily(line) !== marker) {
        return false
      }

      itemCount++
    } else if (indent <= baseIndent) {
      return false
    }
  }

  return itemCount > 1
}

// "-" and "*" start different lists; "1." and "1)" likewise.

/**
 * The family a list marker belongs to.
 *
 * Callers compare families rather than raw markers, so the ordered spelling
 * keeps the delimiter that follows the number while the bullet spelling keeps
 * the bullet character itself.
 * @param line - one source line of a list block.
 * @returns the marker family, such as `bullet-` or `ordered.`, or null when the
 *   line carries no list marker.
 */
export function listMarkerFamily(line: string): string | null {
  let match

  match = line.match(patterns.listMarkerRegex)

  if (!match) {
    return null
  }

  if (/\d/.test(match[1]!)) {
    return 'ordered' + match[1]!.slice(-1)
  }

  return 'bullet' + match[1]!
}

// Split a list block into its top-level items. A deeper marker is a nested
// list and stays with the item above it.

/**
 * Split a list block into its top-level items.
 *
 * Items keep their own source text, continuation lines included, because
 * listMarkerFamily() reads the marker off the first line and the cache compares
 * an item's text to decide whether it has to be re-rendered.
 * @param md - the list block source to split.
 * @returns one source string per top-level item, in document order.
 */
export function listItems(md: string): string[] {
  let i
  let line
  let lines
  let items: string[]
  let indent
  let current: string | null
  let baseIndent

  lines = md.split(patterns.lineSplitRegex)

  items = []
  current = null
  baseIndent = null

  for (i = 0; i < lines.length; i++) {
    line = lines[i]!
    indent = line.match(patterns.listIndentOnlyRegex)![0].length

    if (patterns.listItemRegex.test(line) && baseIndent === null) {
      baseIndent = indent
    }

    if (

      patterns.listItemRegex.test(line) &&
      baseIndent !== null &&
      indent <= baseIndent
    ) {
      if (current !== null) {
        items.push(current)
      }
      current = line
    } else if (current !== null) {
      current += '\n' + line
    }
  }

  if (current !== null) {
    items.push(current)
  }

  return items
}

// Footnote definitions render nothing where they are written: the notes are
// gathered separately and emitted as one section at the end. A block holding
// only definitions therefore parses to an empty result, and on a long note
// list that same block is re-parsed on every chunk for no output at all.
