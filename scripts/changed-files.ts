/**
 * Resolve the paths a gate actually has to look at.
 *
 * A full-corpus gate costs the same whether one file changed or a thousand, so
 * every verifier that can scope itself accepts `--changed` and asks here. The
 * set is the merge base of the checked-out branch against `origin/main`, plus
 * anything already staged or unstaged, because both are what a push would carry.
 */

import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname

/** Run git in the repository root and return its stdout lines. */
function git(args: string[]): string[] {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.split('\n').filter(line => line.length > 0)
}

/**
 * Repo-relative paths a `--changed` gate must check: the commits on this branch
 * since it forked from `origin/main`, plus the working tree and the index.
 * @param base - revision to compare against; defaults to `origin/main`.
 * @returns POSIX-separated repo-relative paths.
 */
export function changedPaths(base = 'origin/main'): Set<string> {
  const mergeBase = git(['merge-base', 'HEAD', base])[0]
  if (mergeBase === undefined) throw new Error(`no merge base between HEAD and ${base}`)
  const committed = git(['diff', '--name-only', mergeBase, 'HEAD'])
  const workingTree = git(['diff', '--name-only'])
  const staged = git(['diff', '--name-only', '--cached'])
  return new Set([...committed, ...workingTree, ...staged])
}

/** Whether a gate was asked to scope itself to the change under test. */
export function isChangedScope(argv: readonly string[]): boolean {
  return argv.includes('--changed')
}
