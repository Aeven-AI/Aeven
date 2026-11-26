/**
 * The account's artifacts: the finished files Aeven created, read from stored Session logs.
 *
 * The `artifacts` Remote lists them a page of Sessions at a time, newest Session first, so a page
 * can show the first cards while older Sessions are still being read. Each Session's list is derived
 * from its log once per stored revision and kept, in memory and, when `cacheFile` is set, on disk, so
 * a restarted Host does not read every log again.
 * @module @aeven/host-artifacts
 */

import type {} from '@aeven/identity-user'
import type {} from '@aeven/fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { SessionHeader, SessionId } from '@aeven/session'
import type { SessionPersistenceRevision } from '@aeven/session-persistence'
import { TypertRemoteService, Remote } from '@aeven/typert-protocol'
import { collectArtifacts } from './collect.ts'
import type { Artifact, ArtifactCursor, ArtifactListRequest, ArtifactListValue } from './types.ts'

export type * from './types.ts'
export { artifactKind, artifactName, collectArtifacts, htmlTitle, readableName } from './collect.ts'

/** Deployment settings. */
export interface Config {
  /** Stored Sessions one `list` call reads at most. */
  readonly sessionsPerPage: number
  /** File the derived lists are kept in across restarts; absent, they are kept in memory only. */
  readonly cacheFile?: string
}

/** Format of the cache file; a file of another version is ignored and rebuilt. */
const CACHE_VERSION = 1

declare module '@deepseek-ai/cordis' {
  interface Context {
    artifacts: ArtifactsService
  }
}

/** One Session's artifacts as of one stored revision. */
interface CachedSession {
  readonly revision: SessionPersistenceRevision
  readonly items: readonly Artifact[]
}

/** The two header fields the newest-first order reads. */
type Position = Pick<SessionHeader, 'createdAt' | 'id'>

/**
 * Order Sessions newest first, ties broken by id so the order is total.
 * @param a - one Session's position.
 * @param b - another Session's position.
 * @returns a negative number when `a` comes first.
 */
function newestFirst(a: Position, b: Position): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The cursor that names a Session's position in the newest-first order. */
function cursorOf(header: Position): ArtifactCursor {
  return `${String(header.createdAt)}:${header.id}` as ArtifactCursor
}

/**
 * Remote service behind the Artifacts page. It reads persisted Session history and never creates
 * or resumes an Agent or Session.
 */
export class ArtifactsService extends TypertRemoteService {
  static inject = ['sessionPersistence', 'identityUsers']

  /** Loader validation for the deployment settings. */
  static Config: s<Config> = s.object({
    sessionsPerPage: s.natural().min(1).default(20),
    cacheFile: s.string(),
  })

  private readonly cache = new Map<SessionId, CachedSession>()
  /** The cache file's read, started once. */
  private loaded: Promise<void> | undefined
  /** Whether the memory cache holds entries the file does not. */
  private dirty = false
  /** The write in progress, so writes never overlap. */
  private writing: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host context carrying Session persistence and identity.
   * @param config - validated deployment settings.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'artifacts')
  }

  /** Nothing to open: the list is derived from stored logs on demand. */
  protected [Service.init](): void {}

  /**
   * List the artifacts of the next Sessions the acting user may read, newest Session first.
   * @param request - where the previous page stopped.
   * @param signal - carrier cancellation.
   * @returns the page's artifacts, the cursor for the next page, and the scan progress.
   */
  @Remote('list')
  async list(request: ArtifactListRequest, signal: AbortSignal): Promise<ArtifactListValue> {
    await (this.loaded ??= this.load())
    const all = await this.ctx.sessionPersistence.listSnapshots(signal)
    const snapshots = all
      .filter(snapshot => this.ctx.identityUsers.mayAccess(snapshot.header.owner))
      .sort((a, b) => newestFirst(a.header, b.header))
    // Sessions of other accounts stay cached; only Sessions gone from storage are forgotten.
    const stored = new Set(all.map(snapshot => snapshot.header.id))
    for (const id of this.cache.keys()) {
      if (stored.has(id)) continue
      this.cache.delete(id)
      this.dirty = true
    }
    // A cursor whose Session was deleted since still names a position in the order.
    const after = request.cursor === undefined ? undefined : positionOf(request.cursor)
    const start = after === undefined ? 0 : snapshots.findIndex(snapshot => newestFirst(snapshot.header, after) > 0)
    const from = start < 0 ? snapshots.length : start
    const page = snapshots.slice(from, from + this.config.sessionsPerPage)
    const items: Artifact[] = []
    for (const snapshot of page) {
      signal.throwIfAborted()
      let cached = this.cache.get(snapshot.header.id)
      if (cached === undefined || cached.revision !== snapshot.revision) {
        const inspection = await this.ctx.sessionPersistence.inspect(snapshot.header.id, signal)
        cached = {
          revision: snapshot.revision,
          items: collectArtifacts(inspection.meta, inspection.inheritedEventCount, inspection.events),
        }
        this.cache.set(snapshot.header.id, cached)
        this.dirty = true
      }
      items.push(...await this.present(cached.items, snapshot.header, signal))
    }
    this.save()
    const scanned = from + page.length
    const last = page.at(-1)
    return {
      items: items.sort((a, b) => b.createdAt - a.createdAt),
      nextCursor: last === undefined || scanned >= snapshots.length ? null : cursorOf(last.header),
      scanned,
      total: snapshots.length,
    }
  }

  /** Read the cache file once; a missing, unreadable or older file starts an empty cache. */
  private async load(): Promise<void> {
    if (this.config.cacheFile === undefined) return
    try {
      const parsed = JSON.parse(await readFile(this.config.cacheFile, 'utf8')) as {
        version?: unknown
        sessions?: Record<string, CachedSession>
      }
      if (parsed.version !== CACHE_VERSION || typeof parsed.sessions !== 'object' || parsed.sessions === null) return
      for (const [id, entry] of Object.entries(parsed.sessions)) {
        if (typeof entry.revision === 'string' && Array.isArray(entry.items)) this.cache.set(id as SessionId, entry)
      }
    } catch {
      // No cache file yet, or one this build cannot read: every Session is derived from its log again.
    }
  }

  /** Write the cache file when it lags the memory cache; one write at a time, through a temporary name. */
  private save(): void {
    const file = this.config.cacheFile
    if (file === undefined || !this.dirty) return
    this.dirty = false
    const body = JSON.stringify({ version: CACHE_VERSION, sessions: Object.fromEntries(this.cache) })
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${String(process.pid)}.tmp`
      await writeFile(temporary, body)
      await rename(temporary, file)
    }).catch((error: unknown) => {
      // A failed write costs only a longer first read after a restart; the next list call tries again.
      this.dirty = true
      this.ctx.logger('artifacts').debug('cache not written: %s', error instanceof Error ? error.message : String(error))
    })
  }

  /**
   * Mark the artifacts whose file is not on this device now. Checked on every read, because a file can be deleted
   * or moved without its Session changing; a check never waits for a sync to bring the file.
   * @param items - one Session's artifacts.
   * @param header - that Session's metadata, whose working directory relative paths resolve against.
   * @param signal - carrier cancellation.
   * @returns the artifacts, each missing one marked and each present one given its version token.
   */
  private async present(items: readonly Artifact[], header: SessionHeader, signal: AbortSignal): Promise<Artifact[]> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return [...items]
    return await Promise.all(items.map(async (item) => {
      let version: string | undefined
      try {
        const info = await fs.stat(await fs.resolve(item.path, header.cwd === undefined ? { signal } : { cwd: header.cwd, signal }), signal)
        if (info !== undefined) version = `${String(info.version)}:${String(info.size ?? '')}`
      } catch {
        // A path this device cannot resolve or read, such as another device's home folder, is not here.
      }
      return version === undefined ? { ...item, missing: true as const } : { ...item, version }
    }))
  }
}

/**
 * The position a cursor names.
 * @param cursor - a cursor this service issued.
 * @returns the creation time and id the cursor encodes.
 */
function positionOf(cursor: ArtifactCursor): Position {
  const split = cursor.indexOf(':')
  return { createdAt: Number(cursor.slice(0, split)), id: cursor.slice(split + 1) as SessionId }
}

export default ArtifactsService
