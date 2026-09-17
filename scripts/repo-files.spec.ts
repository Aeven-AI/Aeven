import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { uniqueRepoFiles } from './repo-files.ts'

/** Scratch trees created by one case and removed with it. */
const created: string[] = []

/** Build a scratch repository tree from a `path -> contents` map. */
function scratchRepo(entries: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'avn-repo-files-')))
  created.push(root)
  for (const [relativePath, contents] of Object.entries(entries)) {
    const abs = join(root, relativePath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, contents)
  }
  return root
}

/** Name matched files relative to the repository root they came from. */
function relativePaths(root: string, files: readonly { abs: string }[]): string[] {
  return files.map(file => file.abs.slice(root.length + 1))
}

/** Write the shared prompt sidecar, plus the scenario symlink that borrows it. */
function sharedPromptSidecar(): string {
  const root = scratchRepo({ 'session/read-image/system-prompt.expected.md': 'shared' })
  const link = join(root, 'acp/image-compaction/system-prompt.expected.md')
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync('../../session/read-image/system-prompt.expected.md', link)
  return root
}

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('uniqueRepoFiles', () => {
  it('expands a globstar pattern over a plain tree in stable sorted order', () => {
    const root = scratchRepo({
      'docs/b.md': 'b',
      'docs/a.md': 'a',
      'docs/nested/c.md': 'c',
      'docs/skipped.txt': 'txt',
    })

    expect(relativePaths(root, uniqueRepoFiles(root, ['docs/**/*.md']))).toEqual([
      'docs/a.md',
      'docs/b.md',
      'docs/nested/c.md',
    ])
  })

  // A symlinked file cannot be traversed, and `fs.globSync` fails the whole
  // pattern with ENOTDIR when a globstar segment reaches one. That crashed
  // `verify-md-wrap`, `verify-md-links`, `verify-doc-refs`, and
  // `verify-package-paths` outright, because the ACP scenarios share their
  // prompt sidecar with the session corpus through a committed symlink.
  it('does not traverse a symlinked file matched by a globstar pattern', () => {
    const root = sharedPromptSidecar()

    expect(() => uniqueRepoFiles(root, ['**/system-prompt.expected.md'])).not.toThrow()
  })

  it('checks a symlink and its target as one authored file, under the path a reader can open', () => {
    const root = sharedPromptSidecar()

    expect(relativePaths(root, uniqueRepoFiles(root, ['**/system-prompt.expected.md']))).toEqual([
      'session/read-image/system-prompt.expected.md',
    ])
  })

  it('lets a caller exclusion see the canonical path, not the link it was reached through', () => {
    const root = scratchRepo({ 'docs/kept.md': 'kept', 'docs/dropped.md': 'dropped' })

    const files = uniqueRepoFiles(root, ['docs/**/*.md'], path => path === 'docs/dropped.md')

    expect(relativePaths(root, files)).toEqual(['docs/kept.md'])
  })

  it('matches a non-globstar pattern against the repository root', () => {
    const root = scratchRepo({ 'README.md': 'root readme', 'docs/README.md': 'nested readme' })

    expect(relativePaths(root, uniqueRepoFiles(root, ['README.md']))).toEqual(['README.md'])
  })

  // macOS reaches one directory as both `/tmp/...` and `/private/tmp/...`, so a
  // caller that hands over an unresolved root must still get in-tree paths.
  it('resolves its root before matching, so a symlinked root still reports in-tree paths', () => {
    const root = scratchRepo({ 'docs/a.md': 'a' })
    const linkParent = realpathSync(mkdtempSync(join(tmpdir(), 'avn-root-link-')))
    created.push(linkParent)
    const viaLink = join(linkParent, 'root')
    symlinkSync(root, viaLink)

    expect(relativePaths(root, uniqueRepoFiles(viaLink, ['docs/**/*.md']))).toEqual(['docs/a.md'])
  })
})
