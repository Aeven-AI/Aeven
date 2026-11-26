/**
 * Devices that hold one repository agree on a single description of it. The description carries the location hint and
 * the size, which differ on every device, so holders that each published their own would replace each other's on
 * every pass. The published remote is the URL the repository's configuration records, not the one a
 * `url.<base>.insteadOf` rewrite produces for this device alone.
 */
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { WorkspaceRepositories, type SyncedRepository, type WorkspaceRepositoriesOptions } from '../src/repositories.ts'
import type { Git, GitResult } from '../src/git.ts'
import type { CheckoutDiscovery } from '../src/discovery.ts'

const OWNER = 'o1'
const WORKSPACE = 'w1'
const REMOTE = 'https://github.com/example/project.git'
/** Git reads no configuration of the machine the spec runs on. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'spec',
  GIT_AUTHOR_EMAIL: 'spec@example.invalid',
  GIT_COMMITTER_NAME: 'spec',
  GIT_COMMITTER_EMAIL: 'spec@example.invalid',
}

const dirs: string[] = []
const fleet: WorkspaceRepositories[] = []
afterEach(async () => {
  for (const repositories of fleet.splice(0)) await repositories.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The system's Git, run directly in a work tree. */
const git = {
  run: (args: readonly string[], run: { cwd: string }): Promise<GitResult> => new Promise((resolve) => {
    execFile('git', [...args], { cwd: run.cwd, env: GIT_ENV }, (error, stdout, stderr) => {
      resolve({ exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr })
    })
  }),
  async output(args: readonly string[], run: { cwd: string }): Promise<string> {
    const result = await git.run(args, run)
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout
  },
} as unknown as Git

/** A committed work tree with `origin` set, holding one file of the given size so two of them differ in bytes. */
function workTree(fileBytes: number): string {
  const path = mkdtempSync(join(tmpdir(), 'avn-git-describe-'))
  dirs.push(path)
  const run = (...args: string[]): void => { execFileSync('git', args, { cwd: path, env: GIT_ENV, stdio: 'ignore' }) }
  run('init', '--initial-branch=main')
  writeFileSync(join(path, 'file.txt'), 'x'.repeat(fileBytes))
  run('add', 'file.txt')
  run('commit', '-m', 'first')
  run('remote', 'add', 'origin', REMOTE)
  return path
}

/**
 * The account's documents as two devices hold them: a change one device makes reaches the other as a remote
 * transaction, the way the sync provider applies it.
 */
function account() {
  const copies = new Map<string, Map<string, Y.Doc>>()
  const copy = (device: string, name: string): Y.Doc => {
    const held = copies.get(name) ?? new Map<string, Y.Doc>()
    copies.set(name, held)
    let doc = held.get(device)
    if (doc === undefined) {
      doc = new Y.Doc()
      const own = doc
      for (const other of held.values()) Y.applyUpdate(own, Y.encodeStateAsUpdate(other), 'remote')
      own.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === 'remote') return
        for (const [id, other] of held) if (id !== device) Y.applyUpdate(other, update, 'remote')
      })
      held.set(device, own)
    }
    return doc
  }

  /** A device holding the workspace at `path`, or not holding it once `holds.value` is false. */
  function device(id: string, path: string) {
    const holds = { value: true }
    const workspace = { id: WORKSPACE, kind: 'folder', path, owner: OWNER, isBuiltIn: false, updatedAt: '2026-01-01T00:00:00.000Z' }
    const ctx = {
      workspaceRegistry: {
        list: () => holds.value ? [workspace] : [],
        get: () => holds.value ? workspace : undefined,
        filesPaused: () => false,
        fileStatus: () => undefined,
        setFileStatus: () => {},
      },
      sync: {
        status: () => ({ state: 'ready', device: id }),
        openDocument: (_owner: string, name: string) => Promise.resolve({ doc: copy(id, name), close: () => {} }),
        retireDocument: () => Promise.resolve(),
      },
      get: () => undefined,
      logger: () => ({ warn: () => {}, info: () => {} }),
    } as unknown as Context
    const options = {
      startDelayMs: 0,
      envFiles: { patterns: [], exclude: [], maxBytes: 0, maxFiles: 0, maxTotalBytes: 0 },
    } as unknown as WorkspaceRepositoriesOptions
    const repositories = new WorkspaceRepositories(ctx, git, {} as CheckoutDiscovery, options)
    fleet.push(repositories)
    const descriptions = copy(id, 'workspace-git/repository-holders').getMap<SyncedRepository>('repositories')
    let written = 0
    descriptions.observe((_event, transaction) => { if (transaction.local) written++ })
    const internals = repositories as unknown as { passes: Map<string, Promise<void>> }
    return {
      repositories,
      holds,
      description: () => descriptions.get(WORKSPACE),
      written: () => written,
      pass: () => internals.passes.get(OWNER) ?? Promise.resolve(),
    }
  }

  return { device }
}

type Device = ReturnType<ReturnType<typeof account>['device']>

/** Let every pass a change started finish, and the passes those started, for a bounded number of rounds. */
async function settle(devices: readonly Device[], rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    for (const each of devices) await each.pass()
  }
}

describe('the description of a repository several devices hold', () => {
  it('is written once by the first holder and left alone by the second, whose size differs', async () => {
    const shared = account()
    const first = shared.device('device-a', workTree(10))
    const second = shared.device('device-b', workTree(100_000))
    await first.repositories.attach(OWNER)
    await second.repositories.attach(OWNER)
    await settle([first, second])
    expect(first.written()).toBe(1)
    expect(second.written()).toBe(0)
    expect(second.description()).toEqual(first.description())
    expect(first.description()?.device).toBe('device-a')
    // A later pass on either device changes nothing either.
    second.repositories.reconcileAll()
    first.repositories.reconcileAll()
    await settle([first, second])
    expect(first.written() + second.written()).toBe(1)
  })

  it('passes to another holder once the describing device no longer holds the repository', async () => {
    const shared = account()
    const first = shared.device('device-a', workTree(10))
    const second = shared.device('device-b', workTree(100_000))
    await first.repositories.attach(OWNER)
    await second.repositories.attach(OWNER)
    await settle([first, second])
    const before = first.description()
    first.holds.value = false
    first.repositories.reconcileAll()
    await settle([first, second])
    second.repositories.reconcileAll()
    await settle([first, second])
    expect(second.description()?.device).toBe('device-b')
    expect(second.description()?.bytes).not.toBe(before?.bytes)
    expect(second.written()).toBe(1)
  })

  it('publishes the configured remote where this device rewrites it to a local proxy', async () => {
    const path = workTree(10)
    execFileSync('git', ['config', 'url.http://127.0.0.1:3128/git/github.com/.insteadOf', 'https://github.com/'], { cwd: path, env: GIT_ENV })
    expect((await git.output(['remote', 'get-url', 'origin'], { cwd: path })).trim()).toBe('http://127.0.0.1:3128/git/github.com/example/project.git')
    const only = account().device('device-a', path)
    await only.repositories.attach(OWNER)
    await settle([only])
    expect(only.description()?.remote).toBe(REMOTE)
  })
})
