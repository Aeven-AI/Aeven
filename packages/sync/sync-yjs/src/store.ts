/**
 * One account's local sync state in `accounts/<hash>/sync/sync.db`: device keys, keyring, device chain,
 * document updates keyed by opaque id, the outbox of sealed frames, and replay counters. Every write that
 * must survive a crash together runs in one transaction.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { brandNumber } from '@aeven/brand'
import {
  fromBase64Url, toBase64Url,
  type ChainEntry, type DeviceId, type DeviceKeys, type KeyEpoch, type Keyring, type OpaqueId,
} from '@aeven/sync-vault'

const SCHEMA_VERSION = 1

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
  private readonly db: Database.Database

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
      this.db.close()
      throw new Error(`sync store ${path} has schema ${String(version)}; this build reads ${String(SCHEMA_VERSION)}`)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS keyring (epoch INTEGER PRIMARY KEY, key BLOB NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS chain (idx INTEGER PRIMARY KEY, entry TEXT NOT NULL) STRICT;
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

  private meta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  /** @returns this device's keys, once enrolled. */
  deviceKeys(): DeviceKeys | undefined {
    const raw = this.meta('device')
    if (raw === undefined) return undefined
    const parsed = JSON.parse(raw) as { id: DeviceId; signing: string; agreement: string; signingSecret: string; agreementSecret: string }
    return {
      id: parsed.id,
      publicKeys: { signing: fromBase64Url(parsed.signing, 32), agreement: fromBase64Url(parsed.agreement, 32) },
      secretKeys: { signing: fromBase64Url(parsed.signingSecret, 32), agreement: fromBase64Url(parsed.agreementSecret, 32) },
    }
  }

  /** @param keys - this device's keys. */
  setDeviceKeys(keys: DeviceKeys): void {
    this.setMeta('device', JSON.stringify({
      id: keys.id,
      signing: toBase64Url(keys.publicKeys.signing),
      agreement: toBase64Url(keys.publicKeys.agreement),
      signingSecret: toBase64Url(keys.secretKeys.signing),
      agreementSecret: toBase64Url(keys.secretKeys.agreement),
    }))
  }

  /** @returns the last relay sequence number applied; 0 before the first. */
  relayCursor(): number {
    return Number(this.meta('cursor') ?? '0')
  }

  /** @param cursor - the last relay sequence number applied. */
  setRelayCursor(cursor: number): void {
    this.setMeta('cursor', String(cursor))
  }

  /** @returns every held vault key generation. */
  keyring(): Keyring {
    const rows = this.db.prepare('SELECT epoch, key FROM keyring').all() as Array<{ epoch: number; key: Buffer }>
    return new Map(rows.map(row => [brandNumber<KeyEpoch>(row.epoch), new Uint8Array(row.key)]))
  }

  /** @param keyring - generations to hold; existing epochs are kept. */
  addKeys(keyring: Keyring): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO keyring (epoch, key) VALUES (?, ?)')
    for (const [epoch, key] of keyring) insert.run(epoch, Buffer.from(key))
  }

  /** @returns the locally held device chain. */
  chain(): ChainEntry[] {
    return (this.db.prepare('SELECT entry FROM chain ORDER BY idx').all() as Array<{ entry: string }>).map(row => JSON.parse(row.entry) as ChainEntry)
  }

  /** @param entries - the verified chain, replacing the held one. */
  setChain(entries: readonly ChainEntry[]): void {
    this.db.prepare('DELETE FROM chain').run()
    const insert = this.db.prepare('INSERT INTO chain (idx, entry) VALUES (?, ?)')
    for (const entry of entries) insert.run(entry.index, JSON.stringify(entry))
  }

  /**
   * @param id - the document.
   * @returns every stored update, oldest first.
   */
  docUpdates(id: OpaqueId): Uint8Array[] {
    return (this.db.prepare('SELECT data FROM doc_updates WHERE id = ? ORDER BY seq').all(id) as Array<{ data: Buffer }>).map(row => new Uint8Array(row.data))
  }

  /**
   * @param id - the document.
   * @param update - a Yjs update to store.
   * @returns the number of updates now stored for `id`.
   */
  appendDocUpdate(id: OpaqueId, update: Uint8Array): void {
    this.statement('INSERT INTO doc_updates (id, data) VALUES (?, ?)').run(id, Buffer.from(update))
  }

  /**
   * @param id - the document.
   * @returns how many updates are stored for it.
   */
  docUpdateCount(id: OpaqueId): number {
    return (this.statement('SELECT COUNT(*) AS n FROM doc_updates WHERE id = ?').get(id) as { n: number }).n
  }

  /** @returns every document this device stores updates for. */
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
    const row = this.statement('SELECT counter FROM seen WHERE device = ? AND id = ?').get(device, id) as { counter: number } | undefined
    if (row !== undefined && counter <= row.counter) return false
    this.statement('INSERT INTO seen (device, id, counter) VALUES (?, ?, ?) ON CONFLICT (device, id) DO UPDATE SET counter = excluded.counter')
      .run(device, id, counter)
    return true
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

  /** @param id - the document a snapshot was just queued for. */
  resetSinceSnapshot(id: OpaqueId): void {
    this.db.prepare('DELETE FROM since_snapshot WHERE id = ?').run(id)
  }

  /**
   * @param frame - a sealed frame to send.
   * @param covers - for a snapshot, the relay sequence number it covers.
   */
  enqueue(frame: Uint8Array, covers?: number): void {
    this.db.prepare('INSERT INTO outbox (frame, covers) VALUES (?, ?)').run(Buffer.from(frame), covers ?? null)
  }

  /**
   * @param limit - maximum number of frames to return; omitted means every frame.
   * @returns unacknowledged frames, oldest first.
   */
  outbox(limit?: number): OutboxFrame[] {
    const rows = limit === undefined
      ? this.db.prepare('SELECT seq, frame, covers FROM outbox ORDER BY seq').all()
      : this.db.prepare('SELECT seq, frame, covers FROM outbox ORDER BY seq LIMIT ?').all(limit)
    return (rows as Array<{ seq: number; frame: Buffer; covers: number | null }>)
      .map(row => ({ seq: row.seq, frame: new Uint8Array(row.frame), ...row.covers === null ? {} : { covers: row.covers } }))
  }

  /** @param seq - the acknowledged outbox position. */
  acknowledge(seq: number): void {
    this.db.prepare('DELETE FROM outbox WHERE seq = ?').run(seq)
  }

  /** @returns the number of unacknowledged frames. */
  pending(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM outbox').get() as { n: number }).n
  }
}
