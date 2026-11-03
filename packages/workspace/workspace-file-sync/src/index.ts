/**
 * File sync Consumer for workspaces: a folder workspace opened on one device of an account syncs as one folder with
 * the account's other devices, which receive it into a directory of their own without asking the user where. Each
 * device publishes its file transport peer id in the account's `file-sync/peers` document, and each folder
 * workspace's folder id, size, and location hint travel in `file-sync/folders`; a Git work tree is left to the
 * repository mode the [workspace file sync note](../../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.md)
 * plans.
 * @module @aeven/workspace-file-sync
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@aeven/file-sync'
import type {} from '@aeven/sync'
import type {} from '@aeven/workspace'
import { WorkspaceFiles } from './files.ts'

export type { SyncedWorkspaceFiles, WorkspaceFilesOptions } from './files.ts'

/** Plugin name. */
export const name = 'workspace-file-sync'

/** Services this Consumer requires. */
export const inject = ['fileSync', 'workspaceRegistry', 'sync']

/** Consumer configuration. */
export interface Config {
  /** Directory a workspace from another device lands in when its location hint names no free directory here. */
  root: string
  /** Largest workspace, in bytes, this device downloads as soon as it arrives. */
  prefetchMaxBytes: number
  /** Share of the disk, from 0 to 1, a download must leave free. */
  minFreeDiskRatio: number
}

/** Configuration schema. */
export const Config: Schema<Config> = Schema.object({
  root: Schema.string().default(join(homedir(), 'Aeven')),
  prefetchMaxBytes: Schema.natural().default(5 * 1024 ** 3),
  minFreeDiskRatio: Schema.number().min(0).max(1).default(0.1),
})

/**
 * Keep the account's folder workspaces in sync on every device that syncs the account.
 * @param ctx - context providing `fileSync`, `workspaceRegistry`, and `sync`.
 * @param config - placement root and disk budget.
 */
export function apply(ctx: Context, config: Config): void {
  const files = new WorkspaceFiles(ctx, config)
  const warn = (error: unknown): void => {
    ctx.logger('workspace-file-sync').warn(`workspace-file-sync: ${String(error)}`)
  }
  ctx.on('sync/status', (owner) => { files.attach(owner).catch(warn) })
  ctx.on('sync/devices', (owner) => { files.refreshPeers(owner).catch(warn) })
  ctx.on('sync/reset', (owner) => { files.reset(owner).catch(warn) })
  ctx.on('workspace/changed', () => { files.reconcileAll() })
  ctx.on('file-sync/folder', (folder) => { files.folderChanged(folder).catch(warn) })
  ctx.effect(() => () => files.dispose(), 'workspace-file-sync: documents')
}
