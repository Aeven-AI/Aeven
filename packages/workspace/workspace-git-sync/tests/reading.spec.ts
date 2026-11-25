/**
 * A reader of a session's files, such as the explorer of a client following it, brings the session's repository
 * here as a turn would: on a managed Host it asks for the repository that has not arrived, and once it is here it
 * applies newer work another device checkpointed, except while a turn of a session of that repository runs here,
 * whose work tree the apply would change under it.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@aeven/session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRepositories, type WorkspaceRepositoriesOptions } from '../src/repositories.ts'
import type { Git } from '../src/git.ts'
import type { CheckoutDiscovery } from '../src/discovery.ts'

const dirs: string[] = []
const fleet: WorkspaceRepositories[] = []
afterEach(async () => {
  for (const repositories of fleet.splice(0)) await repositories.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

type Placement =
  | { state: 'filed'; workspace: { kind: 'remote'; id: string; owner: string } }
  | { state: 'filed'; workspace: { kind: 'folder'; id: string; owner: string; path: string } }

function harness(placement: () => Placement) {
  const ctx = {
    workspaceRegistry: { placeSession: placement, filesPaused: () => false },
  } as unknown as Context
  const options = {
    managedRoot: '/managed',
    startDelayMs: 0,
    envFiles: { patterns: [], exclude: [] },
  } as unknown as WorkspaceRepositoriesOptions
  const repositories = new WorkspaceRepositories(ctx, {} as Git, {} as CheckoutDiscovery, options)
  fleet.push(repositories)
  const internals = repositories as unknown as {
    reconcile(owner: string): Promise<void>
    workState: {
      apply(owner: string, workspace: string, path: string, signal: AbortSignal): Promise<void>
      postpone(workspace: string): void
      schedule(owner: string, workspace: string, path: string): void
    }
  }
  const reconcile = vi.spyOn(internals, 'reconcile').mockResolvedValue(undefined)
  const apply = vi.spyOn(internals.workState, 'apply').mockResolvedValue(undefined)
  vi.spyOn(internals.workState, 'postpone').mockReturnValue(undefined)
  vi.spyOn(internals.workState, 'schedule').mockReturnValue(undefined)
  return { repositories, reconcile, apply }
}

/** A bound Git work tree on this device. */
function workTree(): string {
  const path = mkdtempSync(join(tmpdir(), 'avn-git-reading-'))
  dirs.push(path)
  mkdirSync(join(path, '.git'))
  return path
}

const session = SessionId('s1')

describe('a reader of a session\'s repository', () => {
  it('asks for a repository that has not arrived on a managed Host, and applies nothing yet', async () => {
    const { repositories, reconcile, apply } = harness(() => ({ state: 'filed', workspace: { kind: 'remote', id: 'w1', owner: 'o1' } }))
    await repositories.wantedForReading(session, new AbortController().signal)
    expect(reconcile).toHaveBeenCalledWith('o1')
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies newer work another device left in a repository that is here', async () => {
    const path = workTree()
    const { repositories, reconcile, apply } = harness(() => ({ state: 'filed', workspace: { kind: 'folder', id: 'w1', owner: 'o1', path } }))
    const signal = new AbortController().signal
    await repositories.wantedForReading(session, signal)
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledWith('o1', 'w1', path, signal)
  })

  it('leaves the work tree alone while a turn of the repository runs here, and applies again once it ended', async () => {
    const path = workTree()
    const { repositories, apply } = harness(() => ({ state: 'filed', workspace: { kind: 'folder', id: 'w1', owner: 'o1', path } }))
    const signal = new AbortController().signal
    await repositories.beforeTurn(session, signal)
    apply.mockClear()
    await repositories.wantedForReading(SessionId('reader'), signal)
    expect(apply).not.toHaveBeenCalled()
    repositories.turnEnded(session)
    await repositories.wantedForReading(SessionId('reader'), signal)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('applies nothing for a reader that already gave up', async () => {
    const path = workTree()
    const { repositories, apply } = harness(() => ({ state: 'filed', workspace: { kind: 'folder', id: 'w1', owner: 'o1', path } }))
    const controller = new AbortController()
    controller.abort()
    await repositories.wantedForReading(session, controller.signal)
    expect(apply).not.toHaveBeenCalled()
  })
})
