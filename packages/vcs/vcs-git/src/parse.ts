/**
 * Parsers for the git report formats this provider reads: porcelain v2 status,
 * the commit and branch formats it asks for, and the unmerged-path listing.
 *
 * Every parser turns engine text into the seam's normalized values and never
 * throws on an unrecognized status code: a code this provider does not classify
 * is reported as `unknown`, so a caller cannot read an unfamiliar change as a
 * clean path.
 * @module @aeven/vcs-git/parse
 */

import type { VcsBranch, VcsChange, VcsChangeKind, VcsCommit } from '@aeven/vcs'

/** Branch, upstream, and changed-path facts one status report carries. */
export interface ParsedStatus {
  readonly branch: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly changes: readonly VcsChange[]
  readonly truncated: boolean
}

/** Porcelain v2 field separator for record fields. */
const UNIT_SEPARATOR = '\u001f'

/** Porcelain v2 record terminator used by the log format. */
const RECORD_SEPARATOR = '\u001e'

const CHANGE_KINDS: Readonly<Record<string, VcsChangeKind>> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'conflicted',
}

/**
 * Map one porcelain status character to a change kind.
 * @param code - the index or work-tree character.
 * @returns the change kind, or null when that side is unchanged.
 */
function changeKind(code: string | undefined): VcsChangeKind | null {
  if (code === undefined || code === ' ' || code === '.') return null
  return CHANGE_KINDS[code] ?? 'unknown'
}

/**
 * Split porcelain v2 output into records. Headers are newline-terminated on
 * some git versions and NUL-terminated on others, so both separators are
 * accepted; a path that itself contains a newline is not supported by this
 * parser.
 * @param text - raw `--porcelain=v2 -z` output.
 * @returns records in engine order.
 */
function records(text: string): string[] {
  const lines: string[] = []
  for (const chunk of text.split('\0')) {
    if (chunk === '') continue
    for (const line of chunk.split('\n')) if (line !== '') lines.push(line)
  }
  return lines
}

/**
 * Parse a porcelain v2 status report.
 * @param text - raw `--porcelain=v2 --branch -z` output.
 * @param maxEntries - largest number of changed paths to keep.
 * @returns the normalized status facts; `truncated` is true when paths were dropped.
 */
export function parseStatus(text: string, maxEntries: number): ParsedStatus {
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const changes: VcsChange[] = []
  let truncated = false
  let expectingOriginalPath = false

  for (const record of records(text)) {
    if (expectingOriginalPath) {
      // A type-2 record's original path follows as its own record.
      expectingOriginalPath = false
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length).trim()
      branch = head === '(detached)' ? null : head
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length).trim()
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
      if (match !== null) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('#')) continue

    if (record.startsWith('? ')) {
      if (changes.length < maxEntries) {
        changes.push({ path: record.slice(2), staged: null, worktree: 'untracked' })
      } else truncated = true
      continue
    }
    if (record.startsWith('! ')) continue

    const kind = record.slice(0, 2)
    if (kind === '1 ') {
      const fields = record.split(' ')
      const staged = changeKind(fields[1]?.[0])
      const worktree = changeKind(fields[1]?.[1])
      const path = fields.slice(8).join(' ')
      if (path === '') continue
      if (changes.length < maxEntries) changes.push({ path, staged, worktree })
      else truncated = true
      continue
    }
    if (kind === '2 ') {
      const fields = record.split(' ')
      const staged = changeKind(fields[1]?.[0])
      const worktree = changeKind(fields[1]?.[1])
      const path = fields.slice(9).join(' ')
      expectingOriginalPath = true
      if (path === '') continue
      if (changes.length < maxEntries) changes.push({ path, staged, worktree })
      else truncated = true
      continue
    }
    if (kind === 'u ') {
      const fields = record.split(' ')
      const path = fields.slice(10).join(' ')
      if (path === '') continue
      if (changes.length < maxEntries) changes.push({ path, staged: 'conflicted', worktree: 'conflicted' })
      else truncated = true
    }
  }

  changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return { branch, upstream, ahead, behind, changes, truncated }
}

/**
 * Parse the log format this provider requests.
 * @param text - raw `--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e` output.
 * @returns commits, newest first, skipping records missing a required field.
 */
export function parseLog(text: string): VcsCommit[] {
  const commits: VcsCommit[] = []
  for (const record of text.split(RECORD_SEPARATOR)) {
    const normalized = record.replace(/^\n/u, '').replace(/\n$/u, '')
    if (normalized === '') continue
    const [hash, shortHash, author, date, ...subject] = normalized.split(UNIT_SEPARATOR)
    if (hash === undefined || shortHash === undefined || author === undefined || date === undefined) continue
    commits.push({ hash, shortHash, author, date, subject: subject.join(UNIT_SEPARATOR) })
  }
  return commits
}

/**
 * Parse the branch format this provider requests.
 * @param text - raw `--format=%(refname:short)%09%(HEAD)` output.
 * @returns branches in engine order with the current one flagged.
 */
export function parseBranches(text: string): VcsBranch[] {
  const branches: VcsBranch[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const [name, head] = line.split('\t')
    if (name === undefined || name === '') continue
    branches.push({ name, current: head === '*' })
  }
  return branches
}

/**
 * Parse a NUL-separated path listing.
 * @param text - raw `-z` path output.
 * @returns the paths in engine order.
 */
export function parsePaths(text: string): string[] {
  return text.split('\0').filter(path => path !== '')
}
