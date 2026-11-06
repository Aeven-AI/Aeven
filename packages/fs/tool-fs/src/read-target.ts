/**
 * Shared path resolution and regular-file validation for model-facing read tools.
 * @module @aeven/tool-fs/src/read-target
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@aeven/fs'
import type { FsInfo, FsTarget } from '@aeven/fs'
import type { ToolExecution } from '@aeven/tools'
import type {} from '@aeven/sandbox-policy'
import { sessionResolveOptions } from './session-cwd.ts'

/**
 * Refuse a read target outside the calling session's workspace root: the
 * deployment's readers must not reach the Host's other files. A call without a
 * session has no workspace and is refused.
 * @param ctx - the plugin context providing the filesystem and the sandbox policy.
 * @param exec - the current tool execution.
 * @param target - the resolved, canonical target.
 * @throws {FsError} `FS_SANDBOX_DENIED` when the target is outside the workspace.
 */
export async function assertInWorkspace(ctx: Context, exec: ToolExecution, target: FsTarget): Promise<void> {
  const session = exec.agent?.session
  const policy = session === undefined ? undefined : ctx.get('sandboxPolicy')?.resolve({ session })
  const root = policy === undefined ? undefined : await ctx.fs.resolve(policy.workspaceRoot, { signal: exec.signal })
  if (root === undefined || !ctx.fs.contains(root, target)) {
    throw new FsError(`cannot read "${target.displayPath}": it is outside the conversation folder`, 'FS_SANDBOX_DENIED')
  }
}

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @param confine - refuse targets outside the calling session's workspace.
 * @returns the resolved target and its single stat result.
 */
export async function resolveRegularReadTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  confine: boolean = false,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(ctx, exec, requestedPath))
  if (confine) await assertInWorkspace(ctx, exec, target)
  await ctx.parallel('fs/pre-read', target, exec.signal)
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}
