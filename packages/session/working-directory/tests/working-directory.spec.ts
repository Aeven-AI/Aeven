/** Working-directory service: header seed, logged override, and path resolution. */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@aeven/session'
import type { Session } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import WorkingDirectoryService from '@aeven/working-directory'

interface Bench {
  ctx: Context
  session: Session
}

/**
 * Compose the session store, the projection registry, and the service.
 * @param cwd - the header working directory the session is created in.
 * @returns the composed context and its session.
 */
async function harness(cwd?: string): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(WorkingDirectoryService)
  const session = ctx.sessions.create(undefined, cwd === undefined ? {} : { meta: { cwd } })
  return { ctx, session }
}

/**
 * Create a throwaway directory tree under the OS temp directory.
 * @param names - subdirectory names to create inside it.
 * @returns the absolute root path.
 */
async function benchDirectory(names: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'avn-wd-'))
  for (const name of names) await mkdir(join(root, name), { recursive: true })
  return root
}

describe('working directory', () => {
  it('serves the session header cwd before any logged change', async () => {
    const root = await benchDirectory(['a'])
    const bench = await harness(root)
    expect(bench.ctx.workingDirectory.of(bench.session)).toBe(root)
  })

  it('serves no directory when the header records none', async () => {
    const bench = await harness()
    expect(bench.ctx.workingDirectory.of(bench.session)).toBeUndefined()
  })

  it('records a change in the log and serves it afterwards', async () => {
    const root = await benchDirectory(['a', 'b'])
    const bench = await harness(root)
    const target = join(root, 'b')
    await expect(bench.ctx.workingDirectory.change(bench.session, target)).resolves.toBe(target)
    expect(bench.ctx.workingDirectory.of(bench.session)).toBe(target)
    expect(bench.ctx.sessionProjections.snapshot(bench.session).values)
      .toEqual({ workingDirectory: { cwd: target } })
  })

  it('resolves a relative target against the directory in force', async () => {
    const root = await benchDirectory(['a', 'b'])
    const bench = await harness(root)
    await bench.ctx.workingDirectory.change(bench.session, 'a')
    expect(bench.ctx.workingDirectory.of(bench.session)).toBe(join(root, 'a'))
    await bench.ctx.workingDirectory.change(bench.session, '../b')
    expect(bench.ctx.workingDirectory.of(bench.session)).toBe(join(root, 'b'))
  })

  it('normalizes an absolute target instead of prefixing it', async () => {
    const root = await benchDirectory(['a', 'b'])
    const bench = await harness(root)
    expect(bench.ctx.workingDirectory.resolve(bench.session, join(root, 'a', '..', 'b')))
      .toBe(join(root, 'b'))
  })

  it('rejects a missing directory without logging a change', async () => {
    const root = await benchDirectory(['a'])
    const bench = await harness(root)
    await expect(bench.ctx.workingDirectory.change(bench.session, join(root, 'nope')))
      .rejects.toThrow(/does not exist/)
    expect(bench.ctx.workingDirectory.of(bench.session)).toBe(root)
  })

  it('rejects a file', async () => {
    const root = await benchDirectory(['a'])
    await writeFile(join(root, 'a', 'file.txt'), 'x\n', 'utf8')
    const bench = await harness(root)
    await expect(bench.ctx.workingDirectory.change(bench.session, join(root, 'a', 'file.txt')))
      .rejects.toThrow(/is not a directory/)
  })

  it('rejects an empty target', async () => {
    const bench = await harness()
    await expect(bench.ctx.workingDirectory.change(bench.session, '   '))
      .rejects.toThrow(/required/)
  })

  it('logs nothing when the target is already in force', async () => {
    const root = await benchDirectory(['a'])
    const bench = await harness(root)
    const before = bench.ctx.workingDirectory.of(bench.session)
    await expect(bench.ctx.workingDirectory.change(bench.session, root)).resolves.toBe(before)
    expect(bench.ctx.sessionProjections.snapshot(bench.session).values)
      .toEqual({ workingDirectory: { cwd: null } })
  })

  it('enters an absolute directory from a session with no header cwd', async () => {
    const root = await benchDirectory(['a'])
    const bench = await harness()
    await bench.ctx.workingDirectory.change(bench.session, join(root, 'a'))
    expect(bench.ctx.workingDirectory.of(bench.session)).toBe(join(root, 'a'))
  })
})
