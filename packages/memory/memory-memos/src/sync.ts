/**
 * Keeps an account's MemOS memory the same on every device of the account through synced documents.
 *
 * SQLite triggers on each replicated table record every write into `sync_changes`, whichever MemOS code path
 * made it; a periodic drain publishes the changed rows into shard documents (`memory/<table>/<id prefix>`),
 * one Yjs map entry per row. Rows another device wrote are upserted, never replaced, so a parent row's
 * `ON DELETE CASCADE` cannot remove its children; writes made while applying them set a marker row the
 * triggers skip. A deleted row becomes a tombstone that wins over any concurrent edit.
 *
 * Rows carry their vectors with the embedding model that produced them; a device on another model keeps its
 * own vectors and leaves the received ones out.
 */
import Database from 'better-sqlite3'
import type { Map as YMap } from 'yjs'
import type { Sync, SyncDocument } from '@aeven/sync'

/** A replicated table: its key columns, the shard prefix length, and its vector columns. */
interface TableSpec {
  readonly key: readonly string[]
  readonly prefix: number
  readonly vectors: readonly string[]
}

/** Tables whose rows are the account's memory; every other MemOS table is local bookkeeping or derived. */
const TABLES: Readonly<Record<string, TableSpec>> = {
  traces: { key: ['id'], prefix: 2, vectors: ['vec_summary', 'vec_action'] },
  episodes: { key: ['id'], prefix: 2, vectors: [] },
  sessions: { key: ['id'], prefix: 1, vectors: [] },
  policies: { key: ['id'], prefix: 1, vectors: ['vec'] },
  trace_policy_links: { key: ['trace_id', 'policy_id'], prefix: 2, vectors: [] },
  world_model: { key: ['id'], prefix: 1, vectors: ['vec'] },
  skills: { key: ['id'], prefix: 1, vectors: ['vec'] },
  skill_trials: { key: ['id'], prefix: 1, vectors: [] },
  feedback: { key: ['id'], prefix: 1, vectors: [] },
  decision_repairs: { key: ['id'], prefix: 1, vectors: [] },
  l2_candidate_pool: { key: ['id'], prefix: 1, vectors: [] },
}

/** Characters a shard prefix can take: MemOS ids are lowercase Crockford base-32 and Aeven ids are hex. */
const PREFIX_ALPHABET: readonly string[] = '0123456789abcdefghijklmnopqrstuvwxyz'.split('')

function specOf(table: string): TableSpec {
  const spec = TABLES[table]
  if (spec === undefined) throw new Error(`memory sync does not replicate ${table}`)
  return spec
}

/** A row as it travels: column values, BLOBs as `{ $b: base64 }`, and `$model` beside any vector. */
type SyncedRow = Record<string, unknown>

interface Change {
  seq: number
  tbl: string
  pk: string
  op: 'upsert' | 'delete'
}

/** Tuning the provider configures. */
export interface MemorySyncTuning {
  /** Interval between drains of recorded changes, in milliseconds. */
  drainMs: number
  /** Changes published per drain. */
  drainBatch: number
  /** Lifetime of this device's claim on the account's memory maintenance, in milliseconds. */
  maintenanceTtlMs: number
  /** Interval between renewals of that claim, in milliseconds. */
  maintenanceRenewMs: number
}

function shardOf(table: string, keyValue: string): string {
  const spec = specOf(table)
  const random = keyValue.replace(/^[a-z]{2}_/, '').toLowerCase()
  const prefix = random.split('').filter(char => PREFIX_ALPHABET.includes(char)).slice(0, spec.prefix).join('')
  return `memory/${table}/${prefix.padEnd(spec.prefix, '0')}`
}

function* allShards(): Generator<string> {
  for (const [table, spec] of Object.entries(TABLES)) {
    const prefixes = spec.prefix === 1
      ? PREFIX_ALPHABET
      : PREFIX_ALPHABET.flatMap(a => PREFIX_ALPHABET.map(b => a + b))
    for (const prefix of prefixes) yield `memory/${table}/${prefix}`
  }
}

/** Encode a row for a document. Every BLOB the replicated tables hold is a vector, so a BLOB marks the model. */
function encode(row: Record<string, unknown>, model: string): SyncedRow {
  const out: SyncedRow = {}
  for (const [column, value] of Object.entries(row)) {
    if (Buffer.isBuffer(value)) {
      out[column] = { $b: value.toString('base64') }
      out.$model = model
    } else {
      out[column] = value
    }
  }
  return out
}

/** Decode one encoded column value; the only object values a row holds are encoded BLOBs. */
function decode(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? Buffer.from((value as { $b: string }).$b, 'base64') : value
}

/** One account's memory mirror. */
export class MemorySyncMirror {
  private readonly db: Database.Database
  private readonly columns = new Map<string, readonly string[]>()
  private readonly names = new Map<string, string>()
  private readonly queued = new Set<string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private draining = false
  private closed = false

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  /**
   * @param owner - the account.
   * @param dbFile - the account's MemOS database.
   * @param sync - the account sync service.
   * @param model - the embedding model this device runs.
   * @param tuning - drain interval and batch.
   * @param warn - receives failures to publish or apply.
   */
  constructor(
    private readonly owner: string,
    dbFile: string,
    private readonly sync: Sync,
    private readonly model: string,
    private readonly tuning: MemorySyncTuning,
    private readonly warn: (message: string) => void,
  ) {
    this.db = new Database(dbFile, { fileMustExist: true })
    this.db.pragma('busy_timeout = 5000')
    // Rows arrive shard by shard, so a child may land before its parent; MemOS's own connection keeps the
    // cascades when it deletes a parent.
    this.db.pragma('foreign_keys = OFF')
    for (const table of Object.keys(TABLES)) {
      const columns = (this.db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{ name: string }>).map(row => row.name)
      if (columns.length > 0) this.columns.set(table, columns)
    }
    for (const name of allShards()) this.names.set(this.sync.documentId(owner, name), name)
  }

  /**
   * Install the triggers, record existing rows once, take what other devices already synced, and start draining.
   * @returns when the first pass over stored documents finished.
   */
  async start(): Promise<void> {
    this.installTriggers()
    const seeded = this.db.prepare("SELECT value FROM sync_state WHERE key = 'seeded'").get() as { value: string } | undefined
    if (seeded === undefined) {
      this.db.transaction(() => {
        for (const [table, spec] of this.tables()) {
          this.db.prepare(`INSERT INTO sync_changes (tbl, pk, op) SELECT ?, json_array(${spec.key.join(', ')}), 'upsert' FROM ${table}`).run(table)
        }
        this.db.prepare("INSERT INTO sync_state (key, value) VALUES ('seeded', '1')").run()
      })()
    }
    for (const name of allShards()) await this.materialize(name)
    if (this.isClosed()) return
    this.timer = setInterval(() => { void this.drain() }, this.tuning.drainMs)
    void this.drain()
  }

  private *tables(): Generator<[string, TableSpec]> {
    for (const [table, spec] of Object.entries(TABLES)) if (this.columns.has(table)) yield [table, spec]
  }

  private installTriggers(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL, op TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sync_applying (marker INTEGER) STRICT;
      CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      DELETE FROM sync_applying;
    `)
    for (const [table, spec] of this.tables()) {
      const key = (row: 'NEW' | 'OLD'): string => `json_array(${spec.key.map(column => `${row}.${column}`).join(', ')})`
      const guard = 'WHEN NOT EXISTS (SELECT 1 FROM sync_applying)'
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS sync_${table}_ai AFTER INSERT ON ${table} ${guard}
          BEGIN INSERT INTO sync_changes (tbl, pk, op) VALUES ('${table}', ${key('NEW')}, 'upsert'); END;
        CREATE TRIGGER IF NOT EXISTS sync_${table}_au AFTER UPDATE ON ${table} ${guard}
          BEGIN INSERT INTO sync_changes (tbl, pk, op) VALUES ('${table}', ${key('NEW')}, 'upsert'); END;
        CREATE TRIGGER IF NOT EXISTS sync_${table}_ad AFTER DELETE ON ${table} ${guard}
          BEGIN INSERT INTO sync_changes (tbl, pk, op) VALUES ('${table}', ${key('OLD')}, 'delete'); END;
      `)
    }
  }

  private readRow(table: string, keyValues: readonly unknown[]): Record<string, unknown> | undefined {
    const spec = specOf(table)
    const where = spec.key.map(column => `${column} = ?`).join(' AND ')
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...keyValues) as Record<string, unknown> | undefined
  }

  /**
   * Publish recorded changes, oldest first, one shard document at a time.
   * @returns when this drain pass ends.
   */
  async drain(): Promise<void> {
    if (this.draining || this.isClosed()) return
    this.draining = true
    try {
      for (;;) {
        const changes = this.db.prepare('SELECT seq, tbl, pk, op FROM sync_changes ORDER BY seq LIMIT ?').all(this.tuning.drainBatch) as Change[]
        if (changes.length === 0) return
        const byShard = new Map<string, Change[]>()
        for (const change of changes) {
          if (!this.columns.has(change.tbl)) continue
          const keyValues = JSON.parse(change.pk) as unknown[]
          const shard = shardOf(change.tbl, String(keyValues[0]))
          byShard.set(shard, [...byShard.get(shard) ?? [], change])
        }
        for (const [shard, shardChanges] of byShard) await this.publish(shard, shardChanges)
        if (this.isClosed()) return
        this.db.prepare('DELETE FROM sync_changes WHERE seq <= ?').run(changes.at(-1)?.seq ?? 0)
      }
    } catch (error) {
      this.warn(`memory sync: publishing changes failed: ${String(error)}`)
    } finally {
      this.draining = false
    }
  }

  private async publish(shard: string, changes: readonly Change[]): Promise<void> {
    const handle = await this.sync.openDocument(this.owner, shard)
    try {
      const rows = handle.doc.getMap<SyncedRow>('rows')
      const forgotten = handle.doc.getMap<boolean>('forgotten')
      handle.doc.transact(() => {
        for (const change of changes) {
          const row = change.op === 'upsert' ? this.readRow(change.tbl, JSON.parse(change.pk) as unknown[]) : undefined
          if (row === undefined) {
            rows.delete(change.pk)
            forgotten.set(change.pk, true)
            continue
          }
          if (forgotten.get(change.pk) === true) continue
          const encoded = encode(row, this.model)
          if (JSON.stringify(rows.get(change.pk)) !== JSON.stringify(encoded)) rows.set(change.pk, encoded)
        }
      })
    } finally {
      handle.close()
    }
  }

  /**
   * Apply another device's change to one document.
   * @param id - the document's opaque id.
   */
  documentChanged(id: string): void {
    const name = this.names.get(id)
    if (name === undefined || this.queued.has(name)) return
    this.queued.add(name)
    setImmediate(() => {
      this.queued.delete(name)
      void this.materialize(name)
    })
  }

  private async materialize(name: string): Promise<void> {
    const [, table = ''] = name.split('/')
    const columns = this.columns.get(table)
    if (columns === undefined) return
    let handle: SyncDocument
    if (this.isClosed()) return
    try {
      handle = await this.sync.openDocument(this.owner, name)
    } catch (error) {
      this.warn(`memory sync: opening ${name} failed: ${String(error)}`)
      return
    }
    try {
      const rows = handle.doc.getMap<SyncedRow>('rows')
      const forgotten = handle.doc.getMap<boolean>('forgotten')
      if (this.isClosed() || (rows.size === 0 && forgotten.size === 0)) return
      this.apply(table, columns, rows, forgotten)
    } catch (error) {
      this.warn(`memory sync: applying ${name} failed: ${String(error)}`)
    } finally {
      handle.close()
    }
  }

  private apply(table: string, columns: readonly string[], rows: YMap<SyncedRow>, forgotten: YMap<boolean>): void {
    const spec = specOf(table)
    const where = spec.key.map(column => `${column} = ?`).join(' AND ')
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO sync_applying (marker) VALUES (1)').run()
      for (const key of forgotten.keys()) {
        this.db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...JSON.parse(key) as unknown[])
      }
      for (const [key, row] of rows) {
        if (forgotten.get(key) === true) continue
        const keepLocalVectors = row.$model !== this.model
        const present = columns.filter(column => column in row && !(keepLocalVectors && spec.vectors.includes(column)))
        const local = this.readRow(table, JSON.parse(key) as unknown[])
        const same = (column: string): boolean =>
          JSON.stringify(encode({ [column]: local?.[column] }, this.model)[column]) === JSON.stringify(row[column])
        if (local !== undefined && present.every(same)) continue
        const updates = present.filter(column => !spec.key.includes(column)).map(column => `${column} = excluded.${column}`)
        this.db.prepare(
          `INSERT INTO ${table} (${present.join(', ')}) VALUES (${present.map(() => '?').join(', ')})
           ON CONFLICT (${spec.key.join(', ')}) DO ${updates.length === 0 ? 'NOTHING' : `UPDATE SET ${updates.join(', ')}`}`,
        ).run(...present.map(column => decode(row[column])))
      }
      this.db.prepare('DELETE FROM sync_applying').run()
    })()
  }

  /** Stop draining and close the connection. */
  dispose(): void {
    this.closed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.db.close()
  }
}
