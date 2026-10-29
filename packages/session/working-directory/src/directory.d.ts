/**
 * The one call a tool or plugin makes to learn the directory it acts in.
 *
 * Consumers must not read `session.header.cwd` themselves: that value names the
 * device that wrote the log, and reading it is how a conversation synced from
 * another machine ends up acting on a path that is not the user's folder here.
 * These helpers answer with the local directory, refuse loudly when the session
 * records one this device cannot stand behind, and fall back to the header only
 * when the working-directory capability is not composed at all — a composition
 * with no workspace registry, and therefore no synced sessions either.
 *
 * @module @aeven/working-directory/directory
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@aeven/session';
/**
 * The directory the calling session's file, search, and shell work acts in.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param session - the calling session.
 * @returns the local directory, or undefined when the session records none.
 * @throws {WorkingDirectoryUnavailableError} when the session's workspace has no folder on this device.
 */
export declare function sessionDirectory(ctx: Context, session: Session): string | undefined;
/**
 * The root that confines the calling session's writes.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param session - the calling session.
 * @returns the local workspace root, or undefined when the session records none.
 * @throws {WorkingDirectoryUnavailableError} when the session's workspace has no folder on this device.
 */
export declare function sessionWorkspaceRoot(ctx: Context, session: Session): string | undefined;
//# sourceMappingURL=directory.d.ts.map