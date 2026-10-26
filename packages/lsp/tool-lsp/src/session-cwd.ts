/**
 * Derive the workspace root an `lsp` call resolves against from the calling
 * agent's session. A missing cwd fails as `LSP_WORKSPACE_REQUIRED` because the
 * local provider must canonicalize a real workspace before starting a server.
 * @module @aeven/tool-lsp/session-cwd
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@aeven/tools'
import type {} from '@aeven/working-directory'

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param ctx - the tool plugin's context, through which `workingDirectory` is looked up when composed.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session directory (`ctx.workingDirectory` when
 *   composed, else its header cwd), or undefined for a non-agent caller.
 */
export function sessionCwd(ctx: Context, exec: ToolExecution): string | undefined {
  const session = exec.agent?.session
  if (session === undefined) return undefined
  return ctx.get('workingDirectory')?.of(session) ?? session.header.cwd
}
