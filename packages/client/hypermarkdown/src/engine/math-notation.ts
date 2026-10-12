import { indexLines, terminated } from './line-index.ts'
import { patterns } from './patterns.ts'

/**
 * Normalise the notations models emit for maths onto the "$"/"$$" that
 * remark-math understands, leaving code, comments and raw HTML alone.
 * @param mdBuffer - the markdown buffer to rewrite.
 * @param blockType - the type detected for this buffer; a code block is returned
 *   untouched so its contents stay literal.
 * @returns the rewritten buffer, or the input unchanged when it is null,
 *   undefined, or a code block.
 */
export function convertMath(
  mdBuffer: string | null | undefined,
  blockType?: string,
): string | null | undefined {
  const tokens = patterns.mathProtectedRegex
  const mathSplitter = patterns.mathSplitterRegex
  const looksLikeLeft = patterns.mathLooksLeftRegex
  const looksLikeRight = patterns.mathLooksRightRegex

  if (mdBuffer == null) {
    return mdBuffer
  }

  if (blockType === 'code') {
    return mdBuffer
  } else {
    tokens.lastIndex = 0

    return mdBuffer
      .split(tokens)
      .map((chunk, i) => {
        const protectedRegion = i % 2 === 1
        return protectedRegion ? chunk : transformUnsafe(chunk)
      })
      .join('')
  }

  function transformUnsafe(text: string): string {
    // The TeX delimiters themselves are not rewritten here. `\(…\)`, `\[…\]`
    // and a same-line `$$…$$` are recognised while parsing, by the math
    // plugin's micromark extension, which can tell an escape from a delimiter
    // and knows whether it is inside a table cell or interrupting a paragraph.
    // What stays below is the part no tokenizer covers: notations that are not
    // TeX at all, and the dollars that must be kept away from maths.

    // Bracketed block "[\n … \n]" → "$$ … $$"
    text = convertBracketBlocks(text)

    text = protectOrphanDollar(text)

    text = protectNonMathDollars(text)

    return convertInlineOutsideMath(text)
  }

  /**
   * Keep an opening dollar that whitespace follows out of maths.
   *
   * Text trained on the usual maths syntax never opens a formula on "$ ", but
   * micromark-extension-math does. Left alone, a stray one in prose opens a
   * formula that runs on to the next dollar anywhere in the block — including
   * a dollar inside an inline code span, which it then swallows as formula
   * text. Only a dollar that nothing closes is rewritten, so a formula whose
   * closer is still arriving is left for the parser.
   *
   * @param text - the unprotected text to rewrite.
   * @returns the text with the orphan prose dollar escaped, when it has one.
   */
  function protectOrphanDollar(text: string): string {
    const orphan = findOrphanDollar(text)

    if (orphan === -1) {
      return text
    }

    return text.slice(0, orphan) + '\\' + text.slice(orphan)
  }

  /**
   * Offset of the single dollar that opens a formula nothing closes.
   *
   * Dollars pair left to right, and a run of two matches only another run of
   * two, so a "$$" block is stepped over whole and never reported. A dollar
   * that whitespace follows counts only as prose here: an unclosed "$ " is a
   * price or a quotation, not a formula waiting for its tail.
   *
   * @param text - the text to scan.
   * @returns the offset of the orphan dollar, or -1 when none is unclosed.
   */
  function findOrphanDollar(text: string): number {
    let i = 0

    while (i < text.length) {
      const char = text.charAt(i)

      if (char === '\\') {
        i += 2
        continue
      }

      if (char !== '$') {
        i++
        continue
      }

      const size = text.charAt(i + 1) === '$' ? 2 : 1
      const close = findDelimiterRun(text, i + size, size)

      if (close === -1) {
        return size === 1 &&
          patterns.mathSpaceRegex.test(text.charAt(i + 1))
          ? i
          : -1
      }

      i = close + size
    }

    return -1
  }

  /**
   * Offset of the next dollar run of `size` that nothing escapes.
   *
   * A run longer or shorter than the opening one is not a closer, and a dollar
   * behind a backslash is content: `$$100\$$$` closes on its final fence, not
   * on the escaped dollar inside the body.
   *
   * @param text - the text to scan.
   * @param from - the offset to start scanning at.
   * @param size - the run length the opening delimiter had.
   * @returns the offset of the matching run, or -1 when the block holds none.
   */
  function findDelimiterRun(text: string, from: number, size: number): number {
    let i = from

    while (i < text.length) {
      const char = text.charAt(i)

      if (char === '\\') {
        i += 2
        continue
      }

      if (char !== '$') {
        i++
        continue
      }

      let run = 0

      while (text.charAt(i + run) === '$') {
        run++
      }

      if (run === size) {
        return i
      }

      i += run
    }

    return -1
  }

  /**
   * Escape both dollars of every pair that is not a formula.
   *
   * The body may cross a soft line break: remark-math accepts a line ending
   * inside `$…$`, so a paragraph that opens on one price and closes on the next
   * one several lines later is read as one formula, and the prose between the
   * two amounts is rendered as its body. Only prose that fits on one line would
   * be caught if the scan stopped at the break.
   *
   * @param text - the unprotected text to rewrite.
   * @returns the text with the dollars of every non-formula pair escaped.
   */
  function protectNonMathDollars(text: string): string {
    return text.replace(
      /(?<![$\\])\$([^$]+)\$(?!\$)/g,
      (match, body, offset: number, whole: string) =>
        looksLikeDollarMath(body, whole, offset + match.length)
          ? match
          : `\\$${body}\\$`,
    )
  }

  /**
   * Whether the dollars around `body` delimit a formula.
   *
   * Maths is the exception here, not the rule: models write prices in prose,
   * and two of them around a sentence look to remark-math exactly like a
   * formula — "13.4s video → $68k GMV; … units/$270k" renders the sentence
   * between the two amounts through KaTeX, and a pair opened in one line and
   * closed three lines later takes the lines between them with it. The signals
   * below separate the two.
   *
   * @param body - the text between the two dollars.
   * @param source - the slice the pair was found in, for the character that
   *   follows the closing dollar.
   * @param after - the offset of that following character.
   * @returns true when the pair is maths and must keep its dollars.
   */
  function looksLikeDollarMath(
    body: string,
    source: string,
    after: number,
  ): boolean {
    let trimmed

    trimmed = body.trim()

    if (
      trimmed === '' ||
      /^(?:\.{3,}|…+)$/.test(trimmed) ||
      trimmed.endsWith('~')
    ) {
      return false
    }

    // A closing dollar a digit follows closes a price, not a formula: no TeX
    // run ends on the amount of the next one. This is the general form of the
    // "$2000~$5000" range above, which the trailing "~" catches first.
    if (patterns.digitRegex.test(source.charAt(after))) {
      return false
    }

    // Without a TeX escape to mark it as maths, a body carrying prose words is
    // a sentence that happens to sit between two prices.
    if (!trimmed.includes('\\') && readsAsProse(trimmed)) {
      return false
    }

    return true
  }

  /**
   * Whether a dollar-delimited body reads as a sentence fragment.
   *
   * Two or more words settle it. A single word only counts beside a leading
   * amount, which is what "→ $2.63M views …" carries and what a formula such
   * as "$F = ma$" does not.
   *
   * @param body - the trimmed body between two dollars.
   * @returns true when the body is prose rather than maths.
   */
  function readsAsProse(body: string): boolean {
    const words = body.match(/[A-Za-z]{2,}/g)

    if (words === null) {
      return false
    }

    return (
      words.length >= 2 || /(?:^|\s)\d[\d.,]*\s*[kKmM]?(?=\s)/.test(body)
    )
  }

  function convertInlineOutsideMath(text: string): string {
    mathSplitter.lastIndex = 0

    return text
      .split(mathSplitter)
      .map((seg, i) => {
        if (i % 2 === 1) return seg

        // "(( … ))" → "$…$"
        seg = seg.replace(
          /(?<!\\)\(\(\s*([\s\S]*?)\s*\)\)/g,
          (m, body, offset, str) => {
            if (offset > 0 && str.charAt(offset - 1) === ']') return m
            const before = str.slice(Math.max(0, offset - 12), offset)
            const after = str.slice(offset + m.length, offset + m.length + 12)
            if (looksLikeLeft.test(before) || looksLikeRight.test(after))
              return m
            return `$${body.trim()}$`
          },
        )

        // "( … )" with padding spaces → "$…$"
        seg = seg.replace(
          /(?<!\\)\(\s+([\s\S]*?)\s+\)/g,
          (m, body, offset, str) => {
            // a "]" before it makes this a link destination, not maths
            if (offset > 0 && str.charAt(offset - 1) === ']') return m
            const before = str.slice(Math.max(0, offset - 12), offset)
            const after = str.slice(offset + m.length, offset + m.length + 12)
            if (looksLikeLeft.test(before) || looksLikeRight.test(after))
              return m
            return `$${body.trim()}$`
          },
        )

        return seg
      })
      .join('')
  }

  /**
   * Rewrite each "[" / "]" pair that sits alone on its own line.
   *
   * The pattern this replaces led with "\\[\\s*\\r?\\n" — an ambiguous split,
   * since "\\s*" and "\\r?\\n" both match a newline — and then hunted for the
   * closing line with a lazy "[\\s\\S]*?". A run of blank lines under an
   * unclosed bracket was therefore re-read once per line. Walking the lines
   * settles both: the whitespace run is skipped once, and once no closing line
   * is left, no later bracket can find one either, so the scan is over.
   */
  function convertBracketBlocks(source: string): string {
    const lines = indexLines(source)

    let result = ''
    let pointer = 0
    let index = 0

    while (index < lines.length) {
      const open = lines[index]!

      if (!terminated(open) || !opensBracket(open.text)) {
        index++
        continue
      }

      // "\\s*" ran to the last newline of the whitespace after "[", so the
      // body starts at the first line that carries something.
      let bodyStart = index + 1

      while (bodyStart < lines.length && lines[bodyStart]!.text.trim() === '') {
        bodyStart++
      }

      let closing = bodyStart + 1

      while (closing < lines.length && !closesBracket(lines[closing]!.text)) {
        closing++
      }

      if (closing >= lines.length) {
        break
      }

      const body = source.slice(lines[bodyStart]!.start, lines[closing - 1]!.end)

      result += source.slice(pointer, open.start)
      result += looksLikeBracketMath(body)
        ? `\n$$\n${body.trim()}\n$$\n`
        : source.slice(open.start, lines[closing]!.end)

      pointer = lines[closing]!.end
      index = closing + 1
    }

    return result + source.slice(pointer)
  }

  /** "[" alone on its line, with only spaces or tabs around it. */
  function opensBracket(line: string): boolean {
    return /^[ \t]*\[[ \t]*$/.test(line)
  }

  /** The matching "]" or "\\]", likewise alone. */
  function closesBracket(line: string): boolean {
    return /^[ \t]*\\?\][ \t]*$/.test(line)
  }

  function looksLikeBracketMath(body: string): boolean {
    let trimmed

    const jsonValue = /^(?:\{|"|true\b|false\b|null\b)/
    const mathSyntax =
      /\\[A-Za-z]+|[=^_]|[A-Za-z0-9})]\s*[+*/-]\s*[A-Za-z0-9({]/

    trimmed = body.trim()

    if (trimmed === '' || jsonValue.test(trimmed)) {
      return false
    }

    return mathSyntax.test(trimmed)
  }
}
