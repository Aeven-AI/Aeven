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

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionHeader } from '@aeven/session'
import { WorkingDirectoryUnavailableError, type LocalDirectory } from './local.ts'
import type { WorkingDirectoryProjection } from './types.ts'

/**
 * The directory the calling session's file, search, and shell work acts in.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param session - the calling session.
 * @returns the local directory, or undefined when the session records none.
 * @throws {WorkingDirectoryUnavailableError} when the session's workspace has no folder on this device.
 */
export function sessionDirectory(ctx: Context, session: Session): string | undefined {
  return pick(ctx, session, 'cwd')
}

/**
 * The root that confines the calling session's writes.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param session - the calling session.
 * @returns the local workspace root, or undefined when the session records none.
 * @throws {WorkingDirectoryUnavailableError} when the session's workspace has no folder on this device.
 */
export function sessionWorkspaceRoot(ctx: Context, session: Session): string | undefined {
  return pick(ctx, session, 'root')
}

/**
 * The directory pair in force on this device for a stored session this process holds no Session object for — an idle
 * one, or a copy another device writes — read from its header and folded `workingDirectory` projection.
 * @param ctx - the plugin's context, through which `workingDirectory` is looked up when composed.
 * @param header - the session's stored header.
 * @param logged - the folded `workingDirectory` projection of its log, when one was read.
 * @returns the local directory and workspace root, why this device has none, or the fact that the session records
 *   none; without the working-directory capability, the header's directory.
 */
export function observedSessionDirectory(
  ctx: Context,
  header: SessionHeader,
  logged: WorkingDirectoryProjection | undefined,
): LocalDirectory {
  const directory = ctx.get('workingDirectory')
  if (directory !== undefined) return directory.observed(header, logged)
  return header.cwd === undefined ? { state: 'absent' } : { state: 'local', cwd: header.cwd, root: header.cwd }
}

function pick(ctx: Context, session: Session, field: 'cwd' | 'root'): string | undefined {
  const directory = ctx.get('workingDirectory')
  if (directory === undefined) return session.header.cwd
  const local: LocalDirectory = directory.local(session)
  if (local.state === 'unresolved') {
    throw new WorkingDirectoryUnavailableError(session.header.id, local.reason)
  }
  return local.state === 'local' ? local[field] : undefined
}
