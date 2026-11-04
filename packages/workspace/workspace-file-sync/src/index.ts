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
import type {} from '@aeven/fs'
import type {} from '@aeven/tools'
import { avnHomePath } from '@aeven/home-paths'
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
  /** Share of the disk, from 0 to 1, a download must leave free. */
  minFreeDiskRatio: number
  /** Directory holding one marker per folder this device has held completely. */
  completeDirectory: string
  /** Longest a read waits for a file that is still arriving from another device. */
  readWaitMs: number
  /** Interval between checks for a file a read waits for. */
  readPollMs: number
  /** Delay that gathers the files the agent touched into one targeted scan. */
  scanDelayMs: number
  /** Longest a command that reads the whole tree waits for a workspace's first download to finish. */
  gateWaitMs: number
  /** Size above which a first download waits while this computer runs on battery. */
  batteryDeferBytes: number
  /** Interval between checks of whether this computer runs on battery. */
  powerPollMs: number
  /** Shortest interval between two listings of one folder's conflicting versions. */
  conflictScanMs: number
  /** Largest file, in bytes, whose two versions are shown as text. */
  conflictTextMaxBytes: number
}

/** Tools that read the whole tree, which wait for a workspace's first download instead of seeing part of it. */
const TREE_TOOLS = new Set(['bash', 'grep', 'glob'])

/** What the model learns when such a tool ran before the workspace's files had all arrived. */
const ARRIVING_NOTE = 'Some files of this workspace are still arriving from another device, so this result may be incomplete.'

/** Configuration schema. */
export const Config: Schema<Config> = Schema.object({
  root: Schema.string().default(join(homedir(), 'Aeven')),
  minFreeDiskRatio: Schema.number().min(0).max(1).default(0.1),
  completeDirectory: Schema.string().default(avnHomePath('workspace-file-sync', 'complete')),
  readWaitMs: Schema.natural().min(100).default(30_000),
  readPollMs: Schema.natural().min(10).default(100),
  scanDelayMs: Schema.natural().default(100),
  gateWaitMs: Schema.natural().default(60_000),
  batteryDeferBytes: Schema.natural().default(100 * 1024 ** 2),
  powerPollMs: Schema.natural().min(1_000).default(60_000),
  conflictScanMs: Schema.natural().default(30_000),
  conflictTextMaxBytes: Schema.natural().min(1).default(256 * 1024),
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
  // Reads and writes go through the filesystem capability; a Host without it has no agent file tools to serve.
  ctx.on('fs/pre-read', async (target, signal) => {
    const fs = ctx.get('fs')
    if (fs !== undefined) await files.beforeRead(fs.processPath(target), signal)
  })
  // Calls that ran while the first download was still incomplete; their results carry a note.
  const partial = new Set<string>()
  ctx.on('tools/execute', async (exec, next) => {
    const sessionId = exec.agent?.session.id
    const folder = TREE_TOOLS.has(exec.name) && sessionId !== undefined ? files.arriving(sessionId) : undefined
    if (folder !== undefined && !await files.untilArrived(folder, exec.signal)) partial.add(exec.callId)
    return next()
  })
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (!partial.delete(exec.callId)) return next()
    return { kind: 'accept', content: [...result.content, { type: 'text', text: ARRIVING_NOTE }] }
  })
  ctx.on('fs/observed', (target, observation) => {
    const fs = ctx.get('fs')
    if (fs !== undefined && observation.kind === 'present') files.touched(fs.processPath(target))
  })
  ctx.effect(() => ctx.workspaceRegistry.registerConflicts({
    list: workspace => files.conflicts(workspace),
    resolve: (workspace, path, keep) => files.resolve(workspace, path, keep),
  }), 'workspace-file-sync: conflicts')
  ctx.effect(() => {
    // Plugging in releases the first downloads that waited for power.
    let battery: boolean | undefined
    const power = setInterval(() => {
      void files.onBattery().then((now) => {
        if (battery === true && !now) files.reconcileAll()
        battery = now
      })
    }, config.powerPollMs)
    return () => {
      clearInterval(power)
      return files.dispose()
    }
  }, 'workspace-file-sync: documents')
}
