/**
 * Git worktrees as a session capability: one checkout per task, so agents on
 * the same repository do not edit, build, or switch branches in each other's
 * working tree.
 *
 * Checkouts live under the configured directory, outside every repository, so
 * a session confined to one checkout cannot write another. Creating one runs
 * `git worktree add -b <branch> <path> <rev>` through `ctx.subprocess`, runs
 * the first configured setup entry whose marker file the checkout contains,
 * and moves the session there through `ctx.workingDirectory`, which makes the
 * checkout both the directory later calls resolve against and the root
 * sandboxed writes are confined to.
 *
 * A delegated child gets its own checkout when `isolateSubagents` is set:
 * {@link Worktrees.isolate} creates it from a snapshot commit of the parent's
 * working tree — so the child sees the parent's uncommitted changes — and the
 * subagent seam moves the child into it while composing the child.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import z from 'zod'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@aeven/session'
import type {} from '@aeven/session-projection'
import type {} from '@aeven/subprocess'
import type {} from '@aeven/agent'
import type {} from '@aeven/system-prompt'
import type {} from '@aeven/working-directory'
import type {
  CreateWorktreeRequest,
  CreatedWorktree,
  RemovedWorktree,
  WorktreeBranch,
  WorktreeInfo,
  WorktreePath,
  WorktreesUnitState,
} from './types.ts'

export type { WorktreeInfo, CreatedWorktree, CreateWorktreeRequest, RemovedWorktree, WorktreeBranch, WorktreePath }

/** One dependency-setup command, run in a new checkout that contains its marker file. */
export interface SetupEntry {
  /** File at the checkout root that selects this entry, e.g. `pnpm-lock.yaml`. */
  when: string
  /** Command and arguments, run without a shell in the checkout. */
  argv: string[]
}

/** Deployment choices for where checkouts live, how branches are named, and how checkouts are prepared. */
export interface Config {
  /** Absolute directory that holds the checkouts, one subdirectory per repository. */
  directory: string
  /** Prefix every created branch carries, e.g. `avn/`. */
  branchPrefix: string
  /** Grace period in milliseconds for a git or setup child process to exit after termination. */
  graceMs: number
  /** Whether every delegated in-process child agent works in its own checkout. */
  isolateSubagents: boolean
  /** Dependency setup for a new checkout; the first entry whose `when` file exists runs. */
  setup: SetupEntry[]
  /** Milliseconds a setup command may run before it is terminated. */
  setupTimeoutMs: number
}

const createdWorktreeSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  baseCommit: z.string().min(1),
  repositoryRoot: z.string().min(1),
  setup: z.string().nullable(),
}) as unknown as z.ZodType<CreatedWorktree>

/** Characters of a setup command's output kept for the model-visible failure detail. */
const SETUP_DETAIL_CHARS = 1500

/** Resolve and validate a worktree name into a branch and a directory leaf. */
function normaliseName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('worktrees: a worktree name is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(`worktrees: ${JSON.stringify(trimmed)} is not a usable worktree name; use letters, digits, dots, dashes, or underscores`)
  }
  return trimmed
}

/** Parse `git worktree list --porcelain` output into registered checkouts. */
function parseWorktreeList(text: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = []
  let current: { path?: string; ref?: string; head?: string; main: boolean; prunable: boolean } | undefined
  const flush = (): void => {
    if (current?.path !== undefined && current.head !== undefined) {
      entries.push({
        path: current.path as WorktreePath,
        ref: current.ref,
        head: current.head,
        main: current.main,
        prunable: current.prunable,
      })
    }
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice('worktree '.length), main: entries.length === 0, prunable: false }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.ref = line.slice('branch '.length)
    else if (line.startsWith('prunable')) current.prunable = true
  }
  flush()
  return entries
}

/** Render the worktree facts a session's model works from. */
function renderWorktreesContext(state: WorktreesUnitState, root: string | undefined): string {
  const lines: string[] = []
  const entered = state.entered
  if (entered !== null && entered.path === root) {
    lines.push(
      `You work in your own git worktree ${JSON.stringify(entered.path)} on branch ${entered.branch}, `
      + `started from commit ${entered.baseCommit.slice(0, 12)} of the repository at ${JSON.stringify(entered.repositoryRoot)}. `
      + 'Other agents work in other checkouts of the same repository. Commit your finished changes on this branch '
      + 'and name the branch when you report back.',
    )
    if (entered.setup !== null) lines.push(`Dependency setup in this worktree: ${entered.setup}`)
  }
  if (state.delegated.length > 0) {
    lines.push('Subagent worktrees you created, each on its own branch:')
    for (const { worktree, child } of state.delegated) {
      lines.push(`- ${worktree.branch} at ${JSON.stringify(worktree.path)} (subagent ${child}, base ${worktree.baseCommit.slice(0, 12)})`)
    }
    lines.push(
      'To take a subagent\'s committed work: with a clean working tree run `git merge <branch>`; with uncommitted '
      + 'changes run `git diff <base>..<branch> | git apply`. Remove a worktree you no longer need with remove_worktree.',
    )
  }
  return lines.join('\n')
}

/** The git worktree service, registered as `ctx.worktrees`. */
export class Worktrees extends Service {
  static inject = ['subprocess', 'workingDirectory', 'sessionProjections']
  static Config = z.object({
    directory: z.string().min(1).refine(path => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path), 'must be an absolute path'),
    branchPrefix: z.string().min(1),
    graceMs: z.number().int().positive(),
    isolateSubagents: z.boolean(),
    setup: z.array(z.object({ when: z.string().min(1), argv: z.array(z.string().min(1)).min(1) })),
    setupTimeoutMs: z.number().int().positive(),
  })

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'worktrees')
    const parsed = Worktrees.Config.parse(config)
    // Canonical, so checkout paths compare equal to the realpaths git reports.
    mkdirSync(parsed.directory, { recursive: true })
    this.config = { ...parsed, directory: realpathSync.native(parsed.directory) }

    ctx.sessionProjections.register({
      key: 'worktrees',
      stateVersion: 1,
      stateSchema: z.object({
        entered: createdWorktreeSchema.nullable(),
        delegated: z.array(z.object({
          worktree: createdWorktreeSchema,
          child: z.custom<SessionId>(value => typeof value === 'string' && value.length > 0),
        })),
      }),
      init: (): WorktreesUnitState => ({ entered: null, delegated: [] }),
      apply: (state, event) => {
        switch (event.type) {
          case 'worktree/entered':
            return { ...state, entered: event.data.worktree }
          case 'worktree/delegated':
            return { ...state, delegated: [...state.delegated, { worktree: event.data.worktree, child: event.data.child }] }
          case 'worktree/removed':
            return {
              entered: state.entered?.path === event.data.path ? null : state.entered,
              delegated: state.delegated.filter(entry => entry.worktree.path !== event.data.path),
            }
          default:
            return state
        }
      },
    })

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'session:worktrees',
        order: scope.systemPrompt.getContextOrder('WORKTREES'),
        text: (context) => {
          const session = context.agent?.session
          if (session === undefined) return ''
          const state = this.ctx.sessionProjections.stateOf(session, 'worktrees')
          return state === undefined ? '' : renderWorktreesContext(state, this.ctx.workingDirectory.rootOf(session))
        },
      })
    })
  }

  /**
   * Registered checkouts of the session's repository, main working tree first.
   * @param session - the session whose repository is listed.
   * @param signal - cancels the git call.
   * @returns one entry per registered worktree.
   */
  async list(session: Session, signal?: AbortSignal): Promise<WorktreeInfo[]> {
    return parseWorktreeList(await this.git(['worktree', 'list', '--porcelain'], this.directory(session), signal))
  }

  /**
   * Create a branch-backed checkout and move the session into it.
   * @param session - the session that will work in the new checkout.
   * @param request - optional name and starting revision.
   * @param signal - cancels the git and setup calls.
   * @returns the checkout path, its branch, its base commit, the repository root, and the setup outcome.
   */
  async create(session: Session, request: CreateWorktreeRequest = {}, signal?: AbortSignal): Promise<CreatedWorktree> {
    const cwd = this.directory(session)
    const name = normaliseName(request.name ?? `work-${randomUUID().slice(0, 8)}`)
    const baseCommit = (await this.git(['rev-parse', '--verify', '--end-of-options', `${request.from ?? 'HEAD'}^{commit}`], cwd, signal)).trim()
    const created = await this.add(cwd, name, baseCommit, signal)
    await this.ctx.workingDirectory.enter(session, created.path)
    session.append('worktree/entered', { worktree: created })
    return created
  }

  /**
   * Create a checkout for a delegated child from a snapshot of the parent's
   * working tree, and record it on the parent's log. The child moves in
   * through {@link adopt} while it is composed.
   * @param parent - the delegating session.
   * @param child - the child session the checkout is for.
   * @param signal - cancels the git and setup calls.
   * @returns the checkout, or undefined when isolation is off, or the parent
   *   works outside a git repository or in one without commits.
   */
  async isolate(parent: Session, child: SessionId, signal?: AbortSignal): Promise<CreatedWorktree | undefined> {
    if (!this.config.isolateSubagents) return undefined
    const cwd = this.ctx.workingDirectory.of(parent)
    if (cwd === undefined) return undefined
    // A failed probe means "not a repository with a commit to branch from":
    // the child then shares the parent's directory, as without this plugin.
    const probe = await this.run(['git', 'rev-parse', '--verify', '-q', 'HEAD^{commit}'], cwd, signal)
    if (probe.exitCode !== 0) return undefined
    const baseCommit = await this.snapshot(cwd, `Working tree of ${parent.id} for subagent ${child}`, signal)
    // A digest, because session ids may share a prefix such as `session-`.
    const created = await this.add(cwd, `subagent-${createHash('sha256').update(child).digest('hex').slice(0, 8)}`, baseCommit, signal)
    parent.append('worktree/delegated', { worktree: created, child })
    return created
  }

  /**
   * Move a child session into the checkout {@link isolate} created for it.
   * @param child - the child session, inside its creation window.
   * @param worktree - the checkout created for it.
   */
  adopt(child: Session, worktree: CreatedWorktree): void {
    this.ctx.workingDirectory.enterVerified(child, worktree.path)
    child.append('worktree/entered', { worktree })
  }

  /**
   * Remove a checkout and optionally its branch. When the session works in
   * the checkout, it moves back to the repository's main working tree first.
   * @param session - the session removing the checkout.
   * @param name - checkout name; omit for the checkout the session works in.
   * @param options - `deleteBranch` deletes the branch when it is merged into the main working tree's HEAD.
   * @param signal - cancels the git calls.
   * @returns what was removed and where the session works afterwards.
   * @throws when the checkout has uncommitted changes, or the branch is unmerged.
   */
  async remove(
    session: Session,
    name: string | undefined,
    options: { deleteBranch: boolean },
    signal?: AbortSignal,
  ): Promise<RemovedWorktree> {
    const cwd = this.directory(session)
    const { repositoryRoot, checkouts } = await this.repository(cwd, signal)
    let path: string
    if (name === undefined) {
      const entered = this.ctx.sessionProjections.stateOf(session, 'worktrees')?.entered
      if (entered === null || entered === undefined) throw new Error('worktrees: this session is not in a worktree; name the worktree to remove')
      path = entered.path
    } else {
      path = join(checkouts, normaliseName(name))
    }
    // git reports checkout paths with symlinks resolved.
    const canonical = existsSync(path) ? realpathSync.native(path) : path
    const info = (await this.list(session, signal)).find(entry => entry.path === path || entry.path === canonical)
    if (info === undefined || info.main) throw new Error(`worktrees: ${JSON.stringify(path)} is not a removable worktree of this repository`)
    if (this.ctx.workingDirectory.rootOf(session) === path || this.ctx.workingDirectory.of(session)?.startsWith(`${path}/`) === true) {
      await this.ctx.workingDirectory.enter(session, repositoryRoot)
    }
    await this.git(['worktree', 'remove', path], repositoryRoot, signal)
    const branch = info.ref?.replace(/^refs\/heads\//, '') as WorktreeBranch | undefined
    if (options.deleteBranch && branch !== undefined) await this.git(['branch', '-d', branch], repositoryRoot, signal)
    session.append('worktree/removed', { path })
    return {
      path: path as WorktreePath,
      branch,
      branchDeleted: options.deleteBranch && branch !== undefined,
      cwd: this.ctx.workingDirectory.of(session),
    }
  }

  /** Locate the main working tree and this repository's checkout directory. */
  private async repository(cwd: string, signal: AbortSignal | undefined): Promise<{ repositoryRoot: string; checkouts: string }> {
    const common = (await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, signal)).trim()
    // A non-bare repository keeps its shared git directory as `<main checkout>/.git`.
    const repositoryRoot = basename(common) === '.git' ? dirname(common) : common
    const digest = createHash('sha256').update(common).digest('hex').slice(0, 8)
    return { repositoryRoot, checkouts: join(this.config.directory, `${basename(repositoryRoot)}-${digest}`) }
  }

  /** Add a checkout on a new branch at `baseCommit` and run its setup. */
  private async add(cwd: string, name: string, baseCommit: string, signal: AbortSignal | undefined): Promise<CreatedWorktree> {
    const { repositoryRoot, checkouts } = await this.repository(cwd, signal)
    const branch = `${this.config.branchPrefix}${name}` as WorktreeBranch
    const path = join(checkouts, name) as WorktreePath
    await this.git(['worktree', 'add', '-b', branch, path, baseCommit], cwd, signal)
    return { path, branch, baseCommit, repositoryRoot, setup: await this.setup(path, signal) }
  }

  /**
   * Commit the working tree — tracked changes and untracked, unignored files —
   * without touching the user's index, files, or branches: a copy of the index
   * stages everything and `commit-tree` records it on top of HEAD.
   * @returns HEAD when the tree is clean, else the snapshot commit.
   */
  private async snapshot(cwd: string, message: string, signal: AbortSignal | undefined): Promise<string> {
    const top = (await this.git(['rev-parse', '--show-toplevel'], cwd, signal)).trim()
    const head = (await this.git(['rev-parse', 'HEAD'], top, signal)).trim()
    if ((await this.git(['status', '--porcelain'], top, signal)).trim() === '') return head
    const index = (await this.git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], top, signal)).trim()
    const scratch = join(tmpdir(), `avn-worktree-index-${randomUUID()}`)
    try {
      // Copying the index keeps its stat cache, so `add -A` re-hashes only changed files.
      if (existsSync(index)) copyFileSync(index, scratch)
      const env = { GIT_INDEX_FILE: scratch }
      if (!existsSync(scratch)) await this.git(['read-tree', 'HEAD'], top, signal, env)
      await this.git(['add', '-A'], top, signal, env)
      const tree = (await this.git(['write-tree'], top, signal, env)).trim()
      return (await this.git(['commit-tree', tree, '-p', head, '-m', message], top, signal)).trim()
    } finally {
      rmSync(scratch, { force: true })
    }
  }

  /** Run the first setup entry whose marker file the checkout contains. */
  private async setup(path: string, signal: AbortSignal | undefined): Promise<string | null> {
    const entry = this.config.setup.find(candidate => existsSync(join(path, candidate.when)))
    if (entry === undefined) return null
    const command = entry.argv.join(' ')
    const deadline = AbortSignal.timeout(this.config.setupTimeoutMs)
    const outcome = await this.run(entry.argv, path, signal === undefined ? deadline : AbortSignal.any([signal, deadline]))
    signal?.throwIfAborted()
    if (outcome.exitCode === 0) return `\`${command}\` completed.`
    const reason = deadline.aborted ? `timed out after ${String(this.config.setupTimeoutMs)} ms` : `failed (exit ${String(outcome.exitCode)})`
    return `\`${command}\` ${reason}: ${outcome.output.slice(-SETUP_DETAIL_CHARS)}`
  }

  /**
   * The directory the session works in; worktree operations need one.
   * @param session - the session to resolve.
   * @returns its effective directory.
   */
  private directory(session: Session): string {
    const cwd = this.ctx.workingDirectory.of(session)
    if (cwd === undefined) throw new Error('worktrees: this session has no working directory')
    return cwd
  }

  /** Run one command and return its exit code with its trimmed combined output. */
  private async run(
    argv: readonly string[],
    cwd: string,
    signal: AbortSignal | undefined,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ exitCode: number | null; stdout: string; output: string }> {
    const child = this.ctx.subprocess.spawn({
      argv,
      cwd,
      ...signal === undefined ? {} : { signal },
      ...env === undefined ? {} : { env },
      graceMs: this.config.graceMs,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_000_000 }, stderr: { maxBytes: 1_000_000 } },
    })
    const outcome = await child.done
    const stdout = child.collected.stdout?.readFrom(0).text ?? ''
    const stderr = child.collected.stderr?.readFrom(0).text ?? ''
    return { exitCode: outcome.signal === null ? outcome.exitCode : null, stdout, output: `${stderr}${stdout}`.trim() }
  }

  /**
   * Run one git command and return its standard output.
   * @throws with git's own output when the command fails.
   */
  private async git(args: string[], cwd: string, signal: AbortSignal | undefined, env?: NodeJS.ProcessEnv): Promise<string> {
    // Repository hooks and fsmonitor are programs the repository configures;
    // the service's own git calls run neither.
    const result = await this.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], cwd, signal, env)
    if (result.exitCode !== 0) {
      throw new Error(`worktrees: git ${args[0] ?? ''} failed: ${result.output}`)
    }
    return result.stdout
  }
}

export default Worktrees

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: Worktrees
  }
}
