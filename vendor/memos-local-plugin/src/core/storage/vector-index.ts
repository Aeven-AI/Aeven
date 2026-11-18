/**
 * In-memory cosine index over one vector column of one table.
 *
 * `scanAndTopK` reads every candidate row from SQLite and decodes its BLOB on
 * each search, and caps the scan at `DEFAULT_SCAN_HARD_CAP` rows without an
 * order, so a large table is searched only partially. This index keeps every
 * non-empty vector of the column in one contiguous `Float32Array`, scores the
 * whole column per search, and applies the caller's SQL filter to the best
 * candidates only, widening until `k` rows pass or every row was considered —
 * so the result is the exact top-K among the rows the filter admits.
 *
 * The rows stay the source of truth; the index is derived memory and changes
 * nothing on disk.
 *
 * Freshness:
 *   - New rows are read on each search by rowid (`rowid > maxRowid`).
 *   - Rows seen with a NULL vector are rechecked until they get one.
 *   - A deleted row drops out at the SQL filter step and from the next rebuild.
 *   - The index rebuilds when its highest rowid no longer holds the same row,
 *     after `invalidateVectorIndex` (an in-place vector rewrite on this
 *     connection), or when the column's rewrite generation changed.
 *   - The rewrite generation is a counter in `vector_generation` that an
 *     `AFTER UPDATE OF <column>` trigger raises for every in-place write that
 *     changes a vector, from any connection; an upsert that sets the same
 *     vector again, as memory sync's does, leaves it alone. On a database that cannot take the trigger,
 *     the index instead rebuilds when another connection committed and the last
 *     build is older than `FOREIGN_WRITE_REBUILD_MS`.
 *
 * Restarts:
 *   - Each built column is saved next to the database file and loaded by the
 *     next process that searches it, so a restart reads one file instead of
 *     decoding every row. A saved index is used only when its rewrite
 *     generation and its highest row still match the table; the rows inserted
 *     since it was saved are then read like any other new rows.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EmbeddingVector } from "../types.js";
import type { StorageDb } from "./types.js";
import type { VectorHit } from "./vector.js";

/** Bytes all live indexes may hold together; the least recently used ones are dropped beyond it. */
const INDEX_BUDGET_BYTES = 512 * 1024 * 1024;
/** Minimum age of a build before another connection's commit triggers a rebuild. */
const FOREIGN_WRITE_REBUILD_MS = 10 * 60 * 1000;
/** Rows read per pending-vector recheck statement. */
const PENDING_CHUNK = 500;
/** Format of a saved index; a file of another version is ignored and replaced. */
const SNAPSHOT_VERSION = 1;
/** First bytes of a saved index. */
const SNAPSHOT_MAGIC = 0x41564e56;
/** Rows appended since the last save before the index is saved again. */
const SNAPSHOT_SAVE_ROWS = 2_000;

interface Entry {
  readonly db: StorageDb;
  readonly table: string;
  readonly column: string;
  dim: number;
  size: number;
  ids: string[];
  rowids: Float64Array;
  data: Float32Array;
  norms: Float32Array;
  maxRowid: number;
  maxRowidId: string | null;
  pending: Set<number>;
  stale: boolean;
  dataVersion: number;
  builtAt: number;
  usedAt: number;
  /** The column's rewrite generation the entry reflects; undefined when the database has no generation trigger. */
  generation: number | undefined;
  /** Whether the generation trigger was installed or found unavailable for this entry. */
  generationChecked: boolean;
  /** Rows the last saved file held; the next save follows once `SNAPSHOT_SAVE_ROWS` more were appended. */
  savedSize: number;
}

const entries = new Map<string, Entry>();
const handles = new WeakMap<StorageDb, number>();
let nextHandle = 1;

function keyOf(db: StorageDb, table: string, column: string): string {
  let handle = handles.get(db);
  if (handle === undefined) {
    handle = nextHandle++;
    handles.set(db, handle);
  }
  return `${handle}\u0000${table}\u0000${column}`;
}

function dataVersion(db: StorageDb): number {
  return Number(db.raw.pragma("data_version", { simple: true }));
}

function bytesOf(entry: Entry): number {
  return entry.data.byteLength + entry.norms.byteLength + entry.rowids.byteLength + entry.ids.length * 64;
}

function emptyEntry(db: StorageDb, table: string, column: string): Entry {
  return {
    db, table, column,
    dim: 0, size: 0, ids: [], rowids: new Float64Array(0), data: new Float32Array(0), norms: new Float32Array(0),
    maxRowid: 0, maxRowidId: null, pending: new Set(), stale: true, dataVersion: 0, builtAt: 0, usedAt: 0,
    generation: undefined, generationChecked: false, savedSize: 0,
  };
}

/** Whether a name is a plain SQL identifier, safe to splice into DDL. */
function plainIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Install the column's rewrite-generation counter and trigger, and read the counter.
 * @returns the current generation, or undefined when the database cannot take them (read-only or unusual names).
 */
function installGeneration(entry: Entry): number | undefined {
  if (!plainIdentifier(entry.table) || !plainIdentifier(entry.column)) return undefined;
  try {
    entry.db.raw.exec(`
      CREATE TABLE IF NOT EXISTS vector_generation (
        tbl TEXT NOT NULL, col TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tbl, col)
      );
      INSERT OR IGNORE INTO vector_generation (tbl, col, generation) VALUES ('${entry.table}', '${entry.column}', 0);
      CREATE TRIGGER IF NOT EXISTS vector_generation_${entry.table}_${entry.column}
        AFTER UPDATE OF ${entry.column} ON ${entry.table}
        WHEN OLD.${entry.column} IS NOT NEW.${entry.column}
        BEGIN
          UPDATE vector_generation SET generation = generation + 1 WHERE tbl = '${entry.table}' AND col = '${entry.column}';
        END;
    `);
  } catch {
    // A read-only connection or a database another process holds exclusively: the index falls back to the
    // commit-age rule for writes of other connections.
    return undefined;
  }
  return readGeneration(entry);
}

function readGeneration(entry: Entry): number | undefined {
  const row = entry.db.prepare<{ tbl: string; col: string }, { generation: number }>(
    `SELECT generation FROM vector_generation WHERE tbl = @tbl AND col = @col`,
  ).get({ tbl: entry.table, col: entry.column });
  return row?.generation;
}

/** File holding the saved index of one column, or undefined for a database without a file. */
function snapshotPath(entry: Entry): string | undefined {
  const file = entry.db.filepath;
  if (!file || file === ":memory:" || !plainIdentifier(entry.table) || !plainIdentifier(entry.column)) return undefined;
  return join(`${file}-vectors`, `${entry.table}.${entry.column}.bin`);
}

interface SnapshotHeader {
  version: number;
  table: string;
  column: string;
  dim: number;
  size: number;
  maxRowid: number;
  maxRowidId: string | null;
  generation: number;
  ids: string[];
  pending: number[];
}

/**
 * Save the entry's vectors, ids, and position next to the database. Written to a temporary file and renamed, so a
 * reader never sees a partial file. Entries without a generation are not saved: nothing could tell that their
 * vectors were rewritten while no process held them.
 */
function saveSnapshot(entry: Entry): void {
  const path = snapshotPath(entry);
  if (path === undefined || entry.generation === undefined) return;
  const header: SnapshotHeader = {
    version: SNAPSHOT_VERSION, table: entry.table, column: entry.column, dim: entry.dim, size: entry.size,
    maxRowid: entry.maxRowid, maxRowidId: entry.maxRowidId, generation: entry.generation,
    ids: entry.ids.slice(0, entry.size), pending: [...entry.pending],
  };
  const json = Buffer.from(JSON.stringify(header), "utf8");
  // The arrays start on an 8-byte boundary so they can be read in place.
  const headerEnd = Math.ceil((8 + json.byteLength) / 8) * 8;
  const prefix = Buffer.alloc(headerEnd);
  prefix.writeUInt32LE(SNAPSHOT_MAGIC, 0);
  prefix.writeUInt32LE(json.byteLength, 4);
  json.copy(prefix, 8);
  const parts = [
    prefix,
    Buffer.from(entry.rowids.buffer, entry.rowids.byteOffset, entry.size * 8),
    Buffer.from(entry.norms.buffer, entry.norms.byteOffset, entry.size * 4),
    Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.size * entry.dim * 4),
  ];
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, Buffer.concat(parts), { mode: 0o600 });
    renameSync(temporary, path);
    entry.savedSize = entry.size;
  } catch {
    // A full disk or a read-only directory: the index stays in memory and the next restart rebuilds it.
    rmSync(temporary, { force: true });
  }
}

/**
 * Restore the entry from its saved file when the file still describes the table: same format, column, rewrite
 * generation, and highest row. Any other file is deleted.
 * @returns whether the entry was restored.
 */
function loadSnapshot(entry: Entry): boolean {
  const path = snapshotPath(entry);
  if (path === undefined || entry.generation === undefined) return false;
  let file: Buffer;
  try {
    file = readFileSync(path);
  } catch {
    // ENOENT: no saved index yet. Another read error is treated the same way: the index is rebuilt and saved.
    return false;
  }
  const discard = (): false => {
    rmSync(path, { force: true });
    return false;
  };
  if (file.byteLength < 8 || file.readUInt32LE(0) !== SNAPSHOT_MAGIC) return discard();
  const jsonLength = file.readUInt32LE(4);
  let header: SnapshotHeader;
  try {
    header = JSON.parse(file.toString("utf8", 8, 8 + jsonLength)) as SnapshotHeader;
  } catch {
    // A torn or foreign file: rebuilt below.
    return discard();
  }
  const headerEnd = Math.ceil((8 + jsonLength) / 8) * 8;
  const expected = headerEnd + header.size * 8 + header.size * 4 + header.size * header.dim * 4;
  if (header.version !== SNAPSHOT_VERSION || header.table !== entry.table || header.column !== entry.column
    || header.generation !== entry.generation || file.byteLength !== expected || header.ids.length !== header.size) {
    return discard();
  }
  if (header.maxRowid > 0) {
    const top = entry.db.prepare<{ rowid: number }, { id: string }>(
      `SELECT id FROM ${entry.table} WHERE rowid = @rowid`,
    ).get({ rowid: header.maxRowid });
    if (top?.id !== header.maxRowidId) return discard();
  }
  // Copies, so the entry's arrays can grow and the file buffer can be released.
  const rowidsAt = headerEnd;
  const normsAt = rowidsAt + header.size * 8;
  const dataAt = normsAt + header.size * 4;
  entry.dim = header.dim;
  entry.size = header.size;
  entry.ids = header.ids;
  entry.rowids = new Float64Array(file.buffer.slice(file.byteOffset + rowidsAt, file.byteOffset + normsAt));
  entry.norms = new Float32Array(file.buffer.slice(file.byteOffset + normsAt, file.byteOffset + dataAt));
  entry.data = new Float32Array(file.buffer.slice(file.byteOffset + dataAt, file.byteOffset + expected));
  entry.maxRowid = header.maxRowid;
  entry.maxRowidId = header.maxRowidId;
  entry.pending = new Set(header.pending);
  entry.stale = false;
  entry.dataVersion = dataVersion(entry.db);
  entry.builtAt = Date.now();
  entry.savedSize = header.size;
  return true;
}

function ensureCapacity(entry: Entry, rows: number): void {
  if (entry.rowids.length >= rows && entry.data.length >= rows * entry.dim) return;
  const capacity = Math.max(rows, Math.ceil(entry.rowids.length * 1.5), 1024);
  const rowids = new Float64Array(capacity);
  rowids.set(entry.rowids.subarray(0, entry.size));
  const norms = new Float32Array(capacity);
  norms.set(entry.norms.subarray(0, entry.size));
  const data = new Float32Array(capacity * entry.dim);
  data.set(entry.data.subarray(0, entry.size * entry.dim));
  entry.rowids = rowids;
  entry.norms = norms;
  entry.data = data;
}

/** Append one row's vector; returns false when the blob is empty or of another dimension. */
function append(entry: Entry, rowid: number, id: string, blob: Buffer): boolean {
  if (blob.byteLength === 0 || blob.byteLength % 4 !== 0) return false;
  const dim = blob.byteLength / 4;
  if (entry.dim === 0) entry.dim = dim;
  if (dim !== entry.dim) return false;
  ensureCapacity(entry, entry.size + 1);
  const offset = entry.size * dim;
  new Uint8Array(entry.data.buffer, entry.data.byteOffset + offset * 4, dim * 4).set(blob);
  let sum = 0;
  for (let j = 0; j < dim; j++) {
    const value = entry.data[offset + j]!;
    sum += value * value;
  }
  entry.norms[entry.size] = sum;
  entry.rowids[entry.size] = rowid;
  entry.ids[entry.size] = id;
  entry.size += 1;
  return true;
}

interface DeltaRow {
  rowid: number;
  id: string;
  vec: Buffer | null;
}

function rebuild(entry: Entry): void {
  entry.dim = 0;
  entry.size = 0;
  entry.ids = [];
  entry.rowids = new Float64Array(0);
  entry.data = new Float32Array(0);
  entry.norms = new Float32Array(0);
  entry.pending = new Set();
  entry.maxRowid = 0;
  entry.maxRowidId = null;
  entry.dataVersion = dataVersion(entry.db);
  readFrom(entry, 0);
  entry.stale = false;
  entry.builtAt = Date.now();
  saveSnapshot(entry);
}

function readFrom(entry: Entry, afterRowid: number): void {
  const stmt = entry.db.prepare<{ after: number }, DeltaRow>(
    `SELECT rowid AS rowid, id, ${entry.column} AS vec FROM ${entry.table} WHERE rowid > @after ORDER BY rowid`,
  );
  for (const row of stmt.iterate({ after: afterRowid })) {
    if (row.vec === null || !append(entry, row.rowid, row.id, row.vec)) {
      if (row.vec === null) entry.pending.add(row.rowid);
    }
    entry.maxRowid = row.rowid;
    entry.maxRowidId = row.id;
  }
}

function recheckPending(entry: Entry): void {
  if (entry.pending.size === 0) return;
  const rowids = [...entry.pending];
  const stmt = entry.db.prepare<{ rowids: string }, DeltaRow>(
    `SELECT rowid AS rowid, id, ${entry.column} AS vec FROM ${entry.table}
     WHERE rowid IN (SELECT value FROM json_each(@rowids)) AND ${entry.column} IS NOT NULL`,
  );
  for (let start = 0; start < rowids.length; start += PENDING_CHUNK) {
    const chunk = rowids.slice(start, start + PENDING_CHUNK);
    for (const row of stmt.iterate({ rowids: JSON.stringify(chunk) })) {
      entry.pending.delete(row.rowid);
      if (row.vec !== null) append(entry, row.rowid, row.id, row.vec);
    }
  }
}

/** Bring the entry up to date with the table, rebuilding when an in-place change could have been missed. */
function refresh(entry: Entry): void {
  if (!entry.generationChecked) {
    entry.generationChecked = true;
    entry.generation = installGeneration(entry);
    // The first search after a start restores the saved index and then reads only the rows added since.
    if (entry.stale && entry.size === 0) loadSnapshot(entry);
  }
  if (!entry.stale && entry.maxRowid > 0) {
    const top = entry.db.prepare<{ rowid: number }, { id: string }>(
      `SELECT id FROM ${entry.table} WHERE rowid = @rowid`,
    ).get({ rowid: entry.maxRowid });
    if (top?.id !== entry.maxRowidId) entry.stale = true;
  }
  const version = dataVersion(entry.db);
  if (entry.generation !== undefined) {
    const generation = readGeneration(entry);
    if (generation !== entry.generation) {
      entry.generation = generation;
      entry.stale = true;
    }
  } else if (!entry.stale && version !== entry.dataVersion && Date.now() - entry.builtAt >= FOREIGN_WRITE_REBUILD_MS) {
    entry.stale = true;
  }
  if (entry.stale) {
    rebuild(entry);
    return;
  }
  entry.dataVersion = version;
  readFrom(entry, entry.maxRowid);
  recheckPending(entry);
  if (entry.size - entry.savedSize >= SNAPSHOT_SAVE_ROWS) saveSnapshot(entry);
}

function evictBeyondBudget(): void {
  let total = 0;
  for (const entry of entries.values()) total += bytesOf(entry);
  if (total <= INDEX_BUDGET_BYTES) return;
  const byAge = [...entries.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [key, entry] of byAge) {
    if (total <= INDEX_BUDGET_BYTES) break;
    total -= bytesOf(entry);
    entries.delete(key);
  }
}

/**
 * Indices of the `count` highest scores, in descending score order, through a min-heap of size `count`.
 *
 * @param scores - one score per indexed row.
 * @param count - how many indices to return.
 * @returns the indices of the best rows, best first.
 */
function topIndices(scores: Float32Array, count: number): Uint32Array {
  if (count >= scores.length) {
    const all = new Uint32Array(scores.length);
    for (let i = 0; i < all.length; i++) all[i] = i;
    return all.sort((a, b) => scores[b]! - scores[a]!);
  }
  const heap = new Uint32Array(count);
  let filled = 0;
  const less = (a: number, b: number): boolean => scores[heap[a]!]! < scores[heap[b]!]!;
  const swap = (a: number, b: number): void => {
    const t = heap[a]!;
    heap[a] = heap[b]!;
    heap[b] = t;
  };
  const down = (from: number): void => {
    let i = from;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < filled && less(l, m)) m = l;
      if (r < filled && less(r, m)) m = r;
      if (m === i) return;
      swap(i, m);
      i = m;
    }
  };
  for (let i = 0; i < scores.length; i++) {
    if (filled < count) {
      heap[filled] = i;
      let c = filled++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (!less(c, p)) break;
        swap(c, p);
        c = p;
      }
    } else if (scores[i]! > scores[heap[0]!]!) {
      heap[0] = i;
      down(0);
    }
  }
  return heap.sort((a, b) => scores[b]! - scores[a]!);
}

/**
 * Mark every index over `table` stale, so the next search rebuilds it. Call after rewriting vectors in place on
 * `db`; inserts and deletes need no call.
 *
 * @param db - the database whose table changed.
 * @param table - the table whose vectors were rewritten.
 */
export function invalidateVectorIndex(db: StorageDb, table: string): void {
  for (const entry of entries.values()) {
    if (entry.db === db && entry.table === table) entry.stale = true;
  }
}

/** Options for {@link indexedTopK}. */
export interface IndexedTopKOptions {
  /** The vector column to search. */
  vecColumn: string;
  /** SQL filter (without `WHERE`) a row must pass to be returned. */
  where?: string;
  /** Named parameters of `where`; the name `__ids` is reserved. */
  params?: Record<string, unknown>;
}

/**
 * Exact top-K cosine search over every vector of `table.vecColumn` that passes `where`.
 *
 * @param db - the database holding the table.
 * @param table - a rowid table with a TEXT `id` column.
 * @param selectExtra - columns returned as each hit's `meta`.
 * @param query - the query vector.
 * @param k - the number of hits wanted.
 * @param opts - the column, filter, and parameters.
 * @returns up to `k` hits ordered by descending cosine.
 */
export function indexedTopK<TMeta = undefined>(
  db: StorageDb,
  table: string,
  selectExtra: readonly string[],
  query: EmbeddingVector,
  k: number,
  opts: IndexedTopKOptions,
): Array<VectorHit<string, TMeta>> {
  if (k <= 0 || query.length === 0) return [];
  const key = keyOf(db, table, opts.vecColumn);
  let entry = entries.get(key);
  if (entry === undefined) {
    entry = emptyEntry(db, table, opts.vecColumn);
    entries.set(key, entry);
  }
  entry.usedAt = Date.now();
  refresh(entry);
  evictBeyondBudget();
  if (entry.size === 0 || entry.dim !== query.length) return [];

  let qNorm2 = 0;
  for (let j = 0; j < query.length; j++) qNorm2 += query[j]! * query[j]!;
  if (qNorm2 === 0) return [];
  const qNorm = Math.sqrt(qNorm2);

  const { size, dim, data, norms } = entry;
  const scores = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const norm = norms[i]!;
    if (norm === 0) {
      scores[i] = -2;
      continue;
    }
    let dot = 0;
    const offset = i * dim;
    for (let j = 0; j < dim; j++) dot += data[offset + j]! * query[j]!;
    scores[i] = dot / (Math.sqrt(norm) * qNorm);
  }
  // Order only the first window by a bounded heap; a filter that rejects most of it falls back to a full sort.
  let order = topIndices(scores, Math.min(size, Math.max(k * 4, 64)));
  let sorted = order.length === size;

  const cols = ["id", ...selectExtra].join(", ");
  const filter = [`id IN (SELECT value FROM json_each(@__ids))`, `${opts.vecColumn} IS NOT NULL`];
  if (opts.where) filter.push(`(${opts.where})`);
  const stmt = db.prepare<Record<string, unknown>, Record<string, unknown>>(
    `SELECT ${cols} FROM ${table} WHERE ${filter.join(" AND ")}`,
  );

  const hits: Array<VectorHit<string, TMeta>> = [];
  let window = Math.max(k * 4, 64);
  let start = 0;
  while (hits.length < k && start < size) {
    if (!sorted && start + window > order.length) {
      order = topIndices(scores, size);
      sorted = true;
    }
    const end = Math.min(size, start + window);
    const ids: string[] = [];
    for (let i = start; i < end; i++) {
      if (scores[order[i]!]! < -1) break;
      ids.push(entry.ids[order[i]!]!);
    }
    if (ids.length === 0) break;
    const passed = new Map<string, Record<string, unknown>>();
    for (const row of stmt.iterate({ ...(opts.params ?? {}), __ids: JSON.stringify(ids) })) {
      passed.set(String(row["id"]), row);
    }
    for (let i = start; i < end && hits.length < k; i++) {
      const index = order[i]!;
      const row = passed.get(entry.ids[index]!);
      if (row === undefined) continue;
      passed.delete(entry.ids[index]!);
      const meta = selectExtra.length > 0
        ? Object.fromEntries(selectExtra.map((column) => [column, row[column]])) as TMeta
        : undefined as TMeta;
      hits.push({ id: entry.ids[index]!, score: scores[index]!, meta });
    }
    start = end;
    window *= 4;
  }
  return hits;
}
