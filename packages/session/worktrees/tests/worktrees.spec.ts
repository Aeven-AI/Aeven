/**
 * The worktree capability against real git: a temporary repository per test,
 * real checkouts, and the session's logged directory as the observable.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@aeven/session-projection'
import SubprocessLocal from '@aeven/subprocess-local'
import { Session, SessionId } from '@aeven/session'
import type { Session as SessionType } from '@aeven/session'
import WorkingDirectoryService from '@aeven/working-directory'

import Worktrees from '../src/index.ts'

const run = promisify(execFile)
const created: string[] = []

/**
 * Create a repository with one commit and a session working in it.
 * @returns the repository root and the session.
 */
async function repository(): Promise<{ root: string; session: SessionType }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'avn-wt-')))
  created.push(root)
  await run('git', ['init', '-q', '-b', 'main'], { cwd: root })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await run('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# repo\n')
  await run('git', ['add', '.'], { cwd: root })
  await run('git', ['commit', '-q', '-m', 'initial'], { cwd: root })
  const session = Session.create(SessionId('wt-session'), undefined, {
    id: SessionId('wt-session'), version: 0, createdAt: Date.now(), isSeeded: false, cwd: root,
  })
  return { root, session }
}

/**
 * Compose the capability over the real subprocess provider and the real
 * working-directory service.
 * @returns the composed context.
 */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(WorkingDirectoryService)
  await ctx.plugin(Worktrees, { directory: '.aeven/worktrees', branchPrefix: 'avn/', graceMs: 5000 })
  return ctx
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(created.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('worktrees', () => {
  it('creates a branch-backed checkout and moves the session into it', async () => {
    const { root, session } = await repository()
    const ctx = await setup()
    const createdWorktree = await ctx.worktrees.create(session, { name: 'feature' })

    expect(createdWorktree.path).toBe(join(root, '.aeven/worktrees/feature'))
    expect(createdWorktree.branch).toBe('avn/feature')
    expect(createdWorktree.repositoryRoot).toBe(root)
    expect(existsSync(createdWorktree.path)).toBe(true)
    expect(existsSync(join(createdWorktree.path, 'README.md'))).toBe(true)
    expect(await readFile(join(createdWorktree.path, 'README.md'), 'utf8')).toBe('# repo\n')
    expect(ctx.workingDirectory.of(session)).toBe(createdWorktree.path)

    const branches = await run('git', ['branch', '--list', 'avn/feature'], { cwd: root })
    expect(branches.stdout).toContain('avn/feature')
  })

  it('starts from the revision named, not from HEAD', async () => {
    const { root, session } = await repository()
    const ctx = await setup()
    const first = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
    await writeFile(join(root, 'second.txt'), 'two\n')
    await run('git', ['add', '.'], { cwd: root })
    await run('git', ['commit', '-q', '-m', 'second'], { cwd: root })

    const checkout = await ctx.worktrees.create(session, { name: 'from-first', from: first })
    expect(checkout.baseCommit).toBe(first)
    expect(existsSync(join(checkout.path, 'second.txt'))).toBe(false)
  })

  it('refuses a duplicate name instead of reusing a checkout', async () => {
    const { root, session } = await repository()
    const ctx = await setup()
    const other = Session.create(SessionId('wt-session-2'), undefined, {
      id: SessionId('wt-session-2'), version: 0, createdAt: Date.now(), isSeeded: false, cwd: root,
    })
    await ctx.worktrees.create(session, { name: 'twice' })
    await expect(ctx.worktrees.create(other, { name: 'twice' })).rejects.toThrow(/worktrees: git worktree failed/)
    expect(ctx.workingDirectory.of(other)).toBe(root)
  })

  it('leaves the source working tree untouched', async () => {
    const { root, session } = await repository()
    const ctx = await setup()
    await writeFile(join(root, 'dirty.txt'), 'uncommitted\n')
    const checkout = await ctx.worktrees.create(session, { name: 'clean' })
    expect(await readFile(join(root, 'dirty.txt'), 'utf8')).toBe('uncommitted\n')
    expect(existsSync(join(checkout.path, 'dirty.txt'))).toBe(false)
    const status = await run('git', ['status', '--porcelain'], { cwd: root })
    expect(status.stdout).toContain('?? dirty.txt')
  })

  it('lists the main tree and every linked checkout', async () => {
    const { root, session } = await repository()
    const ctx = await setup()
    await ctx.worktrees.create(session, { name: 'listed' })
    const entries = await ctx.worktrees.list(session)
    expect(entries.map(entry => entry.path)).toContain(root)
    expect(entries.map(entry => entry.path)).toContain(join(root, '.aeven/worktrees/listed'))
    expect(entries[0]?.main).toBe(true)
    expect(entries.find(entry => entry.path.endsWith('listed'))?.ref).toBe('refs/heads/avn/listed')
  })

  it('refuses a name git cannot use as a branch', async () => {
    const { session } = await repository()
    const ctx = await setup()
    await expect(ctx.worktrees.create(session, { name: 'bad name' })).rejects.toThrow(/not a usable worktree name/)
  })

  it('refuses a session that is not in a repository', async () => {
    const detached = await mkdtemp(join(tmpdir(), 'avn-wt-plain-'))
    created.push(detached)
    const session = Session.create(SessionId('wt-plain'), undefined, {
      id: SessionId('wt-plain'), version: 0, createdAt: Date.now(), isSeeded: false, cwd: detached,
    })
    const ctx = await setup()
    await expect(ctx.worktrees.create(session, { name: 'nowhere' })).rejects.toThrow(/git rev-parse failed/)
  })
})
