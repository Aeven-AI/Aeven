/**
 * On a Host serving many accounts, a folder workspace arrives only when something here needs it. A reader of a
 * session's files, such as the explorer of a client following it, asks through `workspace/session-files-wanted`,
 * and the folder is brought as for a turn here: once per workspace. A device with its own folders brings every
 * workspace anyway and does not answer.
 */
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@aeven/session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as WorkspaceFileSync from '../src/index.ts'
import { WorkspaceFiles } from '../src/files.ts'

afterEach(() => { vi.restoreAllMocks() })

async function harness(config: Partial<WorkspaceFileSync.Config>) {
  const reconcile = vi.spyOn(WorkspaceFiles.prototype as unknown as { reconcile(owner: string): Promise<void> }, 'reconcile')
    .mockResolvedValue(undefined)
  const ctx = new Context()
  ctx.provide('fileSync')
  ctx.provide('sync')
  ctx.provide('workspaceRegistry')
  ctx.set('fileSync', {})
  ctx.set('sync', {})
  ctx.set('workspaceRegistry', {
    registerConflicts: () => () => {},
    filesPaused: () => false,
    placeSession: () => ({ state: 'filed', workspace: { kind: 'remote', id: 'w1', owner: 'o1' } }),
  })
  // The schema fills every other field with its default.
  const fiber = await ctx.plugin(WorkspaceFileSync, WorkspaceFileSync.Config(config as WorkspaceFileSync.Config))
  return { ctx, fiber, reconcile }
}

describe('a reader of a session\'s folder workspace', () => {
  it('brings the workspace on a managed Host, once per workspace', async () => {
    const { ctx, fiber, reconcile } = await harness({ managedRoot: '/managed' })
    const signal = new AbortController().signal
    await ctx.parallel('workspace/session-files-wanted', SessionId('s1'), signal)
    await ctx.parallel('workspace/session-files-wanted', SessionId('s2'), signal)
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledWith('o1')
    await fiber.dispose()
  })

  it('does not answer on a device that holds its own folders', async () => {
    const { ctx, fiber, reconcile } = await harness({})
    await ctx.parallel('workspace/session-files-wanted', SessionId('s1'), new AbortController().signal)
    expect(reconcile).not.toHaveBeenCalled()
    await fiber.dispose()
  })
})
