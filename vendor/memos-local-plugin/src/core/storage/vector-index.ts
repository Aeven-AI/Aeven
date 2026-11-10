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
 *     connection), or when another connection committed and the last build is
 *     older than `FOREIGN_WRITE_REBUILD_MS`.
 */

import type { EmbeddingVector } from "../types.js";
import type { StorageDb } from "./types.js";
import type { VectorHit } from "./vector.js";

/** Bytes all live indexes may hold together; the least recently used ones are dropped beyond it. */
const INDEX_BUDGET_BYTES = 512 * 1024 * 1024;
/** Minimum age of a build before another connection's commit triggers a rebuild. */
const FOREIGN_WRITE_REBUILD_MS = 10 * 60 * 1000;
/** Rows read per pending-vector recheck statement. */
const PENDING_CHUNK = 500;

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
  };
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
  if (!entry.stale && entry.maxRowid > 0) {
    const top = entry.db.prepare<{ rowid: number }, { id: string }>(
      `SELECT id FROM ${entry.table} WHERE rowid = @rowid`,
    ).get({ rowid: entry.maxRowid });
    if (top?.id !== entry.maxRowidId) entry.stale = true;
  }
  const version = dataVersion(entry.db);
  if (!entry.stale && version !== entry.dataVersion && Date.now() - entry.builtAt >= FOREIGN_WRITE_REBUILD_MS) {
    entry.stale = true;
  }
  if (entry.stale) {
    rebuild(entry);
    return;
  }
  entry.dataVersion = version;
  readFrom(entry, entry.maxRowid);
  recheckPending(entry);
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
