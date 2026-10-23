/**
 * Pass behavior of @aeven/bash-edit-guard: creating files, scratch output, reads,
 * program runs, and edits of files under the system temporary directories reach
 * the tool unchanged.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { guardConfig, mountGuard, textOf } from './harness.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const tempDirs: string[] = []
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A fresh, owned directory under the system temporary root. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bash-edit-guard-'))
  tempDirs.push(dir)
  return dir
}

describe('commands that change nothing existing', () => {
  it('lets a redirect create a new source file', async () => {
    const guard = await mountGuard()
    const result = await guard.run('printf body > out/new.ts', packageRoot)

    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe('bash ran')
    expect(guard.executed).toEqual(['bash'])
  })

  it('lets a read of an existing source file through', async () => {
    const guard = await mountGuard()
    const result = await guard.run('cat src/index.ts', packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })

  it('lets a program run through', async () => {
    const guard = await mountGuard()
    const result = await guard.run('pnpm run build && git status --short', packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })

  it('lets a write into a file whose extension is not a source extension through', async () => {
    const guard = await mountGuard()
    const result = await guard.run("sed -i 's/one/two/' notes.log", packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })

  it('never refuses a source file under a system temporary directory', async () => {
    const dir = tempDir()
    const source = join(dir, 'scratch.ts')
    writeFileSync(source, 'const scratch = 1\n')

    const guard = await mountGuard()
    const result = await guard.run(`sed -i 's/scratch/edited/' ${source}`, packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })

  it('leaves a tool outside the guard invocation alone', async () => {
    const guard = await mountGuard({ config: guardConfig({ tools: [] }) })
    const result = await guard.run("sed -i 's/one/two/' src/index.ts", packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })
})

describe('arguments the guard cannot classify', () => {
  it('lets a call without a string command through', async () => {
    const guard = await mountGuard()

    expect((await guard.dispatch({ arguments: {} })).isError).toBe(false)
    expect((await guard.dispatch({ arguments: { command: 42 } })).isError).toBe(false)
    expect(guard.executed).toEqual(['bash', 'bash'])
  })
})
