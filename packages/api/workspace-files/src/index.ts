/**
 * Workspace file service: directory listings, text previews and a bounded name
 * search over a Session's workspace, exposed as the `workspaceFiles` Remote
 * namespace for the right sidebar's file explorer.
 *
 * The workspace root is this device's binding for the Session's workspace, with
 * the sandbox policy's root as the fallback for a Session that records no
 * directory. Listings and searches stay inside that root; a preview follows the
 * composed filesystem's read access, as the authenticated `/api/file` route
 * already does for bytes. Listings mark, and searches skip, the names in
 * `searchSkip`.
 *
 * The explorer's write actions (new file, new folder, rename, duplicate,
 * delete) and its change stream work on the Host's own filesystem, so they are
 * available only when the composed filesystem maps the workspace's paths
 * one-to-one onto the Host's, and the writes only while the Session's file
 * policy is wider than read-only. Each write resolves the entry's folder inside
 * the workspace exactly as a listing does and validates the new name, so
 * nothing is created, renamed or removed outside the root, through `..` or a
 * symbolic link alike; the entry itself is named, never followed. A delete
 * moves the entry to the platform's trash where one exists and removes it
 * otherwise, which {@link WorkspaceFilesAccess.trash} reports beforehand.
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

import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import mime from 'mime-types'
import type {} from '@aeven/client-connection'
import type { Agent } from '@aeven/agent'
import type { FsError, FsInfo, FsTarget } from '@aeven/fs'
import type {} from '@aeven/sandbox-policy'
import type {} from '@aeven/aeven-folder-sync'
import type {} from '@aeven/identity-user'
import type { SessionId } from '@aeven/session'
import type {} from '@aeven/session-query'
import type {} from '@aeven/session-projection'
import type {} from '@aeven/workspace'
import { observedSessionDirectory, sessionWorkspaceRoot, WorkingDirectoryUnavailableError } from '@aeven/working-directory'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import { brandString } from '@aeven/brand'
import { scopeTarget } from '@aeven/scope'
import { defineTool, jsonStringOutput } from '@aeven/tools'
import type {} from './types.ts'
import type {
  WorkspaceDirectoryEntry, WorkspaceDirectoryListing, WorkspaceEntryCount, WorkspaceEntryRef, WorkspaceFileChanges,
  WorkspaceFilesAccess, WorkspaceFileText, WorkspaceFilesShowResult, WorkspaceSearchHit, WorkspaceSearchResult,
} from './types.ts'
import { hasTrash, invalidName, moveToTrash, watchRoot } from './host.ts'

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
  /** Directory names a search never descends into, which listings mark ignored and the change stream leaves out. */
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
  /** Delay gathering a burst of filesystem changes into one change-stream batch. */
  readonly watchDelayMs: number
  /** Cap on the entries one delete confirmation counts inside a folder. */
  readonly countMaxItems: number
  /**
   * Longest wait for the workspace syncs to bring a Session's workspace here when a reader opens its explorer or reads
   * a file this device does not hold yet; the transfer goes on after the wait ends.
   */
  readonly arrivalWaitMs: number
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

/** One workspace entry named inside its folder on the Host's filesystem. */
interface HostEntry {
  /** Absolute Host path of the entry itself, never followed. */
  readonly host: string
  /** Absolute Host path of its folder. */
  readonly parentHost: string
  /** Workspace path of its folder; empty for the root. */
  readonly folder: string
  /** Its name in that folder. */
  readonly name: string
  /** Its workspace path. */
  readonly path: string
}

/** The `code` of a Node.js system error, or undefined for anything else. */
function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

/**
 * A Host filesystem write's failure in the explorer's codes.
 * @param path - the workspace path the write concerned.
 * @param error - the failure.
 * @returns the error to throw.
 */
function writeFailure(path: string, error: unknown): Error {
  switch (errnoOf(error)) {
    case 'EEXIST':
    case 'ENOTEMPTY':
      return new RemoteError('workspace-file/exists', `"${path}" already exists`, { path })
    case 'ENOENT':
      return new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return new RemoteError('workspace-file/permission-denied', `the system refused to change "${path}"`, { path })
    case 'EROFS':
      return new RemoteError('workspace-file/read-only', `"${path}" is on a read-only filesystem`, { path })
    default:
      return error instanceof Error ? error : new Error(String(error))
  }
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
    watchDelayMs: z.number().step(1).min(0).default(150),
    countMaxItems: z.number().step(1).min(1).default(10_000),
    arrivalWaitMs: z.number().step(1).min(0).default(10_000),
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

  /**
   * Resolve one file of a Session's workspace for a reader acting for the caller, under the same rules as the
   * `/api/workspace-file` route: the Session must belong to the caller and the path resolves under the read rule
   * of a preview. A file not here yet is waited for as long as the workspace syncs take, up to `arrivalWaitMs`,
   * unless `wait` is false.
   * @param sessionId - the Session whose workspace the path is in.
   * @param path - workspace-relative or absolute path.
   * @param signal - aborts the resolution.
   * @param wait - whether to wait for a file that has not arrived; false answers at once.
   * @returns the entry and its stat, or undefined when nothing exists at the path.
   * @throws RemoteError `session/not-found` for an absent or foreign Session, and the filesystem's error for a refused path.
   */
  async locateFile(sessionId: SessionId, path: string, signal: AbortSignal, wait: boolean = true): Promise<{ target: FsTarget; info: FsInfo } | undefined> {
    const target = await this.readTarget(await this.placeOf(sessionId), path, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info !== undefined) return { target, info }
    if (!wait) return undefined
    const arrived = await this.afterArrival(sessionId, path, signal)
    return arrived.info === undefined ? undefined : { target: arrived.target, info: arrived.info }
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
      const located = await this.locateFile(brandString<SessionId>(sessionId), path, request.signal)
      if (located === undefined) return plain(404, 'not found')
      target = located.target
      const { info } = located
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
        const place = await this.placeOf(agent.session.id)
        const root = await this.ctx.fs.resolve(place.root, { signal: exec.signal })
        const target = path.length === 0 ? root : await this.readTarget(place, path, exec.signal)
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
    // Opening the explorer brings the workspace here first, so the tree a reader sees is the one the Session works in.
    if (path.length === 0) await this.wantFiles(sessionId, signal)
    const { root, target } = await this.confine(await this.placeOf(sessionId), path, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    if (info.type !== 'directory') {
      throw new RemoteError('workspace-file/not-directory', `"${path}" is a ${info.type}`, { path, kind: info.type })
    }
    const children = await this.ctx.fs.listDir(target, signal)
    const ignored = new Set(this.config.searchSkip)
    return {
      root: this.ctx.fs.processPath(root),
      path: workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target)),
      entries: children.slice(0, this.config.maxEntries).map((child): WorkspaceDirectoryEntry => ({
        name: child.name,
        type: child.type,
        size: child.size ?? null,
        ignored: ignored.has(child.name),
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
    let target = await this.readTarget(await this.placeOf(sessionId), path, signal)
    let info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) ({ target, info } = await this.afterArrival(sessionId, path, signal))
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
    return {
      absolutePath: this.ctx.fs.processPath(target),
      bytes: info.size ?? null,
      text: page.text,
      eof: page.eof,
    }
  }

  /**
   * Say what the explorer may change in the Session's workspace, so it shows unavailable actions disabled.
   * @param sessionId - the Session asking.
   * @param signal - caller cancellation.
   * @returns whether writes are allowed and why not, whether a delete is recoverable, and whether changes stream.
   */
  @Remote
  async access(sessionId: SessionId, signal: AbortSignal): Promise<WorkspaceFilesAccess> {
    const { root, mode } = await this.placeFor(sessionId)
    const host = this.hostPathOf(await this.ctx.fs.resolve(root, { signal }))
    if (host === undefined) return { writable: false, reason: 'unsupported', trash: false, watch: false }
    const writable = mode !== 'read-only'
    return { writable, reason: writable ? null : 'read-only', trash: hasTrash(), watch: true }
  }

  /**
   * Create one empty file.
   * @param sessionId - the Session whose workspace changes.
   * @param folder - workspace-relative folder to create it in; empty for the root.
   * @param name - the new file's name.
   * @param signal - caller cancellation.
   * @returns the new file's workspace path.
   */
  @Remote
  async createFile(sessionId: SessionId, folder: string, name: string, signal: AbortSignal): Promise<WorkspaceEntryRef> {
    const place = await this.writableFolder(sessionId, folder, signal)
    const path = this.childPath(place.path, name)
    await this.hostWrite(path, () => writeFile(join(place.host, name), '', { flag: 'wx', signal }))
    return { path }
  }

  /**
   * Create one empty folder.
   * @param sessionId - the Session whose workspace changes.
   * @param folder - workspace-relative folder to create it in; empty for the root.
   * @param name - the new folder's name.
   * @param signal - caller cancellation.
   * @returns the new folder's workspace path.
   */
  @Remote
  async createFolder(sessionId: SessionId, folder: string, name: string, signal: AbortSignal): Promise<WorkspaceEntryRef> {
    const place = await this.writableFolder(sessionId, folder, signal)
    const path = this.childPath(place.path, name)
    signal.throwIfAborted()
    await this.hostWrite(path, () => mkdir(join(place.host, name)))
    return { path }
  }

  /**
   * Rename one entry inside its folder. A symbolic link is renamed itself, never the entry it points to.
   * @param sessionId - the Session whose workspace changes.
   * @param path - workspace-relative path of the entry.
   * @param name - the entry's new name.
   * @param signal - caller cancellation.
   * @returns the entry's new workspace path.
   */
  @Remote
  async rename(sessionId: SessionId, path: string, name: string, signal: AbortSignal): Promise<WorkspaceEntryRef> {
    const entry = await this.writableEntry(sessionId, path, signal)
    const renamed = this.childPath(entry.folder, name)
    if (name === entry.name) return { path: renamed }
    const to = join(entry.parentHost, name)
    // A change of letter case only is allowed on a case-insensitive filesystem, where the destination is the entry.
    if (name.toLowerCase() !== entry.name.toLowerCase() && await lstat(to).then(() => true, () => false)) {
      throw new RemoteError('workspace-file/exists', `"${renamed}" already exists`, { path: renamed })
    }
    signal.throwIfAborted()
    await this.hostWrite(renamed, () => rename(entry.host, to))
    return { path: renamed }
  }

  /**
   * Copy one file beside itself as "name copy", "name copy 2" and so on.
   * @param sessionId - the Session whose workspace changes.
   * @param path - workspace-relative path of the file.
   * @param signal - caller cancellation.
   * @returns the copy's workspace path.
   */
  @Remote
  async duplicate(sessionId: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceEntryRef> {
    const entry = await this.writableEntry(sessionId, path, signal)
    const info = await lstat(entry.host).catch(() => undefined)
    if (info === undefined) throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    if (!info.isFile()) {
      throw new RemoteError('workspace-file/not-regular-file', `"${path}" is not a regular file`, { path, kind: info.isDirectory() ? 'directory' : 'other' })
    }
    const extension = extname(entry.name)
    const stem = extension === '' || extension === entry.name ? entry.name : entry.name.slice(0, -extension.length)
    const suffix = extension === entry.name ? '' : extension
    for (let attempt = 1; attempt < 1000; attempt += 1) {
      signal.throwIfAborted()
      const name = `${stem} copy${attempt === 1 ? '' : ` ${String(attempt)}`}${suffix}`
      const copy = this.childPath(entry.folder, name)
      try {
        await copyFile(entry.host, join(entry.parentHost, name), fsConstants.COPYFILE_EXCL)
        return { path: copy }
      } catch (error: unknown) {
        if (errnoOf(error) !== 'EEXIST') throw writeFailure(copy, error)
      }
    }
    throw new RemoteError('workspace-file/exists', `every copy name of "${path}" is taken`, { path })
  }

  /**
   * Count what deleting one entry takes with it, for the confirmation that names the number.
   * @param sessionId - the Session asking.
   * @param path - workspace-relative path of the entry.
   * @param signal - caller cancellation.
   * @returns the files and folders inside it, bounded by the count cap.
   */
  @Remote
  async count(sessionId: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceEntryCount> {
    const entry = await this.hostEntry(sessionId, path, signal)
    const info = await lstat(entry.host).catch(() => undefined)
    if (info === undefined) throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    if (!info.isDirectory()) return { items: 0, capped: false }
    let items = 0
    const queue = [entry.host]
    while (queue.length > 0) {
      signal.throwIfAborted()
      const next = queue.shift() as string
      const children = await readdir(next, { withFileTypes: true }).catch(() => [])
      for (const child of children) {
        items += 1
        if (items >= this.config.countMaxItems) return { items, capped: true }
        if (child.isDirectory()) queue.push(join(next, child.name))
      }
    }
    return { items, capped: false }
  }

  /**
   * Delete one entry: move it to the platform's trash where one exists, otherwise remove it and everything inside it.
   * @param sessionId - the Session whose workspace changes.
   * @param path - workspace-relative path of the entry; the root itself is refused.
   * @param signal - caller cancellation.
   * @returns whether the entry went to the trash rather than being removed.
   */
  @Remote
  async deleteEntry(sessionId: SessionId, path: string, signal: AbortSignal): Promise<{ readonly trashed: boolean }> {
    const entry = await this.writableEntry(sessionId, path, signal)
    if (await lstat(entry.host).then(() => false, () => true)) {
      throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    }
    if (hasTrash()) {
      try {
        await moveToTrash(entry.host, signal)
      } catch (error: unknown) {
        signal.throwIfAborted()
        throw new RemoteError('workspace-file/permission-denied', `"${path}" could not be moved to the trash: ${String(error)}`, { path })
      }
      return { trashed: true }
    }
    signal.throwIfAborted()
    await this.hostWrite(entry.path, () => rm(entry.host, { recursive: true }))
    return { trashed: false }
  }

  /**
   * Follow changes anywhere in the Session's workspace, other than inside the names `searchSkip` lists. The opening
   * batch is empty and confirms the watch; each later one gathers a burst of changes.
   * @param sessionId - the Session whose workspace is watched.
   * @param signal - the reader's observation lifetime.
   * @returns the change batches, until the reader stops or the watcher fails.
   */
  @Remote({ mode: 'stream' })
  async *changes(sessionId: SessionId, signal: AbortSignal): AsyncIterable<WorkspaceFileChanges> {
    const root = await this.ctx.fs.resolve(await this.workspaceRootFor(sessionId), { signal })
    const host = this.hostPathOf(root)
    if (host === undefined) {
      throw new RemoteError('workspace-file/unsupported', 'this Host cannot watch the workspace', { operation: 'watch' })
    }
    const batches: WorkspaceFileChanges[] = []
    let failure: Error | undefined
    let wake: (() => void) | undefined
    const notify = (): void => { wake?.(); wake = undefined }
    const unsubscribe = watchRoot(host, { ignore: new Set(this.config.searchSkip), delayMs: this.config.watchDelayMs },
      (changes) => { batches.push({ changes }); notify() },
      (error) => { failure = error; notify() })
    signal.addEventListener('abort', notify, { once: true })
    try {
      yield { changes: [] }
      while (!signal.aborted) {
        const batch = batches.shift()
        if (batch !== undefined) {
          yield batch
          continue
        }
        if (failure !== undefined) throw failure
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      unsubscribe()
      signal.removeEventListener('abort', notify)
    }
  }

  /** The Host path of a target when the composed filesystem shares the Host's paths, else undefined. */
  private hostPathOf(target: FsTarget): string | undefined {
    const path = this.ctx.fs.processPath(target)
    return this.ctx.fs.processPathFromHostPath(path) === path ? path : undefined
  }

  /** Workspace path of a new child of `folder`, after refusing a name no platform accepts. */
  private childPath(folder: string, name: string): string {
    const reason = invalidName(name)
    if (reason !== undefined) throw new RemoteError('workspace-file/invalid-name', `"${name}": ${reason}`, { name, reason })
    return folder === '' ? name : `${folder}/${name}`
  }

  /**
   * One folder inside the workspace on the Host's filesystem, under a policy that allows writing.
   * @throws {RemoteError} `workspace-file/read-only`, `workspace-file/unsupported`, or a listing's own refusals.
   */
  private async writableFolder(sessionId: SessionId, folder: string, signal: AbortSignal): Promise<{ host: string; path: string }> {
    const { mode } = await this.placeFor(sessionId)
    if (mode === 'read-only') {
      throw new RemoteError('workspace-file/read-only', 'this Session\'s file policy is read-only', { path: folder })
    }
    const { root, target } = await this.confine(await this.placeOf(sessionId), folder, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new RemoteError('workspace-file/not-found', `no entry at "${folder}"`, { path: folder })
    if (info.type !== 'directory') {
      throw new RemoteError('workspace-file/not-directory', `"${folder}" is a ${info.type}`, { path: folder, kind: info.type })
    }
    const host = this.hostPathOf(target)
    if (host === undefined) {
      throw new RemoteError('workspace-file/unsupported', 'this Host cannot change the workspace\'s files', { operation: 'write' })
    }
    return { host, path: workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target)) }
  }

  /** One existing entry named inside its confined folder, never followed, so a link is the entry itself. */
  private async hostEntry(sessionId: SessionId, path: string, signal: AbortSignal, writable = false): Promise<HostEntry> {
    const parts = path.split('/').filter(part => part !== '')
    const name = parts.pop()
    if (name === undefined || name === '.' || name === '..') {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" names no entry inside the workspace`, { path })
    }
    const folderPath = parts.join('/')
    const place = writable
      ? await this.writableFolder(sessionId, folderPath, signal)
      : await this.readableFolder(sessionId, folderPath, signal)
    return { host: join(place.host, name), parentHost: place.host, folder: place.path, name, path: this.childPath(place.path, name) }
  }

  private writableEntry(sessionId: SessionId, path: string, signal: AbortSignal): ReturnType<WorkspaceFiles['hostEntry']> {
    return this.hostEntry(sessionId, path, signal, true)
  }

  /** One folder inside the workspace on the Host's filesystem, for a read. */
  private async readableFolder(sessionId: SessionId, folder: string, signal: AbortSignal): Promise<{ host: string; path: string }> {
    const { root, target } = await this.confine(await this.placeOf(sessionId), folder, signal)
    const host = this.hostPathOf(target)
    if (host === undefined) {
      throw new RemoteError('workspace-file/unsupported', 'this Host cannot reach the workspace\'s files', { operation: 'count' })
    }
    return { host, path: workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target)) }
  }

  /** Run one Host filesystem write, reporting its failure in the explorer's codes. */
  private async hostWrite(path: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write()
    } catch (error: unknown) {
      throw writeFailure(path, error)
    }
  }

  /**
   * Find entries whose name contains `query` (case-insensitive), or whose
   * relative path does when `query` holds a `/`, walking the workspace
   * breadth-first and skipping the configured directory names.
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
    const byPath = needle.includes('/')
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
        // A query naming a folder (`src/app`) matches the whole relative path; any other matches the name.
        const haystack = byPath ? path.toLowerCase() : child.name.toLowerCase()
        if (child.type !== 'other' && haystack.includes(needle)) {
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
   * The Session's workspace root and the file policy mode writes from the explorer run under: a running Session's
   * resolved mode, or the deployment default for a Session no Agent runs here.
   * @param sessionId - the Session the reader browses.
   * @returns the absolute root and the mode.
   */
  private async placeFor(sessionId: SessionId): Promise<{ root: string; mode: Context['sandboxPolicy']['defaultMode'] }> {
    const live = this.ctx.get('agents')?.get(sessionId)
    const root = await this.workspaceRootFor(sessionId)
    const mode = live === undefined ? this.ctx.sandboxPolicy.defaultMode : this.ctx.sandboxPolicy.resolve({ session: live.session }).mode
    return { root, mode }
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
    return (await this.placeOf(sessionId)).root
  }

  /**
   * The file of the account's Aeven folder an absolute path names, as any device of the account wrote it. The folder
   * is the account's own, so it is read whether or not the workspace contains it.
   * @param owner - the Session's account.
   * @param path - the requested path.
   * @param signal - caller cancellation.
   * @returns the file here, or undefined when no Aeven folder is mounted or the path is inside none.
   */
  private async aevenFolderFile(owner: string | undefined, path: string, signal: AbortSignal): Promise<FsTarget | undefined> {
    const folder = this.ctx.get('aevenFolder')
    if (folder === undefined || owner === undefined || !isAbsolute(path)) return undefined
    const [local, here] = await Promise.all([folder.localPath(owner, path), folder.folderOf(owner)])
    if (local === undefined || here === undefined) return undefined
    const root = await this.ctx.fs.resolve(here, { signal })
    const target = await this.ctx.fs.resolve(local, { signal })
    // A symbolic link inside the folder may point anywhere; only files the folder itself holds are its own.
    return this.ctx.fs.contains(root, target) ? target : undefined
  }

  /**
   * The Session's workspace root on this device, its account, and the roots its log recorded, refusing a Session the
   * caller may not open.
   */
  private async placeOf(sessionId: SessionId): Promise<SessionPlace> {
    const live = this.ctx.get('agents')?.get(sessionId)
    if (live !== undefined) {
      this.assertMayAccess(sessionId, live.session.header.owner)
      const logged = this.ctx.get('sessionProjections')?.stateOf(live.session, 'workingDirectory')
      return {
        root: this.workspaceRootOf(live),
        owner: live.session.header.owner,
        recorded: recordedRoots(live.session.header.cwd, logged),
      }
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
    const local = observedSessionDirectory(this.ctx, held.header, held.projections?.values.workingDirectory)
    if (local.state === 'unresolved') throw new WorkingDirectoryUnavailableError(sessionId, local.reason)
    return {
      root: local.state === 'local' ? local.root : this.ctx.sandboxPolicy.workspaceRoot,
      owner: held.header.owner,
      recorded: recordedRoots(held.header.cwd, held.projections?.values.workingDirectory),
    }
  }

  /** Refuse a Session another account owns exactly as an absent one, so a caller cannot learn which exist. */
  private assertMayAccess(sessionId: SessionId, owner: string | undefined): void {
    if (this.ctx.get('identityUsers')?.mayAccess(owner) === false) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
  }

  /**
   * Resolve a path a client names against the Session's workspace here and refuse it unless the workspace contains
   * it. A path another device of the account recorded under its own root for the Session names the same entry here.
   * @returns the resolved workspace root and the entry.
   */
  private async confine(place: SessionPlace, path: string, signal: AbortSignal): Promise<{ root: FsTarget; target: FsTarget }> {
    const root = await this.ctx.fs.resolve(place.root, { signal })
    const local = toLocal(place, path)
    const target = local.length === 0 ? root : await this.ctx.fs.resolve(local, { cwd: place.root, signal })
    if (!this.ctx.fs.contains(root, target)) {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    return { root, target }
  }

  /**
   * The entry a read of a client-named path opens on this device: the account's Aeven folder copy for a path inside
   * any device's Aeven folder, otherwise the path under the workspace here, confined to it when reads are confined.
   */
  private async readTarget(place: SessionPlace, path: string, signal: AbortSignal): Promise<FsTarget> {
    const own = await this.aevenFolderFile(place.owner, path, signal)
    if (own !== undefined) return own
    if (this.config.confineReads === true) return (await this.confine(place, path, signal)).target
    return this.ctx.fs.resolve(toLocal(place, path), { cwd: place.root, signal })
  }

  /**
   * A read that found nothing here: ask the workspace syncs to bring the Session's workspace, as a turn here would,
   * waiting at most `arrivalWaitMs`, then resolve the path again.
   * @returns the entry and its stat after the wait; the stat is undefined when the file still has not arrived.
   */
  private async afterArrival(sessionId: SessionId, path: string, signal: AbortSignal): Promise<{ target: FsTarget; info: Awaited<ReturnType<Context['fs']['stat']>> }> {
    await this.wantFiles(sessionId, signal)
    const place = await this.placeOf(sessionId)
    const target = await this.readTarget(place, path, signal)
    return { target, info: await this.ctx.fs.stat(target, signal) }
  }

  /** Ask the workspace syncs for a Session's workspace files here, for a reader; a running Agent's turn already did. */
  private async wantFiles(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined || this.ctx.get('agents')?.get(sessionId) !== undefined) return
    await registry.wantSessionFiles(sessionId, AbortSignal.any([signal, AbortSignal.timeout(this.config.arrivalWaitMs)]))
  }
}

/** Where a Session's files are for this device: its workspace root here, its account, and every root it recorded. */
interface SessionPlace {
  readonly root: string
  readonly owner: string | undefined
  /** The roots the Session's log recorded on each device that ran it, the header's first. */
  readonly recorded: readonly string[]
}

/**
 * A path a client names, with a prefix that another device recorded as the Session's workspace root replaced by the
 * root here: a conversation that ran elsewhere names its files by that device's absolute paths.
 * @param place - the Session's root here and its recorded roots.
 * @param path - the path as the client names it, relative or absolute.
 * @returns the path to resolve here; relative and unrecorded paths come back unchanged.
 */
export function toLocal(place: Pick<SessionPlace, 'root' | 'recorded'>, path: string): string {
  let best: { readonly root: string; readonly rest: string } | undefined
  for (const recorded of place.recorded) {
    const root = recorded.replace(/[/\\]+$/, '')
    if (root.length === 0 || root === place.root.replace(/[/\\]+$/, '')) continue
    const rest = path === root ? '' : (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) ? path.slice(root.length + 1) : undefined
    if (rest !== undefined && (best === undefined || root.length > best.root.length)) best = { root, rest }
  }
  if (best === undefined) return path
  const segments = best.rest.split(/[/\\]/).filter(segment => segment !== '')
  // A recorded path never climbs out of its own root; one that does stays unchanged and resolves as written.
  return segments.includes('..') ? path : join(place.root, ...segments)
}

/**
 * The workspace roots a Session recorded, first its header's, then each one its log recorded, without repeats.
 * @param header - the header's directory, the first device's root.
 * @param logged - the folded `workingDirectory` state or wire value, when one is known.
 * @returns the recorded roots.
 */
function recordedRoots(
  header: string | undefined,
  logged: { readonly root: string | null; readonly roots: readonly string[] } | undefined,
): readonly string[] {
  const roots = [header, ...logged?.roots ?? [], logged?.root ?? undefined]
  return [...new Set(roots.filter((root): root is string => root !== undefined))]
}

export default WorkspaceFiles
