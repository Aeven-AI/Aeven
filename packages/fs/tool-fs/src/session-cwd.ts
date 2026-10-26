/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's session directory (`ctx.workingDirectory` when composed, else
 * `exec.agent.session.header.cwd`), so each session's `read`/`write`/`edit` act on its
 * workspace, not the server's launch directory.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @aeven/tool-fs/session-cwd
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@aeven/tools'
import { canonicalPath } from '@aeven/sandbox'
import type {} from '@aeven/working-directory'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/** The calling agent's session directory as logged, or `undefined` for a non-agent call. */
function sessionDirectory(ctx: Context, exec: ToolExecution): string | undefined {
  const session = exec.agent?.session
  if (session === undefined) return undefined
  return ctx.get('workingDirectory')?.of(session) ?? session.header.cwd
}

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
export function sessionCwd(ctx: Context, exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = sessionDirectory(ctx, exec)
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export function sessionResolveOptions(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  // The policy root is the canonical spelling of the session's workspace; it
  // stands in for the working directory only while the two are one directory.
  const directory = sessionDirectory(ctx, exec)
  const cwd = policyWorkspaceRoot !== undefined && (directory === undefined || canonicalPath(directory) === policyWorkspaceRoot)
    ? policyWorkspaceRoot
    : sessionCwd(ctx, exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
