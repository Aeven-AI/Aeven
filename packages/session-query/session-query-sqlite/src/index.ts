/**
 * Concrete session-query service with SQLite FTS5 over the live-preferred corpus.
 *
 * @module @aeven/session-query-sqlite
 */

import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionSeq } from '@aeven/session'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
} from '@aeven/session'
import type SessionPersistence from '@aeven/session-persistence'
import type {
  SessionPersistenceRevision,
  SessionPersistenceSnapshot,
} from '@aeven/session-persistence'
import SessionQueryEngine, {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
  SessionSearchCursor,
  assertSessionHeadersCompatible,
  buildSessionEventSearchDocuments,
} from '@aeven/session-query'
import type {} from '@aeven/settings'
import type {
  Config as SessionQueryConfig,
  SessionEventSearchDocument,
  SessionEventSearchHit,
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchCursor as SessionSearchCursorValue,
  SessionSearchPage,
  SessionSearchRequest,
} from '@aeven/session-query'
import {
  type JournalMode,
  openSearchDatabase,
} from './schema.ts'
import {
  type NormalizedEventRequest,
  type NormalizedSessionRequest,
  FTS_HIGHLIGHT_END,
  FTS_HIGHLIGHT_START,
  assertFts5OuterPredicateCount,
  assertPortableBindingCount,
  buildEventWhere,
  buildSessionWhere,
  makeSnippet,
  mergedSpanCount,
  normalizeEventRequest,
  normalizeSessionRequest,
  quoteFtsData,
  requestFingerprint,
  sanitizeFtsText,
  SQLITE_MAX_PAGE_LIMIT,
} from './query.ts'

export {
  SESSION_QUERY_SQLITE_APPLICATION_ID,
  SESSION_QUERY_SQLITE_SCHEMA_VERSION,
  type JournalMode,
} from './schema.ts'

/** Boot-context slot for a launcher-owned absolute path to this process's derived query index. */
export const SESSION_QUERY_SQLITE_PATH_KEY = 'launcherSessionQueryPath'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned absolute path to this process's disposable derived query index. */
    launcherSessionQueryPath?: string
  }
}

/** Default result page size. */
export const SESSION_QUERY_SQLITE_DEFAULT_LIMIT = 20
/** Maximum accepted result page size. */
export const SESSION_QUERY_SQLITE_MAX_LIMIT = 100
/** Default maximum snippet length in Unicode code points. */
export const SESSION_QUERY_SQLITE_SNIPPET_CHARS = 240

// One transient source change gets a retry; repeated churn fails rather than monopolizing the queue.
const STABLE_OBSERVATION_ATTEMPTS = 2

/** SQLite module/handle opening phase; `never` disables full-text search entirely. */
export type OpenAt = 'startup' | 'first-search' | 'never'

/** Settings namespace for the user-owned content-search availability policy. */
const SETTINGS_NAMESPACE = 'session-query-sqlite'

/** User-owned settings that can change without replacing the derived index. */
interface SearchSettings {
  /** Whether SQLite opens at activation, on first search, or remains disabled. */
  openAt: OpenAt
}

/** Schema for the user-owned content-search availability policy. */
const SearchSettingsSchema: z<SearchSettings> = z.object({
  openAt: z.union(['startup', 'first-search', 'never'] as const).default('startup'),
})

/** Combined session-query configuration backed by SQLite full-text search. */
export interface Config extends SessionQueryConfig {
  /**
   * Dedicated derived-index path; `:memory:` is supported for ephemeral
   * indexes. Missing directories and database files are created owner-only on
   * POSIX filesystems; existing modes are preserved.
   */
  path: string
  /**
   * Open the SQLite module and handle at service activation or the first
   * search, or `never` to disable full-text search: the inherited exact
   * reads, filters, and traces stay available, while `searchSessions` and
   * `searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED` and SQLite is
   * never imported or opened. Defaults to `startup`.
   */
  openAt?: OpenAt
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Page size when a request omits `limit`. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 100. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /** Maximum concurrent persisted-log inspections in one inherited batch read. Defaults to 4. */
  persistedInspectConcurrency?: number
}

interface ResolvedConfig {
  path: string
  openAt: OpenAt
  journalMode: JournalMode
  defaultLimit: number
  maxLimit: number
  snippetChars: number
  readWindowMax: number
  persistedInspectConcurrency: number
}

interface ObservedSession {
  header: SessionHeader
  inheritedEventCount: SessionLogOffset
  documents: SessionEventSearchDocument[]
  fingerprint: string
}

interface ObservedPersistedSession {
  header: SessionHeader
  revision: SessionPersistenceRevision
  loaded?: ObservedSession
}

interface PersistenceBinding {
  readonly identity: symbol
  readonly service?: SessionPersistence
}

interface Observation {
  persistenceBinding: PersistenceBinding
  persisted: Map<SessionId, ObservedPersistedSession>
  live: Map<SessionId, ObservedSession>
}

interface IndexedPersistedRow {
  id: string
  revision: string
  generation: number
}

interface IndexedLiveRow {
  id: string
  fingerprint: string
  persisted: number
  generation: number
}

interface SessionHeaderRow {
  session_id: string
  version: number
  created_at: number
  cwd: string | null
  parent_session: string | null
  seed_length: number | null
  delegation_depth: number | null
  agent_preset: string | null
  owner: string | null
}

interface SearchRow extends SessionHeaderRow {
  live: number
  persisted: number
  seq: number
  type: string
  time: number
  surface: string
  marked_text: string
  match_count: number
  document_length: number
}

interface CursorPayload {
  version: 1
  instance: string
  scope: 'sessions' | 'events'
  fingerprint: string
  generation: string
  offset: number
}

/** Concrete SQLite owner of the combined `ctx.sessionQuery` service. */
export class SqliteSessionQueryEngine extends SessionQueryEngine {
  static override inject = ['sessions']

  static Config: z<Config> = z.object({
    path: z.string().required(),
    openAt: z.union(['startup', 'first-search', 'never'] as const).default('startup'),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    defaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_DEFAULT_LIMIT),
    maxLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_MAX_LIMIT),
    snippetChars: z.number().step(1).min(1).default(SESSION_QUERY_SQLITE_SNIPPET_CHARS),
    readWindowMax: z.number().step(1).min(0).default(SESSION_QUERY_READ_WINDOW_MAX),
    persistedInspectConcurrency: z.number()
      .step(1)
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY),
  })

  /** Validated and defaulted backend configuration. */
  readonly config: ResolvedConfig

  private readonly _instance = randomUUID()
  private _ready: Promise<void> | undefined
  private _db: DatabaseSync | undefined
  private _persistenceBinding: PersistenceBinding = { identity: Symbol() }
  private _lastPersistenceIdentity: symbol | undefined
  private _persistenceEpoch = 0
  private _globalGeneration = 0
  private _localGeneration = 0
  private _tail: Promise<void> = Promise.resolve()
  private _closed = false
  private _closePromise: Promise<void> | undefined
  private readonly _optionalPersistenceFiber: Fiber

  constructor(ctx: Context, config: Config) {
    const entry = resolveConfig(config)
    super(ctx, entry)
    let settingsSource: () => SearchSettings = () => ({ openAt: entry.openAt })
    this.config = {
      ...entry,
      get openAt() {
        return settingsSource().openAt
      },
    }
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, SearchSettingsSchema, {
        openAt: entry.openAt,
      }, {
        setSource: (source) => {
          settingsSource = source
        },
        // Search methods read the policy through the getter above; no index
        // registration changes when the setting changes.
        onChange: () => {},
      })
    })
    this._optionalPersistenceFiber = ctx.inject(['sessionPersistence'], (childCtx: Context) => {
      const service = childCtx.sessionPersistence
      const binding = { identity: Symbol(), service }
      this._persistenceBinding = binding
      childCtx.effect(() => () => {
        /* v8 ignore next -- a stale optional-service disposer cannot clear a replacement */
        if (this._persistenceBinding !== binding) return
        this._persistenceBinding = { identity: Symbol() }
      }, 'sessionQuerySqlite.persistenceBinding')
    })
    ctx.effect(() => {
      return () => this._optionalPersistenceFiber.dispose()
    }, 'sessionQuerySqlite.optionalPersistence')
    ctx.effect(() => async () => this.close(), 'sessionQuerySqlite.close')
  }

  /** Open eagerly only when activation owns the configured readiness boundary. */
  protected async [Service.init](): Promise<void> {
    if (this.config.openAt === 'startup') await this._ensureReady(undefined)
  }

  override async searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>> {
    this._assertSearchEnabled()
    const normalized = normalizeSessionRequest(request, this.config)
    const signal = exec?.signal
    return this._serialized(signal, async () => {
      await this._ensureReady(signal)
      const persistenceBinding = await this._reconcile(signal)
      assertNotAborted(signal)
      const generation = String(this._globalGeneration)
      const fingerprint = requestFingerprint(normalized)
      const offset = normalized.cursor === undefined
        ? 0
        : decodeCursor(normalized.cursor, this._instance, 'sessions', fingerprint, generation)
      const rows = this._querySessions(normalized, offset, persistenceBinding)
      return page(rows, normalized.limit, row => this._sessionHit(row), cursorOffset => encodeCursor({
        version: 1,
        instance: this._instance,
        scope: 'sessions',
        fingerprint,
        generation,
        offset: cursorOffset,
      }), offset)
    })
  }

  override async searchEvents(
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage> {
    this._assertSearchEnabled()
    const normalized = normalizeEventRequest(request, this.config)
    const signal = exec?.signal
    return this._serialized(signal, async () => {
      await this._ensureReady(signal)
      const persistenceBinding = await this._reconcile(signal)
      assertNotAborted(signal)
      const target = this._targetObservation(normalized.sessionId, persistenceBinding)
      const fingerprint = requestFingerprint(normalized)
      const offset = normalized.cursor === undefined
        ? 0
        : decodeCursor(normalized.cursor, this._instance, 'events', fingerprint, target.generation)
      const rows = this._queryEvents(normalized, offset, persistenceBinding)
      return {
        session: target.header,
        ...page(rows, normalized.limit, row => this._eventHit(row), cursorOffset => encodeCursor({
          version: 1,
          instance: this._instance,
          scope: 'events',
          fingerprint,
          generation: target.generation,
          offset: cursorOffset,
        }), offset),
      }
    })
  }

  /** Close the database after every accepted operation reaches quiescence. */
  close(): Promise<void> {
    this._closePromise ??= this._close()
    return this._closePromise
  }

  /**
   * Refuse full-text calls under `openAt: 'never'` before any request
   * normalization or SQLite work, so a disabled deployment never imports
   * node:sqlite, opens the index, or observes sources.
   */
  private _assertSearchEnabled(): void {
    if (this.config.openAt !== 'never') return
    throw new SessionQueryError(
      'session search is disabled: this deployment configures the session-query index with openAt "never"',
      'SESSION_QUERY_SEARCH_DISABLED',
    )
  }

  private async _close(): Promise<void> {
    this._closed = true
    await this._tail
    if (this._ready !== undefined) {
      try {
        await this._ready
      } catch {
        // Opening already closed a partially-created handle; disposal only waits.
      }
    }
    this._db?.close()
    this._db = undefined
  }

  private async _open(): Promise<void> {
    this._db = await openSearchDatabase(this.config.path, this.config.journalMode)
    const state = this._db.prepare(
      'SELECT global_generation FROM search_state WHERE singleton = 1',
    ).get() as { global_generation: number }
    this._globalGeneration = state.global_generation
    this._localGeneration = state.global_generation
  }

  private async _ensureReady(signal: AbortSignal | undefined): Promise<void> {
    this._ready ??= this._open()
    try {
      await waitWithAbort(this._ready, signal)
    } catch (error: unknown) {
      if (isAbort(error)) throw error
      throw new SessionQueryError(
        `session-search SQLite index failed to open: ${errorMessage(error)}`,
        'SESSION_QUERY_INDEX_FAILED',
        { cause: error },
      )
    }
  }

  private async _serialized<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (this._isClosed()) throw indexClosed()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const prior = this._tail
    this._tail = prior.then(() => gate)
    try {
      await waitWithAbort(prior, signal)
    } catch (error: unknown) {
      release()
      throw error
    }
    if (this._isClosed()) {
      release()
      throw indexClosed()
    }
    try {
      assertNotAborted(signal)
      return await operation()
    } finally {
      release()
    }
  }

  private async _reconcile(signal: AbortSignal | undefined): Promise<PersistenceBinding> {
    assertNotAborted(signal)
    const db = this._requireDb()
    const persistedRows = db.prepare(
      'SELECT id, revision, generation FROM persisted_sessions',
    ).all() as unknown as IndexedPersistedRow[]
    const liveRows = db.prepare(
      'SELECT id, fingerprint, persisted, generation FROM temp.live_sessions',
    ).all() as unknown as IndexedLiveRow[]
    const persistedById = new Map(persistedRows.map(row => [row.id as SessionId, row]))
    const liveById = new Map(liveRows.map(row => [row.id as SessionId, row]))
    const observation = await this._observeStable(persistedById, liveById, signal)
    assertNotAborted(signal)
    const persistentChanges = observation.persistenceBinding.service === undefined
      ? []
      : [...observation.persisted.values()].filter(entry => entry.loaded !== undefined)
    const persistentDeletes = observation.persistenceBinding.service === undefined
      ? []
      : persistedRows.filter(row => !observation.persisted.has(row.id as SessionId))
    const liveChanges = [...observation.live.values()].filter((entry) => {
      const indexed = liveById.get(entry.header.id)
      const persisted = observation.persisted.has(entry.header.id) ? 1 : 0
      return indexed?.fingerprint !== entry.fingerprint || indexed.persisted !== persisted
    })
    const liveDeletes = liveRows.filter(row => !observation.live.has(row.id as SessionId))
    const pointerChanged = this._lastPersistenceIdentity !== undefined
      && this._lastPersistenceIdentity !== observation.persistenceBinding.identity
    const hasWrites = persistentChanges.length > 0
      || persistentDeletes.length > 0
      || liveChanges.length > 0
      || liveDeletes.length > 0

    let nextMainGeneration = this._mainGeneration()
    let nextLocalGeneration = this._localGeneration
    if (persistentChanges.length > 0 || persistentDeletes.length > 0) nextMainGeneration += 1
    const liveReplacements = liveChanges.map((entry) => {
      nextLocalGeneration = Math.max(nextLocalGeneration, nextMainGeneration) + 1
      return {
        entry,
        generation: nextLocalGeneration,
        persisted: observation.persisted.has(entry.header.id),
      }
    })

    if (hasWrites) {
      let began = false
      try {
        db.exec('BEGIN IMMEDIATE')
        began = true
        for (const row of persistentDeletes) this._deleteSession('persisted', row.id as SessionId)
        for (const entry of persistentChanges) {
          /* v8 ignore next -- observation loads every entry whose revision differs */
          if (entry.loaded === undefined) throw new Error(`missing loaded revision for session "${entry.header.id}"`)
          this._replacePersistedSession(entry.loaded, entry.revision, nextMainGeneration)
        }
        if (persistentChanges.length > 0 || persistentDeletes.length > 0) {
          db.prepare('UPDATE search_state SET global_generation = ? WHERE singleton = 1').run(nextMainGeneration)
        }
        for (const row of liveDeletes) this._deleteSession('live', row.id as SessionId)
        for (const { entry, generation, persisted } of liveReplacements) {
          this._replaceLiveSession(entry, generation, persisted)
        }
        db.exec('COMMIT')
      } catch (error: unknown) {
        /* v8 ignore next -- a BEGIN failure has no transaction to roll back; the common wrapper still reports it. */
        if (began) {
          /* v8 ignore next 5 -- ROLLBACK failure requires a SQLite double fault; the original failure remains actionable. */
          try {
            db.exec('ROLLBACK')
          } catch {
            // The original SQLite failure remains the actionable cause.
          }
        }
        throw new SessionQueryError(
          `session-search reconciliation failed: ${errorMessage(error)}`,
          'SESSION_QUERY_INDEX_FAILED',
          { cause: error },
        )
      }
    }

    if (hasWrites || pointerChanged) this._globalGeneration += 1
    if (pointerChanged) this._persistenceEpoch += 1
    this._localGeneration = nextLocalGeneration
    this._lastPersistenceIdentity = observation.persistenceBinding.identity
    return observation.persistenceBinding
  }

  private async _observeStable(
    indexed: ReadonlyMap<SessionId, IndexedPersistedRow>,
    liveIndexed: ReadonlyMap<SessionId, IndexedLiveRow>,
    signal: AbortSignal | undefined,
  ): Promise<Observation> {
    for (let attempt = 0; attempt < STABLE_OBSERVATION_ATTEMPTS; attempt += 1) {
      assertNotAborted(signal)
      const persistenceBinding = this._persistenceBinding
      const persistence = persistenceBinding.service
      const initiallyLive = new Set(this.ctx.sessions.list().map(session => session.id))
      let persisted = new Map<SessionId, ObservedPersistedSession>()
      if (persistence !== undefined) {
        try {
          const canReuseIndexed = this._lastPersistenceIdentity === undefined
            || this._lastPersistenceIdentity === persistenceBinding.identity
          const before = await persistence.listSnapshots(signal)
          assertNotAborted(signal)
          persisted = materializePersistenceSnapshots(before)
          for (const entry of persisted.values()) {
            if (canReuseIndexed && indexed.get(entry.header.id)?.revision === entry.revision) continue
            // Skip work already shadowed by a live owner. `inspect()` is
            // non-mutating, so an owner attaching after this check cannot cause
            // crash-repair side effects; the live-membership retry below makes
            // the returned observation live-preferred.
            if (initiallyLive.has(entry.header.id) || this.ctx.sessions.get(entry.header.id) !== undefined) continue
            assertNotAborted(signal)
            const loaded = await persistence.inspect(entry.header.id, signal)
            assertNotAborted(signal)
            assertSessionHeadersCompatible(entry.header, loaded.meta)
            entry.loaded = observeSession(
              loaded.meta,
              loaded.inheritedEventCount,
              loaded.events,
            )
          }
          assertNotAborted(signal)
          const afterSnapshots = await persistence.listSnapshots(signal)
          assertNotAborted(signal)
          const after = materializePersistenceSnapshots(afterSnapshots)
          if (!samePersistenceSnapshots(persisted, after)) continue
          if (this._persistenceBinding !== persistenceBinding) continue
        } catch (error: unknown) {
          if (isAbort(error) || signal?.aborted) {
            throw new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED', {
              cause: error,
            })
          }
          if (this._persistenceBinding !== persistenceBinding) continue
          if (error instanceof SessionQueryError) throw error
          throw new SessionQueryError(
            `session-search persistence observation failed: ${errorMessage(error)}`,
            'SESSION_QUERY_PERSISTENCE_FAILED',
            { cause: error },
          )
        }
      }
      const live = new Map<SessionId, ObservedSession>()
      for (const session of this.ctx.sessions.list()) {
        const stamp = liveStamp(session)
        const indexedLive = liveIndexed.get(session.id)
        const persistedFlag = persisted.has(session.id) ? 1 : 0
        // Events are frozen and append-only, so the header, inherited cut, and
        // log length identify the indexed body. A match skips the event read.
        const unchanged = indexedLive !== undefined
          && indexedLive.fingerprint === stamp
          && indexedLive.persisted === persistedFlag
        const observed = unchanged
          ? {
            header: structuredClone(session.header),
            inheritedEventCount: session.inheritedEventCount,
            documents: [],
            fingerprint: stamp,
          }
          : observeLive(session)
        const durable = persisted.get(session.id)
        if (durable !== undefined) assertSessionHeadersCompatible(observed.header, durable.header)
        live.set(session.id, observed)
      }
      if (!sameSessionIds(initiallyLive, live)) continue
      return { persistenceBinding, persisted, live }
    }
    throw new SessionQueryError(
      'session-search persistence observation did not stabilize after one retry',
      'SESSION_QUERY_PERSISTENCE_FAILED',
    )
  }

  private _mainGeneration(): number {
    const row = this._requireDb().prepare(
      'SELECT global_generation FROM search_state WHERE singleton = 1',
    ).get() as { global_generation: number }
    return row.global_generation
  }

  private _deleteSession(source: 'persisted' | 'live', id: SessionId): void {
    const db = this._requireDb()
    if (source === 'persisted') {
      db.prepare('DELETE FROM persisted_doc_meta WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM persisted_docs WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM persisted_sessions WHERE id = ?').run(id)
    } else {
      db.prepare('DELETE FROM temp.live_doc_meta WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM temp.live_docs WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM temp.live_sessions WHERE id = ?').run(id)
    }
  }

  private _replacePersistedSession(
    entry: ObservedSession,
    revision: SessionPersistenceRevision,
    generation: number,
  ): void {
    this._deleteSession('persisted', entry.header.id)
    const db = this._requireDb()
    db.prepare(`
      INSERT INTO persisted_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, owner, revision, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ...headerBindings(entry.header, entry.inheritedEventCount),
      revision,
      generation,
    )
    const insert = db.prepare(`
      INSERT INTO persisted_docs (text, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const meta = db.prepare(`
      INSERT INTO persisted_doc_meta
        (doc_rowid, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const document of entry.documents) {
      const text = sanitizeFtsText(document.text)
      const length = Array.from(text).length
      const inserted = insert.run(
        text,
        document.sessionId,
        document.seq,
        document.type,
        document.time,
        document.surface,
        length,
      )
      meta.run(
        Number(inserted.lastInsertRowid),
        document.sessionId,
        document.seq,
        document.type,
        document.time,
        document.surface,
        length,
      )
    }
  }

  private _replaceLiveSession(entry: ObservedSession, generation: number, persisted: boolean): void {
    this._deleteSession('live', entry.header.id)
    const db = this._requireDb()
    db.prepare(`
      INSERT INTO temp.live_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, owner, fingerprint, persisted, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ...headerBindings(entry.header, entry.inheritedEventCount),
      entry.fingerprint,
      persisted ? 1 : 0,
      generation,
    )
    const insert = db.prepare(`
      INSERT INTO temp.live_docs (text, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const meta = db.prepare(`
      INSERT INTO temp.live_doc_meta
        (doc_rowid, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const document of entry.documents) {
      const text = sanitizeFtsText(document.text)
      const length = Array.from(text).length
      const inserted = insert.run(
        text,
        document.sessionId,
        document.seq,
        document.type,
        document.time,
        document.surface,
        length,
      )
      meta.run(
        Number(inserted.lastInsertRowid),
        document.sessionId,
        document.seq,
        document.type,
        document.time,
        document.surface,
        length,
      )
    }
  }

  private _querySessions(
    request: NormalizedSessionRequest,
    offset: number,
    persistenceBinding: PersistenceBinding,
  ): SearchRow[] {
    const sessionWhere = buildSessionWhere(request.sessionFilters)
    const eventWhere = buildEventWhere(request.eventFilters)
    assertFts5OuterPredicateCount(sessionWhere.predicateCount + eventWhere.predicateCount)
    const where = [sessionWhere.sql, eventWhere.sql].filter(Boolean).join(' AND ')
    return this._queryDocuments({
      query: request.query,
      persistenceVisible: persistenceBinding.service !== undefined,
      where,
      whereParams: [...sessionWhere.params, ...eventWhere.params],
      partitionBySession: true,
      limit: request.limit,
      offset,
    })
  }

  private _queryEvents(
    request: NormalizedEventRequest,
    offset: number,
    persistenceBinding: PersistenceBinding,
  ): SearchRow[] {
    const eventWhere = buildEventWhere(request.filters)
    assertFts5OuterPredicateCount(1 + eventWhere.predicateCount)
    const where = ['session_id = ?', eventWhere.sql].filter(Boolean).join(' AND ')
    return this._queryDocuments({
      query: request.query,
      persistenceVisible: persistenceBinding.service !== undefined,
      where,
      whereParams: [request.sessionId, ...eventWhere.params],
      partitionBySession: false,
      limit: request.limit,
      offset,
    })
  }

  /**
   * Rank indexed documents, then highlight only the page.
   *
   * Match counts come from the token index. Reading `highlight()` for every
   * hit would copy each matching document, including tool results the caller
   * is about to filter out.
   */
  private _queryDocuments(request: {
    query: string
    persistenceVisible: boolean
    where: string
    whereParams: readonly (string | number)[]
    partitionBySession: boolean
    limit: number
    offset: number
  }): SearchRow[] {
    const tokens = this._queryTokens(request.query)
    if (tokens.length === 0) return []
    this._fillMatchCounts(tokens)
    const visible = request.persistenceVisible ? 1 : 0
    const bindings = [
      visible,
      visible,
      ...request.whereParams,
      request.limit + 1,
      request.offset,
    ]
    assertPortableBindingCount(bindings.length)
    // The browser fixture mirrors these rank keys in
    // `packages/client/connection/src/client/fixture.ts`; update both together.
    const ranked = this._requireDb().prepare(documentRankSql(request.partitionBySession, request.where))
      .all(...bindings) as unknown as RankedDocument[]
    return this._attachSnippets(ranked, request.query)
  }

  /** Tokenize a normalized query with the same unicode61 rules as the index. */
  private _queryTokens(query: string): string[] {
    const db = this._requireDb()
    db.prepare('DELETE FROM temp.query_probe').run()
    db.prepare('INSERT INTO temp.query_probe(text) VALUES (?)').run(query)
    const rows = db.prepare(
      'SELECT term FROM temp.query_probe_inst ORDER BY offset',
    ).all() as unknown as Array<{ term: string }>
    return rows.map(row => row.term)
  }

  /** Fill `temp.match_counts` for one tokenized phrase. */
  private _fillMatchCounts(tokens: readonly string[]): void {
    const db = this._requireDb()
    db.prepare('DELETE FROM temp.match_counts').run()
    const term = tokens.length === 1 ? tokens[0] : undefined
    if (term !== undefined) {
      // The row vocabulary's `doc` column is a table-wide frequency, not a
      // rowid. Instance rows name the document, and one token is one span.
      db.prepare(`
        INSERT INTO temp.match_counts(source, doc_rowid, match_count)
        SELECT 'persisted', doc, COUNT(*)
        FROM persisted_docs_inst
        WHERE term = ? AND col = 'text'
        GROUP BY doc
      `).run(term)
      db.prepare(`
        INSERT INTO temp.match_counts(source, doc_rowid, match_count)
        SELECT 'live', doc, COUNT(*)
        FROM temp.live_docs_inst
        WHERE term = ? AND col = 'text'
        GROUP BY doc
      `).run(term)
      return
    }
    const insert = db.prepare(
      'INSERT INTO temp.match_counts(source, doc_rowid, match_count) VALUES (?, ?, ?)',
    )
    const write = (source: 'persisted' | 'live', starts: readonly PhraseStart[]): void => {
      let doc = -1
      let offsets: number[] = []
      const flush = (): void => {
        if (doc === -1) return
        insert.run(source, doc, mergedSpanCount(offsets, tokens.length))
      }
      for (const start of starts) {
        if (start.doc !== doc) {
          flush()
          doc = start.doc
          offsets = []
        }
        offsets.push(start.offset)
      }
      flush()
    }
    write('persisted', this._phraseStarts('persisted_docs_inst', tokens))
    write('live', this._phraseStarts('temp.live_docs_inst', tokens))
  }

  /** Phrase start positions, ordered by document then token offset. */
  private _phraseStarts(vocab: string, tokens: readonly string[]): PhraseStart[] {
    const joins: string[] = []
    for (let index = 1; index < tokens.length; index += 1) {
      const alias = `i${index}`
      joins.push(
        `JOIN ${vocab} ${alias} ON ${alias}.doc = i0.doc AND ${alias}.col = 'text' AND ${alias}.offset = i0.offset + ${index}`,
      )
    }
    const terms = tokens.map((_, index) => `i${index}.term = ?`).join(' AND ')
    const rows = this._requireDb().prepare(`
      SELECT i0.doc AS doc, i0.offset AS token_offset
      FROM ${vocab} i0
      ${joins.join('\n')}
      WHERE i0.col = 'text' AND ${terms}
      ORDER BY i0.doc, i0.offset
    `).all(...tokens) as unknown as Array<{ doc: number; token_offset: number }>
    return rows.map(row => ({ doc: Number(row.doc), offset: Number(row.token_offset) }))
  }

  /** Highlight one page of already-ranked documents. */
  private _attachSnippets(rows: readonly RankedDocument[], query: string): SearchRow[] {
    const marked = new Map<string, string>()
    const remember = (source: 'persisted' | 'live', texts: ReadonlyMap<number, string>): void => {
      for (const [rowid, text] of texts) marked.set(`${source}:${rowid}`, text)
    }
    remember('persisted', this._highlight(
      'persisted_docs',
      rows.filter(row => row.source === 'persisted').map(row => Number(row.doc_rowid)),
      query,
    ))
    remember('live', this._highlight(
      'live_docs',
      rows.filter(row => row.source === 'live').map(row => Number(row.doc_rowid)),
      query,
    ))
    return rows.map(row => {
      const markedText = marked.get(`${row.source}:${Number(row.doc_rowid)}`)
      // Rank and highlight read the same rows in one serialized query.
      /* v8 ignore next -- a token hit is still present when its page is highlighted */
      if (markedText === undefined) return { ...row, marked_text: '' }
      return { ...row, marked_text: markedText }
    })
  }

  /**
   * Highlight specific FTS rows for the quoted query.
   * @param table - `persisted_docs` or the TEMP name `live_docs`.
   * @param rowids - ranked document ids from that table.
   * @param query - normalized caller query.
   * @returns highlighted text keyed by rowid.
   */
  private _highlight(table: 'persisted_docs' | 'live_docs', rowids: readonly number[], query: string): Map<number, string> {
    const marked = new Map<number, string>()
    if (rowids.length === 0) return marked
    const db = this._requireDb()
    const expression = quoteFtsData(query)
    const from = table === 'live_docs' ? 'temp.live_docs' : 'persisted_docs'
    // Three bindings plus the rowid list stay under SQLite's variable limit.
    const batchSize = 500
    for (let start = 0; start < rowids.length; start += batchSize) {
      const batch = rowids.slice(start, start + batchSize)
      const placeholders = batch.map(() => '?').join(', ')
      const hits = db.prepare(`
        SELECT rowid AS doc_rowid, highlight(${table}, 0, ?, ?) AS marked_text
        FROM ${from}
        WHERE ${table} MATCH ? AND rowid IN (${placeholders})
      `).all(FTS_HIGHLIGHT_START, FTS_HIGHLIGHT_END, expression, ...batch) as unknown as Array<{
        doc_rowid: number
        marked_text: string
      }>
      for (const hit of hits) marked.set(Number(hit.doc_rowid), hit.marked_text)
    }
    return marked
  }

  private _targetObservation(
    sessionId: SessionId,
    persistenceBinding: PersistenceBinding,
  ): { header: SessionHeader; generation: string } {
    const db = this._requireDb()
    const live = db.prepare(
      `SELECT
        id AS session_id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, owner, generation
      FROM temp.live_sessions
      WHERE id = ?`,
    ).get(sessionId) as (SessionHeaderRow & { generation: number }) | undefined
    if (live !== undefined) {
      return { header: rowHeader(live), generation: `live:${live.generation}` }
    }
    if (persistenceBinding.service !== undefined) {
      const persisted = db.prepare(
        `SELECT
          id AS session_id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, owner, generation
        FROM persisted_sessions
        WHERE id = ?`,
      ).get(sessionId) as (SessionHeaderRow & { generation: number }) | undefined
      if (persisted !== undefined) {
        return {
          header: rowHeader(persisted),
          generation: `persisted:${this._persistenceEpoch}:${persisted.generation}`,
        }
      }
    }
    throw new SessionQueryError(
      `session "${sessionId}" not found`,
      'SESSION_QUERY_SESSION_NOT_FOUND',
    )
  }

  private _sessionHit(row: SearchRow): SessionSearchHit {
    return {
      header: rowHeader(row),
      live: row.live === 1,
      persisted: row.persisted === 1,
      bestMatch: this._eventHit(row),
    }
  }

  private _eventHit(row: SearchRow): SessionEventSearchHit {
    return {
      sessionId: row.session_id as SessionId,
      seq: SessionSeq(row.seq),
      type: row.type as SessionEventSearchHit['type'],
      time: row.time,
      surface: row.surface as SessionEventSearchHit['surface'],
      snippet: makeSnippet(row.marked_text, this.config.snippetChars),
    }
  }

  private _requireDb(): DatabaseSync {
    /* v8 ignore next -- callers await `_ready`; this guards lifecycle misuse */
    if (this._db === undefined) throw indexClosed()
    return this._db
  }

  private _isClosed(): boolean {
    return this._closed
  }
}

/**
 * The header columns both session upserts bind, in the order their INSERT
 * lists them. The two statements differ only in what they append after these.
 * @param header - the session header being written.
 * @returns one bound value per header column.
 */
function headerBindings(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
): (string | number | null)[] {
  return [
    header.id,
    header.version,
    header.createdAt,
    header.cwd ?? null,
    header.parentSession ?? null,
    header.isSeeded ? inheritedEventCount : null,
    header.delegationDepth ?? null,
    header.agentPreset ?? null,
    header.owner ?? null,
  ]
}

interface RankedDocument extends SessionHeaderRow {
  doc_rowid: number
  source: 'persisted' | 'live'
  live: number
  persisted: number
  seq: number
  type: string
  time: number
  surface: string
  match_count: number
  document_length: number
}

interface PhraseStart {
  doc: number
  offset: number
}

/**
 * Rank `temp.match_counts` without reading document text.
 * @param partitionBySession - keep each session's strongest event, or every event.
 * @param where - parameterized filter over the combined document columns, without `WHERE`.
 * @returns the SQL statement. Bindings are the persisted-visibility flag twice, the
 * filter parameters, `limit + 1`, and the offset.
 */
function documentRankSql(partitionBySession: boolean, where: string): string {
  const filter = where.length === 0 ? '' : `WHERE ${where}`
  const projection = partitionBySession
    ? `,
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY session_id
          ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC
        ) AS event_rank
        FROM filtered
      )
      SELECT * FROM ranked
      WHERE event_rank = 1
      ORDER BY match_count DESC, document_length ASC, time DESC, session_id ASC, seq DESC`
    : `
      SELECT * FROM filtered
      ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC`
  return `WITH persisted_hits AS (
      SELECT
        m.doc_rowid AS doc_rowid,
        'persisted' AS source,
        c.match_count AS match_count,
        ps.version AS version,
        ps.created_at AS created_at,
        ps.cwd AS cwd,
        ps.parent_session AS parent_session,
        ps.seed_length AS seed_length,
        ps.delegation_depth AS delegation_depth,
        ps.agent_preset AS agent_preset,
        ps.owner AS owner,
        0 AS live,
        1 AS persisted,
        m.session_id AS session_id,
        m.seq AS seq,
        m.type AS type,
        m.time AS time,
        m.surface AS surface,
        m.codepoint_length AS document_length
      FROM temp.match_counts AS c
      JOIN persisted_doc_meta AS m ON m.doc_rowid = c.doc_rowid
      JOIN persisted_sessions AS ps ON ps.id = m.session_id
      WHERE c.source = 'persisted'
        AND ? = 1
        AND NOT EXISTS (SELECT 1 FROM temp.live_sessions AS ls WHERE ls.id = m.session_id)
    ),
    live_hits AS (
      SELECT
        m.doc_rowid AS doc_rowid,
        'live' AS source,
        c.match_count AS match_count,
        ls.version AS version,
        ls.created_at AS created_at,
        ls.cwd AS cwd,
        ls.parent_session AS parent_session,
        ls.seed_length AS seed_length,
        ls.delegation_depth AS delegation_depth,
        ls.agent_preset AS agent_preset,
        ls.owner AS owner,
        1 AS live,
        CASE WHEN ? = 1 THEN ls.persisted ELSE 0 END AS persisted,
        m.session_id AS session_id,
        m.seq AS seq,
        m.type AS type,
        m.time AS time,
        m.surface AS surface,
        m.codepoint_length AS document_length
      FROM temp.match_counts AS c
      JOIN temp.live_doc_meta AS m ON m.doc_rowid = c.doc_rowid
      JOIN temp.live_sessions AS ls ON ls.id = m.session_id
      WHERE c.source = 'live'
    ),
    combined AS (
      SELECT * FROM persisted_hits
      UNION ALL
      SELECT * FROM live_hits
    ),
    filtered AS (
      SELECT * FROM combined
      ${filter}
    )${projection}
    LIMIT ? OFFSET ?`
}

function observeLive(session: Session): ObservedSession {
  const events = session.snapshotEvents()
  return {
    header: structuredClone(session.header),
    inheritedEventCount: session.inheritedEventCount,
    documents: buildSessionEventSearchDocuments(session.id, events),
    fingerprint: liveStamp(session),
  }
}

/**
 * Identity of one live log.
 *
 * Session events are frozen at append time and the log only grows, so a later
 * search with the same header, inherited cut, and length still has the same body.
 * @param session - live session being observed.
 * @returns a stamp stored as the live row's fingerprint.
 */
function liveStamp(session: Session): string {
  return createHash('sha256')
    .update(JSON.stringify(session.header))
    .update('\0')
    .update(String(session.inheritedEventCount))
    .update('\0')
    .update(String(session.seq))
    .digest('base64url')
}

function observeSession(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
  events: readonly SessionEvent[],
): ObservedSession {
  const detachedHeader = structuredClone(header)
  const detachedEvents = events.map(event => structuredClone(event))
  return {
    header: detachedHeader,
    inheritedEventCount,
    documents: buildSessionEventSearchDocuments(detachedHeader.id, detachedEvents),
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ header: detachedHeader, inheritedEventCount, events: detachedEvents }))
      .digest('base64url'),
  }
}

function materializePersistenceSnapshots(
  snapshots: readonly SessionPersistenceSnapshot[],
): Map<SessionId, ObservedPersistedSession> {
  if (!isRuntimeArray(snapshots)) throw new Error('persistence snapshots must be an array')
  const result = new Map<SessionId, ObservedPersistedSession>()
  for (const snapshot of snapshots) {
    if (typeof snapshot.revision !== 'string') {
      throw new Error('persistence snapshot revision must be a string')
    }
    const header = structuredClone(snapshot.header)
    if (result.has(header.id)) {
      throw new Error(`persistence listed duplicate session "${header.id}"`)
    }
    result.set(header.id, { header, revision: snapshot.revision })
  }
  return result
}

function samePersistenceSnapshots(
  before: ReadonlyMap<SessionId, ObservedPersistedSession>,
  after: ReadonlyMap<SessionId, ObservedPersistedSession>,
): boolean {
  if (before.size !== after.size) return false
  for (const [id, first] of before) {
    const second = after.get(id)
    if (
      second === undefined
      || first.revision !== second.revision
      || !sameHeader(first.header, second.header)
    ) return false
  }
  return true
}

function sameSessionIds(
  before: ReadonlySet<SessionId>,
  after: ReadonlyMap<SessionId, ObservedSession>,
): boolean {
  if (before.size !== after.size) return false
  for (const id of before) {
    if (!after.has(id)) return false
  }
  return true
}

function sameHeader(a: SessionHeader, b: SessionHeader): boolean {
  return a.version === b.version
    && a.id === b.id
    && a.createdAt === b.createdAt
    && a.cwd === b.cwd
    && a.parentSession === b.parentSession
    && a.isSeeded === b.isSeeded
    && (a.delegationDepth ?? 0) === (b.delegationDepth ?? 0)
    && a.agentPreset === b.agentPreset
    && a.owner === b.owner
}

function rowHeader(row: SessionHeaderRow): SessionHeader {
  return {
    version: row.version,
    id: row.session_id as SessionId,
    createdAt: row.created_at,
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: row.parent_session as SessionId },
    isSeeded: row.seed_length !== null,
    ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
    ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
    ...row.owner === null ? {} : { owner: row.owner },
  }
}

function page<Row, Item>(
  rows: readonly Row[],
  limit: number,
  convert: (row: Row) => Item,
  nextCursor: (offset: number) => SessionSearchCursorValue,
  offset: number,
): SessionSearchPage<Item> {
  const hasMore = rows.length > limit
  return {
    items: rows.slice(0, limit).map(convert),
    ...hasMore ? { nextCursor: nextCursor(offset + limit) } : {},
  }
}

function encodeCursor(payload: CursorPayload): SessionSearchCursorValue {
  return SessionSearchCursor(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'))
}

function decodeCursor(
  cursor: SessionSearchCursorValue,
  instance: string,
  scope: CursorPayload['scope'],
  fingerprint: string,
  generation: string,
): number {
  let decoded: Partial<CursorPayload>
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>
  } catch (error: unknown) {
    throw invalidCursor(error)
  }
  if (
    decoded.version !== 1
    || decoded.instance !== instance
    || decoded.scope !== scope
    || decoded.fingerprint !== fingerprint
    || !Number.isSafeInteger(decoded.offset)
    || decoded.offset === undefined
    || decoded.offset < 0
  ) {
    throw invalidCursor(new Error('cursor does not belong to this normalized request'))
  }
  if (decoded.generation !== generation) {
    throw new SessionQueryError(
      'session-search cursor is stale because its relevant corpus changed',
      'SESSION_QUERY_STALE_CURSOR',
    )
  }
  return decoded.offset
}

function invalidCursor(cause: unknown): SessionQueryError {
  return new SessionQueryError(
    'session-search cursor is invalid',
    'SESSION_QUERY_INVALID_CURSOR',
    { cause },
  )
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    path: config.path,
    openAt: config.openAt ?? 'startup',
    journalMode: config.journalMode ?? 'wal',
    defaultLimit: config.defaultLimit ?? SESSION_QUERY_SQLITE_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? SESSION_QUERY_SQLITE_MAX_LIMIT,
    snippetChars: config.snippetChars ?? SESSION_QUERY_SQLITE_SNIPPET_CHARS,
    readWindowMax: config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX,
    persistedInspectConcurrency: config.persistedInspectConcurrency
      ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  }
  if (typeof resolved.path !== 'string' || resolved.path.trim().length === 0) {
    throw invalidConfig('path must not be blank')
  }
  const openPhases: readonly string[] = ['startup', 'first-search', 'never']
  if (!openPhases.includes(resolved.openAt)) throw invalidConfig('openAt is not supported')
  assertPageLimit('defaultLimit', resolved.defaultLimit)
  assertPageLimit('maxLimit', resolved.maxLimit)
  assertPositiveInteger('snippetChars', resolved.snippetChars)
  if (!Number.isInteger(resolved.readWindowMax) || resolved.readWindowMax < 0) {
    throw invalidConfig('readWindowMax must be a non-negative integer')
  }
  if (
    !Number.isSafeInteger(resolved.persistedInspectConcurrency)
    || resolved.persistedInspectConcurrency < 1
  ) {
    throw invalidConfig('persistedInspectConcurrency must be a positive safe integer')
  }
  if (resolved.defaultLimit > resolved.maxLimit) {
    throw invalidConfig('defaultLimit must be less than or equal to maxLimit')
  }
  const journalModes: readonly string[] = ['wal', 'delete', 'truncate', 'persist']
  if (!journalModes.includes(resolved.journalMode)) throw invalidConfig('journalMode is not supported')
  return resolved
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw invalidConfig(`${name} must be a positive integer`)
}

function assertPageLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > SQLITE_MAX_PAGE_LIMIT) {
    throw invalidConfig(`${name} must be an integer between 1 and ${SQLITE_MAX_PAGE_LIMIT}`)
  }
}

function invalidConfig(detail: string): SessionQueryError {
  return new SessionQueryError(
    `session-search SQLite config: ${detail}`,
    'SESSION_QUERY_INVALID_CONFIG',
  )
}

function indexClosed(): SessionQueryError {
  return new SessionQueryError('session-search SQLite index is closed', 'SESSION_QUERY_INDEX_FAILED')
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED')
  }
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(error))
      },
    )
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED'
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('session-search dependency rejected with a non-Error value', { cause: error })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value)
}

export default SqliteSessionQueryEngine
