/** Shared repository file discovery and line-oriented reference scanning. */

import { globSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { matchesGlob, relative, resolve, sep } from 'node:path'

/** One authored path plus its canonical target for symlink deduplication. */
export interface RepoFile {
  /** Absolute path matched by the caller's glob. */
  abs: string
  /** Absolute canonical path used only for deduplication. */
  real: string
}

/** A rejected line-oriented repository reference. */
export interface ReferenceViolation {
  /** Repo-relative file containing the reference. */
  file: string
  /** 1-based line containing the reference. */
  line: number
  /** Normalized reference text. */
  ref: string
}

/** Whether a repository path is frozen Agent Note history, not evolving source prose. */
export function isArchivedAgentNotePath(path: string): boolean {
  return path.replaceAll('\\', '/').startsWith('.agents/notes/archived/')
}

/**
 * Match a `**`-carrying pattern against the repository tree.
 *
 * `fs.globSync` resolves a globstar segment by asking every entry it meets for
 * children. A symlinked *file* answers with `ENOTDIR`, which fails the entire
 * pattern before a single match is reported — so no pattern may be expanded
 * over a symlink's own path. This walk therefore enters only the entries
 * `readdirSync` reports as real directories, which is exactly what keeps a
 * committed symlink (a scenario's shared `system-prompt.expected.md`) from
 * crashing the gate, and what makes the deduplication below honest: a link and
 * its target match once, as one authored file.
 * @param root - absolute repository root.
 * @param pattern - repository-relative glob pattern.
 * @returns repository-relative matches in stable tree order.
 */
function globstarMatches(root: string, pattern: string): string[] {
  const matches: string[] = []
  const visit = (repoDir: string): void => {
    const abs = repoDir === '' ? root : resolve(root, repoDir)
    const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const repoPath = repoDir === '' ? entry.name : `${repoDir}/${entry.name}`
      if (entry.isDirectory()) {
        visit(repoPath)
        continue
      }
      if (entry.isSymbolicLink() || entry.isFile()) {
        if (matchesGlob(repoPath, pattern)) matches.push(repoPath)
      }
    }
  }
  visit('')
  return matches
}

/**
 * Follow a committed symlink to the path it names, so that the link and its
 * target are one authored file: matched once, and reported under the path a
 * reader can open.
 * @param root - absolute repository root.
 * @param repoPath - repository-relative path that may be a symlink.
 * @returns the repository-relative canonical path.
 */
function canonicalRepoPath(root: string, repoPath: string): string {
  const abs = resolve(root, repoPath)
  if (!lstatSync(abs).isSymbolicLink()) return repoPath
  return relative(root, realpathSync(abs)).split(sep).join('/')
}

/**
 * Expand repository-relative globs and deduplicate symlinked files.
 * @param root - absolute repository root.
 * @param patterns - repository-relative glob patterns, processed in order.
 * @param isExcluded - optional predicate over each matched relative path.
 * @returns matched files in stable first-seen order.
 */
export function uniqueRepoFiles(
  root: string,
  patterns: readonly string[],
  isExcluded: (relativePath: string) => boolean = () => false,
): RepoFile[] {
  // Resolve the root once: on macOS `/tmp` and `/var` are symlinks, so a caller
  // that hands over an unresolved path would otherwise compute canonical paths
  // outside the tree it walks.
  const base = realpathSync(root)
  const seen = new Set<string>()
  const files: RepoFile[] = []
  for (const pattern of patterns) {
    const matches = pattern.includes('**')
      ? globstarMatches(base, pattern)
      : globSync(pattern, { cwd: base }).map(match => match.split(sep).join('/')).sort()
    for (const match of matches) {
      const canonical = canonicalRepoPath(base, match)
      if (isExcluded(canonical)) continue
      const abs = resolve(base, canonical)
      const real = realpathSync(abs)
      if (seen.has(real)) continue
      seen.add(real)
      files.push({ abs, real })
    }
  }
  return files
}

/**
 * Scan regex matches line by line and return the normalized matches rejected by
 * a caller predicate.
 * @param root - absolute repository root used for violation paths.
 * @param absPath - absolute text-file path to scan.
 * @param pattern - global regex matched independently against each line.
 * @param normalize - maps raw regex text to the reference the gate evaluates.
 * @param isViolation - returns true when the normalized reference is invalid.
 * @returns every rejected reference in source order.
 */
export function findReferenceViolations(
  root: string,
  absPath: string,
  pattern: RegExp,
  normalize: (raw: string) => string,
  isViolation: (ref: string) => boolean,
): ReferenceViolation[] {
  const file = relative(root, absPath).split(sep).join('/')
  const out: ReferenceViolation[] = []
  const lines = readFileSync(absPath, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    for (const match of line.matchAll(pattern)) {
      const ref = normalize(match[0])
      if (isViolation(ref)) out.push({ file, line: i + 1, ref })
    }
  }
  return out
}
