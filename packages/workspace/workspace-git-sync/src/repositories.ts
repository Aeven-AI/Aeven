/**
 * The account's repository workspaces on this device: what each one's repository is, which devices hold it, how a
 * device without it gets it, and its environment files.
 * @module @aeven/workspace-git-sync/repositories
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import { brandString } from '@aeven/brand'
import type { FileSync, FileSyncFolderId, FileSyncPeerId } from '@aeven/file-sync'
import type { SyncDocument } from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import type { SessionId } from '@aeven/session'
import type {} from '@aeven/shell'
import { byRecentUse, fitsDisk, hintedDirectory, locationHint, onBatteryPower, placeWorkspace, WorkspaceFileStatusReport } from '@aeven/workspace'
import type { Workspace, WorkspaceFileFailure, WorkspaceFileStatus, WorkspaceId } from '@aeven/workspace'
import { CheckoutDiscovery, parentsOf } from './discovery.ts'
import { EnvFileNames, readEnvFiles, restoreEnvFiles, type EnvFileOptions } from './env-files.ts'
import { GitUnavailableError, type Git } from './git.ts'
import { publicRemote, remoteKey } from './remote.ts'
import { untilFolder } from './wait.ts'
import { WorkState } from './work-state.ts'

/** The document describing the account's repository workspaces, their holders, and copy requests. */
const REPOSITORIES = 'workspace-git/repositories'
/** The bundle file a holder writes into a transfer folder. */
const BUNDLE = 'repository.bundle'

/** One repository workspace as the account's devices describe it. */
export interface SyncedRepository {
  /** The remote URL without credentials; absent for a repository only its devices hold. */
  remote?: string
  /** The branch checked out on the device that described it last. */
  branch?: string
  /** The directory relative to the describing device's home directory, `/`-separated; a placement hint. */
  hint?: string
  /** Size of the repository's objects and checked-out files. */
  bytes: number
}

/** A device's request for a copy of a repository from one of the account's devices that holds it. */
interface CopyRequest {
  /** The requesting device's file transport peer. */
  peer: string
  /** The transfer folder the copy travels in, random per request. */
  folder: string
  /** `requested` until a holder takes it, `serving` while it writes the copy, `ready` once the copy is shared. */
  state: 'requested' | 'serving' | 'ready'
  /** The holder's file transport peer, once ready. */
  holder?: string
  /** The copy's size, once ready. */
  bytes?: number
}

/** Where received repositories go, and the time limits of getting them. */
export interface WorkspaceRepositoriesOptions {
  /** Directory a repository lands in when its hint names no free directory here. */
  root: string
  /** Share of the disk a download must leave free. */
  minFreeDiskRatio: number
  /** Directory transfer folders live in while a copy travels. */
  transferRoot: string
  /** Shortest wait before trying again to get a repository that could not be cloned or copied. */
  retryMs: number
  /** Longest a copy request waits for a device that holds the repository to take it. */
  copyAnswerMs: number
  /** Longest a copy from another device may take, from request to clone. */
  copyTimeoutMs: number
  /** Lifetime of the lease that picks one holder for a copy. */
  copyLeaseMs: number
  /** Which ignored files travel. */
  envFiles: EnvFileOptions
  /** Largest checkpoint of uncommitted work, in bytes, that travels to other devices. */
  checkpointMaxBytes: number
  /** Delay after a turn before its work is checkpointed. */
  checkpointDebounceMs: number
  /** Longest a turn waits for another device's checkpoint before it runs without it. */
  handoffWaitMs: number
  /** File recording which checkpoint each workspace last applied on this device. */
  checkpointStateFile: string
  /** Size above which a first clone or copy waits while this computer runs on battery. */
  batteryDeferBytes: number
  /** Install a received repository's dependencies from its lockfile when the toolchain is on `PATH`. */
  prepareDependencies: boolean
  /** Longest a dependency install runs. */
  prepareTimeoutMs: number
}

/** Lockfiles, the toolchain each needs, and its frozen install, in the order a repository is checked. */
const PREPARATIONS: ReadonlyArray<{ lockfile: string; tool: string; command: string }> = [
  { lockfile: 'pnpm-lock.yaml', tool: 'pnpm', command: 'pnpm install --frozen-lockfile' },
  { lockfile: 'bun.lock', tool: 'bun', command: 'bun install --frozen-lockfile' },
  { lockfile: 'bun.lockb', tool: 'bun', command: 'bun install --frozen-lockfile' },
  { lockfile: 'yarn.lock', tool: 'yarn', command: 'yarn install --frozen-lockfile' },
  { lockfile: 'package-lock.json', tool: 'npm', command: 'npm ci' },
  { lockfile: 'uv.lock', tool: 'uv', command: 'uv sync --frozen' },
  { lockfile: 'poetry.lock', tool: 'poetry', command: 'poetry install --no-interaction' },
  { lockfile: 'Pipfile.lock', tool: 'pipenv', command: 'pipenv sync' },
  { lockfile: 'Cargo.lock', tool: 'cargo', command: 'cargo fetch --locked' },
  { lockfile: 'go.sum', tool: 'go', command: 'go mod download' },
  { lockfile: 'Gemfile.lock', tool: 'bundle', command: 'bundle install' },
]

interface Account {
  device: DeviceId
  document: SyncDocument
}

/** One repository's environment files as this device follows them. */
interface EnvFiles {
  owner: string
  path: string
  document: SyncDocument
  /** The local files as this device last read them; undefined until the first read. */
  known: Map<string, string> | undefined
}

/** A copy this device serves to another device. */
interface Served {
  folder: FileSyncFolderId
  directory: string
  timer: NodeJS.Timeout
}

/** Keeps each account's repository workspaces present on every device that syncs the account. */
export class WorkspaceRepositories {
  private readonly accounts = new Map<string, Promise<Account | undefined>>()
  private readonly passes = new Map<string, Promise<void>>()
  private readonly serving = new Map<string, Promise<void>>()
  private readonly env = new Map<WorkspaceId, EnvFiles>()
  private readonly retryAt = new Map<WorkspaceId, number>()
  private readonly served = new Map<string, Served>()
  /** Called on every change of the copy requests, so a waiting request sees the holder's answer. */
  private readonly requestWaiters = new Set<() => void>()
  private readonly names: EnvFileNames
  private readonly statuses: WorkspaceFileStatusReport
  private readonly workState: WorkState
  /** Repositories whose dependencies are being installed after they arrived. */
  private readonly preparing = new Set<WorkspaceId>()
  private disposed = false

  /**
   * @param ctx - context providing `workspaceRegistry`, `sync`, and `subprocess`, and optionally `fileSync`.
   * @param git - this device's Git.
   * @param discovery - finds existing checkouts.
   * @param options - placement, budgets, and time limits.
   */
  constructor(
    private readonly ctx: Context,
    private readonly git: Git,
    private readonly discovery: CheckoutDiscovery,
    private readonly options: WorkspaceRepositoriesOptions,
  ) {
    this.names = new EnvFileNames(options.envFiles)
    this.statuses = new WorkspaceFileStatusReport(ctx.workspaceRegistry)
    this.workState = new WorkState(ctx, git, {
      transferRoot: options.transferRoot,
      checkpointMaxBytes: options.checkpointMaxBytes,
      checkpointDebounceMs: options.checkpointDebounceMs,
      handoffWaitMs: options.handoffWaitMs,
      stateFile: options.checkpointStateFile,
    }, owner => this.accounts.get(owner) ?? Promise.resolve(undefined))
  }

  /**
   * Checkpoint a session's repository at once because another device took the session over, so that device can
   * continue from this device's work.
   * @param owner - the account.
   * @param sessionId - the session the other device claimed.
   */
  async released(owner: string, sessionId: SessionId): Promise<void> {
    const repository = this.sessionRepository(sessionId)
    if (repository !== undefined && !this.ctx.workspaceRegistry.filesPaused(owner)) {
      await this.workState.checkpoint(owner, repository.id, repository.path)
    }
  }

  /**
   * Checkpoint a session's repository shortly after a turn ends, once a burst of turns has settled.
   * @param sessionId - the session whose turn ended.
   */
  turnEnded(sessionId: SessionId): void {
    const repository = this.sessionRepository(sessionId)
    if (repository?.owner === undefined || this.ctx.workspaceRegistry.filesPaused(repository.owner)) return
    this.workState.schedule(repository.owner, repository.id, repository.path)
  }

  /**
   * Before a session's turn, apply newer work another device left in the session's repository.
   * @param sessionId - the session about to run a turn.
   * @param signal - the turn's abort signal.
   */
  async beforeTurn(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    const repository = this.sessionRepository(sessionId)
    if (repository?.owner === undefined || this.ctx.workspaceRegistry.filesPaused(repository.owner)) return
    this.workState.postpone(repository.id)
    await this.workState.apply(repository.owner, repository.id, repository.path, signal)
  }

  /**
   * Re-check repositories that wait for power after this computer was plugged in.
   */
  powerChanged(): void {
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      if (this.ctx.workspaceRegistry.fileStatus(workspace.id)?.state === 'paused') this.retryAt.delete(workspace.id)
    }
    this.reconcileAll()
  }

  /**
   * Install a repository's dependencies from its lockfile through the shell capability, which applies the Host's
   * sandbox; a missing lockfile, toolchain, or shell skips the step, and the agent installs them when a task needs it.
   */
  private async prepare(workspace: WorkspaceId, directory: string): Promise<void> {
    const shell = this.ctx.get('shell')
    if (!this.options.prepareDependencies || shell === undefined) return
    const step = PREPARATIONS.find(candidate => existsSync(join(directory, candidate.lockfile)))
    if (step === undefined) return
    if (await this.ctx.subprocess.resolveExecutable(step.tool).catch(() => undefined) === undefined) return
    this.preparing.add(workspace)
    this.statuses.set(workspace, { state: 'preparing' })
    try {
      const result = await shell.run(shell.resolve({ command: step.command, workdir: directory, timeoutMs: this.options.prepareTimeoutMs }))
      if (result.exitCode !== 0) this.warn(`installing dependencies with ${step.command} in ${directory} exited ${String(result.exitCode)}`)
    } catch (error) {
      this.warn(`installing dependencies in ${directory} failed: ${String(error)}`)
    } finally {
      this.preparing.delete(workspace)
      this.statuses.set(workspace, undefined)
    }
  }

  /** The repository workspace a session works in on this device, when it is a bound Git work tree. */
  private sessionRepository(sessionId: SessionId): { id: WorkspaceId; path: string; owner: string | undefined } | undefined {
    const placement = this.ctx.workspaceRegistry.placeSession(sessionId)
    if (placement.state !== 'filed') return undefined
    const { workspace } = placement
    if (workspace.kind !== 'folder' || workspace.path === undefined || !isWorkTree(workspace.path)) return undefined
    return { id: workspace.id, path: workspace.path, owner: workspace.owner }
  }

  /**
   * Open the account's document once this device syncs it, withdraw copy requests a previous run left, and
   * reconcile. Later calls for an attached account return at once.
   * @param owner - the account.
   */
  async attach(owner: string): Promise<void> {
    if (this.accounts.has(owner)) return
    const account = await this.account(owner)
    if (account === undefined) return
    const requests = requestMap(account)
    for (const key of [...requests.keys()]) {
      if (key.endsWith(`/${account.device}`)) requests.delete(key)
    }
    await this.reconcile(owner)
    await this.serve(owner)
  }

  /** Run {@link serveNow} after the account's previous run, so one request is never taken twice. */
  private serve(owner: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const run = (this.serving.get(owner) ?? Promise.resolve()).then(() => this.serveNow(owner)).catch((error: unknown) => {
      this.warn(`answering copy requests failed: ${String(error)}`)
    })
    this.serving.set(owner, run)
    return run
  }

  /** Reconcile every attached account. */
  reconcileAll(): void {
    for (const owner of this.accounts.keys()) void this.reconcile(owner)
  }

  /**
   * Act on the user's request for a workspace's files: install Git when the repository waits for it, which the user
   * has just accepted, then try every repository that waited for Git again at once. A request for a workspace this
   * Consumer does not report on is ignored.
   * @param workspace - the workspace whose files were requested.
   */
  requested(workspace: WorkspaceId): void {
    const registry = this.ctx.workspaceRegistry
    if (!needsGit(registry.fileStatus(workspace))) return
    const waiting = registry.list().filter(other => needsGit(registry.fileStatus(other.id))).map(other => other.id)
    for (const id of waiting) this.statuses.set(id, { state: 'installing' })
    this.git.install().then(() => {
      for (const id of waiting) this.retryAt.delete(id)
      this.reconcileAll()
    }, (error: unknown) => {
      this.warn(`installing Git failed: ${String(error)}`)
      for (const id of waiting) this.statuses.set(id, { state: 'failed', reason: 'git-install' })
    })
  }

  /**
   * Close the account's documents because they started over under a new key; the next status attaches again.
   * @param owner - the account.
   */
  async reset(owner: string): Promise<void> {
    const opening = this.accounts.get(owner)
    this.accounts.delete(owner)
    const account = await opening
    account?.document.close()
    for (const [workspace, files] of this.env) {
      if (files.owner !== owner) continue
      files.document.close()
      this.env.delete(workspace)
    }
  }

  /** Let running passes finish, stop serving copies, close every open document, and withdraw reported file statuses. */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.passes.values(), ...this.serving.values()])
    await this.workState.dispose()
    for (const key of [...this.served.keys()]) await this.stopServing(key)
    for (const owner of [...this.accounts.keys()]) await this.reset(owner)
    this.statuses.clear()
  }

  /** The account's open document, opened on first use once this device syncs the account. */
  private account(owner: string): Promise<Account | undefined> {
    let opening = this.accounts.get(owner)
    if (opening === undefined) {
      const { state, device } = this.ctx.sync.status(owner)
      if (state === 'disabled' || state === 'starting' || device === undefined) return Promise.resolve(undefined)
      opening = this.open(owner, device)
      this.accounts.set(owner, opening)
    }
    return opening
  }

  private open(owner: string, device: DeviceId): Promise<Account | undefined> {
    return this.ctx.sync.openDocument(owner, REPOSITORIES).then((document) => {
      repositoryMap({ device, document }).observe((_event: YMapEvent<SyncedRepository>, transaction: Transaction) => {
        if (!transaction.local) void this.reconcile(owner)
      })
      requestMap({ device, document }).observe((_event: YMapEvent<CopyRequest>, transaction: Transaction) => {
        for (const wake of this.requestWaiters) wake()
        if (!transaction.local) void this.serve(owner)
      })
      return { device, document }
    }).catch((error: unknown) => {
      this.accounts.delete(owner)
      this.warn(`opening the account's repositories failed: ${String(error)}`)
      return undefined
    })
  }

  private reconcile(owner: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const pass = (this.passes.get(owner) ?? Promise.resolve()).then(() => this.reconcileNow(owner)).catch((error: unknown) => {
      this.warn(`reconciling repositories failed: ${String(error)}`)
    })
    this.passes.set(owner, pass)
    return pass
  }

  /**
   * Describe each repository workspace this device holds and publish its environment files, and give a repository
   * workspace that arrived from another device an existing checkout, a clone, or a copy from a device that holds it.
   */
  private async reconcileNow(owner: string): Promise<void> {
    const account = await this.accounts.get(owner)
    if (account === undefined) return
    const repositories = repositoryMap(account)
    const holders = holderMap(account)
    const workspaces = byRecentUse(this.ctx.workspaceRegistry.list().filter(workspace => workspace.owner === owner && !workspace.isBuiltIn))
    const held = new Set<WorkspaceId>()
    const arriving = new Set<WorkspaceId>()
    for (const workspace of workspaces) {
      if (workspace.kind === 'folder' && workspace.path !== undefined && isWorkTree(workspace.path)) {
        held.add(workspace.id)
        const next = await this.describe(workspace.path)
        if (JSON.stringify(repositories.get(workspace.id)) !== JSON.stringify(next)) repositories.set(workspace.id, next)
        const key = `${workspace.id}/${account.device}`
        if (holders.get(key) !== true) holders.set(key, true)
        await this.publishEnv(owner, workspace.id, workspace.path)
        // The pass also catches work done outside a turn; an unchanged work tree writes nothing.
        if (!this.ctx.workspaceRegistry.filesPaused(owner)) void this.workState.checkpoint(owner, workspace.id, workspace.path)
      } else if (workspace.kind === 'remote') {
        const entry = repositories.get(workspace.id)
        if (entry === undefined) continue
        arriving.add(workspace.id)
        if (this.ctx.workspaceRegistry.filesPaused(owner)) {
          this.statuses.set(workspace.id, { state: 'stopped' })
          continue
        }
        if (Date.now() >= (this.retryAt.get(workspace.id) ?? 0)) await this.materialize(account, owner, workspace, entry)
      }
    }
    // Another account's workspaces keep their statuses; a deleted or bound workspace's status goes.
    this.statuses.retain((id) => {
      const other = this.ctx.workspaceRegistry.get(id)
      return other !== undefined && (other.owner !== owner || arriving.has(id) || this.preparing.has(id))
    })
    for (const key of [...holders.keys()]) {
      const [workspace, device] = key.split('/')
      if (device === account.device && !held.has(brandString<WorkspaceId>(workspace ?? ''))) holders.delete(key)
    }
    for (const [workspace, files] of this.env) {
      if (files.owner !== owner || held.has(workspace)) continue
      files.document.close()
      this.env.delete(workspace)
    }
  }

  /** The repository at a work tree as the account's devices see it. */
  private async describe(path: string): Promise<SyncedRepository> {
    const names = (await this.git.output(['remote'], { cwd: path })).split('\n').filter(name => name !== '')
    const name = names.includes('origin') ? 'origin' : names[0]
    const url = name === undefined ? undefined : (await this.git.run(['remote', 'get-url', name], { cwd: path })).stdout.trim()
    const remote = url === undefined || url === '' ? undefined : publicRemote(url)
    const branch = (await this.git.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: path })).stdout.trim()
    const hint = locationHint(path)
    return {
      ...remote === undefined ? {} : { remote },
      ...branch === '' ? {} : { branch },
      ...hint === undefined ? {} : { hint },
      bytes: await this.size(path),
    }
  }

  /** Bytes of the repository's objects plus its checked-out files as the index records them. */
  private async size(path: string): Promise<number> {
    const counts = await this.git.output(['count-objects', '-v'], { cwd: path })
    const kib = (field: string): number => Number(new RegExp(`^${field}: (\\d+)$`, 'mu').exec(counts)?.[1] ?? 0)
    // `%(objectsize)` needs Git 2.38; an older Git counts the objects alone.
    const listed = await this.git.run(['ls-files', '--format=%(objectsize)'], { cwd: path })
    const files = listed.exitCode === 0 ? listed.stdout.split('\n').reduce((sum, line) => sum + (Number(line) || 0), 0) : 0
    return (kib('size') + kib('size-pack')) * 1024 + files
  }

  /**
   * Get a repository workspace that arrived from another device: bind an existing checkout of its remote, or clone
   * it into a placed directory, or copy it from a device that holds it, when it fits the disk budget. A failure waits
   * for `retryMs` before the next try. The workspace's file status follows each step and stays at the last failure
   * until the next try.
   */
  private async materialize(account: Account, owner: string, workspace: Workspace, entry: SyncedRepository): Promise<void> {
    this.retryAt.set(workspace.id, Date.now() + this.options.retryMs)
    const registry = this.ctx.workspaceRegistry
    const bound = registry.list().flatMap(other => other.path === undefined ? [] : [other.path])
    // Another device wrote the entry: a remote must be a network URL, and a branch name may not read as an option.
    const key = entry.remote === undefined ? undefined : remoteKey(entry.remote)
    const remote = key === undefined ? undefined : entry.remote
    const branch = entry.branch?.startsWith('-') === false ? entry.branch : undefined
    if (key !== undefined) {
      const hinted = entry.hint === undefined ? undefined : hintedDirectory(entry.hint)
      const direct = hinted === undefined ? [] : [hinted]
      const existing = await this.discovery.find(key, direct, parentsOf(bound), new Set(bound))
      if (existing !== undefined) {
        await this.restoreEnv(owner, workspace.id, existing)
        this.retryAt.delete(workspace.id)
        // Binding commits a registry change, whose `workspace/changed` runs the pass that describes the repository.
        await registry.bind(workspace.id, existing)
        this.statuses.set(workspace.id, undefined)
        return
      }
    }
    if (!await fitsDisk(this.options.root, entry.bytes, this.options.minFreeDiskRatio)) {
      this.statuses.set(workspace.id, { state: 'failed', reason: 'disk' })
      return
    }
    if (entry.bytes > this.options.batteryDeferBytes && await onBatteryPower(this.ctx)) {
      this.statuses.set(workspace.id, { state: 'paused' })
      return
    }
    // Git installs only once the user accepts; the request then tries this repository again.
    if (!await this.git.available()) {
      if (this.ctx.workspaceRegistry.fileStatus(workspace.id)?.state !== 'installing') {
        this.statuses.set(workspace.id, { state: 'git-needed' })
      }
      return
    }
    this.statuses.set(workspace.id, { state: 'syncing' })
    const directory = await placeWorkspace(workspace.title, entry.hint, this.options.root)
    try {
      const cloned = remote === undefined ? undefined : await this.clone(remote, directory)
      let got = cloned === true
      if (got && branch !== undefined) await this.git.run(['switch', branch], { cwd: directory })
      if (!got) {
        await emptyDirectory(directory)
        got = await this.copy(account, owner, workspace, { remote, branch }, directory)
      }
      if (!got) {
        await rm(directory, { recursive: true, force: true })
        // A failed copy means no device that holds the repository answered; without file sync only the clone could run.
        this.statuses.set(workspace.id, this.ctx.get('fileSync') === undefined && typeof cloned === 'string'
          ? { state: 'failed', reason: cloneFailure(cloned) }
          : { state: 'waiting' })
        return
      }
      await this.git.run(['submodule', 'update', '--init', '--recursive'], { cwd: directory, transfer: true })
      await this.pullLfs(directory)
      await this.restoreEnv(owner, workspace.id, directory)
      this.retryAt.delete(workspace.id)
      await registry.bind(workspace.id, directory)
      this.statuses.set(workspace.id, undefined)
      void this.prepare(workspace.id, directory)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      this.statuses.set(workspace.id, { state: 'failed', reason: error instanceof GitUnavailableError ? 'git-install' : 'unknown' })
      throw error
    }
  }

  /**
   * Clone from the remote with this device's own credentials, leaving Git LFS objects for {@link pullLfs}.
   * @returns true when the clone succeeded, otherwise the end of Git's error output; a failure leaves the copy from
   *   another device to try.
   */
  private async clone(remote: string, directory: string): Promise<true | string> {
    // Without Git LFS, a required LFS filter would fail the whole clone; LFS objects are pulled afterwards instead.
    const result = await this.git.run(
      ['-c', 'filter.lfs.required=false', 'clone', '--recurse-submodules', '--', remote, directory],
      { cwd: this.options.root, transfer: true, env: { GIT_LFS_SKIP_SMUDGE: '1' } },
    )
    if (result.exitCode === 0) return true
    const error = result.stderr.trim().slice(-300)
    this.warn(`cloning a repository failed, trying a copy from another device: ${error}`)
    return error
  }

  /** Fetch Git LFS objects of the checked-out files when Git LFS is installed; without it they stay pointer files. */
  private async pullLfs(directory: string): Promise<void> {
    if ((await this.git.run(['lfs', 'version'], { cwd: directory })).exitCode !== 0) return
    await this.git.run(['lfs', 'install', '--local'], { cwd: directory })
    const pulled = await this.git.run(['lfs', 'pull'], { cwd: directory, transfer: true })
    if (pulled.exitCode !== 0) this.warn(`fetching Git LFS objects failed: ${pulled.stderr.trim().slice(-300)}`)
  }

  /**
   * Copy the repository from one of the account's devices that holds it: post a request, wait for a holder to share
   * a bundle of every ref through a transfer folder shared only between the two devices, and clone from it. The
   * clone's `origin` is the published remote, or none.
   * @returns whether the copy succeeded.
   */
  private async copy(
    account: Account,
    owner: string,
    workspace: Workspace,
    checkout: { remote: string | undefined; branch: string | undefined },
    directory: string,
  ): Promise<boolean> {
    const fileSync = this.ctx.get('fileSync')
    const hasHolder = [...holderMap(account).keys()].some(key => key.startsWith(`${workspace.id}/`) && !key.endsWith(`/${account.device}`))
    if (fileSync === undefined || !hasHolder) return false
    const requests = requestMap(account)
    const key = `${workspace.id}/${account.device}`
    const folder = brandString<FileSyncFolderId>(randomUUID())
    const transfer = join(this.options.transferRoot, folder)
    const deadline = Date.now() + this.options.copyTimeoutMs
    requests.set(key, { peer: await fileSync.peerId(), folder, state: 'requested' })
    try {
      // A holder that is offline never takes the request; giving up early keeps it from holding up the pass.
      const taken = await this.until(Math.min(deadline, Date.now() + this.options.copyAnswerMs), this.requestWaiters, () => {
        const request = requests.get(key)
        return request?.folder === folder && request.state !== 'requested' ? request : undefined
      })
      if (taken === undefined) return false
      const ready = await this.until(deadline, this.requestWaiters, () => {
        const request = requests.get(key)
        return request?.folder === folder && request.state === 'ready' ? request : undefined
      })
      if (ready?.holder === undefined || ready.bytes === undefined) return false
      await fileSync.share({ id: folder, owner, path: transfer, peers: [brandString<FileSyncPeerId>(ready.holder)] })
      const bundle = join(transfer, BUNDLE)
      const bytes = ready.bytes
      const arrived = await untilFolder(this.ctx, fileSync, folder, deadline, async () => {
        return (await stat(bundle).catch(() => undefined))?.size === bytes
      })
      if (!arrived) return false
      await this.git.output(['clone', '--', bundle, directory], { cwd: this.options.root, transfer: true })
      // Switch while the bundle's branches are still remote-tracking branches of `origin`.
      if (checkout.branch !== undefined) await this.git.run(['switch', checkout.branch], { cwd: directory })
      if (checkout.remote === undefined) await this.git.output(['remote', 'remove', 'origin'], { cwd: directory })
      else await this.git.output(['remote', 'set-url', 'origin', checkout.remote], { cwd: directory })
      return true
    } finally {
      if (requests.get(key)?.folder === folder) requests.delete(key)
      await fileSync.unshare(folder)
      await rm(transfer, { recursive: true, force: true })
    }
  }

  /**
   * Answer copy requests for repositories this device holds. One holder per request takes it through a lease, writes
   * a bundle of every ref into a new transfer folder, and shares that folder with the requesting device alone; the
   * copy stops being served when the request is withdrawn or `copyTimeoutMs` elapses.
   */
  private async serveNow(owner: string): Promise<void> {
    // A paused account serves no copies; the transfer folders would not move anyway.
    if (this.ctx.workspaceRegistry.filesPaused(owner)) return
    const account = await this.accounts.get(owner)
    const fileSync = this.ctx.get('fileSync')
    if (account === undefined || fileSync === undefined) return
    const requests = requestMap(account)
    for (const [key, served] of this.served) {
      if (requests.get(key)?.folder !== served.folder) await this.stopServing(key)
    }
    for (const [key, request] of requests) {
      const [workspaceId, device] = key.split('/')
      const workspace = this.ctx.workspaceRegistry.list().find(candidate => candidate.id === workspaceId && candidate.owner === owner)
      if (request.state !== 'requested' || device === account.device || this.served.has(key)) continue
      if (workspace?.kind !== 'folder' || workspace.path === undefined || !isWorkTree(workspace.path)) continue
      await this.serveOne(owner, account, fileSync, key, request, workspace.path).catch((error: unknown) => {
        this.warn(`serving a repository copy failed: ${String(error)}`)
      })
    }
  }

  private async serveOne(
    owner: string,
    account: Account,
    fileSync: FileSync,
    key: string,
    request: CopyRequest,
    path: string,
  ): Promise<void> {
    const lease = `workspace-git/copy/${request.folder}`
    if (!(await this.ctx.sync.acquireLease(owner, lease, this.options.copyLeaseMs)).granted) return
    const requests = requestMap(account)
    try {
      if (requests.get(key)?.folder !== request.folder || requests.get(key)?.state !== 'requested') return
      requests.set(key, { ...request, state: 'serving' })
      const folder = brandString<FileSyncFolderId>(request.folder)
      const directory = join(this.options.transferRoot, folder)
      const timer = setTimeout(() => { void this.stopServing(key) }, this.options.copyTimeoutMs)
      this.served.set(key, { folder, directory, timer })
      await mkdir(directory, { recursive: true })
      await this.git.output(['bundle', 'create', join(directory, BUNDLE), '--all'], { cwd: path, transfer: true })
      const bytes = (await stat(join(directory, BUNDLE))).size
      await fileSync.share({ id: folder, owner, path: directory, peers: [brandString<FileSyncPeerId>(request.peer)] })
      if (requests.get(key)?.folder === request.folder) requests.set(key, { ...request, state: 'ready', holder: await fileSync.peerId(), bytes })
    } finally {
      await this.ctx.sync.releaseLease(owner, lease).catch(() => undefined)
    }
  }

  private async stopServing(key: string): Promise<void> {
    const served = this.served.get(key)
    if (served === undefined) return
    this.served.delete(key)
    clearTimeout(served.timer)
    await this.ctx.get('fileSync')?.unshare(served.folder)
    await rm(served.directory, { recursive: true, force: true })
  }

  /** Publish the work tree's environment files that are new or changed since this device last read them. */
  private async publishEnv(owner: string, workspace: WorkspaceId, path: string): Promise<void> {
    const files = await this.envFiles(owner, workspace, path)
    const local = await readEnvFiles(this.git, path, this.names, this.options.envFiles)
    const published = files.document.doc.getMap<string>('files')
    for (const [name, content] of local) {
      // The first read after start publishes only names the account lacks, so a stale local copy replaces nothing.
      const changed = files.known === undefined ? !published.has(name) : files.known.get(name) !== content
      if (changed && published.get(name) !== content) published.set(name, content)
    }
    files.known = local
  }

  /** Write the environment files another device published that this work tree lacks. */
  private async restoreEnv(owner: string, workspace: WorkspaceId, path: string): Promise<void> {
    const files = await this.envFiles(owner, workspace, path)
    const written = await restoreEnvFiles(path, files.document.doc.getMap<string>('files').entries(), this.names, this.options.envFiles)
    if (written.length > 0) this.ctx.logger('workspace-git-sync').info(`workspace-git-sync: restored ${String(written.length)} environment files`)
  }

  private async envFiles(owner: string, workspace: WorkspaceId, path: string): Promise<EnvFiles> {
    const open = this.env.get(workspace)
    if (open !== undefined) {
      open.path = path
      return open
    }
    const document = await this.ctx.sync.openDocument(owner, `workspace-git/env/${workspace}`)
    const files: EnvFiles = { owner, path, document, known: undefined }
    this.env.set(workspace, files)
    document.doc.getMap<string>('files').observe((_event: YMapEvent<string>, transaction: Transaction) => {
      if (!transaction.local) void this.restoreEnv(owner, workspace, files.path).catch((error: unknown) => { this.warn(String(error)) })
    })
    return files
  }

  /** Resolve with the first value `check` returns while waiters are woken, or undefined at the deadline. */
  private until<T>(deadline: number, waiters: Set<() => void>, check: () => T | undefined): Promise<T | undefined> {
    return new Promise((resolve) => {
      const settle = (value: T | undefined): void => {
        waiters.delete(wake)
        clearTimeout(timer)
        resolve(value)
      }
      const wake = (): void => {
        const value = check()
        if (value !== undefined) settle(value)
      }
      const timer = setTimeout(() => { settle(undefined) }, Math.max(0, deadline - Date.now()))
      waiters.add(wake)
      wake()
    })
  }

  private warn(message: string): void {
    this.ctx.logger('workspace-git-sync').warn(`workspace-git-sync: ${message}`)
  }
}

function repositoryMap(account: Account): YMap<SyncedRepository> {
  return account.document.doc.getMap<SyncedRepository>('repositories')
}

/** `<workspace id>/<device id>` for each device that holds the workspace's repository. */
function holderMap(account: Account): YMap<boolean> {
  return account.document.doc.getMap<boolean>('holders')
}

/** `<workspace id>/<device id>` for each device asking for a copy of the workspace's repository. */
function requestMap(account: Account): YMap<CopyRequest> {
  return account.document.doc.getMap<CopyRequest>('requests')
}

/** Whether a directory is the top of a Git work tree. */
function isWorkTree(path: string): boolean {
  return existsSync(join(path, '.git'))
}

/** Whether a repository waits for Git: it was never installed, or the last install failed and may be tried again. */
function needsGit(status: WorkspaceFileStatus | undefined): boolean {
  return status?.state === 'git-needed' || (status?.state === 'failed' && status.reason === 'git-install')
}

/**
 * Why a clone failed, from the end of Git's error output: refused credentials, an unreachable remote, a full disk, or
 * anything else.
 */
function cloneFailure(stderr: string): WorkspaceFileFailure {
  if (/authentication failed|could not read username|permission denied|repository not found|access denied|403/iu.test(stderr)) return 'access'
  if (/could not resolve host|unable to access|connection (refused|timed out)|network is unreachable|timed out/iu.test(stderr)) return 'network'
  if (/no space left on device|disk quota/iu.test(stderr)) return 'disk'
  return 'unknown'
}

/** Remove what a failed clone left in a directory, keeping the directory. */
async function emptyDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory)) await rm(join(directory, entry), { recursive: true, force: true })
}
