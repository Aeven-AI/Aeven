/**
 * The account's artifacts: the finished files Aeven created, read from stored Session logs.
 *
 * The `artifacts` Remote lists them newest Session first. Each Session's list is derived from its log
 * once per stored revision and kept, in memory and, when `cacheFile` is set, on disk, so a restarted
 * Host does not read every log again. A page ends after a set number of log reads, and Sessions whose
 * list is kept cost none, so a cold scan shows its first cards while older logs are still being read
 * and a warm one answers in a single call.
 * @module @aeven/host-artifacts
 */

import type {} from '@aeven/identity-user'
import type {} from '@aeven/fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@aeven/session'
import type { SessionPersistenceRevision } from '@aeven/session-persistence'
import { TypertRemoteService, Remote } from '@aeven/typert-protocol'
import { ARTIFACT_TOOLS, SOURCE_FAMILY, collectArtifacts, linksImage } from './collect.ts'
import type { Artifact, ArtifactCursor, ArtifactListRequest, ArtifactListValue } from './types.ts'

export type * from './types.ts'
export { artifactKind, artifactName, collectArtifacts, htmlTitle, readableName } from './collect.ts'

/** Deployment settings. */
export interface Config {
  /** Session logs one `list` call reads at most; Sessions whose list is kept do not count. */
  readonly readsPerPage: number
  /** File the derived lists are kept in across restarts; absent, they are kept in memory only. */
  readonly cacheFile?: string
}

/** Format of the cache file; a file of another version is ignored and rebuilt. */
const CACHE_VERSION = 5

declare module '@deepseek-ai/cordis' {
  interface Context {
    artifacts: ArtifactsService
  }
}

/** What the live feed holds for one Session running on this Host. */
interface LiveSession {
  /** Calls whose results can add an artifact, by call id, until their result arrives. */
  readonly calls: Set<string>
  /** The artifacts last sent, serialized, so an unchanged list is not sent again. */
  sent?: string | undefined
  /** Whether a derivation is scheduled or running. */
  busy: boolean
  /** Whether another qualifying event arrived while it ran. */
  again: boolean
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
    readsPerPage: s.natural().min(1).default(20),
    cacheFile: s.string(),
  })

  private readonly cache = new Map<SessionId, CachedSession>()
  /** The cache file's read, started once. */
  private loaded: Promise<void> | undefined
  /** Whether the memory cache holds entries the file does not. */
  private dirty = false
  /** The write in progress, so writes never overlap. */
  private writing: Promise<void> = Promise.resolve()
  /** Sessions running on this Host whose events the live feed follows. */
  private readonly live = new Map<SessionId, LiveSession>()
  /** Aborts the live feed's file checks when the service stops. */
  private readonly stopped = new AbortController()

  /**
   * @param ctx - Host context carrying Session persistence and identity.
   * @param config - validated deployment settings.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'artifacts')
    ctx.on('session/event', (session, event) => { this.observe(session, event) })
    ctx.on('session/disposed', (session) => { this.live.delete(session.id) })
    ctx.effect(() => () => { this.stopped.abort() }, 'artifacts: live feed')
  }

  /**
   * Follow one appended event. Only an event that can change the Session's artifacts schedules a derivation: a
   * result of a call that writes, generates or shows a file, a result that declares output files, a reply that
   * links an image, a new title, or a rewind. Streaming chunks and every other event cost a lookup.
   * @param session - the Session whose log grew.
   * @param event - the appended event.
   */
  private observe(session: Session, event: SessionEvent): void {
    let state = this.live.get(session.id)
    switch (event.type) {
      case 'tool/call':
        if (!ARTIFACT_TOOLS.has(event.data.name)) return
        if (state === undefined) {
          state = { calls: new Set(), busy: false, again: false }
          this.live.set(session.id, state)
        }
        state.calls.add(String(event.data.callId))
        return
      case 'tool/result': {
        const callId = String(event.data.message.source.callId)
        const meta: unknown = event.data.meta
        const declares = typeof meta === 'object' && meta !== null && 'producedFiles' in meta && Array.isArray(meta.producedFiles)
          && meta.producedFiles.length > 0
        if (state?.calls.delete(callId) !== true && !declares) return
        break
      }
      case 'assistant/message':
        if (!event.data.message.content.some(block => block.type === 'text' && linksImage(block.text))) return
        break
      case 'session/rewind':
        break
      default:
        if ((event.type as string) !== 'session/title') return
    }
    if (state === undefined) {
      state = { calls: new Set(), busy: false, again: false }
      this.live.set(session.id, state)
    }
    if (state.busy) {
      state.again = true
      return
    }
    state.busy = true
    // Events appended in one burst share one derivation, which runs after the burst.
    setImmediate(() => { void this.send(session, state) })
  }

  /**
   * Derive a live Session's artifacts from its log in memory and send them when they changed since the last send.
   * @param session - the Session.
   * @param state - its live feed state.
   */
  private async send(session: Session, state: LiveSession): Promise<void> {
    try {
      do {
        state.again = false
        const items = collectArtifacts(session.header, session.inheritedEventCount, session.snapshotEvents())
        const shown = await this.present(items, session.header, this.stopped.signal)
        const serialized = JSON.stringify(shown)
        if (serialized !== state.sent && this.live.get(session.id) === state) {
          state.sent = serialized
          this.ctx.emit('artifacts/change', session.id, shown)
        }
      } while (state.again && !this.stopped.signal.aborted)
    } catch (error) {
      // A failed check costs only this update; the page reads the Session again on its next visit.
      this.ctx.logger('artifacts').debug('live update not sent: %s', error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = false
    }
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
    // Each Session's presence check runs beside the scan, which waits only on log reads.
    const presented: Promise<Artifact[]>[] = []
    let reads = 0
    let next = from
    while (next < snapshots.length && reads < this.config.readsPerPage) {
      signal.throwIfAborted()
      const snapshot = snapshots[next] as (typeof snapshots)[number]
      next += 1
      let cached = this.cache.get(snapshot.header.id)
      if (cached === undefined || cached.revision !== snapshot.revision) {
        const inspection = await this.ctx.sessionPersistence.inspect(snapshot.header.id, signal)
        reads += 1
        cached = {
          revision: snapshot.revision,
          items: collectArtifacts(inspection.meta, inspection.inheritedEventCount, inspection.events),
        }
        this.cache.set(snapshot.header.id, cached)
        this.dirty = true
      }
      presented.push(this.present(cached.items, snapshot.header, signal))
    }
    const items = (await Promise.all(presented)).flat()
    this.save()
    const last = snapshots[next - 1]
    return {
      items: items.sort((a, b) => b.createdAt - a.createdAt),
      nextCursor: last === undefined || next >= snapshots.length ? null : cursorOf(last.header),
      scanned: next,
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
   * The artifacts that can still be shown: those whose file is on this device now, each given its version token,
   * and those whose file is gone but whose stored copy stands for it, marked missing. An artifact with neither was
   * removed and is left out. Checked on every read, because a file can be deleted or moved without its Session
   * changing; a check never waits for a sync to bring the file. A page, PDF or document the log does not place in
   * a set is placed by the skill source file beside it on disk, which a command may have written without a file
   * tool; each folder is checked once.
   * @param items - one Session's artifacts.
   * @param header - that Session's metadata, whose working directory relative paths resolve against.
   * @param signal - carrier cancellation.
   * @returns the artifacts that can be shown.
   */
  private async present(items: readonly Artifact[], header: SessionHeader, signal: AbortSignal): Promise<Artifact[]> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return [...items]
    const where = header.cwd === undefined ? { signal } : { cwd: header.cwd, signal }
    const exists = async (path: string): Promise<boolean> => {
      try {
        return await fs.stat(await fs.resolve(path, where), signal) !== undefined
      } catch {
        // A path this device cannot resolve or read holds nothing here.
        return false
      }
    }
    const folders = new Map<string, Promise<Artifact['family']>>()
    const familyOf = (path: string): Promise<Artifact['family']> => {
      const folder = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
      let found = folders.get(folder)
      if (found === undefined) {
        found = (async () => {
          for (const [name, family] of Object.entries(SOURCE_FAMILY)) if (await exists(`${folder}${name}`)) return family
          return undefined
        })()
        folders.set(folder, found)
      }
      return found
    }
    const shown = await Promise.all(items.map(async (item): Promise<Artifact | undefined> => {
      // A stored copy is the artifact itself and never changes, so there is no file to look for.
      if (item.stored === true) return item
      let version: string | undefined
      try {
        const info = await fs.stat(await fs.resolve(item.path, header.cwd === undefined ? { signal } : { cwd: header.cwd, signal }), signal)
        if (info !== undefined) version = `${String(info.version)}:${String(info.size ?? '')}`
      } catch {
        // A path this device cannot resolve or read, such as another device's home folder, is not here.
      }
      if (version !== undefined) {
        const placed = item.family === undefined && (item.kind === 'page' || item.kind === 'pdf' || item.kind === 'document')
        const family = placed ? await familyOf(item.path) : undefined
        return family === undefined ? { ...item, version } : { ...item, version, family }
      }
      return item.attachmentId === undefined ? undefined : { ...item, missing: true as const }
    }))
    return shown.filter(item => item !== undefined)
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
