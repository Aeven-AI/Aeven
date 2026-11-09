/**
 * The explorer's Host-filesystem helpers: entry names every platform refuses are refused, and one shared recursive
 * watcher per root delivers a burst of changes as one batch, leaves ignored folders out, and closes with its last
 * subscriber.
 */
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invalidName, watchRoot } from '../src/host.ts'
import type { WorkspaceFileChange } from '../src/types.ts'

let root: string | undefined
const releases: Array<() => void> = []

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A fresh workspace folder. */
async function workspace(): Promise<string> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'avn-workspace-host-')))
  return root
}

/**
 * Wait until a fresh watcher reports changes: the platform's file events (FSEvents on macOS) start a moment after the
 * watch opens, and a write before that is not reported.
 */
async function settled(dir: string, seen: () => readonly string[]): Promise<void> {
  let probe = 0
  await vi.waitFor(async () => {
    probe += 1
    await writeFile(join(dir, '.probe'), String(probe))
    expect(seen()).toContain('.probe')
  }, { timeout: 3_000, interval: 50 })
}

describe('invalidName', () => {
  it.each(['', ' ', '.', '..', 'a/b', 'a\\b', 'x:y', 'nul', 'COM1.txt', 'ends.', 'ends ', 'x'.repeat(256)])('refuses %j', (name) => {
    expect(invalidName(name)).toBeDefined()
  })

  it.each(['index.html', '.gitignore', 'Résumé.pdf', 'console.log'])('accepts %j', (name) => {
    expect(invalidName(name)).toBeUndefined()
  })
})

describe('watchRoot', () => {
  it('delivers a burst of changes as one batch, with paths relative to the root', async () => {
    const dir = await workspace()
    await mkdir(join(dir, 'src'))
    const batches: Array<readonly WorkspaceFileChange[]> = []
    releases.push(watchRoot(dir, { ignore: new Set(), delayMs: 50 }, (changes) => { batches.push(changes) }, () => undefined))
    await settled(dir, () => batches.flat().map(change => change.path))

    await writeFile(join(dir, 'a.txt'), 'a')
    await writeFile(join(dir, 'src', 'b.txt'), 'b')

    await vi.waitFor(() => {
      const paths = batches.flat().map(change => change.path)
      expect(paths).toEqual(expect.arrayContaining(['a.txt', 'src/b.txt']))
    }, { timeout: 2_000, interval: 20 })
    expect(batches.flat().find(change => change.path === 'a.txt')?.kind).not.toBe('deleted')
  })

  it('reports a removed file as deleted', async () => {
    const dir = await workspace()
    await writeFile(join(dir, 'gone.txt'), 'x')
    const batches: Array<readonly WorkspaceFileChange[]> = []
    releases.push(watchRoot(dir, { ignore: new Set(), delayMs: 30 }, (changes) => { batches.push(changes) }, () => undefined))
    await settled(dir, () => batches.flat().map(change => change.path))

    await unlink(join(dir, 'gone.txt'))

    await vi.waitFor(() => {
      expect(batches.flat()).toContainEqual({ path: 'gone.txt', kind: 'deleted' })
    }, { timeout: 2_000, interval: 20 })
  })

  it('leaves changes inside ignored folders out', async () => {
    const dir = await workspace()
    await mkdir(join(dir, 'node_modules'))
    const batches: Array<readonly WorkspaceFileChange[]> = []
    releases.push(watchRoot(dir, { ignore: new Set(['node_modules']), delayMs: 30 }, (changes) => { batches.push(changes) }, () => undefined))
    await settled(dir, () => batches.flat().map(change => change.path))

    await writeFile(join(dir, 'node_modules', 'dep.js'), 'x')
    await writeFile(join(dir, 'kept.txt'), 'x')

    await vi.waitFor(() => {
      expect(batches.flat().map(change => change.path)).toContain('kept.txt')
    }, { timeout: 2_000, interval: 20 })
    expect(batches.flat().some(change => change.path.startsWith('node_modules'))).toBe(false)
  })

  it('shares one watcher between subscribers and stops delivering to one that left', async () => {
    const dir = await workspace()
    const first: string[] = []
    const second: string[] = []
    const options = { ignore: new Set<string>(), delayMs: 30 }
    const leave = watchRoot(dir, options, (changes) => { first.push(...changes.map(change => change.path)) }, () => undefined)
    releases.push(watchRoot(dir, options, (changes) => { second.push(...changes.map(change => change.path)) }, () => undefined))
    await settled(dir, () => first)

    await writeFile(join(dir, 'one.txt'), '1')
    await vi.waitFor(() => { expect(first).toContain('one.txt') }, { timeout: 2_000, interval: 20 })
    expect(second).toContain('one.txt')

    leave()
    await writeFile(join(dir, 'two.txt'), '2')
    await vi.waitFor(() => { expect(second).toContain('two.txt') }, { timeout: 2_000, interval: 20 })
    expect(first).not.toContain('two.txt')
  })
})
