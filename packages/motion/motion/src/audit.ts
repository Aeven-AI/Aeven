/**
 * The measured audit of a HyperFrames film: the browser script a renderer adds to the bundled composition, the
 * samples that script returns from the page, and the findings judged from them. Every renderer loads the same
 * script and the service judges its samples, so a film gets the same findings wherever it renders.
 *
 * `audit/layout-audit.browser.js` is HyperFrames' own layout audit, copied unmodified from the `hyperframes`
 * package (see `audit/README.md`); `audit/driver.browser.js` seeks the film and collects its measurements.
 * @module
 */
import { readFile } from 'node:fs/promises'

/** How much a finding matters: an error breaks a read, a warning weakens it. */
export type MotionFindingSeverity = 'error' | 'warning'

/** One measured problem in a film. */
export interface MotionFinding {
  /** Stable name of the rule, such as `text_box_overflow` or `text_below_floor`. */
  readonly code: string
  readonly severity: MotionFindingSeverity
  /** Film time the problem is first measured at, in seconds. */
  readonly seconds: number
  /** Film time the problem is last measured at, in seconds. */
  readonly untilSeconds: number
  /** CSS selector of the element, when the finding concerns one. */
  readonly selector?: string
  /** The element's text, shortened. */
  readonly text?: string
  /** What was measured and what to change. */
  readonly message: string
}

/** One layout problem the page reported at one sample. */
export interface MotionAuditIssue {
  readonly code: string
  readonly severity: string
  readonly selector: string
  readonly text: string
  readonly message: string
  readonly fixHint: string | null
}

/** One painted text element at one sample. */
export interface MotionAuditPart {
  /** Identity of the element across samples. */
  readonly key: string
  /** Identity of the reading block the element belongs to. */
  readonly block: string
  readonly selector: string
  readonly text: string
  /** Text of the whole reading block. */
  readonly blockText: string
  /** Product of the element's and its ancestors' opacity, 0 to 1. */
  readonly opacity: number
  /** Rendered font size in frame pixels, transforms applied. */
  readonly fontPx: number
  readonly captions: boolean
}

/** What the page measured at one film time. */
export interface MotionAuditSample {
  readonly time: number
  readonly issues: readonly MotionAuditIssue[]
  readonly parts: readonly MotionAuditPart[]
}

/** The page's whole answer: `window.__avnMotionAudit(times)` in `audit/driver.browser.js`. */
export interface MotionAuditSamples {
  /** Frame width in pixels. */
  readonly width: number
  /** Frame height in pixels. */
  readonly height: number
  /** Font families the composition names that the page rendered in another face. */
  readonly missingFonts: readonly { readonly family: string; readonly text: string }[]
  readonly samples: readonly MotionAuditSample[]
}

/** Thresholds of {@link summarizeAudit}. */
export interface MotionAuditRules {
  /** Smallest reading text, as a share of the frame's short side. */
  readonly typeFloorFraction: number
  /** Opacity below which text counts as too faint to read, and above which it counts as reading text. */
  readonly readOpacity: number
  /** Seconds a problem must hold before it is reported, which leaves out entrances, exits, and scene changes. */
  readonly minHeldSeconds: number
  /** Share of an element's time on screen a layout problem must cover before it is reported. */
  readonly minHeldShare: number
  /** Seconds any line needs on screen before its words. */
  readonly holdBaseSeconds: number
  /** Further seconds a line needs per word. */
  readonly holdPerWordSeconds: number
  /** Most findings returned; errors come first. */
  readonly maxFindings: number
}

/**
 * Layout problems of the upstream audit that concern text a viewer reads. Its other codes judge boxes, video
 * mattes, and diagram connectors, and a photo scaled past the frame for a slow push trips them by design.
 */
const TEXT_LAYOUT_CODES: ReadonlySet<string> = new Set([
  'clipped_text', 'text_box_overflow', 'text_occluded', 'text_not_painted', 'content_overlap', 'canvas_overflow',
])

/** Layout problems a reveal mask that is too tight for its glyphs produces. */
const CLIP_CODES: ReadonlySet<string> = new Set(['clipped_text', 'text_box_overflow'])

/** What to change when the clipping box is a reveal mask. */
const MASK_HINT = 'When the box is a reveal mask with overflow hidden, give it padding of at least 0.15em on the clipped side and the same negative margin, and keep line-height at 1.05 or more.'

/** Most elements one grouped finding names. */
const MAX_LISTED = 12

const SCRIPT_FILES = ['layout-audit.browser.js', 'driver.browser.js'] as const

let script: Promise<string> | undefined

/**
 * The browser script that defines `window.__avnMotionAudit(times)`.
 * @returns the script's source, read once per process.
 */
export function motionAuditScript(): Promise<string> {
  script ??= Promise.all(SCRIPT_FILES.map(file => readFile(new URL(`../audit/${file}`, import.meta.url), 'utf8')))
    .then(parts => parts.join('\n'))
  return script
}

/**
 * Add the audit script to a bundled composition document.
 * @param html - the document {@link MotionRenderer.bundle} returns.
 * @returns the document with the script as its body's last element.
 */
export async function withMotionAuditScript(html: string): Promise<string> {
  // A literal closing tag inside the source would end the inline script early.
  const element = `<script>${(await motionAuditScript()).replaceAll('</script', '<\\/script')}</script>`
  const close = html.lastIndexOf('</body>')
  return close === -1 ? `${html}${element}` : `${html.slice(0, close)}${element}${html.slice(close)}`
}

/**
 * Evenly spaced audit times through a film, each at the middle of its step.
 * @param durationSeconds - film length.
 * @param stepSeconds - wanted distance between samples.
 * @param maxSamples - most samples; a longer film widens the step.
 * @returns the times, rounded to milliseconds.
 */
export function motionAuditTimes(durationSeconds: number, stepSeconds: number, maxSamples: number): number[] {
  const count = Math.max(1, Math.min(maxSamples, Math.round(durationSeconds / stepSeconds)))
  return Array.from({ length: count }, (_, index) => Math.round((index + 0.5) * durationSeconds / count * 1000) / 1000)
}

/** Runs of consecutive sample indices, as inclusive `[first, last]` pairs. */
function runs(indices: readonly number[]): [number, number][] {
  const found: [number, number][] = []
  for (const index of [...indices].sort((a, b) => a - b)) {
    const last = found.at(-1)
    if (last !== undefined && index === last[1] + 1) last[1] = index
    else found.push([index, index])
  }
  return found
}

/** The longest run of consecutive sample indices. */
function longestRun(indices: readonly number[]): [number, number] | undefined {
  return runs(indices).reduce<[number, number] | undefined>(
    (best, run) => best === undefined || run[1] - run[0] > best[1] - best[0] ? run : best, undefined)
}

/** Words a viewer reads in a text; a script written without spaces counts two characters as a word. */
function readingWords(text: string): number {
  const spaced = text.match(/[\p{L}\p{M}\p{N}%$]+/gu) ?? []
  const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
  const wordsIn = (run: string): number => Array.from(segmenter.segment(run)).filter(segment => segment.isWordLike === true).length
  return spaced.reduce((count, word) => count + (unspaced.test(word) ? Math.max(1, wordsIn(word)) : 1), 0)
}

const seconds = (value: number): string => `${value.toFixed(2)} s`
const round = (value: number): number => Math.round(value * 1000) / 1000

/**
 * Judge the page's samples.
 * @param audit - what `window.__avnMotionAudit` returned.
 * @param durationSeconds - film length.
 * @param rules - thresholds.
 * @returns the findings, errors first and then in film order, at most `rules.maxFindings`.
 */
export function summarizeAudit(audit: MotionAuditSamples, durationSeconds: number, rules: MotionAuditRules): MotionFinding[] {
  const samples = [...audit.samples].sort((a, b) => a.time - b.time)
  const step = samples.length > 1 ? ((samples.at(-1)?.time ?? 0) - (samples[0]?.time ?? 0)) / (samples.length - 1) : durationSeconds
  const timeAt = (index: number): number => samples[index]?.time ?? 0
  // A run seen at n samples was on screen for about n steps.
  const held = (run: readonly [number, number]): number => (run[1] - run[0] + 1) * step
  const findings: MotionFinding[] = []

  for (const font of audit.missingFonts) {
    findings.push({
      code: 'font_missing',
      severity: 'error',
      seconds: 0,
      untilSeconds: round(durationSeconds),
      text: font.text,
      message: `The font "${font.family}" did not load, so its text renders in a fallback face with other widths. Use a family Google Fonts serves under exactly that name, or add an @font-face rule for a file in assets/fonts/.`,
    })
  }

  // Layout problems: where each element is on screen, and where each problem holds.
  const present = new Map<string, Set<number>>()
  const problems = new Map<string, { issue: MotionAuditIssue; at: number[] }>()
  samples.forEach((sample, index) => {
    for (const part of sample.parts) {
      const seen = present.get(part.selector) ?? new Set<number>()
      seen.add(index)
      present.set(part.selector, seen)
    }
    for (const issue of sample.issues) {
      if (!TEXT_LAYOUT_CODES.has(issue.code)) continue
      const key = `${issue.code}\u0000${issue.selector}`
      const problem = problems.get(key) ?? { issue, at: [] }
      if (problem.at.at(-1) !== index) problem.at.push(index)
      problems.set(key, problem)
    }
  })
  for (const { issue, at } of problems.values()) {
    const run = longestRun(at)
    if (run === undefined || held(run) < rules.minHeldSeconds || run[0] === run[1]) continue
    const onScreen = new Set([...present.get(issue.selector) ?? [], ...at])
    if (at.length / onScreen.size < rules.minHeldShare) continue
    findings.push({
      code: issue.code,
      severity: issue.severity === 'error' ? 'error' : 'warning',
      seconds: round(timeAt(run[0])),
      untilSeconds: round(timeAt(run[1])),
      selector: issue.selector,
      ...issue.text === '' ? {} : { text: issue.text },
      message: [issue.message, ...issue.fixHint === null ? [] : [issue.fixHint], ...CLIP_CODES.has(issue.code) ? [MASK_HINT] : []].join(' '),
    })
  }

  // Type size and opacity, per element.
  const floorPx = Math.round(rules.typeFloorFraction * Math.min(audit.width, audit.height))
  const small = new Map<string, { part: MotionAuditPart; at: number[] }>()
  const faint = new Map<string, { part: MotionAuditPart; at: number[] }>()
  const note = (into: Map<string, { part: MotionAuditPart; at: number[] }>, part: MotionAuditPart, index: number): void => {
    const entry = into.get(part.key) ?? { part, at: [] }
    entry.at.push(index)
    into.set(part.key, entry)
  }
  samples.forEach((sample, index) => {
    for (const part of sample.parts) {
      if (part.captions || readingWords(part.text) === 0) continue
      if (part.opacity < rules.readOpacity) note(faint, part, index)
      else if (part.fontPx < floorPx - 0.5) note(small, part, index)
    }
  })
  // One finding per rule: a film's labels usually share a size, and one line each would bury the errors.
  const grouped = (
    entries: Iterable<{ part: MotionAuditPart; at: number[] }>,
    keep: (entry: { part: MotionAuditPart; at: number[] }, run: [number, number]) => boolean,
    describe: (part: MotionAuditPart) => string,
  ): { first: number; last: number; items: string[] } | undefined => {
    const items: { time: number; label: string }[] = []
    let first = Number.POSITIVE_INFINITY
    let last = 0
    for (const entry of entries) {
      const run = longestRun(entry.at)
      if (run === undefined || held(run) < rules.minHeldSeconds || !keep(entry, run)) continue
      first = Math.min(first, timeAt(run[0]))
      last = Math.max(last, timeAt(run[1]))
      items.push({ time: timeAt(run[0]), label: `${JSON.stringify(entry.part.text)} ${describe(entry.part)} (${entry.part.selector})` })
    }
    if (items.length === 0) return undefined
    const labels = items.sort((a, b) => a.time - b.time).map(item => item.label)
    const shown = labels.slice(0, MAX_LISTED)
    return { first, last, items: labels.length > shown.length ? [...shown, `and ${String(labels.length - shown.length)} more`] : shown }
  }
  const smallText = grouped(small.values(), () => true, part => `at ${String(Math.round(part.fontPx))} px`)
  if (smallText !== undefined) {
    findings.push({
      code: 'text_below_floor',
      severity: 'warning',
      seconds: round(smallText.first),
      untilSeconds: round(smallText.last),
      message: `Reading text needs at least ${String(floorPx)} px here (${(rules.typeFloorFraction * 100).toFixed(1)}% of the frame's short side, what a phone shows legibly). Under it: ${smallText.items.join('; ')}. Enlarge each or cut it.`,
    })
  }
  // Text that is faint on every sample it appears at is styled faint; text fading in or out is not.
  const faintText = grouped(faint.values(), entry => entry.at.length >= (present.get(entry.part.selector)?.size ?? 0),
    part => `at ${String(Math.round(part.opacity * 100))}% opacity`)
  if (faintText !== undefined) {
    findings.push({
      code: 'text_faint',
      severity: 'warning',
      seconds: round(faintText.first),
      untilSeconds: round(faintText.last),
      message: `Text meant to be read needs at least ${String(Math.round(rules.readOpacity * 100))}% opacity. Under it: ${faintText.items.join('; ')}. Raise each or cut it.`,
    })
  }

  // Reading time, per block of text.
  const blocks = new Map<string, { part: MotionAuditPart; at: Set<number> }>()
  samples.forEach((sample, index) => {
    for (const part of sample.parts) {
      if (part.captions || part.opacity < rules.readOpacity || part.fontPx < floorPx - 0.5) continue
      const block = blocks.get(part.block) ?? { part, at: new Set<number>() }
      block.at.add(index)
      blocks.set(part.block, block)
    }
  })
  for (const { part, at } of blocks.values()) {
    const run = longestRun([...at])
    const words = readingWords(part.blockText)
    if (run === undefined || words === 0) continue
    const needed = rules.holdBaseSeconds + rules.holdPerWordSeconds * words
    // One step of slack: a line seen at n samples may have been up for a step less.
    if (held(run) + step >= needed) continue
    findings.push({
      code: 'line_unread',
      severity: 'warning',
      seconds: round(timeAt(run[0])),
      untilSeconds: round(timeAt(run[1])),
      selector: part.selector,
      text: part.blockText,
      message: `Readable for about ${seconds(held(run))}; ${String(words)} word${words === 1 ? '' : 's'} need ${seconds(needed)} (${seconds(rules.holdBaseSeconds)} plus ${seconds(rules.holdPerWordSeconds)} a word). Hold it longer or shorten the line.`,
    })
  }

  const rank = (finding: MotionFinding): number => finding.severity === 'error' ? 0 : 1
  return findings.sort((a, b) => rank(a) - rank(b) || a.seconds - b.seconds).slice(0, rules.maxFindings)
}
