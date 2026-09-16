/**
 * Reject CSS features the supported browser baseline cannot render.
 *
 * The web client ships to public browsers, so its stylesheets state a floor:
 * iOS/Safari 14.5, the release that carries flexbox `gap`. Below that release
 * 291 of the client's 313 `gap` blocks lose their spacing, which is why the
 * floor sits there and not at 14.0.
 *
 * A banned feature is one the floor cannot parse AND whose absence changes
 * what a reader sees. A declaration the engine drops leaves a transparent
 * surface or an unspaced row; a selector it cannot match leaves an affordance
 * that should have been hidden. Features that merely degrade — scroll chaining,
 * CJK autospacing — are not listed, because their absence costs nothing a
 * reader can name.
 *
 * `ALLOWLIST` carries the sites that predate the rule. It only shrinks: a new
 * violation fails the gate, and a removed one fails it too, so the backlog
 * cannot quietly grow or drift out of date.
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** A stylesheet count below this means the glob stopped matching the client. */
const MINIMUM_STYLESHEETS = 120

/** The supported floor, stated once for diagnostics. */
export const BASELINE = 'iOS/Safari 14.5'

/** One banned feature: how to spot it, and what the floor does instead. */
interface BannedFeature {
  /** Stable id used by the allowlist. */
  readonly id: string
  /** Matches the feature in stylesheet source. */
  readonly pattern: RegExp
  /** First release that renders it. */
  readonly since: string
  /** What a reader loses on the floor, and the supported spelling. */
  readonly remedy: string
}

const BANNED: readonly BannedFeature[] = [
  {
    id: 'color-mix',
    pattern: /\bcolor-mix\s*\(/g,
    since: 'Safari 16.2',
    remedy: 'state the resolved colour per theme in the ui-theme token sheets',
  },
  {
    id: 'has-selector',
    pattern: /:has\s*\(/g,
    since: 'Safari 15.4',
    remedy: 'carry the state the selector reads as a class or data attribute from the component',
  },
  {
    id: 'container-query',
    pattern: /@container\b/g,
    since: 'Safari 16.0',
    remedy: 'use a @media width query, or let the component own the breakpoint',
  },
  {
    id: 'container-type',
    pattern: /\bcontainer-type\s*:/g,
    since: 'Safari 16.0',
    remedy: 'resolve the width against the element\'s own percentage basis',
  },
  {
    id: 'property-registration',
    pattern: /@property\b/g,
    since: 'Safari 16.4',
    remedy: 'declare the custom property on its owning element',
  },
  {
    id: 'accent-color',
    pattern: /\baccent-color\s*:/g,
    since: 'Safari 15.4',
    remedy: 'leave the control its user-agent appearance, or draw the control',
  },
  {
    id: 'scrollbar-color',
    pattern: /\bscrollbar-color\s*:/g,
    since: 'Safari 18.2',
    remedy: 'skin ::-webkit-scrollbar-thumb, which every WebKit release honours',
  },
  {
    id: 'scrollbar-gutter',
    pattern: /\bscrollbar-gutter\s*:/g,
    since: 'unsupported in Safari',
    remedy: 'reserve the gutter with padding, or let the overlay bar float',
  },
  {
    id: 'css-nesting',
    pattern: /^\s*&[\s.:[#>+~]/gm,
    since: 'Safari 17.2',
    remedy: 'write the selector in full at the top level',
  },
]

/**
 * Sites that predate this rule, as `id path` pairs.
 *
 * Entries leave this list as each site is converted. Nothing is added: a new
 * violation is a gate failure, not an allowlist entry.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([])

/** One banned-feature occurrence. */
export interface BaselineViolation {
  readonly id: string
  readonly path: string
  readonly line: number
  readonly since: string
  readonly remedy: string
}

/**
 * Find banned features in one stylesheet.
 * @param path - repository-relative stylesheet path, used in diagnostics.
 * @param source - stylesheet text.
 * @returns every occurrence, in source order.
 */
export function findBaselineViolations(path: string, rawSource: string): BaselineViolation[] {
  const source = withoutComments(rawSource)
  const found: BaselineViolation[] = []
  found.push(...findUnpairedDynamicViewportUnits(path, source))
  found.push(...findOffScaleBreakpoints(path, source))
  for (const feature of BANNED) {
    // A fresh regex per file: the shared literals carry /g and therefore lastIndex.
    const pattern = new RegExp(feature.pattern.source, feature.pattern.flags)
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      found.push({
        id: feature.id,
        path,
        line: lineAt(source, match.index),
        since: feature.since,
        remedy: feature.remedy,
      })
    }
  }
  return found.sort((left, right) => left.line - right.line)
}

/**
 * The 1-based line holding one source offset.
 * @param source - stylesheet text.
 * @param index - offset into `source`.
 * @returns the line number a diagnostic names.
 */
function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}


/**
 * Blank out comment bodies, preserving offsets so reported lines stay true.
 *
 * A sheet's prose names the very features this gate bans — the rationale for
 * removing one is written beside the rule that replaced it — so scanning raw
 * text reports a stylesheet's own explanation as a violation.
 * @param source - stylesheet text.
 * @returns the text with every comment replaced by equivalent whitespace.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

/**
 * The responsive scale, mirroring the Aeven client's `_config.scss` steps and
 * restated for authors in `aeven-language.css`.
 *
 * A custom property cannot appear in a `@media` condition, so a sheet writes
 * the literal. Holding every sheet to these five widths is what keeps the
 * scale central without a preprocessor to substitute it.
 */
const BREAKPOINT_SCALE: readonly number[] = [1284, 1024, 768, 640, 480]

/**
 * Flag a `@media` width outside the responsive scale.
 *
 * The scale is the VIEWPORT scale, so only a `@media` condition states it. A
 * `@container` query measures the element's own box — a different axis, whose
 * condition the `container-query` entry rejects outright — so a width inside
 * its prelude is not a breakpoint and the scale has nothing to say about it.
 * @param path - repository-relative stylesheet path, used in diagnostics.
 * @param source - stylesheet text.
 * @returns every off-scale breakpoint.
 */
function findOffScaleBreakpoints(path: string, source: string): BaselineViolation[] {
  const found: BaselineViolation[] = []
  const mediaPreludes = [...source.matchAll(/@media\b[^{]*/g)]
    .map((match): readonly [number, number] => [match.index, match.index + match[0].length])
  const pattern = /\((?:max|min)-width:\s*(\d+)px\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    // The assignment in the condition narrows `match` only for the iteration
    // itself; a fresh binding is what carries that narrowing into the closure.
    const at = match.index
    const width = Number(match[1])
    if (!mediaPreludes.some(([start, end]) => at >= start && at < end)) continue
    if (BREAKPOINT_SCALE.includes(width)) continue
    found.push({
      id: 'breakpoint-off-scale',
      path,
      line: lineAt(source, at),
      since: 'n/a',
      remedy: `use one of the ${BREAKPOINT_SCALE.join(' / ')} steps named in aeven-language.css`,
    })
  }
  return found
}

/** A dynamic viewport unit inside a declared value. */
const DYNAMIC_VIEWPORT_UNIT = /\b\d*\.?\d+(?:dvh|svh|lvh)\b/

/** A static `vh` length — the value the floor can parse. */
const STATIC_VIEWPORT_UNIT = /\b\d*\.?\d+vh\b/

/** One declaration, with the block that holds it. */
interface Declaration {
  /** Property name as written; CSS properties are case-insensitive. */
  readonly property: string
  /** Declared value text. */
  readonly value: string
  /** Offset where the value starts, for reporting the line that carries it. */
  readonly valueIndex: number
  /** Offset of the `{` opening the enclosing block, or `-1` at the top level. */
  readonly blockIndex: number
}

/**
 * Read every declaration in a stylesheet, each with its enclosing block.
 *
 * Whether a dynamic unit has a fallback is a question about ONE declaration
 * block — a fallback in a sibling rule or another at-rule never reaches it — so
 * the answer needs the declarations and their block, not the text lines they
 * happen to be printed on.
 * @param source - stylesheet text, without comments.
 * @returns every declaration, in source order.
 */
function declarationsIn(source: string): Declaration[] {
  const declarations: Declaration[] = []
  const blocks: number[] = []
  const token = /(?<brace>[{};])|(?<property>[A-Za-z-]+)\s*:\s*(?<value>[^;{}]*)/g
  let end = 0
  let match: RegExpExecArray | null
  while ((match = token.exec(source)) !== null) {
    const brace = match.groups?.brace
    if (brace !== undefined) {
      if (brace === '{') blocks.push(match.index)
      else if (brace === '}') blocks.pop()
      end = match.index + 1
      continue
    }
    const property = match.groups?.property
    const value = match.groups?.value
    if (property === undefined || value === undefined) continue
    // A declaration begins where the last `{`, `}`, or `;` left off, so only
    // whitespace may precede the property. Without that guard a pseudo-class
    // (`a:hover`) reads as a declaration named `a`.
    if (source.slice(end, match.index).trim() !== '') continue
    declarations.push({
      property,
      value,
      valueIndex: match.index + match[0].indexOf(':') + 1,
      blockIndex: blocks[blocks.length - 1] ?? -1,
    })
    end = match.index + match[0].length
  }
  return declarations
}

/**
 * Flag a dynamic viewport unit no static `vh` declaration precedes.
 *
 * `dvh` is the supported spelling once it is the SECOND declaration of a pair:
 * the floor drops the declaration it cannot parse and keeps the `vh` value
 * stated before it. Only that form is a violation, so the fallback is looked up
 * among the earlier declarations of the SAME property in the SAME block — a
 * `vh` fallback written for another property, in another rule, or in the same
 * declaration as the unit itself leaves the floor with no height at all.
 * @param path - repository-relative stylesheet path, used in diagnostics.
 * @param source - stylesheet text.
 * @returns every unpaired dynamic-viewport declaration.
 */
function findUnpairedDynamicViewportUnits(path: string, source: string): BaselineViolation[] {
  const found: BaselineViolation[] = []
  const fallbacks = new Map<number, Set<string>>()
  for (const declaration of declarationsIn(source)) {
    const property = declaration.property.toLowerCase()
    const stated = fallbacks.get(declaration.blockIndex) ?? new Set<string>()
    fallbacks.set(declaration.blockIndex, stated)
    const dynamic = DYNAMIC_VIEWPORT_UNIT.exec(declaration.value)
    // A value holding both spellings is one declaration, so the floor drops it
    // whole: the fallback has to be a declaration of its own, stated first.
    if (dynamic !== null && !stated.has(property)) {
      found.push({
        id: 'viewport-unit-dvh',
        path,
        line: lineAt(source, declaration.valueIndex + dynamic.index),
        since: 'Safari 15.4',
        remedy: 'state the same property in vh before it, so the floor keeps a usable height',
      })
    }
    if (STATIC_VIEWPORT_UNIT.test(declaration.value)) stated.add(property)
  }
  return found
}

/**
 * Stylesheets the baseline governs: client package sources and the web shell.
 * Vendored sheets are excluded — they are pinned upstream copies, and
 * `vendor/README.md` owns their modification policy.
 * @returns repository-relative stylesheet paths.
 */
export function governedStylesheets(): string[] {
  return globSync(['packages/client/*/src/**/*.css', 'apps/web/src/**/*.css'], { cwd: root })
    .map(entry => entry.split('\\').join('/'))
    .filter(entry => !entry.includes('/vendor/'))
    .sort()
}

function main(): void {
  const sheets = governedStylesheets()
  if (sheets.length < MINIMUM_STYLESHEETS) {
    throw new Error(
      `verify-css-baseline: found ${String(sheets.length)} stylesheets, expected at least `
      + `${String(MINIMUM_STYLESHEETS)}; the glob no longer reaches the client`,
    )
  }

  const violations: BaselineViolation[] = []
  for (const sheet of sheets) {
    const source = readFileSync(resolve(root, sheet), 'utf8')
    violations.push(...findBaselineViolations(sheet, source))
  }

  const unlisted = violations.filter(v => !ALLOWLIST.has(`${v.id} ${v.path}`))
  const stale = [...ALLOWLIST].filter(entry => !violations.some(v => `${v.id} ${v.path}` === entry))

  if (unlisted.length === 0 && stale.length === 0) {
    process.stdout.write(
      `verify-css-baseline: ${String(sheets.length)} stylesheets hold the ${BASELINE} baseline\n`,
    )
    return
  }

  const lines: string[] = []
  if (unlisted.length > 0) {
    const byId = new Map<string, BaselineViolation[]>()
    for (const violation of unlisted) {
      const bucket = byId.get(violation.id) ?? []
      bucket.push(violation)
      byId.set(violation.id, bucket)
    }
    lines.push(`verify-css-baseline: ${String(unlisted.length)} declaration(s) below the ${BASELINE} baseline`)
    for (const [id, bucket] of [...byId].sort()) {
      const first = bucket[0] as BaselineViolation
      lines.push('', `  ${id} — needs ${first.since}; ${first.remedy}`)
      for (const violation of bucket.slice(0, 12)) {
        lines.push(`    ${violation.path}:${String(violation.line)}`)
      }
      if (bucket.length > 12) lines.push(`    … ${String(bucket.length - 12)} more`)
    }
  }
  if (stale.length > 0) {
    lines.push('', '  allowlist entries with no matching violation (delete them):')
    for (const entry of stale) lines.push(`    ${entry}`)
  }
  throw new Error(lines.join('\n'))
}

if (process.argv[1] !== undefined && relative(resolve(process.argv[1]), resolve(import.meta.filename)) === '') {
  main()
}
