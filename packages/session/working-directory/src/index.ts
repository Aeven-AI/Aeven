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
 * Both are recorded by the device that wrote them, so neither is a directory
 * *here*. Resolution answers with this device's binding for the session's
 * workspace (see `./local.ts`): that is what lets a conversation synced from
 * another machine act in a folder of this machine, while the log stays the
 * portable record of where in the workspace the session works.
 *
 * @module @aeven/working-directory
 */

import { existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve as resolvePath } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Session, SessionId } from '@aeven/session'
import type {} from '@aeven/session-projection'
import type {} from '@aeven/agent'
import type {} from '@aeven/system-prompt'
import type { SessionPlacement } from '@aeven/workspace'
import { workingDirectoryProjectionDefinition } from './projection.ts'
import { localDirectory, type LocalDirectory, type RecordedDirectory, WorkingDirectoryUnavailableError } from './local.ts'
export type * from './types.ts'
export * from './local.ts'
export { sessionDirectory, sessionWorkspaceRoot } from './directory.ts'

/** Working-directory resolution configuration. */
export interface Config {
  /**
   * Whether this Host gives sessions a folder of its own. A Host that serves the
   * accounts of different people sets `false`: a conversation another device
   * recorded in a folder continues here without a working directory instead of
   * waiting for a folder this Host never offers. Defaults to `true`.
   */
  readonly folders?: boolean
  /**
   * With `folders: false`, the absolute directory under which this Host gives
   * each account's sessions a folder it creates and manages itself, never one
   * a person chooses: `<managedRoot>/<owner>/workspaces/<workspace id>` for a
   * session filed in a workspace, `<managedRoot>/<owner>/chats` otherwise. A
   * session without an owner, or whose owner or workspace id is not a plain
   * path segment, gets no folder. Omitted, sessions without a folder of
   * their own stay without one.
   */
  readonly managedRoot?: string
}

/** An owner or workspace id usable as one directory name. */
const PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u

/** Directory resolution and change for one session. */
export class WorkingDirectoryService extends Service {
  static inject = ['sessionProjections']

  static Config: Schema<Config> = Schema.object({ folders: Schema.boolean(), managedRoot: Schema.string() })

  private readonly folders: boolean
  private readonly managedRoot: string | undefined
  /** Managed folders this process has created. */
  private readonly created = new Set<string>()

  /**
   * Directories this process moved a session into. A replicated session's
   * recorded path belongs to another device, so a move made here is the one
   * local fact that outranks its workspace binding; it lives for this process
   * because the log carries the move for the next one.
   */
  private readonly entered = new Map<SessionId, RecordedDirectory>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workingDirectory')
    this.folders = config.folders ?? true
    this.managedRoot = config.managedRoot
    if (this.managedRoot !== undefined) {
      if (this.folders) throw new Error('working-directory: managedRoot requires folders: false')
      if (!isAbsolute(this.managedRoot)) throw new Error(`working-directory: managedRoot "${this.managedRoot}" must be absolute`)
    }
    ctx.sessionProjections.register(workingDirectoryProjectionDefinition)

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'session:working-directory',
        order: scope.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
        text: (context) => {
          const session = context.agent?.session
          if (session === undefined) return ''
          const local = this.local(session)
          if (local.state === 'absent') return ''
          if (local.state === 'unresolved') {
            return local.reason === 'workspace-unbound'
              ? 'This conversation belongs to a workspace that has no folder on this machine yet. '
                + 'Ask the user which folder to use before reading or writing files here.'
              : 'This conversation was written on another device and belongs to a workspace that has not reached this machine. '
                + 'Ask the user which folder to use before reading or writing files here.'
          }
          return existsSync(local.cwd)
            ? `Current working directory: ${JSON.stringify(local.cwd)}. Relative paths in file, search, and shell calls resolve against it.`
            : `The working directory ${JSON.stringify(local.cwd)} no longer exists. Move the session to an existing directory before using relative paths.`
        },
      })
    })
  }

  /**
   * The directory pair in force for a session on this device.
   * @param session - the session to resolve.
   * @returns the local directory and workspace root, why this device has none,
   *   or the fact that the session records no directory at all.
   */
  local(session: Session): LocalDirectory {
    const logged = this.ctx.sessionProjections.stateOf(session, 'workingDirectory')
    const cwd = logged?.cwd ?? session.header.cwd
    const registry = this.ctx.get('workspaceRegistry')
    const placement: SessionPlacement = registry?.placeSession(session.header.id) ?? { state: 'unfiled' }
    const resolved = localDirectory({
      recorded: cwd === undefined ? undefined : { cwd, root: logged?.root ?? cwd },
      placement,
      replicated: registry?.replicated(session.header.id) ?? false,
      entered: this.entered.get(session.header.id),
    })
    if (this.folders || resolved.state === 'local') return resolved
    // Without folders here, a folder another device recorded is one this Host will never have.
    const managed = this.managedFolder(session)
    return managed === undefined ? { state: 'absent' } : { state: 'local', cwd: managed, root: managed }
  }

  /**
   * The managed folder for a session on a Host without folders of its own,
   * created on first use and private to the Host's user.
   * @param session - the session to place.
   * @returns the folder, or undefined when no managed root is configured or the session has no usable owner.
   */
  private managedFolder(session: Session): string | undefined {
    const owner = session.header.owner
    if (this.managedRoot === undefined || owner === undefined || !PATH_SEGMENT.test(owner)) return undefined
    const placement = this.ctx.get('workspaceRegistry')?.placeSession(session.header.id)
    let path: string
    if (placement?.state === 'filed') {
      const workspaceId = String(placement.workspace.id)
      if (!PATH_SEGMENT.test(workspaceId)) return undefined
      path = join(this.managedRoot, owner, 'workspaces', workspaceId)
    } else {
      path = join(this.managedRoot, owner, 'chats')
    }
    if (!this.created.has(path)) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
      this.created.add(path)
    }
    return path
  }

  /**
   * The directory in force for a session on this device.
   * @param session - the session whose tool calls resolve paths against it.
   * @returns the local directory, or undefined when this device has none — read
   *   {@link local} to tell a refusal from a session that records none.
   */
  of(session: Session): string | undefined {
    const local = this.local(session)
    return local.state === 'local' ? local.cwd : undefined
  }

  /**
   * The workspace root in force for a session on this device: the directory
   * sandboxed writes are confined to.
   * @param session - the session to resolve.
   * @returns the local root, or undefined when this device has none.
   */
  rootOf(session: Session): string | undefined {
    const local = this.local(session)
    return local.state === 'local' ? local.root : undefined
  }

  /**
   * Resolve a path the way the tools do, without touching the filesystem.
   * @param session - the session supplying the base directory.
   * @param path - absolute, or relative to {@link of}.
   * @returns the normalized absolute path.
   * @throws {WorkingDirectoryUnavailableError} when this device has no directory
   *   for a session that records one, so a relative path cannot resolve here.
   * @throws when the session records no directory at all and `path` is relative.
   */
  resolve(session: Session, path: string): string {
    if (isAbsolute(path)) return normalize(path)
    return normalize(resolvePath(this.baseOf(session, path), path))
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
    this.entered.set(session.header.id, { cwd: path, root: this.rootOf(session) ?? path })
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
    const unchanged = this.of(session) === path && this.rootOf(session) === path
    this.entered.set(session.header.id, { cwd: path, root: path })
    if (unchanged) return
    session.append('session/cwd', { cwd: path, root: path })
  }

  /**
   * Start a child session where its parent works: copy the parent's logged
   * directory and workspace root onto the child's log. A parent still in its
   * header directory leaves the child on its own header.
   *
   * A parent working through this device's workspace binding has no portable
   * directory to copy: the child's own header already names this device's
   * directory, and copying the parent's recorded path would carry another
   * machine's spelling into the child's synced log.
   * @param child - the child session, inside its creation window.
   * @param parent - the delegating session.
   */
  inherit(child: Session, parent: Session): void {
    const parentLocal = this.local(parent)
    if (parentLocal.state === 'unresolved') return
    const logged = this.ctx.sessionProjections.stateOf(parent, 'workingDirectory')
    const recorded = logged?.cwd ?? parent.header.cwd
    if (recorded === undefined) return
    const root = logged?.root ?? recorded
    this.entered.set(child.header.id, parentLocal.state === 'local'
      ? { cwd: parentLocal.cwd, root: parentLocal.root }
      : { cwd: recorded, root })
    // A parent acting through this device's binding has nothing portable to log:
    // the child's header already names the directory this device works in.
    if (parentLocal.state === 'local' && parentLocal.cwd !== recorded) return
    if (this.of(child) === logged?.cwd && this.rootOf(child) === (logged?.root ?? parent.header.cwd)) return
    child.append('session/cwd', {
      cwd: recorded,
      ...logged?.root === null || logged?.root === undefined ? {} : { root: logged.root },
    })
  }

  /** The directory a relative target resolves against, refusing rather than guessing. */
  private baseOf(session: Session, path: string): string {
    const local = this.local(session)
    if (local.state === 'local') return local.cwd
    if (local.state === 'unresolved') {
      throw new WorkingDirectoryUnavailableError(session.header.id, local.reason)
    }
    throw new Error(`working directory: the session records no directory, so "${path}" cannot resolve`)
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
    /** Session working directory: this device's directory for the session's workspace. */
    workingDirectory: WorkingDirectoryService
  }
}
