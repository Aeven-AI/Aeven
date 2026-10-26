/**
 * The session's working directory as a capability: every tool that resolves a
 * relative path asks this service instead of reading the session header.
 *
 * A session is created in a directory and that creation path is immutable
 * header metadata, but work moves — a checkout, a subdirectory, a fresh
 * worktree. The effective directory is therefore the header's `cwd` overridden
 * by the last logged `session/cwd`, which keeps it reconstructable from the log:
 * resume and fork both restore it, and no tool can act on a directory the log
 * cannot explain. The workspace root — the directory `workspace-write`
 * confines writes to — moves only through {@link WorkingDirectoryService.enter},
 * so changing into a subdirectory never narrows what the session may write.
 *
 * @module @aeven/working-directory
 */

import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, normalize, resolve as resolvePath } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@aeven/session'
import type {} from '@aeven/session-projection'
import type {} from '@aeven/agent'
import type {} from '@aeven/system-prompt'
import { workingDirectoryProjectionDefinition } from './projection.ts'
export type * from './types.ts'

/** Directory resolution and change for one session. */
export class WorkingDirectoryService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
    ctx.sessionProjections.register(workingDirectoryProjectionDefinition)

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'session:working-directory',
        order: scope.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
        text: (context) => {
          const session = context.agent?.session
          const cwd = session === undefined ? null : this.ctx.sessionProjections.stateOf(session, 'workingDirectory')?.cwd ?? null
          if (cwd === null) return ''
          return existsSync(cwd)
            ? `Current working directory: ${JSON.stringify(cwd)}. Relative paths in file, search, and shell calls resolve against it.`
            : `The working directory ${JSON.stringify(cwd)} no longer exists. Move the session to an existing directory before using relative paths.`
        },
      })
    })
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
   * The workspace root in force for a session: the directory sandboxed writes
   * are confined to.
   * @param session - the session to resolve.
   * @returns the last logged `root`, else the header's `cwd`, else undefined.
   */
  rootOf(session: Session): string | undefined {
    const logged = this.ctx.sessionProjections.stateOf(session, 'workingDirectory')
    return logged?.root ?? session.header.cwd
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
   * Move the session into a directory and record it in the log. The
   * workspace root stays where it is.
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
    const path = await this.existingDirectory(session, target)
    if (this.of(session) === path) return path
    session.append('session/cwd', { cwd: path })
    return path
  }

  /**
   * Move the session into another workspace: the directory becomes both the
   * working directory and the root sandboxed writes are confined to.
   * @param session - the session to move.
   * @param target - absolute, or relative to the current directory.
   * @returns the absolute directory now in force.
   * @throws when the target is empty, missing, or not a directory.
   */
  async enter(session: Session, target: string): Promise<string> {
    const path = await this.existingDirectory(session, target)
    this.enterVerified(session, path)
    return path
  }

  /**
   * {@link enter} for a directory the caller has just created and checked, in
   * a window that cannot await — a child agent's creation setup.
   * @param session - the session to move.
   * @param path - absolute path of an existing directory.
   */
  enterVerified(session: Session, path: string): void {
    if (this.of(session) === path && this.rootOf(session) === path) return
    session.append('session/cwd', { cwd: path, root: path })
  }

  /**
   * Start a child session where its parent works: copy the parent's logged
   * directory and workspace root onto the child's log. A parent still in its
   * header directory leaves the child on its own header.
   * @param child - the child session, inside its creation window.
   * @param parent - the delegating session.
   */
  inherit(child: Session, parent: Session): void {
    const logged = this.ctx.sessionProjections.stateOf(parent, 'workingDirectory')
    if (logged?.cwd === null || logged?.cwd === undefined) return
    if (this.of(child) === logged.cwd && this.rootOf(child) === (logged.root ?? parent.header.cwd)) return
    child.append('session/cwd', {
      cwd: logged.cwd,
      ...logged.root === null ? {} : { root: logged.root },
    })
  }

  /** Resolve a target and require it to be an existing directory. */
  private async existingDirectory(session: Session, target: string): Promise<string> {
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
