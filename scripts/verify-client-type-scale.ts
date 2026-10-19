/**
 * Reject pixel type sizes in Client stylesheets.
 *
 * The client's typographic base is the document root font-size: the reader's
 * Font size setting moves it (12–17px, default 16), and every `rem` below it
 * follows. A `font-size: 14px` — or a `line-height` in px, or a `--dsw-font-*`
 * token carrying px — opts one element out of that, so an interface set to 17px
 * keeps a 14px island. Type is therefore stated in `rem`; pixels remain for
 * borders, spacing, shadows and media queries, which do not follow the text.
 *
 * A deliberate exception states itself on the line: `/* type-scale-allow: why *\/`.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Source roots whose CSS is graded: the browser client and its API client halves. */
const SOURCE_GLOBS = ['packages/client/*/src/**/*.css', 'packages/api/*/src/**/*.css']

/** Minimum sheet count, so a broken glob cannot pass by finding nothing. */
const MINIMUM_SHEETS = 90

/** A type declaration whose value is stated in pixels. */
export interface TypeScaleViolation {
  /** Repository-relative path. */
  file: string
  /** One-based source line. */
  line: number
  /** The offending declaration, trimmed. */
  text: string
}

/** `font-size`, `line-height`, and the type half of a `font:` shorthand. */
const TYPE_DECLARATION = /(?:^|[;{\s])(font-size|line-height|font)\s*:\s*([^;}]*)/g

/**
 * A custom property that carries type under another name: the design system's
 * font tokens, row line boxes, and component-local type scales. Names without a
 * type word (`--avn-control-size`) are geometry and stay in pixels.
 */
const FONT_TOKEN = new RegExp(
  '(--(?:[a-z0-9-]*-(?:font|leading|line-height|type-size)|[a-z0-9-]*-font-[a-z0-9-]+'
  + '|dsw-font-[a-z0-9-]+))\\s*:\\s*([^;}]*)',
  'g',
)

/** Any pixel length inside a type value. */
const PIXEL = /(?<![\w.-])\d*\.?\d+px(?![\w-])/

/** A media query condition states a viewport width, not type. */
const CONDITION = /@(media|supports|container)\b/

/** Whether a line asks to be excused, with its reason. */
const ALLOW = /\/\*\s*type-scale-allow:\s*\S.*\*\//i

/**
 * Remove comment prose, keeping the line structure: a comment that mentions
 * `font: 14px` describes a rule, it is not one.
 * @param css - stylesheet text.
 * @returns the same text with comment bodies blanked.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

/**
 * Grade one stylesheet's text.
 * @param file - repository-relative path, reported in each violation.
 * @param css - stylesheet text.
 * @returns every type declaration stated in pixels.
 */
export function findTypeScaleViolations(file: string, css: string): TypeScaleViolation[] {
  const violations: TypeScaleViolation[] = []

  const raw = css.split('\n')
  withoutComments(css).split('\n').forEach((text, index) => {
    if (ALLOW.test(raw[index] ?? '')) return
    const condition = CONDITION.test(text)
    const matches = [
      ...text.matchAll(TYPE_DECLARATION),
      ...text.matchAll(FONT_TOKEN),
    ].filter(match => !(condition && (match[2] ?? '').includes('(')) && PIXEL.test(match[2] ?? ''))

    for (const match of matches) {
      violations.push({ file, line: index + 1, text: match[0].trim() })
    }
  })

  return violations
}

/**
 * Grade every graded stylesheet in the repository.
 * @returns the violations, and how many sheets were read.
 */
export function scanTypeScale(): { violations: TypeScaleViolation[]; sheets: number } {
  const files = SOURCE_GLOBS.flatMap(pattern => globSync(pattern, { cwd: root }))
  const violations: TypeScaleViolation[] = []

  for (const file of files) {
    const css = readFileSync(resolve(root, file), 'utf8')
    violations.push(...findTypeScaleViolations(file, css))
  }

  return { violations, sheets: files.length }
}

/**
 * Report the gate's outcome and exit with its status.
 * @returns never, on either path.
 */
function main(): void {
  const { violations, sheets } = scanTypeScale()

  if (sheets < MINIMUM_SHEETS) {
    console.error(`verify-client-type-scale: read only ${sheets} stylesheets, expected at least ${MINIMUM_SHEETS}`)
    process.exit(1)
  }

  if (violations.length > 0) {
    console.error(`verify-client-type-scale: ${violations.length} type declaration(s) stated in px:`)
    for (const violation of violations.slice(0, 80)) {
      console.error(`  ${violation.file}:${violation.line}: ${violation.text}`)
    }
    if (violations.length > 80) console.error(`  … and ${violations.length - 80} more`)
    console.error("State type in rem (px ÷ 16) so it follows the reader's font size.")
    process.exit(1)
  }

  console.log(`verify-client-type-scale: ${sheets} stylesheet(s) state type in rem.`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) main()
