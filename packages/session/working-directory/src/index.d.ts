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
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@aeven/session'
export type * from './types.ts'
/** Directory resolution and change for one session. */
export declare class WorkingDirectoryService extends Service {
  static inject: string[]
  constructor(ctx: Context)
  /**
     * The directory in force for a session.
     * @param session - the session whose tool calls resolve paths against it.
     * @returns the last logged `session/cwd`, else the header's `cwd`, else
     *   undefined when the session records none and nothing overrode it.
     */
  of(session: Session): string | undefined
  /**
     * Resolve a path the way the tools do, without touching the filesystem.
     * @param session - the session supplying the base directory.
     * @param path - absolute, or relative to {@link of}.
     * @returns the normalized absolute path.
     */
  resolve(session: Session, path: string): string
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
  change(session: Session, target: string): Promise<string>
}
export default WorkingDirectoryService
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session working directory: the header's `cwd` plus the last logged `session/cwd`. */
    workingDirectory: WorkingDirectoryService
  }
}
//# sourceMappingURL=index.d.ts.map
