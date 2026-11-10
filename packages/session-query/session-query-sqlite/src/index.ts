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
  buildSessionEventRecords,
  buildSessionEventSearchDocuments,
} from '@aeven/session-query'
import type {} from '@aeven/settings'
import type {
  Config as SessionQueryConfig,
  SessionEventSearchDocument,
  SessionEventSearchHit,
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionResultFilter,
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
  tokenMatchExpression,
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
/** Default shortest final query token searched as a prefix. */
export const SESSION_QUERY_SQLITE_PREFIX_MIN_CHARS = 3
/** Default milliseconds a write waits for another process's lock on a shared index. */
export const SESSION_QUERY_SQLITE_BUSY_TIMEOUT = 5000

// One transient source change gets a retry; repeated churn returns the last attempt rather than monopolizing the queue.
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
  /**
   * Milliseconds after activation at which the service opens the index and
   * reconciles it in the background, so the first search finds it current.
   * Omitted: the first search opens and reconciles the index. Ignored while
   * `openAt` is `never`.
   */
  warmAfter?: number
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /**
   * Milliseconds a statement waits for another process's write lock before
   * failing. Processes sharing one index file serialize their writes through
   * this wait. Defaults to 5000.
   */
  busyTimeout?: number
  /** Page size when a request omits `limit`. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 100. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /**
   * Shortest final query token, in characters, that also matches as a prefix, so `rele` finds `release` while the
   * user types. Shorter tokens match whole tokens only, since a short prefix expands to most of the vocabulary.
   * `0` disables prefix matching. Defaults to 3.
   */
  prefixMinChars?: number
  /** Maximum concurrent persisted-log inspections in one inherited batch read. Defaults to 4. */
  persistedInspectConcurrency?: number
}

interface ResolvedConfig {
  path: string
  openAt: OpenAt
  warmAfter?: number
  journalMode: JournalMode
  busyTimeout: number
  defaultLimit: number
  maxLimit: number
  snippetChars: number
  prefixMinChars: number
  readWindowMax: number
  persistedInspectConcurrency: number
}

interface ObservedSession {
  header: SessionHeader
  inheritedEventCount: SessionLogOffset
  documents: SessionEventSearchDocument[]
}

interface ObservedLiveSession extends ObservedSession {
  /** Identity stamp of the header and inherited cut. */
  fingerprint: string
  /** Log length this observation covers. */
  seq: SessionLogOffset
  /** First seq of `documents` when they extend the indexed row; absent for a full replacement. */
  appendFrom?: number
  /** Surface of every seq, present for an append that added events. */
  surfaces?: ReadonlyMap<SessionSeq, string>
}

interface ObservedPersistedSession {
  header: SessionHeader
  revision: SessionPersistenceRevision
}

interface PersistenceBinding {
  readonly identity: symbol
  readonly service?: SessionPersistence
}

interface Observation {
  persistenceBinding: PersistenceBinding
  persisted: Map<SessionId, ObservedPersistedSession>
  live: Map<SessionId, ObservedLiveSession>
}

interface IndexedPersistedRow {
  id: string
  revision: string
  generation: number
}

interface IndexedLiveRow {
  id: string
  fingerprint: string
  indexed_seq: number
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
  phrase_count: number
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
    warmAfter: z.number().step(1).min(0),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeout: z.number().step(1).min(0).default(SESSION_QUERY_SQLITE_BUSY_TIMEOUT),
    defaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_DEFAULT_LIMIT),
    maxLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_MAX_LIMIT),
    snippetChars: z.number().step(1).min(1).default(SESSION_QUERY_SQLITE_SNIPPET_CHARS),
    prefixMinChars: z.number().step(1).min(0).default(SESSION_QUERY_SQLITE_PREFIX_MIN_CHARS),
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
  private _warmAbort: AbortController | undefined
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
    const warmAfter = entry.warmAfter
    if (warmAfter !== undefined) {
      ctx.effect(() => {
        const timer = setTimeout(() => { void this._warm() }, warmAfter)
        return () => { clearTimeout(timer) }
      }, 'sessionQuerySqlite.warm')
    }
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
      // Another process sharing this index file advances only the stored generation.
      const generation = `${String(this._mainGeneration())}:${String(this._globalGeneration)}`
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

  /**
   * Open and reconcile the index as one queued operation with no caller, so a
   * search that arrives meanwhile waits for it instead of repeating it. Every
   * inspected persisted log commits on its own, so a cancelled or failed pass
   * keeps its progress and the next search continues from there.
   */
  private async _warm(): Promise<void> {
    if (this.config.openAt === 'never' || this._isClosed()) return
    const controller = new AbortController()
    this._warmAbort = controller
    try {
      await this._serialized(controller.signal, async () => {
        await this._ensureReady(controller.signal)
        await this._reconcile(controller.signal)
      })
    } catch (error: unknown) {
      if (!controller.signal.aborted && !this._isClosed()) {
        this.ctx.logger.warn(`session-query-sqlite: background index refresh failed; the next search retries: ${errorMessage(error)}`)
      }
    } finally {
      if (this._warmAbort === controller) this._warmAbort = undefined
    }
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
    // A background refresh stops at its next step instead of finishing the corpus.
    this._warmAbort?.abort()
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
    this._db = await openSearchDatabase(this.config.path, this.config.journalMode, this.config.busyTimeout)
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
      'SELECT id, fingerprint, indexed_seq, persisted, generation FROM temp.live_sessions',
    ).all() as unknown as IndexedLiveRow[]
    const persistedById = new Map(persistedRows.map(row => [row.id as SessionId, row]))
    const liveById = new Map(liveRows.map(row => [row.id as SessionId, row]))
    const observation = await this._observeStable(persistedById, liveById, signal)
    assertNotAborted(signal)
    const persistentDeletes = observation.persistenceBinding.service === undefined
      ? []
      : persistedRows.filter(row => !observation.persisted.has(row.id as SessionId))
    const liveChanges = [...observation.live.values()].filter((entry) => {
      const indexed = liveById.get(entry.header.id)
      const persisted = observation.persisted.has(entry.header.id) ? 1 : 0
      return indexed?.fingerprint !== entry.fingerprint
        || indexed.indexed_seq !== entry.seq
        || indexed.persisted !== persisted
    })
    const liveDeletes = liveRows.filter(row => !observation.live.has(row.id as SessionId))
    const pointerChanged = this._lastPersistenceIdentity !== undefined
      && this._lastPersistenceIdentity !== observation.persistenceBinding.identity
    const hasWrites = persistentDeletes.length > 0
      || liveChanges.length > 0
      || liveDeletes.length > 0

    let nextLocalGeneration = this._localGeneration
    if (hasWrites) {
      this._transaction(() => {
        let mainGeneration = this._mainGeneration()
        if (persistentDeletes.length > 0) {
          mainGeneration += 1
          for (const row of persistentDeletes) this._deleteSession('persisted', row.id as SessionId)
          db.prepare('UPDATE search_state SET global_generation = ? WHERE singleton = 1').run(mainGeneration)
        }
        for (const row of liveDeletes) this._deleteSession('live', row.id as SessionId)
        for (const entry of liveChanges) {
          nextLocalGeneration = Math.max(nextLocalGeneration, mainGeneration) + 1
          this._replaceLiveSession(entry, nextLocalGeneration, observation.persisted.has(entry.header.id))
        }
      })
    }

    if (hasWrites || pointerChanged) this._globalGeneration += 1
    if (pointerChanged) this._persistenceEpoch += 1
    this._localGeneration = nextLocalGeneration
    this._lastPersistenceIdentity = observation.persistenceBinding.identity
    return observation.persistenceBinding
  }

  /**
   * Run index writes in one immediate transaction.
   * @param write - synchronous writes; a throw rolls every one back.
   */
  private _transaction(write: () => void): void {
    const db = this._requireDb()
    let began = false
    try {
      db.exec('BEGIN IMMEDIATE')
      began = true
      write()
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

  /**
   * Index one inspected persisted revision in its own transaction, so an
   * aborted search keeps every session it already read.
   */
  private _commitPersistedSession(entry: ObservedSession, revision: SessionPersistenceRevision): IndexedPersistedRow {
    let generation = 0
    this._transaction(() => {
      generation = this._mainGeneration() + 1
      this._replacePersistedSession(entry, revision, generation)
      this._requireDb().prepare('UPDATE search_state SET global_generation = ? WHERE singleton = 1').run(generation)
    })
    this._globalGeneration += 1
    return { id: entry.header.id, revision, generation }
  }

  private async _observeStable(
    indexed: Map<SessionId, IndexedPersistedRow>,
    liveIndexed: ReadonlyMap<SessionId, IndexedLiveRow>,
    signal: AbortSignal | undefined,
  ): Promise<Observation> {
    for (let attempt = 0; attempt < STABLE_OBSERVATION_ATTEMPTS; attempt += 1) {
      assertNotAborted(signal)
      const persistenceBinding = this._persistenceBinding
      const persistence = persistenceBinding.service
      const initiallyLive = new Set(this.ctx.sessions.list().map(session => session.id))
      let persisted = new Map<SessionId, ObservedPersistedSession>()
      // Whether sessions changed while this attempt observed them. Rows are keyed by revision, so an attempt that saw
      // churn is still correct as of its first listing; the next reconcile picks up what changed after it.
      let churned = false
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
            // Rows are keyed by revision, so a revision committed here stays
            // correct even if this observation later retries or aborts.
            indexed.set(entry.header.id, this._commitPersistedSession(
              observeSession(loaded.meta, loaded.inheritedEventCount, loaded.events),
              entry.revision,
            ))
          }
          assertNotAborted(signal)
          const afterSnapshots = await persistence.listSnapshots(signal)
          assertNotAborted(signal)
          const after = materializePersistenceSnapshots(afterSnapshots)
          if (this._persistenceBinding !== persistenceBinding) continue
          churned = !samePersistenceSnapshots(persisted, after)
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
      const live = new Map<SessionId, ObservedLiveSession>()
      for (const session of this.ctx.sessions.list()) {
        const observed = observeLive(session, liveIndexed.get(session.id))
        const durable = persisted.get(session.id)
        if (durable !== undefined) assertSessionHeadersCompatible(observed.header, durable.header)
        live.set(session.id, observed)
      }
      churned ||= !sameSessionIds(initiallyLive, live)
      // A Host serving many accounts writes sessions continuously, so churn on the last attempt returns this
      // observation instead of failing the search.
      if (churned && attempt + 1 < STABLE_OBSERVATION_ATTEMPTS) continue
      return { persistenceBinding, persisted, live }
    }
    throw new SessionQueryError(
      'session-search persistence binding did not settle after one retry',
      'SESSION_QUERY_PERSISTENCE_FAILED',
    )
  }

  private _mainGeneration(): number {
    const row = this._requireDb().prepare(
      'SELECT global_generation FROM search_state WHERE singleton = 1',
    ).get() as { global_generation: number }
    return row.global_generation
  }

  /** Remove one session's rows; FTS rows are addressed through the indexed meta table. */
  private _deleteSession(source: 'persisted' | 'live', id: SessionId): void {
    const db = this._requireDb()
    if (source === 'persisted') {
      db.prepare('DELETE FROM persisted_docs WHERE rowid IN (SELECT doc_rowid FROM persisted_doc_meta WHERE session_id = ?)').run(id)
      db.prepare('DELETE FROM persisted_doc_meta WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM persisted_sessions WHERE id = ?').run(id)
    } else {
      db.prepare('DELETE FROM temp.live_docs WHERE rowid IN (SELECT doc_rowid FROM temp.live_doc_meta WHERE session_id = ?)').run(id)
      db.prepare('DELETE FROM temp.live_doc_meta WHERE session_id = ?').run(id)
      db.prepare('DELETE FROM temp.live_sessions WHERE id = ?').run(id)
    }
  }

  private _replacePersistedSession(
    entry: ObservedSession,
    revision: SessionPersistenceRevision,
    generation: number,
  ): void {
    this._deleteSession('persisted', entry.header.id)
    this._requireDb().prepare(`
      INSERT INTO persisted_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, owner, revision, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ...headerBindings(entry.header, entry.inheritedEventCount),
      revision,
      generation,
    )
    this._insertDocuments('persisted', entry.documents)
  }

  /**
   * Bring one live row up to its observation: a full replacement, or for an
   * append, the new tail's documents plus any surface an append reclassified.
   */
  private _replaceLiveSession(entry: ObservedLiveSession, generation: number, persisted: boolean): void {
    const db = this._requireDb()
    if (entry.appendFrom === undefined) {
      this._deleteSession('live', entry.header.id)
      db.prepare(`
        INSERT INTO temp.live_sessions
          (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, owner, fingerprint, indexed_seq, persisted, generation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ...headerBindings(entry.header, entry.inheritedEventCount),
        entry.fingerprint,
        entry.seq,
        persisted ? 1 : 0,
        generation,
      )
    } else {
      db.prepare(
        'UPDATE temp.live_sessions SET indexed_seq = ?, persisted = ?, generation = ? WHERE id = ?',
      ).run(entry.seq, persisted ? 1 : 0, generation, entry.header.id)
      if (entry.surfaces !== undefined) this._updateLiveSurfaces(entry.header.id, entry.surfaces)
    }
    this._insertDocuments('live', entry.documents)
  }

  /** Rewrite the surface of indexed live documents an append reclassified. */
  private _updateLiveSurfaces(id: SessionId, surfaces: ReadonlyMap<SessionSeq, string>): void {
    const db = this._requireDb()
    const rows = db.prepare(
      'SELECT doc_rowid, seq, surface FROM temp.live_doc_meta WHERE session_id = ?',
    ).all(id) as unknown as Array<{ doc_rowid: number; seq: number; surface: string }>
    const update = db.prepare('UPDATE temp.live_doc_meta SET surface = ? WHERE doc_rowid = ?')
    for (const row of rows) {
      const surface = surfaces.get(SessionSeq(row.seq))
      if (surface !== undefined && surface !== row.surface) update.run(surface, row.doc_rowid)
    }
  }

  /** Insert FTS text rows and their metadata rows, linked by FTS rowid. */
  private _insertDocuments(source: 'persisted' | 'live', documents: readonly SessionEventSearchDocument[]): void {
    const db = this._requireDb()
    const insert = db.prepare(source === 'persisted'
      ? 'INSERT INTO persisted_docs (text) VALUES (?)'
      : 'INSERT INTO temp.live_docs (text) VALUES (?)')
    const meta = db.prepare(`
      INSERT INTO ${source === 'persisted' ? 'persisted_doc_meta' : 'temp.live_doc_meta'}
        (doc_rowid, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const document of documents) {
      const text = sanitizeFtsText(document.text)
      const inserted = insert.run(text)
      meta.run(
        Number(inserted.lastInsertRowid),
        document.sessionId,
        document.seq,
        document.type,
        document.time,
        document.surface,
        Array.from(text).length,
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
      scope: ownerScope(request.sessionFilters),
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
      scope: { kind: 'session', sessionId: request.sessionId },
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
    scope: CandidateScope | undefined
    partitionBySession: boolean
    limit: number
    offset: number
  }): SearchRow[] {
    const tokens = this._queryTokens(request.query)
    if (tokens.length === 0) return []
    this._fillMatchCounts(tokens, request.scope)
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

  /**
   * Fill `temp.match_counts` with every document holding all query tokens, in any order.
   *
   * `match_count` is the number of token instances the document holds; `phrase_count` is the number of merged
   * exact-phrase spans, so documents with the tokens adjacent and in order rank first. The final token also matches
   * as a prefix once it reaches `prefixMinChars`. Both counts come from the token index and compare across the
   * persisted and live tables.
   */
  private _fillMatchCounts(tokens: readonly string[], scope: CandidateScope | undefined): void {
    const db = this._requireDb()
    db.prepare('DELETE FROM temp.match_counts').run()
    db.prepare('DELETE FROM temp.term_hits').run()
    const last = tokens.length - 1
    const prefix = this._isPrefixToken(tokens[last] as string)
    const expression = tokenMatchExpression(tokens, () => prefix)
    const sources = [
      ['persisted', 'persisted_docs', 'persisted_docs', 'persisted_docs_inst'],
      ['live', 'temp.live_docs', 'live_docs', 'temp.live_docs_inst'],
    ] as const
    for (const [source, table, name, vocab] of sources) {
      // FTS5 intersects the token doclists to find the documents holding every token; the instance vocabulary then
      // counts hits only for those candidates.
      db.prepare('DELETE FROM temp.match_candidates').run()
      db.prepare(`INSERT INTO temp.match_candidates(doc) SELECT rowid FROM ${table} WHERE ${name} MATCH ?`).run(expression)
      this._pruneCandidates(source, scope)
      const exact = db.prepare(`
        INSERT INTO temp.term_hits(position, source, doc, hits)
        SELECT ?, ?, i.doc, COUNT(*) FROM ${vocab} AS i JOIN temp.match_candidates AS c ON c.doc = i.doc
        WHERE i.term = ? AND i.col = 'text' GROUP BY i.doc
      `)
      // The vocabulary orders terms by byte, so every term starting with the token sorts below token + U+10FFFF.
      const ranged = db.prepare(`
        INSERT INTO temp.term_hits(position, source, doc, hits)
        SELECT ?, ?, i.doc, COUNT(*) FROM ${vocab} AS i JOIN temp.match_candidates AS c ON c.doc = i.doc
        WHERE i.term >= ? AND i.term < ? AND i.col = 'text' GROUP BY i.doc
      `)
      tokens.forEach((token, position) => {
        if (position === last && prefix) ranged.run(position, source, token, `${token}\u{10FFFF}`)
        else exact.run(position, source, token)
      })
      db.prepare(`
        INSERT INTO temp.match_counts(source, doc_rowid, phrase_count, match_count)
        SELECT ?, doc, 0, SUM(hits) FROM temp.term_hits WHERE source = ? GROUP BY doc
        HAVING COUNT(DISTINCT position) = ?
      `).run(source, source, tokens.length)
    }
    if (tokens.length === 1) {
      db.prepare('UPDATE temp.match_counts SET phrase_count = match_count').run()
      return
    }
    const update = db.prepare(
      'UPDATE temp.match_counts SET phrase_count = ? WHERE source = ? AND doc_rowid = ?',
    )
    const write = (source: 'persisted' | 'live', starts: readonly PhraseStart[]): void => {
      let doc = -1
      let offsets: number[] = []
      const flush = (): void => {
        if (doc === -1) return
        update.run(mergedSpanCount(offsets, tokens.length), source, doc)
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
    write('persisted', this._phraseStarts('persisted_docs_inst', tokens, prefix))
    write('live', this._phraseStarts('temp.live_docs_inst', tokens, prefix))
  }

  /**
   * Drop candidates outside the request's owner or session scope before their hits are counted. The rank query
   * applies the same filter again, so pruning only saves work.
   *
   * @param source - which document table the candidates came from.
   * @param scope - the owners or the one session the request is limited to.
   */
  private _pruneCandidates(source: 'persisted' | 'live', scope: CandidateScope | undefined): void {
    if (scope === undefined) return
    const meta = source === 'persisted' ? 'persisted_doc_meta' : 'temp.live_doc_meta'
    const sessions = source === 'persisted' ? 'persisted_sessions' : 'temp.live_sessions'
    const db = this._requireDb()
    if (scope.kind === 'session') {
      db.prepare(`
        DELETE FROM temp.match_candidates WHERE NOT EXISTS (
          SELECT 1 FROM ${meta} AS m WHERE m.doc_rowid = temp.match_candidates.doc AND m.session_id = ?
        )
      `).run(scope.sessionId)
      return
    }
    db.prepare(`
      DELETE FROM temp.match_candidates WHERE NOT EXISTS (
        SELECT 1 FROM ${meta} AS m JOIN ${sessions} AS s ON s.id = m.session_id
        WHERE m.doc_rowid = temp.match_candidates.doc AND s.owner IN (SELECT value FROM json_each(?))
      )
    `).run(JSON.stringify(scope.owners))
  }

  /** Whether the final query token also matches longer tokens it begins. */
  private _isPrefixToken(token: string): boolean {
    return this.config.prefixMinChars > 0 && Array.from(token).length >= this.config.prefixMinChars
  }

  /**
   * Phrase start positions, ordered by document then token offset.
   *
   * Each later token's instances are read once into a keyed temp table, and
   * the first token's instances probe it. Joining the vocabulary table to
   * itself instead rescans a whole token instance list for every outer row.
   *
   * @param vocab - the instance vocabulary of the document table.
   * @param tokens - the query tokens, in order.
   * @param lastIsPrefix - whether the final token also matches the longer tokens it begins.
   * @returns phrase starts, by document then offset.
   */
  private _phraseStarts(vocab: string, tokens: readonly string[], lastIsPrefix: boolean): PhraseStart[] {
    const db = this._requireDb()
    db.prepare('DELETE FROM temp.phrase_terms').run()
    const fill = db.prepare(`
      INSERT OR IGNORE INTO temp.phrase_terms(position, doc, token_offset)
      SELECT ?, doc, offset FROM ${vocab} WHERE term = ? AND col = 'text'
    `)
    const fillPrefix = db.prepare(`
      INSERT OR IGNORE INTO temp.phrase_terms(position, doc, token_offset)
      SELECT ?, doc, offset FROM ${vocab} WHERE term >= ? AND term < ? AND col = 'text'
    `)
    const joins: string[] = []
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index] as string
      if (index === tokens.length - 1 && lastIsPrefix) fillPrefix.run(index, token, `${token}\u{10FFFF}`)
      else fill.run(index, token)
      const alias = `t${index}`
      // CROSS JOIN keeps the vocabulary scan as the outer loop.
      joins.push(
        `CROSS JOIN temp.phrase_terms ${alias} ON ${alias}.position = ${index} AND ${alias}.doc = i0.doc AND ${alias}.token_offset = i0.offset + ${index}`,
      )
    }
    const rows = db.prepare(`
      SELECT i0.doc AS doc, i0.offset AS token_offset
      FROM ${vocab} i0
      ${joins.join('\n')}
      WHERE i0.term = ? AND i0.col = 'text'
      ORDER BY i0.doc, i0.offset
    `).all(tokens[0] as string) as unknown as Array<{ doc: number; token_offset: number }>
    return rows.map(row => ({ doc: row.doc, offset: row.token_offset }))
  }

  /** Highlight one page of already-ranked documents. */
  private _attachSnippets(rows: readonly RankedDocument[], query: string): SearchRow[] {
    const marked = new Map<string, string>()
    const remember = (source: 'persisted' | 'live', texts: ReadonlyMap<number, string>): void => {
      for (const [rowid, text] of texts) marked.set(`${source}:${rowid}`, text)
    }
    remember('persisted', this._highlight(
      'persisted_docs',
      rows.filter(row => row.source === 'persisted').map(row => row.doc_rowid),
      query,
    ))
    remember('live', this._highlight(
      'live_docs',
      rows.filter(row => row.source === 'live').map(row => row.doc_rowid),
      query,
    ))
    return rows.map((row) => {
      const markedText = marked.get(`${row.source}:${row.doc_rowid}`)
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
    const expression = tokenMatchExpression(this._queryTokens(query), this._isPrefixToken.bind(this))
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
      for (const hit of hits) marked.set(hit.doc_rowid, hit.marked_text)
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
  phrase_count: number
  match_count: number
  document_length: number
}

interface PhraseStart {
  doc: number
  offset: number
}

/** The owners or the single session a search is limited to, used to prune candidates before counting. */
type CandidateScope =
  | { kind: 'owners'; owners: readonly string[] }
  | { kind: 'session'; sessionId: string }

/**
 * The first owner filter of a session search, as a candidate scope. Filters are ANDed, so any one owner filter
 * admits a superset of the result.
 *
 * @param filters - the request's logical-session filters.
 * @returns the owner scope, or `undefined` when the search names no owner.
 */
function ownerScope(filters: readonly SessionResultFilter[]): CandidateScope | undefined {
  for (const filter of filters) {
    if (filter.kind === 'owner') return { kind: 'owners', owners: filter.values }
  }
  return undefined
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
          ORDER BY phrase_count DESC, match_count DESC, document_length ASC, time DESC, seq DESC
        ) AS event_rank
        FROM filtered
      )
      SELECT * FROM ranked
      WHERE event_rank = 1
      ORDER BY phrase_count DESC, match_count DESC, document_length ASC, time DESC, session_id ASC, seq DESC`
    : `
      SELECT * FROM filtered
      ORDER BY phrase_count DESC, match_count DESC, document_length ASC, time DESC, seq DESC`
  return `WITH persisted_hits AS (
      SELECT
        m.doc_rowid AS doc_rowid,
        'persisted' AS source,
        c.phrase_count AS phrase_count,
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
        c.phrase_count AS phrase_count,
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

/**
 * Observe one live log against its indexed row.
 *
 * Events are frozen and the log only grows, so a row with the same identity
 * stamp needs only the events after its `indexed_seq`; surfaces are still
 * reclassified over the whole log because a later event can shadow earlier ones.
 * @param session - live session being observed.
 * @param indexed - this session's indexed row, if any.
 * @returns the documents to add and, for an append, the current surface of every seq.
 */
function observeLive(session: Session, indexed: IndexedLiveRow | undefined): ObservedLiveSession {
  const fingerprint = liveStamp(session)
  const seq = session.seq
  const base = {
    header: structuredClone(session.header),
    inheritedEventCount: session.inheritedEventCount,
    fingerprint,
    seq,
  }
  const appendFrom = indexed?.fingerprint === fingerprint && indexed.indexed_seq <= seq
    ? indexed.indexed_seq
    : undefined
  if (appendFrom === seq) return { ...base, documents: [], appendFrom }
  const events = session.snapshotEvents()
  if (appendFrom === undefined) {
    return { ...base, documents: buildSessionEventSearchDocuments(session.id, events) }
  }
  return {
    ...base,
    documents: buildSessionEventSearchDocuments(session.id, events, appendFrom),
    appendFrom,
    surfaces: new Map(buildSessionEventRecords(session.id, events).map(record => [record.seq, record.surface])),
  }
}

/**
 * Identity of one live log apart from its length.
 *
 * The header and inherited cut fix every event already in the log; only
 * appends follow, so the indexed row with this stamp stays valid up to its
 * `indexed_seq`.
 * @param session - live session being observed.
 * @returns a stamp stored as the live row's fingerprint.
 */
function liveStamp(session: Session): string {
  return createHash('sha256')
    .update(JSON.stringify(session.header))
    .update('\0')
    .update(String(session.inheritedEventCount))
    .digest('base64url')
}

/**
 * Build the persisted index body for one inspected log. Inspection returns
 * immutable events, and only the derived document text is retained.
 */
function observeSession(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
  events: readonly SessionEvent[],
): ObservedSession {
  return {
    header: structuredClone(header),
    inheritedEventCount,
    documents: buildSessionEventSearchDocuments(header.id, events),
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
    ...config.warmAfter === undefined ? {} : { warmAfter: config.warmAfter },
    journalMode: config.journalMode ?? 'wal',
    busyTimeout: config.busyTimeout ?? SESSION_QUERY_SQLITE_BUSY_TIMEOUT,
    defaultLimit: config.defaultLimit ?? SESSION_QUERY_SQLITE_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? SESSION_QUERY_SQLITE_MAX_LIMIT,
    snippetChars: config.snippetChars ?? SESSION_QUERY_SQLITE_SNIPPET_CHARS,
    prefixMinChars: config.prefixMinChars ?? SESSION_QUERY_SQLITE_PREFIX_MIN_CHARS,
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
  if (resolved.warmAfter !== undefined && (!Number.isSafeInteger(resolved.warmAfter) || resolved.warmAfter < 0)) {
    throw invalidConfig('warmAfter must be a non-negative integer')
  }
  if (!Number.isSafeInteger(resolved.busyTimeout) || resolved.busyTimeout < 0) {
    throw invalidConfig('busyTimeout must be a non-negative integer')
  }
  if (!Number.isInteger(resolved.prefixMinChars) || resolved.prefixMinChars < 0) {
    throw invalidConfig('prefixMinChars must be a non-negative integer')
  }
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
