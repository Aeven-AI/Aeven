/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's session directory on this device, resolved by `@aeven/working-directory` from the
 * session's workspace rather than from the path the header records. That recorded path names the
 * device that wrote the log, so it must never become this machine's execution directory; a
 * session whose workspace has no folder here fails with `WorkingDirectoryUnavailableError`
 * instead. Each session's `read`/`write`/`edit` therefore act on its workspace, never on the
 * server's launch directory.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @aeven/tool-fs/session-cwd
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@aeven/tools'
import { canonicalPath } from '@aeven/sandbox'
import { sessionDirectory } from '@aeven/working-directory'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param ctx - the tool plugin's context, through which `workingDirectory` resolves the directory.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 * @throws when the session's workspace has no folder on this device (`WorkingDirectoryUnavailableError`).
 */
export function sessionCwd(ctx: Context, exec: ToolExecution, requestedPath: string): string | undefined {
  const session = exec.agent?.session
  const cwd = session === undefined ? undefined : sessionDirectory(ctx, session)
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * @param ctx - the tool plugin's context, through which `workingDirectory` resolves the directory.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 * @throws when the session's workspace has no folder on this device (`WorkingDirectoryUnavailableError`).
 */
export function sessionResolveOptions(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  // The policy root is the canonical spelling of the session's workspace; it
  // stands in for the working directory only while the two are one directory.
  const session = exec.agent?.session
  const directory = session === undefined ? undefined : sessionDirectory(ctx, session)
  const cwd = policyWorkspaceRoot !== undefined && (directory === undefined || canonicalPath(directory) === policyWorkspaceRoot)
    ? policyWorkspaceRoot
    : sessionCwd(ctx, exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
