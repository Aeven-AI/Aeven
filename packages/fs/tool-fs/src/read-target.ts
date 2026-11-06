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
import { SessionLogOffset } from '@aeven/session'
import type { Session } from '@aeven/session'
import type {} from '@aeven/working-directory'
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
  for (const workspaceRoot of allowed?.workspaceRoots ?? []) {
    if (ctx.fs.contains(await ctx.fs.resolve(workspaceRoot, { signal: exec.signal }), target)) return
  }
  if (allowed?.attachments.has(String(target.targetKey)) === true) return
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
  const cwd = sessionCwd(ctx, exec, requestedPath)
  // A relative path is judged both as given and against the canonical working directory.
  const candidates = isAbsolute(requestedPath)
    ? [normalize(requestedPath)]
    : [...new Set([cwd, cwd === undefined ? undefined : canonicalPath(cwd)].filter(dir => dir !== undefined))]
      .map(dir => resolvePath(dir, requestedPath))
  for (const absolute of candidates.length > 0 ? candidates : [resolvePath(allowed.workspaceRoots[0] ?? '/', requestedPath)]) {
    for (const workspaceRoot of allowed.workspaceRoots) {
      const rest = relative(workspaceRoot, absolute)
      if (rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))) return
    }
    if (allowed.attachments.has(absolute)) return
  }
  throw outsideFolder(requestedPath)
}

/** The attachment files each live session references, and the log position read so far. */
const sessionAttachments = new WeakMap<Session, { seq: number; files: Set<string> }>()

/**
 * The calling session's workspace roots and the attachment files its log
 * references, each in its configured and its canonical form, so a symlinked
 * data directory neither blocks reads nor widens them.
 */
function readableRoots(ctx: Context, exec: ToolExecution): { workspaceRoots: string[]; attachments: Set<string> } | undefined {
  const session = exec.agent?.session
  const policy = session === undefined ? undefined : ctx.get('sandboxPolicy')?.resolve({ session })
  if (session === undefined || policy === undefined) return undefined
  const configured = ctx.get('workingDirectory')?.rootOf(session)
  const workspaceRoots = [
    ...new Set([policy.workspaceRoot, canonicalPath(policy.workspaceRoot), ...configured === undefined ? [] : [configured]]),
  ]
  const store = ctx.get('attachments')
  const known = sessionAttachments.get(session) ?? { seq: 0, files: new Set<string>() }
  if (store !== undefined) {
    for (const path of referencedAttachmentPaths(session.snapshotEvents(SessionLogOffset(known.seq)), store)) {
      known.files.add(path)
      known.files.add(canonicalPath(path))
    }
    known.seq = session.seq
    sessionAttachments.set(session, known)
  }
  return { workspaceRoots, attachments: known.files }
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
