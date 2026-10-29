/**
 * One account's local sync state in `accounts/<hash>/sync/sync.db`: this device's id, the account key, whether
 * this device syncs, document updates keyed by opaque id, the outbox of sealed frames, and replay counters. Every
 * write that must survive a crash together runs in one transaction.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { fromBase64Url, generateDeviceId, toBase64Url, type DeviceId, type EnvelopeHeader, type OpaqueId } from '@aeven/sync-vault'

const SCHEMA_VERSION = 2

/** A sealed frame waiting for the relay's acknowledgment. */
export interface OutboxFrame {
  /** Local outbox position. */
  seq: number
  /** The frame. */
  frame: Uint8Array
  /** For a snapshot, the relay sequence number it covers. */
  covers?: number
}

/** Durable state of one account's vault on this device. */
export class SyncStore {
  private db: Database.Database

  /**
   * Open or create the store.
   * @param path - absolute database path.
   * @param owner - the account the store belongs to; a store holding another owner is refused.
   */
  constructor(readonly path: string, owner: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    // The sync worker writes compactions and snapshots through its own connection.
    this.db.pragma('busy_timeout = 5000')
    // In WAL mode NORMAL keeps every commit atomic; a crash loses at most the last commits, and the relay cursor
    // commits with the frames it covers, so catch-up resumes from there.
    this.db.pragma('synchronous = NORMAL')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version !== 0 && version !== SCHEMA_VERSION) {
      // A store of an earlier vault format holds nothing this build can use: the relay starts the account over with
      // its account key, and the account's data is published again from each device's own copy.
      this.db.close()
      for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
      this.db = new Database(path)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 5000')
      this.db.pragma('synchronous = NORMAL')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS doc_updates (id TEXT NOT NULL, seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS doc_updates_id ON doc_updates (id, seq);
      CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, frame BLOB NOT NULL, covers INTEGER) STRICT;
      CREATE TABLE IF NOT EXISTS counters (id TEXT PRIMARY KEY, counter INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS seen (device TEXT NOT NULL, id TEXT NOT NULL, counter INTEGER NOT NULL, PRIMARY KEY (device, id)) STRICT;
      CREATE TABLE IF NOT EXISTS since_snapshot (id TEXT PRIMARY KEY, frames INTEGER NOT NULL) STRICT;
    `)
    this.db.pragma(`user_version = ${String(SCHEMA_VERSION)}`)
    const stored = this.meta('owner')
    if (stored === undefined) this.setMeta('owner', owner)
    else if (stored !== owner) {
      this.db.close()
      throw new Error(`sync store ${path} belongs to another account`)
    }
  }

  /**
   * Read which account a store belongs to without creating or migrating it.
   * @param path - absolute database path.
   * @returns the owner, or undefined when the store records none.
   */
  static ownerOf(path: string): string | undefined {
    const db = new Database(path, { readonly: true, fileMustExist: true })
    try {
      return (db.prepare("SELECT value FROM meta WHERE key = 'owner'").get() as { value: string } | undefined)?.value
    } finally {
      db.close()
    }
  }

  /** Close the database. */
  close(): void {
    this.db.close()
  }

  /**
   * Run writes atomically.
   * @param fn - the writes.
   * @returns what `fn` returns.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  /**
   * Read a device-local value a Consumer keeps for this account; it shares the `meta` table under a `local:` prefix.
   * @param key - the Consumer's key.
   * @returns the value, or undefined when none is stored.
   */
  localValue(key: string): string | undefined {
    return this.meta(`local:${key}`)
  }

  /**
   * Store a device-local value a Consumer keeps for this account.
   * @param key - the Consumer's key.
   * @param value - the value.
   */
  setLocalValue(key: string, value: string): void {
    this.setMeta(`local:${key}`, value)
  }

  private meta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  /**
   * Report this device's store id.
   * @returns the id, chosen once per store.
   */
  deviceId(): DeviceId {
    const stored = this.meta('device')
    if (stored !== undefined) return stored as DeviceId
    const id = generateDeviceId()
    this.setMeta('device', id)
    return id
  }

  /**
   * Read the account key the relay handed to this device.
   * @returns the key, or undefined before the handoff.
   */
  accountKey(): Uint8Array | undefined {
    const stored = this.meta('key')
    return stored === undefined ? undefined : fromBase64Url(stored, 32)
  }

  /**
   * Hold the relay's account key. A different key means the relay started the account over: the documents,
   * outbox, counters, and cursor of the earlier key are dropped, and Consumers publish their data again.
   * @param key - the account key.
   * @returns whether the store started over.
   */
  setAccountKey(key: Uint8Array): boolean {
    const stored = this.meta('key')
    const encoded = toBase64Url(key)
    if (stored === encoded) return false
    this.transaction(() => {
      if (stored !== undefined) {
        this.db.exec('DELETE FROM doc_updates; DELETE FROM outbox; DELETE FROM counters; DELETE FROM seen; DELETE FROM since_snapshot;')
        this.db.prepare("DELETE FROM meta WHERE key = 'cursor'").run()
        this.db.prepare("DELETE FROM meta WHERE key LIKE 'fragment:%'").run()
        this.db.prepare("DELETE FROM meta WHERE key LIKE 'stream-complete:%'").run()
      }
      this.setMeta('key', encoded)
    })
    return stored !== undefined
  }

  /**
   * Report whether the user lets this device sync the account.
   * @returns the stored preference.
   */
  enabled(): boolean {
    return this.meta('enabled') !== 'false'
  }

  /**
   * Store the user's sync preference.
   * @param enabled - whether this device syncs the account.
   */
  setEnabled(enabled: boolean): void {
    this.setMeta('enabled', String(enabled))
  }

  /**
   * Read the last relay sequence number applied.
   * @returns the cursor, 0 before the first frame.
   */
  relayCursor(): number {
    return Number(this.meta('cursor') ?? '0')
  }

  /**
   * Record the last relay sequence number applied.
   * @param cursor - the relay sequence number.
   */
  setRelayCursor(cursor: number): void {
    this.setMeta('cursor', String(cursor))
  }

  /**
   * List the stored updates of a document, oldest first.
   * @param id - the document.
   * @returns every stored update.
   */
  docUpdates(id: OpaqueId): Uint8Array[] {
    return (this.db.prepare('SELECT data FROM doc_updates WHERE id = ? ORDER BY seq').all(id) as Array<{ data: Buffer }>).map(row => new Uint8Array(row.data))
  }

  /**
   * Store one Yjs update for a document.
   * @param id - the document.
   * @param update - a Yjs update to store.
   * @returns the number of updates now stored for `id`.
   */
  appendDocUpdate(id: OpaqueId, update: Uint8Array): void {
    this.statement('INSERT INTO doc_updates (id, data) VALUES (?, ?)').run(id, Buffer.from(update))
  }

  /**
  /**
   * Count the stored updates of a document.
   * @param id - the document.
   * @returns how many updates are stored for it.
   */
  docUpdateCount(id: OpaqueId): number {
    return (this.statement('SELECT COUNT(*) AS n FROM doc_updates WHERE id = ?').get(id) as { n: number }).n
  }

  /**
   * List every document this device stores updates for.
   * @returns their opaque ids.
   */
  storedDocuments(): OpaqueId[] {
    return (this.statement('SELECT DISTINCT id FROM doc_updates').all() as Array<{ id: string }>).map(row => row.id as OpaqueId)
  }

  private readonly statements = new Map<string, Database.Statement>()

  /** A prepared statement, compiled once per store. */
  private statement(sql: string): Database.Statement {
    let prepared = this.statements.get(sql)
    if (prepared === undefined) {
      prepared = this.db.prepare(sql)
      this.statements.set(sql, prepared)
    }
    return prepared
  }

  /**
   * Take this device's next counter for an id.
   * @param id - the document or stream.
   * @returns the counter to put in the next frame.
   */
  nextCounter(id: OpaqueId): number {
    const row = this.db.prepare(
      'INSERT INTO counters (id, counter) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET counter = counter + 1 RETURNING counter',
    ).get(id) as { counter: number }
    return row.counter
  }

  /**
   * Record a received frame's counter, refusing a replay.
   * @param device - the sender.
   * @param id - the document or stream.
   * @param counter - the frame's counter.
   * @returns whether the counter is new for this sender and id.
   */
  acceptCounter(device: DeviceId, id: OpaqueId, counter: number): boolean {
    if (!this.isNewCounter(device, id, counter)) return false
    this.statement('INSERT INTO seen (device, id, counter) VALUES (?, ?, ?) ON CONFLICT (device, id) DO UPDATE SET counter = excluded.counter')
      .run(device, id, counter)
    const prefix = `fragment:${device}:${id}:`
    for (const row of this.fragmentRows(prefix)) {
      if (Number(row.key.slice(prefix.length).split(':')[0]) <= counter) this.statement('DELETE FROM meta WHERE key = ?').run(row.key)
    }
    return true
  }

  /**
   * Check a sender counter without advancing it before a fragmented payload is complete.
   * @param device - sender.
   * @param id - document.
   * @param counter - logical payload counter.
   * @returns whether it has not been accepted.
   */
  isNewCounter(device: DeviceId, id: OpaqueId, counter: number): boolean {
    const row = this.statement('SELECT counter FROM seen WHERE device = ? AND id = ?').get(device, id) as { counter: number } | undefined
    return row === undefined || counter > row.counter
  }

  private fragmentRows(prefix: string): Array<{ key: string; value: string }> {
    return this.statement('SELECT key, value FROM meta WHERE key >= ? AND key < ?').all(prefix, `${prefix}\uffff`) as Array<{ key: string; value: string }>
  }

  /**
   * Durably collect authenticated parts; callers commit this with their relay cursor and document writes.
   * @param header - authenticated routing and part fields.
   * @param payload - decrypted part or whole payload.
   * @param sequence - relay position when reading a stream; records its first complete copy.
   * @returns the complete payload, or undefined while parts are missing.
   */
  assemble(header: EnvelopeHeader, payload: Uint8Array, sequence?: number): Uint8Array | undefined {
    const { fragment } = header
    if (fragment === undefined) return payload
    const prefix = `fragment:${header.device}:${header.id}:${String(header.counter)}:${fragment.id}:`
    this.statement('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
      `${prefix}${String(fragment.index)}`, toBase64Url(payload),
    )
    const rows = this.fragmentRows(prefix)
    if (rows.length !== fragment.count) return undefined
    rows.sort((a, b) => Number(a.key.slice(prefix.length)) - Number(b.key.slice(prefix.length)))
    const complete = new Uint8Array(Buffer.concat(rows.map(row => Buffer.from(row.value, 'base64url'))))
    const logical = `fragment:${header.device}:${header.id}:${String(header.counter)}:`
    this.statement('DELETE FROM meta WHERE key >= ? AND key < ?').run(logical, `${logical}\uffff`)
    if (sequence !== undefined) {
      this.statement('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
        `stream-complete:${header.device}:${header.id}:${String(header.counter)}`, String(sequence),
      )
    }
    return complete
  }

  /**
   * Recognize retransmitted stream parts while allowing a caller to replay the original stream from zero.
   * @param header - authenticated stream header.
   * @param sequence - part's relay position.
   * @returns whether the part follows that logical payload's first complete copy.
   */
  duplicateStreamPart(header: EnvelopeHeader, sequence: number): boolean {
    if (header.fragment === undefined) return false
    const completed = this.meta(`stream-complete:${header.device}:${header.id}:${String(header.counter)}`)
    return completed !== undefined && sequence > Number(completed)
  }

  /**
   * Count document frames since that document's last snapshot.
   * @param id - the document.
   * @param added - how many frames arrived or were made.
   * @returns the number of frames for `id` since its last snapshot.
   */
  countSinceSnapshot(id: OpaqueId, added = 1): number {
    return (this.statement(
      'INSERT INTO since_snapshot (id, frames) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET frames = frames + excluded.frames RETURNING frames',
    ).get(id, added) as { frames: number }).frames
  }

  /**
   * Clear a document's snapshot backlog after its snapshot was queued.
   * @param id - the document.
   */
  resetSinceSnapshot(id: OpaqueId): void {
    this.db.prepare('DELETE FROM since_snapshot WHERE id = ?').run(id)
  }

  /**
   * Queue one sealed frame for the relay.
   * @param frame - the frame.
   * @param covers - for a snapshot, the relay sequence number it covers.
   */
  enqueue(frame: Uint8Array, covers?: number): void {
    this.db.prepare('INSERT INTO outbox (frame, covers) VALUES (?, ?)').run(Buffer.from(frame), covers ?? null)
  }

  /**
   * List queued frames, oldest first.
   * @param limit - maximum number of frames to return; omitted means every frame.
   * @returns unacknowledged frames.
   */
  outbox(limit?: number): OutboxFrame[] {
    const rows = limit === undefined
      ? this.db.prepare('SELECT seq, frame, covers FROM outbox ORDER BY seq').all()
      : this.db.prepare('SELECT seq, frame, covers FROM outbox ORDER BY seq LIMIT ?').all(limit)
    return (rows as Array<{ seq: number; frame: Buffer; covers: number | null }>)
      .map(row => ({ seq: row.seq, frame: new Uint8Array(row.frame), ...row.covers === null ? {} : { covers: row.covers } }))
  }

  /**
   * Drop acknowledged frames from the outbox.
   * @param seq - the last acknowledged outbox position; it and every earlier frame leave the outbox.
   */
  acknowledge(seq: number): void {
    this.db.prepare('DELETE FROM outbox WHERE seq <= ?').run(seq)
  }

  /**
   * Count unacknowledged frames.
   * @returns the number of frames still queued.
   */
  pending(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM outbox').get() as { n: number }).n
  }
}
