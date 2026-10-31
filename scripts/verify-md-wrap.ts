/**
 * Reject Markdown prose paragraphs spanning multiple physical lines. The GFM
 * AST distinguishes paragraphs—including those in lists and blockquotes—from
 * multiline structural nodes. The checker never rewrites; symlinked instruction
 * files are deduped. VitePress frontmatter and custom-container delimiters are
 * masked before parsing. The owning convention is in `docs/AGENTS.md`.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Nodes } from 'mdast'
import { changedPaths, isChangedScope } from './changed-files.ts'
import { parseMarkdown, visitMarkdown } from './markdown.ts'
import { isArchivedAgentNotePath, uniqueRepoFiles } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/** Files to check: doc-typecheck's scope, system-prompt expected outputs, and the AGENTS.md pair. */
const PATTERNS = [
  'README.md',
  'README.zh.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'snapshots/**/system-prompt.expected.md',
  'packages/**/system-prompt.expected.md',
  'AGENTS.md',
  'packages/AGENTS.md',
  'snapshots/AGENTS.md',
]

/** A located hard-wrap: a prose paragraph spanning more than one source line. */
interface Violation {
  file: string
  /** Absolute path of the violating file, for the rewrite. */
  abs: string
  /** 1-based line where the hard-wrapped paragraph starts. */
  line: number
  /** 1-based line where the same paragraph ends. */
  endLine: number
  text: string
}

function maskVitePressStructure(source: string): string {
  const lines = source.split('\n')
  if (lines[0] === '---') {
    const closing = lines.indexOf('---', 1)
    if (closing !== -1) {
      for (let index = 0; index <= closing; index++) lines[index] = ''
    }
  }
  return lines.map(line => line.trimStart().startsWith(':::') ? '' : line).join('\n')
}

/** Find every hard-wrapped prose paragraph in one Markdown file via its AST. */
function findViolations(absPath: string): Violation[] {
  const file = relative(root, absPath)
  const source = readFileSync(absPath, 'utf8')
  const parsedSource = maskVitePressStructure(source)
  const tree = parseMarkdown(parsedSource)
  const out: Violation[] = []

  visitMarkdown(tree, (node: Nodes): boolean | void => {
    if (node.type === 'paragraph' && node.position) {
      const { start, end } = node.position
      if (end.line > start.line) {
        const firstLine = source.split('\n')[start.line - 1] ?? ''
        out.push({ file, abs: absPath, line: start.line, endLine: end.line, text: firstLine.trim() })
      }
      // Paragraph children are inline, so no further paragraph can be nested.
      return false
    }
  })
  return out
}

/**
 * Check (and with `--fix`, repair) every Markdown prose paragraph in scope.
 * @param argv - arguments to read `--fix` from.
 * @returns 0 when nothing is hard-wrapped, 1 otherwise.
 */
export function runMdWrap(argv: readonly string[] = process.argv): number {
  const scoped = isChangedScope(argv) ? changedPaths() : undefined
  const files = uniqueRepoFiles(root, PATTERNS, isArchivedAgentNotePath)
    .filter(file => scoped === undefined || scoped.has(relative(root, file.abs)))
  const checked = files.length
  const fix = argv.includes('--fix')

  /** Blockquote and table paragraphs carry semantic prefixes a join would drop. */
  const fixable = (violation: Violation): boolean =>
    !violation.text.startsWith('>') && !violation.text.startsWith('|')

  /** Rewrite each multi-line paragraph as one physical line, keeping its leading indentation. */
  function joinParagraphs(absPath: string, violations: Violation[]): number {
    const lines = readFileSync(absPath, 'utf8').split('\n')
    let joined = 0
    for (const violation of [...violations].sort((a, b) => b.line - a.line)) {
      const paragraph = lines.slice(violation.line - 1, violation.endLine)
      const indent = /^\s*/.exec(paragraph[0] ?? '')?.[0] ?? ''
      const text = paragraph
        .map(line => line.trim().replace(/\\$/, '').trimEnd())
        .filter(line => line.length > 0)
        .join(' ')
      lines.splice(violation.line - 1, violation.endLine - violation.line + 1, `${indent}${text}`)
      joined++
    }
    if (joined > 0) writeFileSync(absPath, lines.join('\n'))
    return joined
  }

  let all = files.flatMap(file => findViolations(file.abs))
  if (fix && all.length > 0) {
    const byFile = new Map<string, Violation[]>()
    for (const violation of all.filter(fixable)) {
      byFile.set(violation.abs, [...(byFile.get(violation.abs) ?? []), violation])
    }
    let rewritten = 0
    for (const [absPath, violations] of byFile) rewritten += joinParagraphs(absPath, violations)
    console.log(`verify-md-wrap --fix: joined ${rewritten} paragraph(s) in ${byFile.size} file(s).`)
    all = files.flatMap(file => findViolations(file.abs))
  }

  if (all.length === 0) {
    console.log(`verify-md-wrap: ${checked} file(s) checked, no hard-wrapped prose paragraphs.`)
    return 0
  }

  console.error('verify-md-wrap: hard-wrapped prose paragraphs found (write one physical line per paragraph; `--fix` joins those outside blockquotes and tables):')
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}  ${v.text.slice(0, 80)}${v.text.length > 80 ? '…' : ''}`)
  }
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(runMdWrap())
}
