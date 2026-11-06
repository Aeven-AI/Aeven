/**
 * Workspace file service: directory listings, text previews and a bounded name
 * search over a Session's workspace, exposed as the `workspaceFiles` Remote
 * namespace for the right sidebar's file explorer.
 *
 * The workspace root is this device's binding for the Session's workspace, with
 * the sandbox policy's root as the fallback for a Session that records no
 * directory. Listings and searches stay inside that root; a preview follows the
 * composed filesystem's read access, as the authenticated `/api/file` route
 * already does for bytes. Nothing here writes.
 *
 * A preview page is cut from `streamText`, which decodes as it goes, so a file
 * is read only up to the first character past the page and is never held whole
 * in memory; a page that would exceed the byte cap is refused rather than cut.
 *
 * The authenticated `/api/workspace-file` route serves one file's bytes for the
 * explorer's image, video, and audio views and its downloads: the path resolves
 * against the Session's workspace root under the same read rule as a preview,
 * and the Session must belong to the caller. A single byte range is answered
 * with `206`, which is what lets a media player seek.
 *
 * The `sidebar_files` model tool shows a path in that explorer: it resolves and
 * stats the path here, then asks the window displaying the Session to open it.
 * @module @aeven/api-workspace-files
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import mime from 'mime-types'
import type {} from '@aeven/client-connection'
import type { Agent } from '@aeven/agent'
import type { FsError, FsTarget } from '@aeven/fs'
import type {} from '@aeven/sandbox-policy'
import type {} from '@aeven/identity-user'
import type { SessionId } from '@aeven/session'
import type {} from '@aeven/session-query'
import { sessionWorkspaceRoot, WorkingDirectoryUnavailableError } from '@aeven/working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import { brandString } from '@aeven/brand'
import { scopeTarget } from '@aeven/scope'
import { defineTool, jsonStringOutput } from '@aeven/tools'
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
  /**
   * Whether file previews stay inside the workspace like listings and
   * searches do (default false: a preview follows the file tools' read
   * access). A Host whose readers must not see its own files sets true.
   */
  readonly confineReads?: boolean
  /** Inclusive byte cap on one file `/api/workspace-file` serves; a larger file is refused with `413`. */
  readonly maxFileBytes: number
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

/** Path of the route that serves one workspace file's bytes. */
const FILE_ROUTE = '/api/workspace-file'

/** Headers of every `/api/workspace-file` response; HTML and SVG files open on the authenticated origin without running. */
const FILE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
}

/** A plain-text response with the route's headers. */
function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { ...FILE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * The one byte span a `Range` header asks for.
 * @param header - the request's `Range` header.
 * @param size - the file's length.
 * @returns the inclusive span, `unsatisfiable` for a span past the end, or undefined to serve the whole file.
 */
function byteRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null || (match[1] === '' && match[2] === '')) return undefined
  const suffix = match[1] === ''
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1])
  const end = suffix || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return start >= size || start > end ? 'unsatisfiable' : { start, end }
}

/** `Content-Disposition` parameters naming the saved file, ASCII and UTF-8. */
function dispositionName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** The response for a refused read: an absent or foreign Session and a path outside the workspace read as absent. */
function fileFailure(error: unknown): Response {
  if (error instanceof WorkingDirectoryUnavailableError) return plain(404, 'not found')
  if (error instanceof RemoteError) {
    return plain(error.code === 'session/not-found' || error.code === 'workspace-file/outside-workspace' ? 404 : 400, 'not found')
  }
  // Recognized by code, since the backend's error class may come from another package instance.
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (typeof code !== 'string' || !code.startsWith('FS_')) throw error
  const statuses: Partial<Record<FsError['code'], number>> = {
    FS_NOT_FOUND: 404,
    FS_NOT_REGULAR_FILE: 403,
    FS_PERMISSION_DENIED: 403,
    FS_SANDBOX_DENIED: 403,
    FS_TOO_LARGE: 413,
    FS_ABORTED: 499,
  }
  return plain(statuses[code as FsError['code']] ?? 500, code)
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
    confineReads: z.boolean().default(false),
    maxFileBytes: z.number().step(1).min(1).default(512 * 1024 * 1024),
  })

  /**
   * @param ctx - Host context carrying the filesystem and the sandbox policy.
   * @param config - deployment caps on listings, previews and searches.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceFiles')
    ctx.inject(['tools'], (scoped) => { this.registerTool(scoped) })
    ctx.inject(['connection'], (scoped) => {
      scoped.effect(() => scoped.connection.fetch.register({
        path: FILE_ROUTE,
        methods: ['GET', 'HEAD'],
        fetch: request => this.serveFile(request),
      }), 'workspace-files: /api/workspace-file')
    })
  }

  /** Answer one `/api/workspace-file` request: the named Session's file, whole or as one byte range. */
  private async serveFile(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    const path = url.searchParams.get('path')
    if (sessionId === null || sessionId === '' || path === null || path === '' || path.includes('\0')) {
      return plain(400, 'sessionId and path are required')
    }
    let target: FsTarget
    let bytes: Uint8Array
    try {
      const workspaceRoot = await this.workspaceRootFor(brandString<SessionId>(sessionId))
      target = this.config.confineReads === true
        ? await this.confine(await this.ctx.fs.resolve(workspaceRoot, { signal: request.signal }), workspaceRoot, path, request.signal)
        : await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal: request.signal })
      const info = await this.ctx.fs.stat(target, request.signal)
      if (info === undefined) return plain(404, 'not found')
      if (info.type !== 'file') return plain(403, 'not a regular file')
      if (info.size !== undefined && info.size > this.config.maxFileBytes) return plain(413, 'file exceeds byte limit')
      bytes = await this.ctx.fs.readBytes(target, request.signal, this.config.maxFileBytes)
    } catch (error: unknown) {
      return fileFailure(error)
    }
    const name = target.displayPath.split('/').pop() ?? 'file'
    const headers: Record<string, string> = {
      ...FILE_HEADERS,
      'Content-Type': mime.lookup(name) || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; ${dispositionName(name)}`,
    }
    const range = byteRange(request.headers.get('range'), bytes.byteLength)
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Length': '0', 'Content-Range': `bytes */${String(bytes.byteLength)}` } })
    }
    const body = range === undefined ? bytes : bytes.subarray(range.start, range.end + 1)
    return new Response(request.method === 'HEAD' ? null : body.slice(), {
      status: range === undefined ? 200 : 206,
      headers: range === undefined ? headers : {
        ...headers,
        'Content-Length': String(body.byteLength),
        'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(bytes.byteLength)}`,
      },
    })
  }

  private registerTool(ctx: Context): void {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'sidebar_files',
      description: 'Show a file or folder in the file explorer beside this chat in web or Electron. A file opens in a preview tab there; a folder opens the explorer expanded at it. Use it when the user asks to see files, a folder, or a file in the sidebar.',
      parameters: {
        path: { type: 'string', description: 'Workspace-relative or absolute path. Omit or leave empty for the workspace root.' },
      },
      output: jsonStringOutput(),
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
        if ((info.type === 'directory' || this.config.confineReads === true) && !this.ctx.fs.contains(root, target)) {
          throw new Error(`"${path}" is outside the workspace, which the explorer shows`)
        }
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
   * @param sessionId - the Session asking; this device's binding for its workspace names the root.
   * @param path - workspace-relative or absolute path; empty for the root.
   * @param signal - caller cancellation.
   * @returns the root, the listed path and its children, bounded by the entry cap.
   */
  @Remote
  async list(sessionId: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing> {
    const workspaceRoot = await this.workspaceRootFor(sessionId)
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
   * @param sessionId - the Session asking; relative paths resolve against its workspace root.
   * @param path - workspace-relative or absolute path.
   * @param signal - caller cancellation.
   * @returns the file's absolute path, size, first page and whether that page reaches EOF.
   */
  @Remote
  async read(sessionId: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceFileText> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'path is required', {})
    const workspaceRoot = await this.workspaceRootFor(sessionId)
    const target = this.config.confineReads === true
      ? await this.confine(await this.ctx.fs.resolve(workspaceRoot, { signal }), workspaceRoot, path, signal)
      : await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
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
   * @param sessionId - the Session asking; this device's binding for its workspace names the root.
   * @param query - the name fragment to match.
   * @param signal - caller cancellation.
   * @returns the matches in walk order and whether a cap stopped the walk.
   */
  @Remote
  async search(sessionId: SessionId, query: string, signal: AbortSignal): Promise<WorkspaceSearchResult> {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return { hits: [], truncated: false }
    const root = await this.ctx.fs.resolve(await this.workspaceRootFor(sessionId), { signal })
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

  /**
   * The Session's workspace root: this device's binding for its workspace, or the sandbox policy root
   * when it records no directory.
   * @param agent - the Session asking.
   * @returns the absolute root listings, previews and searches resolve against.
   * @throws {WorkingDirectoryUnavailableError} when the Session's workspace has no folder on this device.
   */
  private workspaceRootOf(agent: Agent): string {
    return sessionWorkspaceRoot(this.ctx, agent.session) ?? this.ctx.sandboxPolicy.workspaceRoot
  }

  /**
   * The workspace root of a Session a reader browses, whether or not an Agent
   * runs it here. Browsing never starts one: an idle Session, and a replica
   * another device of the account runs, answer from the stored log, so the
   * explorer neither waits on nor takes over the device running the work.
   * @param sessionId - the Session the reader browses.
   * @returns the absolute root listings, previews and searches resolve against.
   * @throws {RemoteError} `session/not-found` when the Session is absent or the caller may not reach it.
   * @throws {WorkingDirectoryUnavailableError} when the Session's workspace has no folder on this device.
   */
  private async workspaceRootFor(sessionId: SessionId): Promise<string> {
    const live = this.ctx.get('agents')?.get(sessionId)
    if (live !== undefined) {
      this.assertMayAccess(sessionId, live.session.header.owner)
      return this.workspaceRootOf(live)
    }
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    let observation
    try {
      observation = await query.observeSession(sessionId)
    } catch (error: unknown) {
      if ((error as { code?: unknown } | null)?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
      }
      throw error
    }
    using held = observation
    this.assertMayAccess(sessionId, held.header.owner)
    const directory = this.ctx.get('workingDirectory')
    const local = directory === undefined
      ? (held.header.cwd === undefined ? { state: 'absent' as const } : { state: 'local' as const, cwd: held.header.cwd, root: held.header.cwd })
      : directory.observed(held.header, held.projections?.values.workingDirectory)
    if (local.state === 'unresolved') throw new WorkingDirectoryUnavailableError(sessionId, local.reason)
    return local.state === 'local' ? local.root : this.ctx.sandboxPolicy.workspaceRoot
  }

  /** Refuse a Session another account owns exactly as an absent one, so a caller cannot learn which exist. */
  private assertMayAccess(sessionId: SessionId, owner: string | undefined): void {
    if (this.ctx.get('identityUsers')?.mayAccess(owner) === false) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
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
