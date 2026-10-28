/**
 * Render the Chinese counterpart of a generated English page so a regeneration
 * never leaves the pair structurally stale. The committed pair is a line
 * translation memory: identical lines that occur once on each side anchor the
 * alignment; between two anchors, lines pair by shape (block marker, code
 * spans, link targets), and equal-length unmatched runs pair by position. A
 * new English line takes its recorded translation when its exact text
 * was translated before, and otherwise appears in English until translated.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Write a generated English page and, when its `.zh.md` counterpart exists,
 * the Chinese page rendered from the committed pair.
 * @param path - absolute path of the English page.
 * @param content - the freshly generated English page.
 */
export function writePairedPage(path: string, content: string): void {
  const zhPath = path.replace(/\.md$/u, '.zh.md')
  if (zhPath !== path && existsSync(zhPath)) {
    const oldEn = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeFileSync(zhPath, renderPairedZh(oldEn, readFileSync(zhPath, 'utf8'), content))
  }
  writeFileSync(path, content)
}

/** The language switcher line every Chinese page carries below its title. */
const SWITCHER = /^\[English\]\([^)]*\) \| 中文$/u

/** Gap sizes above this product skip the quadratic LCS and stay unpaired. */
const MAX_GAP_CELLS = 4_000_000

/**
 * Render the Chinese page for a regenerated English page.
 * @param oldEn - the committed English page, or `''` when none exists.
 * @param oldZh - the committed Chinese page.
 * @param newEn - the freshly generated English page.
 * @returns the Chinese page, line-aligned with `newEn` plus the switcher.
 */
export function renderPairedZh(oldEn: string, oldZh: string, newEn: string): string {
  const zhLines = oldZh.split('\n')
  const switcherAt = zhLines.findIndex(line => SWITCHER.test(line))
  // The switcher and the blank line after it have no English counterpart.
  const switcher = switcherAt === -1 ? [] : zhLines.splice(switcherAt, 2)
  const memory = translationMemory(oldEn.split('\n'), zhLines)
  const out = newEn.split('\n').map(line => memory.get(line) ?? line)
  if (switcherAt !== -1) out.splice(Math.min(switcherAt, out.length), 0, ...switcher)
  return out.join('\n')
}

/**
 * Pair each translated English line with its Chinese line.
 * @param en - committed English lines.
 * @param zh - committed Chinese lines without the switcher.
 * @returns English line to Chinese line; the first pairing of a line wins.
 */
function translationMemory(en: readonly string[], zh: readonly string[]): Map<string, string> {
  const memory = new Map<string, string>()
  const enShapes = en.map(shape)
  const zhShapes = zh.map(shape)
  const record = (x: number, y: number): void => {
    const source = en[x] as string
    if (source === '' || memory.has(source)) return
    // A translated heading keeps the explicit anchor that preserves its English slug.
    const anchor = zh[y - 2]
    const anchored = /^#{1,6} /u.test(source) && zh[y - 1] === '' && anchor !== undefined
      && /^<a id="[^"]+"><\/a>$/u.test(anchor) && en[x - 2] !== anchor
    memory.set(source, anchored ? `${anchor}\n\n${zh[y] as string}` : zh[y] as string)
  }
  /** Pair lines of matching shape, then pair each equal-length unmatched run by position. */
  const pairGap = (i0: number, i1: number, j0: number, j1: number): void => {
    let i = i0
    let j = j0
    for (const [x, y] of [...lcs(enShapes, zhShapes, i0, i1, j0, j1), [i1, j1] as const]) {
      if (x - i === y - j) for (let k = 0; k < x - i; k += 1) record(i + k, j + k)
      if (x < i1) record(x, y)
      i = x + 1
      j = y + 1
    }
  }
  let i = 0
  let j = 0
  for (const [ai, bj] of [...uniqueAnchors(en, zh), [en.length, zh.length] as const]) {
    pairGap(i, ai, j, bj)
    i = ai + 1
    j = bj + 1
  }
  return memory
}

/**
 * The language-neutral shape of a Markdown line: its block marker plus the
 * code spans and link targets a translation keeps verbatim. A table row is
 * keyed by its cell count and first cell's code spans.
 * @param line - one Markdown line.
 * @returns a key equal for a line and its translation.
 */
function shape(line: string): string {
  if (line.trim() === '') return ''
  const marker = /^\s*(#{1,6} |[-*] |\d+\. |\||>|<!--|```)/u.exec(line)?.[1] ?? 'p'
  const kept = (text: string): string[] => (text.match(/`[^`]+`|\]\([^)]*\)/gu) ?? [])
    .map(span => span.replace(/\.zh\.md\b/u, '.md'))
  if (marker === '|') {
    const cells = line.split(/(?<!\\)\|/u)
    return ['|', cells.length, ...kept(cells[1] ?? '')].join('\u0000')
  }
  return [marker, ...kept(line)].join('\u0000')
}

/** Identical lines occurring exactly once on each side, reduced to an ascending chain. */
function uniqueAnchors(a: readonly string[], b: readonly string[]): Array<readonly [number, number]> {
  const counts = new Map<string, { a: number; b: number; bIndex: number }>()
  a.forEach((line) => {
    const entry = counts.get(line) ?? { a: 0, b: 0, bIndex: -1 }
    entry.a += 1
    counts.set(line, entry)
  })
  b.forEach((line, index) => {
    const entry = counts.get(line)
    if (entry === undefined) return
    entry.b += 1
    entry.bIndex = index
  })
  const candidates: Array<readonly [number, number]> = []
  a.forEach((line, index) => {
    const entry = counts.get(line)
    if (entry?.a === 1 && entry.b === 1) candidates.push([index, entry.bIndex])
  })
  return longestIncreasingByB(candidates)
}

/** Longest subsequence of `pairs` (ascending in a) that is also ascending in b. */
function longestIncreasingByB(pairs: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
  const tails: number[] = []
  const previous: number[] = []
  pairs.forEach(([, bj], index) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if ((pairs[tails[mid] as number] as readonly [number, number])[1] < bj) low = mid + 1
      else high = mid
    }
    previous[index] = low > 0 ? tails[low - 1] as number : -1
    tails[low] = index
  })
  const chain: Array<readonly [number, number]> = []
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index] as number) {
    chain.push(pairs[index] as readonly [number, number])
  }
  return chain.reverse()
}

/** LCS of `a[aStart, aEnd)` and `b[bStart, bEnd)` as ascending index pairs. */
function lcs(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): Array<readonly [number, number]> {
  const n = aEnd - aStart
  const m = bEnd - bStart
  if (n === 0 || m === 0 || n * m > MAX_GAP_CELLS) return []
  const table = new Uint32Array((n + 1) * (m + 1))
  for (let x = n - 1; x >= 0; x -= 1) {
    for (let y = m - 1; y >= 0; y -= 1) {
      table[x * (m + 1) + y] = a[aStart + x] === b[bStart + y]
        ? (table[(x + 1) * (m + 1) + y + 1] as number) + 1
        : Math.max(table[(x + 1) * (m + 1) + y] as number, table[x * (m + 1) + y + 1] as number)
    }
  }
  const pairs: Array<readonly [number, number]> = []
  let x = 0
  let y = 0
  while (x < n && y < m) {
    if (a[aStart + x] === b[bStart + y]) {
      pairs.push([aStart + x, bStart + y])
      x += 1
      y += 1
    } else if ((table[(x + 1) * (m + 1) + y] as number) >= (table[x * (m + 1) + y + 1] as number)) {
      x += 1
    } else {
      y += 1
    }
  }
  return pairs
}
