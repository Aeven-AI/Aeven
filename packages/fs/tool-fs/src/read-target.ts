/**
 * Shared path resolution and regular-file validation for model-facing read tools.
 * @module @aeven/tool-fs/src/read-target
 */

import { isAbsolute, normalize, relative, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@aeven/fs'
import type { FsInfo, FsTarget } from '@aeven/fs'
import type { ToolExecution } from '@aeven/tools'
import type {} from '@aeven/sandbox-policy'
import { referencedAttachmentPaths } from '@aeven/attachment'
import { canonicalPath } from '@aeven/sandbox'
import { sessionCwd, sessionResolveOptions } from './session-cwd.ts'

/**
 * Refuse a read target outside the calling session's workspace and outside the
 * attachments its own messages and tool results reference: the deployment's
 * readers must not reach the Host's other files. A call without a session has
 * no workspace and is refused.
 * @param ctx - the plugin context providing the filesystem, sandbox policy, and attachments.
 * @param exec - the current tool execution.
 * @param target - the resolved, canonical target.
 * @throws {FsError} `FS_SANDBOX_DENIED` when the target is outside both.
 */
export async function assertInWorkspace(ctx: Context, exec: ToolExecution, target: FsTarget): Promise<void> {
  const allowed = readableRoots(ctx, exec)
  const root = allowed === undefined ? undefined : await ctx.fs.resolve(allowed.workspaceRoot, { signal: exec.signal })
  if (root !== undefined && ctx.fs.contains(root, target)) return
  if (allowed?.attachments.has(canonicalPath(String(target.targetKey))) === true) return
  throw outsideFolder(target.displayPath)
}

/**
 * Refuse a path that names a place outside the workspace and the referenced
 * attachments before any filesystem call, so a refusal reveals nothing about
 * the Host's directories; symlinks are checked once the path resolves.
 * @param ctx - the plugin context.
 * @param exec - the current tool execution.
 * @param requestedPath - the raw path supplied to the tool.
 * @throws {FsError} `FS_SANDBOX_DENIED` when the path lies outside both.
 */
function assertLexicallyInWorkspace(ctx: Context, exec: ToolExecution, requestedPath: string): void {
  const allowed = readableRoots(ctx, exec)
  if (allowed === undefined) throw outsideFolder(requestedPath)
  const absolute = isAbsolute(requestedPath)
    ? normalize(requestedPath)
    : resolvePath(sessionCwd(ctx, exec, requestedPath) ?? allowed.workspaceRoot, requestedPath)
  const rest = relative(allowed.workspaceRoot, absolute)
  if (rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))) return
  if (allowed.attachments.has(absolute)) return
  throw outsideFolder(requestedPath)
}

/** The calling session's workspace root and the attachment files its log references. */
function readableRoots(ctx: Context, exec: ToolExecution): { workspaceRoot: string; attachments: Set<string> } | undefined {
  const session = exec.agent?.session
  const policy = session === undefined ? undefined : ctx.get('sandboxPolicy')?.resolve({ session })
  if (session === undefined || policy === undefined) return undefined
  const store = ctx.get('attachments')
  const attachments = new Set<string>()
  if (store !== undefined) {
    for (const path of referencedAttachmentPaths(session.snapshotEvents(), store)) attachments.add(canonicalPath(path))
  }
  return { workspaceRoot: canonicalPath(policy.workspaceRoot), attachments }
}

function outsideFolder(path: string): FsError {
  return new FsError(`cannot read "${path}": it is outside the conversation folder`, 'FS_SANDBOX_DENIED')
}

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @param confine - refuse targets outside the calling session's workspace and its referenced attachments.
 * @returns the resolved target and its single stat result.
 */
export async function resolveRegularReadTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  confine: boolean = false,
): Promise<{ target: FsTarget; info: FsInfo }> {
  if (confine) assertLexicallyInWorkspace(ctx, exec, requestedPath)
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
