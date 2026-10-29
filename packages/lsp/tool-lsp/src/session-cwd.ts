/**
 * Derive the workspace root an `lsp` call resolves against from the calling
 * agent's session: the folder this device binds to the session's workspace,
 * never the path the header records, which names the device that wrote the log.
 * A session that records no directory fails as `LSP_WORKSPACE_REQUIRED` because
 * the local provider must canonicalize a real workspace before starting a
 * server; one whose workspace has no folder here fails with
 * `WorkingDirectoryUnavailableError` rather than starting a server elsewhere.
 * @module @aeven/tool-lsp/session-cwd
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@aeven/tools'
import { sessionDirectory } from '@aeven/working-directory'

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param ctx - the tool plugin's context, through which `workingDirectory` resolves the directory.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session directory on this device, or undefined
 *   for a non-agent caller.
 * @throws when the session's workspace has no folder on this device (`WorkingDirectoryUnavailableError`).
 */
export function sessionCwd(ctx: Context, exec: ToolExecution): string | undefined {
  const session = exec.agent?.session
  return session === undefined ? undefined : sessionDirectory(ctx, session)
}
