/** SQLite schema for the disposable session full-text read model. */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current derived-index schema version. Incompatible versions reset in place. */
export const SESSION_QUERY_SQLITE_SCHEMA_VERSION = 11

/** SQLite application id protecting unrelated databases from derived resets. */
export const SESSION_QUERY_SQLITE_APPLICATION_ID = 0x44534851

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

const DERIVED_USER_TABLES = new Set([
  'search_state',
  'persisted_sessions',
  'persisted_docs',
  'persisted_docs_data',
  'persisted_docs_idx',
  'persisted_docs_content',
  'persisted_docs_docsize',
  'persisted_docs_config',
  'persisted_doc_meta',
  'persisted_docs_inst',
])

/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open, validate, and initialize persistent and connection-local schemas.
 * @param path - dedicated derived-index path or `:memory:`; missing filesystem paths are created owner-only.
 * @param journalMode - validated SQLite journal mode.
 * @param busyTimeout - milliseconds a statement waits for another process's write lock before failing.
 * @returns initialized database handle owned by the search service.
 */
export async function openSearchDatabase(
  path: string,
  journalMode: JournalMode,
  busyTimeout: number,
): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    // Processes sharing one Aeven home share this index; a writer waits for
    // another process's transaction instead of failing with SQLITE_BUSY.
    // busyTimeout is a validated non-negative integer, not caller-controlled SQL.
    db.exec(`PRAGMA busy_timeout = ${String(busyTimeout)}`)
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const userTables = listUserTables(db)
    if (applicationId !== 0 && applicationId !== SESSION_QUERY_SQLITE_APPLICATION_ID) {
      throw new Error(`session-search database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`session-search database at "${actual}" is not an empty or recognized derived index`)
    }
    if (applicationId === SESSION_QUERY_SQLITE_APPLICATION_ID) {
      assertDerivedUserTables(actual, userTables)
      if (version !== SESSION_QUERY_SQLITE_SCHEMA_VERSION) resetDerivedSchema(db, userTables)
    }
    // Apply mutating pragmas only after refusing foreign or canonical files.
    // journalMode is a validated closed union, not caller-controlled SQL.
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    ensurePersistentSchema(db)
    ensureTemporarySchema(db)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ name: string }>
  return rows.map(row => row.name)
}

function assertDerivedUserTables(path: string, userTables: readonly string[]): void {
  const unknownTables = userTables.filter(name => !DERIVED_USER_TABLES.has(name))
  if (unknownTables.length > 0) {
    throw new Error(
      `session-search database at "${path}" has unrecognized user tables: ${unknownTables.join(', ')}`,
    )
  }
}

function resetDerivedSchema(db: DatabaseSync, userTables: readonly string[]): void {
  for (const name of userTables) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`)
  }
  db.exec('PRAGMA user_version = 0')
}

function ensurePersistentSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA application_id = ${SESSION_QUERY_SQLITE_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_state (
      singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
      global_generation INTEGER NOT NULL
    ) STRICT
  `)
  db.exec('INSERT OR IGNORE INTO search_state (singleton, global_generation) VALUES (1, 0)')
  db.exec(`
    CREATE TABLE IF NOT EXISTS persisted_sessions (
      id             TEXT PRIMARY KEY,
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      cwd            TEXT,
      parent_session TEXT,
      seed_length    INTEGER,
      delegation_depth INTEGER,
      agent_preset  TEXT,
      owner          TEXT,
      revision       TEXT NOT NULL,
      generation     INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS persisted_docs USING fts5(text, tokenize = 'unicode61')
  `)
  // Filters, match counts, and per-session deletes read these side tables by
  // FTS rowid. The FTS content row holds only the document text, so a query
  // never reads that text before it knows which rows to return, and removing
  // one session never scans the whole content table.
  db.exec(`
    CREATE TABLE IF NOT EXISTS persisted_doc_meta (
      doc_rowid        INTEGER PRIMARY KEY,
      session_id       TEXT NOT NULL,
      seq              INTEGER NOT NULL,
      type             TEXT NOT NULL,
      time             INTEGER NOT NULL,
      surface          TEXT NOT NULL,
      codepoint_length INTEGER NOT NULL
    ) STRICT
  `)
  db.exec('CREATE INDEX IF NOT EXISTS persisted_doc_meta_session ON persisted_doc_meta(session_id)')
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS persisted_docs_inst USING fts5vocab(persisted_docs, instance)')
  db.exec(`PRAGMA user_version = ${SESSION_QUERY_SQLITE_SCHEMA_VERSION}`)
}

function ensureTemporarySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS live_sessions (
      id             TEXT PRIMARY KEY,
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      cwd            TEXT,
      parent_session TEXT,
      seed_length    INTEGER,
      delegation_depth INTEGER,
      agent_preset  TEXT,
      owner          TEXT,
      fingerprint    TEXT NOT NULL,
      indexed_seq    INTEGER NOT NULL,
      persisted      INTEGER NOT NULL CHECK (persisted IN (0, 1)),
      generation     INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS temp.live_docs USING fts5(text, tokenize = 'unicode61')
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS temp.live_doc_meta (
      doc_rowid        INTEGER PRIMARY KEY,
      session_id       TEXT NOT NULL,
      seq              INTEGER NOT NULL,
      type             TEXT NOT NULL,
      time             INTEGER NOT NULL,
      surface          TEXT NOT NULL,
      codepoint_length INTEGER NOT NULL
    ) STRICT
  `)
  db.exec('CREATE INDEX IF NOT EXISTS temp.live_doc_meta_session ON live_doc_meta(session_id)')
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.live_docs_inst USING fts5vocab(live_docs, instance)')
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_probe USING fts5(text, tokenize = 'unicode61')`)
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.query_probe_inst USING fts5vocab(query_probe, instance)')
  // Instances of a phrase's second and later tokens, keyed for point lookups
  // from the first token's instances.
  db.exec(`
    CREATE TABLE IF NOT EXISTS temp.phrase_terms (
      position     INTEGER NOT NULL,
      doc          INTEGER NOT NULL,
      token_offset INTEGER NOT NULL,
      PRIMARY KEY (position, doc, token_offset)
    ) WITHOUT ROWID
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS temp.match_counts (
      source      TEXT NOT NULL,
      doc_rowid   INTEGER NOT NULL,
      match_count INTEGER NOT NULL
    )
  `)
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
