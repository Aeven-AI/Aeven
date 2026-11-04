/**
 * Git Consumer for workspaces: a workspace whose directory is a Git work tree follows the account to its other
 * devices as a repository. A device that receives one binds an existing checkout of the same remote, or clones it
 * with submodules and Git LFS objects, or copies it from a device that holds it when the remote cannot be reached;
 * environment files that Git ignores travel beside it and never replace a local file. Repository descriptions,
 * holders, and copy requests travel in the account's `workspace-git/repositories` document, and each workspace's
 * environment files in `workspace-git/env/<workspace id>`, as the
 * [workspace file sync note](../../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.md) plans.
 * @module @aeven/workspace-git-sync
 */
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@aeven/file-sync'
import { avnHomePath } from '@aeven/home-paths'
import type {} from '@aeven/subprocess'
import type {} from '@aeven/sync'
import type {} from '@aeven/workspace'
import { CheckoutDiscovery } from './discovery.ts'
import { Git } from './git.ts'
import { WorkspaceRepositories } from './repositories.ts'

export type { SyncedRepository } from './repositories.ts'
export { publicRemote, remoteKey } from './remote.ts'

/** Plugin name. */
export const name = 'workspace-git-sync'

/**
 * Services this Consumer requires. `fileSync` is read through `ctx.get` when a copy travels and is never injected:
 * every injected service is required, so injecting it would keep the Consumer from starting on a Host without file
 * sync, which still clones and binds repositories.
 */
export const inject = ['workspaceRegistry', 'sync', 'subprocess']

/** Consumer configuration. */
export interface Config {
  /** Directory a repository from another device lands in when its location hint names no free directory here. */
  root: string
  /** Share of the disk, from 0 to 1, a download must leave free. */
  minFreeDiskRatio: number
  /** Interval between checks for a finished Git install. */
  gitInstallPollMs: number
  /** Longest wait for a Git install the user may have to confirm. */
  gitInstallTimeoutMs: number
  /** Longest an ordinary Git command runs. */
  commandTimeoutMs: number
  /** Longest a clone, LFS fetch, or bundle runs. */
  transferTimeoutMs: number
  /** Grace a stopped Git command gets before it is killed. */
  stopGraceMs: number
  /** Largest output kept from one Git command. */
  outputMaxBytes: number
  /** Directories whose subdirectories may hold an existing checkout. */
  discoveryRoots: string[]
  /** Levels of subdirectories under each discovery root that are searched. */
  discoveryDepth: number
  /** Longest one search for an existing checkout reads. */
  discoveryTimeoutMs: number
  /** How long the list of directories under the discovery roots is reused. */
  discoveryCacheMs: number
  /** Which files Git ignores travel as environment files. */
  envFiles: {
    /** File-name patterns that travel, with `*` and `?` wildcards. */
    patterns: string[]
    /** File-name patterns that never travel, such as templates. */
    exclude: string[]
    /** Largest environment file, in bytes, that travels. */
    maxBytes: number
    /** Most environment files one workspace carries. */
    maxFiles: number
  }
  /** Interval between passes that publish changed environment files and retry repositories not yet received. */
  passIntervalMs: number
  /** Shortest wait before trying again to get a repository that could not be cloned or copied. */
  retryMs: number
  /** Longest a copy request waits for a device that holds the repository to take it. */
  copyAnswerMs: number
  /** Longest a copy from another device may take. */
  copyTimeoutMs: number
  /** Lifetime of the lease that picks one device to serve a copy. */
  copyLeaseMs: number
  /** Directory copies travel through. */
  transferRoot: string
}

/** Where developers keep checkouts, under the home directory on every platform. */
const DISCOVERY_ROOTS = ['Projects', 'code', 'src', 'Developer', 'repos', 'git', 'workspace', join('source', 'repos')]

/** Configuration schema. */
export const Config: Schema<Config> = Schema.object({
  root: Schema.string().default(join(homedir(), 'Aeven')),
  minFreeDiskRatio: Schema.number().min(0).max(1).default(0.1),
  gitInstallPollMs: Schema.natural().min(100).default(5_000),
  gitInstallTimeoutMs: Schema.natural().min(1_000).default(1_800_000),
  commandTimeoutMs: Schema.natural().min(1_000).default(60_000),
  transferTimeoutMs: Schema.natural().min(1_000).default(3_600_000),
  stopGraceMs: Schema.natural().min(100).default(5_000),
  outputMaxBytes: Schema.natural().min(1_024).default(4 * 1024 ** 2),
  discoveryRoots: Schema.array(Schema.string()).default(DISCOVERY_ROOTS.map(root => join(homedir(), root))),
  discoveryDepth: Schema.natural().min(1).default(2),
  discoveryTimeoutMs: Schema.natural().min(1).default(500),
  discoveryCacheMs: Schema.natural().default(600_000),
  envFiles: Schema.object({
    patterns: Schema.array(Schema.string()).default(['.env', '.env.*', '.dev.vars', '.envrc']),
    exclude: Schema.array(Schema.string()).default(['*.example', '*.sample', '*.template']),
    maxBytes: Schema.natural().min(1).default(64 * 1024),
    maxFiles: Schema.natural().min(1).default(50),
  }),
  passIntervalMs: Schema.natural().min(1_000).default(300_000),
  retryMs: Schema.natural().min(1_000).default(600_000),
  copyAnswerMs: Schema.natural().min(1_000).default(30_000),
  copyTimeoutMs: Schema.natural().min(1_000).default(600_000),
  copyLeaseMs: Schema.natural().min(1_000).default(60_000),
  transferRoot: Schema.string().default(avnHomePath('workspace-git-sync', 'transfer')),
})

/**
 * Keep the account's repository workspaces present on every device that syncs the account.
 * @param ctx - context providing `workspaceRegistry`, `sync`, and `subprocess`, and optionally `fileSync`.
 * @param config - placement, Git, discovery, environment file, and copy settings.
 */
export function apply(ctx: Context, config: Config): void {
  const git = new Git(ctx, {
    installPollMs: config.gitInstallPollMs,
    installTimeoutMs: config.gitInstallTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    transferTimeoutMs: config.transferTimeoutMs,
    graceMs: config.stopGraceMs,
    outputMaxBytes: config.outputMaxBytes,
  })
  const discovery = new CheckoutDiscovery({
    roots: config.discoveryRoots,
    depth: config.discoveryDepth,
    timeoutMs: config.discoveryTimeoutMs,
    cacheMs: config.discoveryCacheMs,
  })
  const repositories = new WorkspaceRepositories(ctx, git, discovery, config)
  const warn = (error: unknown): void => {
    ctx.logger('workspace-git-sync').warn(`workspace-git-sync: ${String(error)}`)
  }
  // Transfer folders live only while a copy travels; what a previous run left is never resumed.
  const cleared = rm(config.transferRoot, { recursive: true, force: true }).catch(warn)
  ctx.on('sync/status', (owner) => { void cleared.then(() => repositories.attach(owner)).catch(warn) })
  ctx.on('sync/reset', (owner) => { repositories.reset(owner).catch(warn) })
  ctx.on('workspace/changed', () => { repositories.reconcileAll() })
  ctx.on('workspace/files-requested', (workspace) => { repositories.requested(workspace) })
  ctx.effect(() => {
    const timer = setInterval(() => { repositories.reconcileAll() }, config.passIntervalMs)
    return () => {
      clearInterval(timer)
      return repositories.dispose()
    }
  }, 'workspace-git-sync: repositories')
}
