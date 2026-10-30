/** Markdown flattening and incremental sentence segmentation for a reply that is still arriving. */

/** A fenced block, including an unterminated one at the end of the stream. */
const FENCE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE = /`([^`]*)`/g
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g
const LINK = /\[([^\]]*)\]\([^)]*\)/g
const HTML = /<[^>]+>/g
const HEADING = /^\s{0,3}#{1,6}\s+/gm
const QUOTE = /^\s{0,3}>\s?/gm
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/gm
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/gm
const EMPHASIS = /(\*{1,3}|_{1,3}|~~)(?=\S)([^*_~]+?)(?<=\S)\1/g
/** Markdown punctuation no reader should hear: emphasis that never closed, pipes, stray markers. */
const MARKERS = /[*_~`|]+/g
const TABLE_ROW = /^\s*\|.*\|\s*$/gm
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/gm
const SPACES = /[ \t]+/g
const BLANK_LINES = /\n{3,}/g

/**
 * Flatten assistant Markdown into the text a reader should hear.
 * Code, tables, and link targets are dropped; link labels and inline code are kept.
 * @param markdown - assistant message source.
 * @returns plain spoken text.
 */
export function toSpeechText(markdown: string): string {
  return markdown
    .replace(FENCE, '\n')
    .replace(IMAGE, ' ')
    .replace(LINK, (_match, label: string) => label)
    .replace(INLINE_CODE, (_match, code: string) => code)
    .replace(HTML, ' ')
    .replace(TABLE_RULE, '')
    .replace(TABLE_ROW, ' ')
    .replace(RULE, '')
    .replace(HEADING, '')
    .replace(QUOTE, '')
    .replace(LIST, '')
    .replace(EMPHASIS, (_match, _marker: string, inner: string) => inner)
    .replace(MARKERS, ' ')
    .replace(SPACES, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(BLANK_LINES, '\n\n')
    .trim()
}

/** Sentence end, including scripts that terminate a sentence without a following space. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)|[。！？]+["'”’）」』]*/g

/** Clause end: a natural place to start speaking before the sentence finishes. */
const CLAUSE_END = /[,;:—–]|[，、；：]/g

/** Latin abbreviations whose period does not end a sentence. */
const ABBREVIATION = /(?:^|\s)(?:[a-z]\.){2,}$|\b(?:mr|mrs|ms|dr|prof|vs|etc|approx|fig|no)\.$/i

/** Shortest spoken fragment, in characters, before a clause boundary is allowed to cut one. */
const MIN_LATIN = 12

/** Shortest spoken fragment for scripts that carry more meaning per character. */
const MIN_CJK = 4

/** Longest fragment handed to the Host before the splitter cuts at the last space. Edge needs
 * roughly 50ms per character, so a shorter cap is what shortens the wait for the first audio. */
const MAX_SEGMENT = 120

/**
 * Cut speakable fragments from the front of a growing buffer.
 * A finished sentence always ends a fragment; a clause ends one once it carries enough text to speak,
 * which is what makes the first words audible long before the sentence completes.
 * @param buffer - text not yet spoken.
 * @param minLength - shortest fragment allowed to end at a clause boundary.
 * @returns complete fragments and the unterminated remainder to keep.
 */
export function takeSegments(buffer: string, minLength: number): { segments: readonly string[]; rest: string } {
  const segments: string[] = []
  let cursor = 0
  for (const match of buffer.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length
    const candidate = buffer.slice(cursor, end).trim()
    if (candidate.length === 0) continue
    if (candidate.length < 3 || ABBREVIATION.test(candidate)) continue
    segments.push(candidate)
    cursor = end
  }
  let rest = buffer.slice(cursor)
  for (;;) {
    let cut = -1
    for (const match of rest.matchAll(CLAUSE_END)) {
      const end = match.index + match[0].length
      if (rest.slice(0, end).trim().length < minLength) continue
      if (rest.slice(end).trim().length === 0) break
      cut = end
      break
    }
    if (cut < 0) break
    segments.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut)
  }
  while (rest.length > MAX_SEGMENT) {
    const window = rest.slice(0, MAX_SEGMENT)
    const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '))
    if (cut <= 0) break
    const head = rest.slice(0, cut).trim()
    if (head !== '') segments.push(head)
    rest = rest.slice(cut + 1)
  }
  return { segments, rest }
}

/**
 * Shortest fragment allowed for a language.
 * @param language - primary subtag of the text about to be spoken.
 * @returns the character count a clause must reach before it is spoken on its own.
 */
export function minSegmentLength(language: string): number {
  return language === 'zh' ? MIN_CJK : MIN_LATIN
}
