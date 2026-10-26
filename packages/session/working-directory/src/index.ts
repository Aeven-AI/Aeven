/**
 * The session's working directory as a capability: every tool that resolves a
 * relative path asks this service instead of reading the session header.
 *
 * A session is created in a directory and that creation path is immutable
 * header metadata, but work moves — a checkout, a subdirectory, a fresh
 * worktree. The effective directory is therefore the header's `cwd` overridden
 * by the last logged `session/cwd`, which keeps it reconstructable from the log:
 * resume and fork both restore it, and no tool can act on a directory the log
 * cannot explain.
 *
 * @module @aeven/working-directory
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, normalize, resolve as resolvePath } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@aeven/session'
import type {} from '@aeven/session-projection'
import { workingDirectoryProjectionDefinition } from './projection.ts'
export type * from './types.ts'

/** Directory resolution and change for one session. */
export class WorkingDirectoryService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
    ctx.sessionProjections.register(workingDirectoryProjectionDefinition)
  }

  /**
   * The directory in force for a session.
   * @param session - the session whose tool calls resolve paths against it.
   * @returns the last logged `session/cwd`, else the header's `cwd`, else
   *   undefined when the session records none and nothing overrode it.
   */
  of(session: Session): string | undefined {
    const logged = this.ctx.sessionProjections.stateOf(session, 'workingDirectory')
    return logged?.cwd ?? session.header.cwd
  }

  /**
   * Resolve a path the way the tools do, without touching the filesystem.
   * @param session - the session supplying the base directory.
   * @param path - absolute, or relative to {@link of}.
   * @returns the normalized absolute path.
   */
  resolve(session: Session, path: string): string {
    if (isAbsolute(path)) return normalize(path)
    const base = this.of(session) ?? process.cwd()
    return normalize(resolvePath(base, path))
  }

  /**
   * Move the session into a directory and record it in the log.
   *
   * The directory must already exist: this changes where later calls run, it
   * does not create directories. A relative target resolves against the current
   * directory, so successive changes compose the way a shell's `cd` does.
   * @param session - the session to move.
   * @param target - absolute, or relative to the current directory.
   * @returns the absolute directory now in force.
   * @throws when the target is empty, missing, or not a directory.
   */
  async change(session: Session, target: string): Promise<string> {
    const trimmed = target.trim()
    if (trimmed === '') throw new Error('working directory: a target directory is required')
    const path = this.resolve(session, trimmed)
    const entry = await stat(path).catch(() => undefined)
    if (entry === undefined) {
      throw new Error(`working directory: "${path}" does not exist`)
    }
    if (!entry.isDirectory()) {
      throw new Error(`working directory: "${path}" is not a directory`)
    }
    if (this.of(session) === path) return path
    session.append('session/cwd', { cwd: path })
    return path
  }
}

export default WorkingDirectoryService

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session working directory: the header's `cwd` plus the last logged `session/cwd`. */
    workingDirectory: WorkingDirectoryService
  }
}
