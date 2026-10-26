/**
 * Workspace file service: directory listings, text previews and a bounded name
 * search over a Session's workspace, exposed as the `workspaceFiles` Remote
 * namespace for the right sidebar's file explorer.
 *
 * The workspace root is the Session header's `cwd`, with the sandbox policy's
 * root as the fallback for a Session that has none. Listings and searches stay
 * inside that root; a preview follows the composed filesystem's read access,
 * as the authenticated `/api/file` route already does for bytes. Nothing here
 * writes.
 *
 * A preview page is cut from `streamText`, which decodes as it goes, so a file
 * is read only up to the first character past the page and is never held whole
 * in memory; a page that would exceed the byte cap is refused rather than cut.
 *
 * The `sidebar_files` model tool shows a path in that explorer: it resolves and
 * stats the path here, then asks the window displaying the Session to open it.
 * @module @aeven/api-workspace-files
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/fs'
import type { FsTarget } from '@aeven/fs'
import type {} from '@aeven/sandbox-policy'
import type {} from '@aeven/working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import { scopeTarget } from '@aeven/scope'
import { defineTool } from '@aeven/tools'
import type {} from './types.ts'
import type {
  WorkspaceDirectoryEntry, WorkspaceDirectoryListing, WorkspaceFileText, WorkspaceFilesShowResult, WorkspaceSearchHit,
  WorkspaceSearchResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceFiles` Remote namespace. */
    workspaceFiles: WorkspaceFiles
  }
}

/** Deployment caps on one listing, one preview page and one search. */
export interface Config {
  /** Cap on returned directory entries; the rest is dropped and reported cut. */
  readonly maxEntries: number
  /** Lines in one preview page; a longer file is reported not at EOF. */
  readonly maxLines: number
  /** Inclusive byte cap on one preview page; a page above it is refused. */
  readonly maxBytes: number
  /** Cap on the hits one search returns. */
  readonly searchMaxHits: number
  /** Cap on the directories one search lists before it stops. */
  readonly searchMaxDirectories: number
  /** Directory names a search never descends into. */
  readonly searchSkip: string[]
  /** How long `sidebar_files` waits for the window showing the Session to open the explorer. */
  readonly showTimeoutMs: number
}

/** The byte text never carries: its presence marks a page as binary. */
const NUL = String.fromCharCode(0)

/** One page cut from a decoded text stream. */
interface Page {
  readonly text: string
  readonly eof: boolean
}

/**
 * Cut the first `limit` lines from decoded chunks, stopping at the first
 * character past the page so the rest of the file is never read, and refusing
 * the page the moment its bytes exceed `maxBytes`.
 */
async function cutPage(chunks: AsyncIterable<string>, limit: number, maxBytes: number, path: string): Promise<Page> {
  const lines: string[] = []
  let current = ''
  let bytes = 0
  const admit = (size: number): void => {
    bytes += size
    if (bytes > maxBytes) {
      throw new RemoteError('workspace-file/too-large', `"${path}" exceeds the ${maxBytes} byte preview cap`, { path, limit: maxBytes })
    }
  }
  for await (const chunk of chunks) {
    let position = 0
    while (position < chunk.length) {
      if (lines.length >= limit) return { text: lines.join('\n'), eof: false }
      const newline = chunk.indexOf('\n', position)
      const segment = newline === -1 ? chunk.slice(position) : chunk.slice(position, newline)
      admit(Buffer.byteLength(segment, 'utf8'))
      current += segment
      if (newline === -1) break
      admit(1)
      lines.push(current)
      current = ''
      position = newline + 1
    }
  }
  if (current.length > 0) lines.push(current)
  return { text: lines.join('\n'), eof: true }
}

/** Workspace path of `target` relative to `root`, from their canonical `file:` URIs; empty for the root. */
function workspacePathOf(rootUrl: string, targetUrl: string): string {
  const root = new URL(rootUrl).pathname.replace(/\/+$/, '')
  const target = new URL(targetUrl).pathname
  if (target === root) return ''
  return target.slice(root.length + 1).split('/').map(decodeURIComponent).join('/')
}

/** The backend's non-text refusal, recognized by its code across package instances. */
function isNotTextRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'FS_NOT_TEXT'
}

/** Host Remote listings, previews and name searches over the composed filesystem. */
export class WorkspaceFiles extends TypertRemoteService {
  static inject = ['fs', 'sandboxPolicy', 'typert']

  static Config: z<Config> = z.object({
    maxEntries: z.number().step(1).min(1).default(2000),
    maxLines: z.number().step(1).min(1).default(5000),
    maxBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
    searchMaxHits: z.number().step(1).min(1).default(200),
    searchMaxDirectories: z.number().step(1).min(1).default(5000),
    searchSkip: z.array(z.string()).default(['.git', 'node_modules']),
    showTimeoutMs: z.number().step(1).min(1).default(5_000),
  })

  /**
   * @param ctx - Host context carrying the filesystem and the sandbox policy.
   * @param config - deployment caps on listings, previews and searches.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceFiles')
    ctx.inject(['tools'], (scoped) => { this.registerTool(scoped) })
  }

  private registerTool(ctx: Context): void {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'sidebar_files',
      description: 'Show a file or folder in the file explorer beside this chat in web or Electron. A file opens in a preview tab there; a folder opens the explorer expanded at it. Use it when the user asks to see files, a folder, or a file in the sidebar.',
      parameters: {
        path: { type: 'string', description: 'Workspace-relative or absolute path. Omit or leave empty for the workspace root.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error('Showing files in the sidebar requires a calling agent')
        const path = args.path ?? ''
        const workspaceRoot = this.workspaceRootOf(agent)
        const root = await this.ctx.fs.resolve(workspaceRoot, { signal: exec.signal })
        const target = path.length === 0 ? root : await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal: exec.signal })
        const info = await this.ctx.fs.stat(target, exec.signal)
        if (info === undefined) throw new Error(`No file or folder exists at "${path}"`)
        if (info.type === 'other') throw new Error(`"${path}" is neither a file nor a folder`)
        // The explorer lists only inside the workspace; a file preview follows read access, as `read` does.
        if (info.type === 'directory' && !this.ctx.fs.contains(root, target)) throw new Error(`"${path}" is outside the workspace, which the explorer shows`)
        const shownPath = info.type === 'directory' ? workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target)) : path
        const bounded = AbortSignal.any([exec.signal, AbortSignal.timeout(this.config.showTimeoutMs)])
        const unanswered = new Promise<WorkspaceFilesShowResult>((resolve) => {
          if (bounded.aborted) resolve('no-window')
          else bounded.addEventListener('abort', () => { resolve('no-window') }, { once: true })
        })
        const result = await Promise.race([
          ctx.waterfall(scopeTarget(agent, agent), 'workspace-files/show',
            { path: shownPath, type: info.type, agent, signal: bounded }, () => Promise.resolve<WorkspaceFilesShowResult>('no-window')),
          unanswered,
        ])
        exec.signal.throwIfAborted()
        if (result === 'no-window') throw new Error('No window is showing this chat, so nothing was opened. Ask the user to open Files in the sidebar.')
        if (result === 'not-previewable') throw new Error(`"${path}" has no text or image preview, so the explorer cannot open it`)
        return info.type === 'directory' ? `Showing the folder "${shownPath || '.'}" in the file explorer.` : `Showing "${path}" in the file explorer.`
      },
      presentCall: args => ({ card: 'generic', title: 'Show in Files', kind: 'read', rawInput: args.path ?? '' }),
    })), 'workspace-files.model-tool')
  }

  /**
   * List the direct children of one directory inside the Session's workspace.
   * @param agent - the Session asking; its header names the workspace root.
   * @param path - workspace-relative or absolute path; empty for the root.
   * @param signal - caller cancellation.
   * @returns the root, the listed path and its children, bounded by the entry cap.
   */
  @Remote
  async list(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing> {
    const workspaceRoot = this.workspaceRootOf(agent)
    const root = await this.ctx.fs.resolve(workspaceRoot, { signal })
    const target = await this.confine(root, workspaceRoot, path, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    if (info.type !== 'directory') {
      throw new RemoteError('workspace-file/not-directory', `"${path}" is a ${info.type}`, { path, kind: info.type })
    }
    const children = await this.ctx.fs.listDir(target, signal)
    return {
      root: this.ctx.fs.processPath(root),
      path: workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target)),
      entries: children.slice(0, this.config.maxEntries).map((child): WorkspaceDirectoryEntry => ({
        name: child.name,
        type: child.type,
        size: child.size ?? null,
      })),
      truncated: children.length > this.config.maxEntries,
    }
  }

  /**
   * Read the leading page of one UTF-8 text file.
   * @param agent - the Session asking; relative paths resolve against its workspace root.
   * @param path - workspace-relative or absolute path.
   * @param signal - caller cancellation.
   * @returns the file's absolute path, size, first page and whether that page reaches EOF.
   */
  @Remote
  async read(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFileText> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'path is required', {})
    const workspaceRoot = this.workspaceRootOf(agent)
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    if (info.type !== 'file') {
      throw new RemoteError('workspace-file/not-regular-file', `"${path}" is a ${info.type}`, { path, kind: info.type })
    }
    let page: Page
    try {
      page = await cutPage(await this.ctx.fs.streamText(target, signal), this.config.maxLines, this.config.maxBytes, path)
    } catch (error: unknown) {
      if (isNotTextRefusal(error)) {
        throw new RemoteError('workspace-file/not-text', `"${path}" is not UTF-8 text`, { path }, { cause: error })
      }
      throw error
    }
    if (page.text.includes(NUL)) throw new RemoteError('workspace-file/not-text', `"${path}" contains NUL bytes`, { path })
    return { absolutePath: this.ctx.fs.processPath(target), bytes: info.size ?? null, text: page.text, eof: page.eof }
  }

  /**
   * Find entries whose name contains `query` (case-insensitive), walking the
   * workspace breadth-first and skipping the configured directory names.
   * @param agent - the Session asking; its header names the workspace root.
   * @param query - the name fragment to match.
   * @param signal - caller cancellation.
   * @returns the matches in walk order and whether a cap stopped the walk.
   */
  @Remote
  async search(agent: Agent, query: string, signal: AbortSignal): Promise<WorkspaceSearchResult> {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return { hits: [], truncated: false }
    const root = await this.ctx.fs.resolve(this.workspaceRootOf(agent), { signal })
    const skip = new Set(this.config.searchSkip)
    const hits: WorkspaceSearchHit[] = []
    const queue: Array<{ target: FsTarget; path: string }> = [{ target: root, path: '' }]
    let listed = 0
    while (queue.length > 0) {
      if (listed >= this.config.searchMaxDirectories || hits.length >= this.config.searchMaxHits) {
        return { hits, truncated: true }
      }
      const next = queue.shift()
      /* v8 ignore next -- the loop condition proves an entry is queued. */
      if (next === undefined) break
      listed += 1
      // A directory that vanished or refuses listing mid-walk is skipped; the
      // rest of the tree still answers.
      const children = await this.ctx.fs.listDir(next.target, signal).catch(() => [])
      for (const child of children) {
        const path = next.path === '' ? child.name : `${next.path}/${child.name}`
        if (child.type === 'directory' && !skip.has(child.name)) queue.push({ target: child.target, path })
        if (child.type !== 'other' && child.name.toLowerCase().includes(needle)) {
          hits.push({ path, type: child.type })
          if (hits.length >= this.config.searchMaxHits) return { hits, truncated: true }
        }
      }
    }
    return { hits, truncated: false }
  }

  /** The Session's workspace root: its logged root, its header `cwd`, or the sandbox policy root. */
  private workspaceRootOf(agent: Agent): string {
    return this.ctx.get('workingDirectory')?.rootOf(agent.session) ?? agent.session.header.cwd ?? this.ctx.sandboxPolicy.workspaceRoot
  }

  /** Resolve `path` against the root and refuse it unless the workspace contains it. */
  private async confine(root: FsTarget, workspaceRoot: string, path: string, signal: AbortSignal): Promise<FsTarget> {
    const target = path.length === 0 ? root : await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    if (!this.ctx.fs.contains(root, target)) {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    return target
  }
}

export default WorkspaceFiles
