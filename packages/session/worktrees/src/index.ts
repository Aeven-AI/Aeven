/**
 * Git worktrees as a session capability: one checkout per task, so agents do
 * not share a working tree. Creating one runs `git worktree add -b <branch>
 * <path> <rev>` through `ctx.subprocess` and then moves the session there
 * through `ctx.workingDirectory`, which makes the checkout the directory every
 * later file, shell, and search call resolves against.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import z from 'zod'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@aeven/session'
import type {} from '@aeven/subprocess'
import type {} from '@aeven/working-directory'
import type {
  CreateWorktreeRequest,
  CreatedWorktree,
  WorktreeBranch,
  WorktreeInfo,
  WorktreePath,
} from './types.ts'

/** Deployment choices for where checkouts live and how their branches are named. */
export interface Config {
  /** Directory, relative to the repository root, that holds the checkouts. */
  directory: string
  /** Prefix every created branch carries, e.g. `avn/`. */
  branchPrefix: string
  /** Grace period in milliseconds for a git child process to exit after termination. */
  graceMs: number
}

/** Milliseconds a git child gets between SIGTERM and SIGKILL. */
export type { WorktreeInfo, CreatedWorktree, CreateWorktreeRequest, WorktreeBranch, WorktreePath }

const configSchema = z.object({
  directory: z.string().min(1),
  branchPrefix: z.string().min(1),
  graceMs: z.number().int().positive(),
})

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

/** The git worktree service, registered as `ctx.worktrees`. */
export class Worktrees extends Service {
  static inject = ['subprocess', 'workingDirectory']
  static Config = configSchema

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'worktrees')
    this.config = configSchema.parse(config)
  }

  /**
   * Root of the repository the session works in.
   * @param session - the session whose working directory names the repository.
   * @param signal - cancels the git call.
   * @returns the absolute repository root.
   * @throws when the session is in no repository.
   */
  async repositoryRoot(session: Session, signal?: AbortSignal): Promise<string> {
    const cwd = this.directory(session)
    const output = await this.git(['rev-parse', '--show-toplevel'], cwd, signal)
    const root = output.trim()
    if (root.length === 0) throw new Error(`worktrees: ${cwd} is not inside a git repository`)
    return root
  }

  /**
   * Registered checkouts of the session's repository, main working tree first.
   * @param session - the session whose repository is listed.
   * @param signal - cancels the git call.
   * @returns one entry per registered worktree.
   */
  async list(session: Session, signal?: AbortSignal): Promise<WorktreeInfo[]> {
    const root = await this.repositoryRoot(session, signal)
    return parseWorktreeList(await this.git(['worktree', 'list', '--porcelain'], root, signal))
  }

  /**
   * Create a branch-backed checkout and move the session into it.
   * @param session - the session that will work in the new checkout.
   * @param request - optional name and starting revision.
   * @param signal - cancels the git calls.
   * @returns the checkout path, its branch, its base commit, and the repository root.
   */
  async create(session: Session, request: CreateWorktreeRequest = {}, signal?: AbortSignal): Promise<CreatedWorktree> {
    const root = await this.repositoryRoot(session, signal)
    const name = normaliseName(request.name ?? `work-${randomUUID().slice(0, 8)}`)
    const branch = `${this.config.branchPrefix}${name}` as WorktreeBranch
    const path = join(root, this.config.directory, name) as WorktreePath
    const from = request.from ?? 'HEAD'

    const baseCommit = (await this.git(['rev-parse', from], root, signal)).trim()
    await this.git(['worktree', 'add', '-b', branch, path, from], root, signal)
    await this.ctx.workingDirectory.change(session, path)
    return { path, branch, baseCommit, repositoryRoot: root }
  }

  /**
   * The directory the session works in; the service always resolves one because
   * creating a worktree requires a repository.
   * @param session - the session to resolve.
   * @returns its effective directory.
   */
  private directory(session: Session): string {
    const cwd = this.ctx.workingDirectory.of(session)
    if (cwd === undefined) throw new Error('worktrees: this session has no working directory')
    return cwd
  }

  /**
   * Run one git command and return its standard output.
   * @param args - git arguments after the program name.
   * @param cwd - directory the command runs in.
   * @param signal - cancels the child.
   * @returns standard output on success.
   * @throws with git's own stderr when the command fails.
   */
  private async git(args: string[], cwd: string, signal: AbortSignal | undefined): Promise<string> {
    const child = this.ctx.subprocess.spawn({
      argv: ['git', ...args],
      cwd,
      ...signal === undefined ? {} : { signal },
      graceMs: this.config.graceMs,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_000_000 }, stderr: { maxBytes: 1_000_000 } },
    })
    const outcome = await child.done
    const stdout = child.collected.stdout?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      const stderr = (child.collected.stderr?.readFrom(0).text ?? '').trim()
      throw new Error(`worktrees: git ${args[0] ?? ''} failed (${outcome.exitCode === null ? `signal ${String(outcome.signal)}` : `exit ${String(outcome.exitCode)}`}): ${stderr === '' ? stdout.trim() : stderr}`)
    }
    return stdout
  }
}

export default Worktrees

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: Worktrees
  }
}
