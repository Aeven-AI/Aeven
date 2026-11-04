/**
 * Work-state checkpoints: a repository's uncommitted and unpushed work, which the device that works in it publishes
 * and the device that continues the work applies before its first turn there. A checkpoint holds the base commit and
 * branch, a bundle of the commits no remote has, a binary diff of tracked changes, and copies of the untracked files
 * `.gitignore` does not exclude; it travels through a transfer folder the publishing device serves to the account's
 * other devices.
 * @module @aeven/workspace-git-sync/work-state
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap } from 'yjs'
import { brandString } from '@aeven/brand'
import type { FileSyncFolderId, FileSyncPeerId } from '@aeven/file-sync'
import type { SyncDocument } from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import type { WorkspaceId } from '@aeven/workspace'
import type { Git } from './git.ts'
import { untilFolder } from './wait.ts'

/** One device's latest checkpoint of a repository workspace, as the account's devices read it. */
export interface Checkpoint {
  /** The device that wrote it. */
  device: string
  /** That device's file transport peer. */
  peer: string
  /** The transfer folder the checkpoint travels in, the same for every checkpoint of this workspace and device. */
  folder: string
  /** Content address: equal checkpoints have equal ids. */
  id: string
  /** The commit the work builds on. */
  head: string
  /** The branch checked out, absent on a detached `HEAD`. */
  branch?: string
  /** When it was written, epoch milliseconds. */
  at: number
}

/** The description written last into a checkpoint's folder, so a receiver knows the content is complete. */
interface CheckpointMeta {
  id: string
  bundle: boolean
  untracked: string[]
}

/** Limits and locations of checkpoints. */
export interface WorkStateOptions {
  /** Directory transfer folders live in. */
  transferRoot: string
  /** Largest checkpoint, in bytes, of tracked changes and untracked files together; a larger one is not written. */
  checkpointMaxBytes: number
  /** Delay after a turn before its work is checkpointed, so a burst of turns writes one checkpoint. */
  checkpointDebounceMs: number
  /** Longest a turn waits for another device's checkpoint to arrive before it runs without it. */
  handoffWaitMs: number
  /** File recording which checkpoint each workspace last applied on this device. */
  stateFile: string
}

/** The account's repositories document as this device opened it. */
interface Account {
  device: DeviceId
  document: SyncDocument
}

/** Name of the bundle of unpushed commits inside a checkpoint folder. */
const BUNDLE = 'commits.bundle'
/** Name of the binary diff of tracked changes inside a checkpoint folder. */
const DIFF = 'changes.diff'
/** Directory holding copies of untracked files inside a checkpoint folder. */
const UNTRACKED = 'untracked'
/** Name of the description written last inside a checkpoint folder. */
const META = 'checkpoint.json'

/** Writes, publishes, and applies the account's work-state checkpoints on this device. */
export class WorkState {
  private readonly timers = new Map<WorkspaceId, NodeJS.Timeout>()
  private readonly writing = new Map<WorkspaceId, Promise<void>>()
  private applied: Record<string, { id: string; at: number }> | undefined
  private disposed = false

  /**
   * @param ctx - context providing `sync` and optionally `fileSync`.
   * @param git - this device's Git.
   * @param options - limits and locations.
   * @param account - the account's opened repositories document, once this device syncs the account.
   */
  constructor(
    private readonly ctx: Context,
    private readonly git: Git,
    private readonly options: WorkStateOptions,
    private readonly account: (owner: string) => Promise<Account | undefined>,
  ) {}

  /**
   * Checkpoint a workspace's work tree after `checkpointDebounceMs`; a later call within the delay replaces it.
   * @param owner - the account.
   * @param workspace - the repository workspace.
   * @param path - its work tree here.
   */
  schedule(owner: string, workspace: WorkspaceId, path: string): void {
    clearTimeout(this.timers.get(workspace))
    this.timers.set(workspace, setTimeout(() => {
      this.timers.delete(workspace)
      void this.checkpoint(owner, workspace, path)
    }, this.options.checkpointDebounceMs))
  }

  /**
   * Write and publish a workspace's checkpoint now, after any checkpoint of it still being written. A work tree equal
   * to the published checkpoint writes nothing.
   * @param owner - the account.
   * @param workspace - the repository workspace.
   * @param path - its work tree here.
   * @returns when the checkpoint is published or skipped.
   */
  checkpoint(owner: string, workspace: WorkspaceId, path: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const run = (this.writing.get(workspace) ?? Promise.resolve())
      .then(() => this.checkpointNow(owner, workspace, path))
      .catch((error: unknown) => { this.warn(`checkpointing a repository failed: ${String(error)}`) })
    this.writing.set(workspace, run)
    return run
  }

  /**
   * Apply the newest checkpoint another device published for a workspace, when it is newer than this device's own
   * work there and than what was applied last. Local changes are stashed first, and commits the checkpoint would
   * leave behind keep a ref, so nothing this device had is lost.
   * @param owner - the account.
   * @param workspace - the repository workspace.
   * @param path - its work tree here.
   * @param signal - the turn's abort signal.
   * @returns when the checkpoint is applied, or the wait for it ran out.
   */
  async apply(owner: string, workspace: WorkspaceId, path: string, signal: AbortSignal): Promise<void> {
    const fileSync = this.ctx.get('fileSync')
    const account = await this.account(owner)
    if (fileSync === undefined || account === undefined || this.disposed) return
    const checkpoints = checkpointMap(account)
    const own = checkpoints.get(`${workspace}/${account.device}`)
    const applied = (await this.appliedState())[workspace]
    let newest: Checkpoint | undefined
    for (const [key, checkpoint] of checkpoints) {
      if (!key.startsWith(`${workspace}/`) || checkpoint.device === account.device) continue
      if (newest === undefined || checkpoint.at > newest.at) newest = checkpoint
    }
    const known = Math.max(own?.at ?? 0, applied?.at ?? 0)
    if (newest === undefined || newest.at <= known || newest.id === applied?.id) return
    // Another device wrote these fields: the folder id names a directory here, and the branch reaches Git's argv.
    if (!/^[0-9a-f-]{36}$/u.test(newest.folder) || newest.branch?.startsWith('-') === true || !/^[0-9a-f]{40,64}$/u.test(newest.head)) return
    const folder = brandString<FileSyncFolderId>(newest.folder)
    const incoming = join(this.options.transferRoot, 'incoming', newest.folder)
    await fileSync.share({ id: folder, owner, path: incoming, peers: [brandString<FileSyncPeerId>(newest.peer)] })
    const expected = newest.id
    const arrived = await untilFolder(this.ctx, fileSync, folder, Date.now() + this.options.handoffWaitMs, async () => {
      return (await readMeta(incoming))?.id === expected
    })
    if (!arrived || signal.aborted) {
      this.warn('the work from another device did not arrive in time; the turn runs without it')
      return
    }
    const meta = await readMeta(incoming)
    if (meta === undefined) return
    await this.applyFolder(path, incoming, newest, meta)
    await this.recordApplied(workspace, { id: newest.id, at: newest.at })
  }

  /** Stop pending checkpoints and let running ones finish. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.all(this.writing.values())
  }

  private async checkpointNow(owner: string, workspace: WorkspaceId, path: string): Promise<void> {
    const fileSync = this.ctx.get('fileSync')
    const account = await this.account(owner)
    if (fileSync === undefined || account === undefined) return
    const headResult = await this.git.run(['rev-parse', '--verify', 'HEAD'], { cwd: path })
    // A repository without a commit has no base for other devices to build on.
    if (headResult.exitCode !== 0) return
    const head = headResult.stdout.trim()
    const branch = (await this.git.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: path })).stdout.trim()
    const checkpoints = checkpointMap(account)
    const key = `${workspace}/${account.device}`
    const published = checkpoints.get(key)
    const folderId = published?.folder ?? randomUUID()
    const dir = join(this.options.transferRoot, 'checkpoints', folderId)
    const staging = `${dir}.staging`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    try {
      await this.git.output(['diff', '--binary', 'HEAD', `--output=${join(staging, DIFF)}`], { cwd: path })
      const listed = await this.git.output(['ls-files', '-z', '--others', '--exclude-standard'], { cwd: path })
      const untracked = listed.split('\0').filter(entry => entry !== '')
      const unpushed = Number((await this.git.output(['rev-list', '--count', 'HEAD', '--not', '--remotes'], { cwd: path })).trim())
      const hash = createHash('sha256').update(`${head}\n${branch}\n`)
      hash.update(await readFile(join(staging, DIFF)))
      let bytes = (await stat(join(staging, DIFF))).size
      for (const entry of untracked) {
        const info = await stat(join(path, entry)).catch(() => undefined)
        if (info?.isFile() !== true) continue
        bytes += info.size
        hash.update(`${entry}\0${String(info.size)}\0${String(info.mtimeMs)}\n`)
      }
      const id = hash.digest('hex')
      // An unchanged work tree whose folder still holds the checkpoint is only shared again, as after a restart.
      if (published?.id === id && (await readMeta(dir))?.id === id) {
        await fileSync.share({ id: brandString<FileSyncFolderId>(folderId), owner, path: dir })
        return
      }
      if (bytes > this.options.checkpointMaxBytes) {
        this.warn(`the work in ${path} is larger than checkpointMaxBytes and does not travel to other devices`)
        return
      }
      if (unpushed > 0) {
        await this.git.output(['bundle', 'create', join(staging, BUNDLE), 'HEAD', '--not', '--remotes'], { cwd: path, transfer: true })
      }
      const copied: string[] = []
      for (const entry of untracked) {
        const from = join(path, entry)
        if ((await stat(from).catch(() => undefined))?.isFile() !== true) continue
        const to = join(staging, UNTRACKED, entry)
        await mkdir(dirname(to), { recursive: true })
        await cp(from, to)
        copied.push(entry)
      }
      const meta: CheckpointMeta = { id, bundle: unpushed > 0, untracked: copied }
      // The description is written last: a receiver that reads it reads a complete checkpoint.
      await rm(dir, { recursive: true, force: true })
      await cp(staging, dir, { recursive: true })
      await writeFile(join(dir, META), JSON.stringify(meta))
      await fileSync.share({ id: brandString<FileSyncFolderId>(folderId), owner, path: dir })
      checkpoints.set(key, {
        device: account.device,
        peer: await fileSync.peerId(),
        folder: folderId,
        id,
        head,
        ...branch === '' ? {} : { branch },
        at: Date.now(),
      })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  /** Bring a work tree to a received checkpoint: stash local changes, take its commits and branch, then its changes. */
  private async applyFolder(path: string, incoming: string, checkpoint: Checkpoint, meta: CheckpointMeta): Promise<void> {
    const run = (args: string[], transfer = false) => this.git.run(args, { cwd: path, transfer })
    if ((await run(['status', '--porcelain'])).stdout.trim() !== '') {
      await this.git.output(['stash', 'push', '--include-untracked', '-m', 'Aeven: before applying work from another device'], { cwd: path })
    }
    if (meta.bundle) {
      await run(['fetch', '--no-tags', join(incoming, BUNDLE), '+HEAD:refs/aeven/checkpoint'], true)
    }
    if ((await run(['cat-file', '-e', `${checkpoint.head}^{commit}`])).exitCode !== 0) {
      await run(['fetch', '--no-tags', '--all'], true)
      if ((await run(['cat-file', '-e', `${checkpoint.head}^{commit}`])).exitCode !== 0) {
        this.warn('the work from another device builds on a commit this device cannot get; it was not applied')
        return
      }
    }
    const current = (await run(['rev-parse', 'HEAD'])).stdout.trim()
    if (current !== checkpoint.head) {
      if ((await run(['merge-base', '--is-ancestor', checkpoint.head, 'HEAD'])).exitCode === 0) {
        // This device is ahead of the checkpoint: its own commits are newer, so the checkpoint is left out.
        return
      }
      if ((await run(['merge-base', '--is-ancestor', 'HEAD', checkpoint.head])).exitCode !== 0) {
        // Diverged: keep this device's commits reachable before the branch moves to the checkpoint.
        await run(['update-ref', `refs/aeven/before/${checkpoint.id.slice(0, 12)}`, current])
      }
      const moved = checkpoint.branch === undefined
        ? await run(['checkout', '--detach', checkpoint.head])
        : await run(['checkout', '-B', checkpoint.branch, checkpoint.head])
      if (moved.exitCode !== 0) {
        this.warn(`switching to the work from another device failed: ${moved.stderr.trim().slice(-300)}`)
        return
      }
    }
    const diff = join(incoming, DIFF)
    if (((await stat(diff).catch(() => undefined))?.size ?? 0) > 0) {
      const applied = await run(['apply', '--binary', '--whitespace=nowarn', diff])
      if (applied.exitCode !== 0) this.warn(`applying the changes from another device failed: ${applied.stderr.trim().slice(-300)}`)
    }
    for (const entry of meta.untracked) {
      // Another device wrote the list; a path that would leave the work tree or reach `.git` is skipped.
      const segments = entry.split('/')
      if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment === '.git')) continue
      const to = join(path, ...segments)
      if (existsSync(to)) continue
      await mkdir(dirname(to), { recursive: true })
      await cp(join(incoming, UNTRACKED, ...segments), to)
    }
  }

  private async appliedState(): Promise<Record<string, { id: string; at: number }>> {
    if (this.applied !== undefined) return this.applied
    try {
      const parsed: unknown = JSON.parse(await readFile(this.options.stateFile, 'utf8'))
      this.applied = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, { id: string; at: number }> : {}
    } catch {
      // No state yet, or one this version cannot read: every checkpoint counts as not applied.
      this.applied = {}
    }
    return this.applied
  }

  private async recordApplied(workspace: WorkspaceId, entry: { id: string; at: number }): Promise<void> {
    const state = await this.appliedState()
    state[workspace] = entry
    await mkdir(dirname(this.options.stateFile), { recursive: true })
    await writeFile(this.options.stateFile, JSON.stringify(state))
  }

  private warn(message: string): void {
    this.ctx.logger('workspace-git-sync').warn(`workspace-git-sync: ${message}`)
  }
}

/** `<workspace id>/<device id>` to each device's latest checkpoint of the workspace. */
function checkpointMap(account: Account): YMap<Checkpoint> {
  return account.document.doc.getMap<Checkpoint>('checkpoints')
}

/** The description in a checkpoint folder, once it is complete. */
async function readMeta(dir: string): Promise<CheckpointMeta | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, META), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const meta = parsed as Partial<CheckpointMeta>
    if (typeof meta.id !== 'string' || typeof meta.bundle !== 'boolean' || !Array.isArray(meta.untracked)) return undefined
    return { id: meta.id, bundle: meta.bundle, untracked: meta.untracked.filter(entry => typeof entry === 'string') }
  } catch {
    // Absent or half-written: the checkpoint has not arrived yet.
    return undefined
  }
}
