/**
 * The guard treats a source file it cannot stat as absent: a path that vanishes or
 * becomes unreadable between the existence check and the stat never refuses a
 * command for a file it cannot see.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mountGuard, textOf } from './harness.ts'

/** Absolute path the mocked `statSync` fails on; empty means every path behaves normally. */
const fsState = vi.hoisted(() => ({ unreadable: '' }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statSync: (path: Parameters<typeof actual.statSync>[0], options?: Parameters<typeof actual.statSync>[1]) => {
      if (String(path) === fsState.unreadable) throw Object.assign(new Error(`EIO: i/o error, stat '${String(path)}'`), { code: 'EIO' })
      return (actual.statSync as (candidate: unknown, candidateOptions?: unknown) => unknown)(path, options)
    },
  }
})

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

afterEach(() => { fsState.unreadable = '' })

describe('a source file that cannot be stat-ed', () => {
  it('counts the unreadable file as absent and lets the command run', async () => {
    const target = join(packageRoot, 'src/index.ts')
    fsState.unreadable = target

    const guard = await mountGuard()
    const result = await guard.run(`sed -i 's/one/two/' ${target}`, packageRoot)

    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe('bash ran')
    expect(guard.executed).toEqual(['bash'])
  })
})
