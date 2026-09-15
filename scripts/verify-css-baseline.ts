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
export function findBaselineViolations(path: string, source: string): BaselineViolation[] {
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
        line: source.slice(0, match.index).split('\n').length,
        since: feature.since,
        remedy: feature.remedy,
      })
    }
  }
  return found.sort((left, right) => left.line - right.line)
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
 * @param path - repository-relative stylesheet path, used in diagnostics.
 * @param source - stylesheet text.
 * @returns every off-scale breakpoint.
 */
function findOffScaleBreakpoints(path: string, source: string): BaselineViolation[] {
  const found: BaselineViolation[] = []
  const pattern = /\((?:max|min)-width:\s*(\d+)px\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const width = Number(match[1])
    if (BREAKPOINT_SCALE.includes(width)) continue
    found.push({
      id: 'breakpoint-off-scale',
      path,
      line: source.slice(0, match.index).split('\n').length,
      since: 'n/a',
      remedy: `use one of the ${BREAKPOINT_SCALE.join(' / ')} steps named in aeven-language.css`,
    })
  }
  return found
}

/**
 * Flag a dynamic viewport unit that no static `vh` declaration precedes.
 *
 * `dvh` is the supported spelling once it is the SECOND of a pair: the floor
 * keeps the `vh` value it can parse and later releases override it. A lone
 * `dvh` leaves the floor with no height at all, so only that form is a
 * violation.
 * @param path - repository-relative stylesheet path, used in diagnostics.
 * @param source - stylesheet text.
 * @returns every unpaired dynamic-viewport declaration.
 */
function findUnpairedDynamicViewportUnits(path: string, source: string): BaselineViolation[] {
  const lines = source.split('\n')
  const found: BaselineViolation[] = []
  for (const [index, line] of lines.entries()) {
    if (!/\b\d*\.?\d+(?:dvh|svh|lvh)\b/.test(line)) continue
    const property = line.match(/^\s*([a-z-]+)\s*:/)?.[1]
    const previous = lines[index - 1] ?? ''
    const paired = property !== undefined
      && new RegExp(`^\\s*${property}\\s*:`).test(previous)
      && /\b\d*\.?\d+vh\b/.test(previous)
    if (paired) continue
    found.push({
      id: 'viewport-unit-dvh',
      path,
      line: index + 1,
      since: 'Safari 15.4',
      remedy: 'declare the same property in vh on the line above, so the floor keeps a usable height',
    })
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
