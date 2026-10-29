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
import { Service, type Context } from '@deepseek-ai/cordis';
import type { Session } from '@aeven/session';
import { type LocalDirectory } from './local.ts';
export type * from './types.ts';
export * from './local.ts';
export { sessionDirectory, sessionWorkspaceRoot } from './directory.ts';
/** Directory resolution and change for one session. */
export declare class WorkingDirectoryService extends Service {
    static inject: string[];
    /**
     * Directories this process moved a session into. A replicated session's
     * recorded path belongs to another device, so a move made here is the one
     * local fact that outranks its workspace binding; it lives for this process
     * because the log carries the move for the next one.
     */
    private readonly entered;
    constructor(ctx: Context);
    /**
     * The directory pair in force for a session on this device.
     * @param session - the session to resolve.
     * @returns the local directory and workspace root, why this device has none,
     *   or the fact that the session records no directory at all.
     */
    local(session: Session): LocalDirectory;
    /**
     * The directory in force for a session on this device.
     * @param session - the session whose tool calls resolve paths against it.
     * @returns the local directory, or undefined when this device has none — read
     *   {@link local} to tell a refusal from a session that records none.
     */
    of(session: Session): string | undefined;
    /**
     * The workspace root in force for a session on this device: the directory
     * sandboxed writes are confined to.
     * @param session - the session to resolve.
     * @returns the local root, or undefined when this device has none.
     */
    rootOf(session: Session): string | undefined;
    /**
     * Resolve a path the way the tools do, without touching the filesystem.
     * @param session - the session supplying the base directory.
     * @param path - absolute, or relative to {@link of}.
     * @returns the normalized absolute path.
     * @throws {WorkingDirectoryUnavailableError} when this device has no directory
     *   for a session that records one, so a relative path cannot resolve here.
     * @throws when the session records no directory at all and `path` is relative.
     */
    resolve(session: Session, path: string): string;
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
    change(session: Session, target: string): Promise<string>;
    /**
     * Move the session into another workspace: the directory becomes both the
     * working directory and the root sandboxed writes are confined to.
     * @param session - the session to move.
     * @param target - absolute, or relative to the current directory.
     * @returns the absolute directory now in force.
     * @throws when the target is empty, missing, or not a directory.
     */
    enter(session: Session, target: string): Promise<string>;
    /**
     * {@link enter} for a directory the caller has just created and checked, in
     * a window that cannot await — a child agent's creation setup.
     * @param session - the session to move.
     * @param path - absolute path of an existing directory.
     */
    enterVerified(session: Session, path: string): void;
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
    inherit(child: Session, parent: Session): void;
    /** The directory a relative target resolves against, refusing rather than guessing. */
    private baseOf;
    /** Resolve a target and require it to be an existing directory. */
    private existingDirectory;
}
export default WorkingDirectoryService;
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Session working directory: this device's directory for the session's workspace. */
        workingDirectory: WorkingDirectoryService;
    }
}
//# sourceMappingURL=index.d.ts.map