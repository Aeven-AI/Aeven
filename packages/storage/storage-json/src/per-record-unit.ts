/**
 * One opened JSON unit in `per-record` layout: the unit is a directory at
 * `dir`, holding one document per record under `<dir>/<table>/<key>.json`
 * plus `global.json` for the global slot. The directory is the state — this
 * unit holds NO in-memory state of its own: `loadAll` re-reads the tree and
 * every write is one durable file operation. The domain layer owns the live
 * in-memory tables (seeded by the open-time `loadAll`) and serializes writes
 * through its write chain, so this unit never mutates memory and needs no
 * rollback — a failed write simply leaves both the file and the domain's
 * memory unchanged.
 *
 * Per-record contract: a record document that is malformed or stamped with a
 * version outside the accepted set (the descriptor's current version plus
 * its `compatibleVersions`) reads as an absent record — one bad or stale
 * file never bricks the whole unit, and a version bump discards stale
 * records instead of migrating them. Record keys become path segments, so
 * they must be path-safe (`[a-zA-Z0-9_-]+`); an unsafe key rejects at write.
 *
 * Legacy bootstrap: when the new tree has no document path, a legacy
 * whole-unit file `<root>/<name>.json` (the pre-per-record layout) seeds
 * per-record documents, provided its stored unit version is in the accepted
 * set — a legacy file stamped with any other version is left alone and reads
 * as the empty unit. Any new document path, including one whose contents are
 * unreadable or stale, suppresses the bootstrap for the whole unit. The
 * legacy file is never changed or deleted.
 * @module @deepseek-ai/dsh-storage-json/src/per-record-unit
 */

import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Dirent } from 'node:fs'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { ExternalChange, KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import { ExternalWatcher } from './external-watch.ts'
import type { ExternalWatchOptions } from './external-watch.ts'
import { parseRecord, serializeRecord } from './format.ts'
import type { UnitState } from './format.ts'

/** Keys become path segments in this layout; this set is path-safe on every OS. */
const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Foreign-write detection cadence. These are not deployment tunables: the
 * debounce only coalesces one burst of filesystem events, and the sweep is the
 * correctness floor that makes a dropped `fs.watch` event cost latency instead
 * of permanent staleness. A deployment that wants a different convergence
 * bound changes how often it reads, not how often the medium is stated.
 */
const EXTERNAL_WATCH_OPTIONS: ExternalWatchOptions = { debounceMs: 50, sweepIntervalMs: 5_000 }

/**
 * Open one `per-record`-layout unit under `root`: the unit directory is
 * `<root>/<name>/`. Loads lazily on the first `loadAll` — this unit holds no
 * state, so opening touches nothing on the medium.
 * @param descriptor - Static identity and shape of the unit.
 * @param root - Absolute backend root directory.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
// oxlint-disable-next-line typescript/require-await -- async keeps both openers' call sites uniform
export async function openPerRecordUnit(
  descriptor: KvUnitDescriptor,
  root: string,
  onClose: () => void,
): Promise<KvUnit> {
  return new PerRecordJsonUnit(descriptor, join(root, descriptor.name), onClose)
}

/**
 * Read every record document under the unit directory: each declared table's
 * `<key>.json` files plus `global.json`. A missing directory is the empty
 * unit (materialization defers to the first write); a foreign document
 * (missing, malformed, or stamped with another version) reads as an absent
 * record, per the per-record contract.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - Absolute unit directory path.
 * @returns the authoritative state reconstructed from the tree.
 */
async function loadPerRecordState(descriptor: KvUnitDescriptor, dir: string): Promise<UnitState> {
  const versions = acceptedStamps(descriptor)
  const state: UnitState = {
    version: descriptor.version,
    global: null,
    tables: new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()])),
  }
  let entries: Dirent[] | undefined
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Missing directory = empty unit; the legacy bootstrap below still runs
    // (the fresh-upgrade shape is exactly an absent new tree).
  }
  const hasNewDocuments = entries === undefined
    ? false
    : (await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        const records = state.tables.get(entry.name)
        if (records !== undefined) {
          return loadTableRecords(records, versions, join(dir, entry.name))
        }
      }
      if (entry.name === 'global.json' && descriptor.hasGlobal) {
        const global = await readRecord(join(dir, entry.name), versions)
        if (global !== undefined) state.global = global
        return true
      }
      return false
    }))).some(Boolean)
  if (!hasNewDocuments) await bootstrapLegacyUnit(descriptor, dir, state)
  return state
}

/** The version stamps this unit reads as its own: current plus declared compatible versions. */
function acceptedStamps(descriptor: KvUnitDescriptor): readonly number[] {
  return [descriptor.version, ...descriptor.compatibleVersions ?? []]
}

/**
 * Bootstrap an empty per-record tree from a legacy whole-unit file
 * (`<root>/<name>.json`, the pre-per-record layout). Every declared-table
 * record is copied into a current-version document, and so is the global
 * singleton when the unit declares one — a unit whose global carries
 * authoritative state (ordering, set membership) would otherwise silently
 * lose it the first time its owner adopts this layout. The legacy file is
 * retained unchanged. A missing, foreign (another unit's name), malformed,
 * or non-unit legacy file is left alone, and so is one whose stored unit
 * version is outside the accepted set — migrating records the owner never
 * vouched for would stamp them with the current version and turn a
 * discardable stale cache into schema failures at the domain layer. Other
 * read failures propagate.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - The per-record unit directory (`<root>/<name>`).
 * @param state - The empty tree state; bootstrapped records are added.
 */
async function bootstrapLegacyUnit(descriptor: KvUnitDescriptor, dir: string, state: UnitState): Promise<void> {
  const legacyPath = join(dirname(dir), `${descriptor.name}.json`)
  let text: string | undefined
  try {
    text = await readFile(legacyPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  // The legacy document is runtime data: only `unit.name`, `unit.version`,
  // and the tables map shape are checked here — the record values are
  // migrated as-is and the domain layer's schemas judge them.
  let document: { unit?: { name?: unknown; version?: unknown }; tables?: unknown; global?: unknown }
  try {
    document = JSON.parse(text) as {
      unit?: { name?: unknown; version?: unknown }
      tables?: unknown
      global?: unknown
    }
  } catch {
    return // Malformed legacy file: not ours to interpret or delete.
  }
  if (document.unit?.name !== descriptor.name) return
  const stamped = document.unit.version
  if (typeof stamped !== 'number' || !acceptedStamps(descriptor).includes(stamped)) return
  const tables = document.tables
  if (typeof tables !== 'object' || tables === null) return
  const recordsByTable = tables as Record<string, Record<string, unknown>>
  for (const [table, records] of Object.entries(recordsByTable)) {
    const target = state.tables.get(table)
    if (target === undefined) continue
    for (const [key, value] of Object.entries(records)) {
      const path = join(dir, table, `${key}.json`)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(descriptor.version, value))
      target.set(key, value)
    }
  }
  // A legacy `global` of null is indistinguishable from "never written", which
  // is exactly the state an absent `global.json` already represents.
  if (!descriptor.hasGlobal || document.global === undefined || document.global === null) return
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeAtomic(join(dir, 'global.json'), serializeRecord(descriptor.version, document.global))
  state.global = document.global
}

/**
 * Read one declared table's record documents into `records`.
 * @returns whether the directory contains any `.json` document path,
 * independently of key safety, readability, or stored version.
 */
async function loadTableRecords(records: Map<string, unknown>, versions: readonly number[], dir: string): Promise<boolean> {
  const files = await readdir(dir, { withFileTypes: true })
  const hasDocuments = files.some(file => file.name.endsWith('.json'))
  const loaded = await Promise.all(files.map(async (file) => {
    if (!file.name.endsWith('.json')) return
    const key = file.name.slice(0, -'.json'.length)
    if (!SAFE_KEY_RE.test(key)) return
    const record = await readRecord(join(dir, file.name), versions)
    if (record !== undefined) return [key, record] as const
  }))
  for (const record of loaded) {
    if (record !== undefined) records.set(...record)
  }
  return hasDocuments
}

/** Read one record document; a foreign (unreadable or stale) one reads as absent. */
async function readRecord(path: string, versions: readonly number[]): Promise<unknown> {
  try {
    return parseRecord(await readFile(path, 'utf8'), versions)
  } catch {
    return undefined
  }
}

/**
 * One opened `per-record`-layout unit. Stateless by design: the directory is
 * the medium, the domain layer owns the live memory, and each method here is
 * a single durable file operation. Write ordering belongs to the caller (the
 * domain layer's write chain), exactly like the `single`-layout unit.
 */
export class PerRecordJsonUnit implements KvUnit {
  private closed = false
  /** In-flight durable writes; close() drains them before releasing the unit. */
  private readonly inFlight = new Set<Promise<void>>()
  /** Foreign-write detector; present only while a caller observes this unit. */
  private watcher: ExternalWatcher | undefined

  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly dir: string,
    private readonly onClose: () => void,
  ) {}

  /** Re-read the tree: the directory is the authoritative state. */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const state = await loadPerRecordState(this.descriptor, this.dir)
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of state.tables) {
      tables[table] = Object.fromEntries(records)
    }
    return { tables, global: state.global }
  }

  /** Durably replace one record: its own document, atomically. */
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    await this.tracked(this.writeDocument(join(this.tableDir(table), `${key}.json`), value))
  }

  /** Durably delete one record. Idempotent: a missing key is a no-op. */
  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    const path = join(this.tableDir(table), `${key}.json`)
    await this.tracked(rm(path, { force: true }))
    this.watcher?.forget(path)
  }

  /**
   * Move one record's document aside as `<key>.json.bak.<YYYYMMDDHHmm>`. The
   * moved file no longer ends in `.json`, so every later read ignores it; the
   * bytes stay on disk for inspection. A same-minute backup of the same
   * key overwrites the previous backup (the newer bytes are the ones worth
   * keeping).
   */
  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    const path = join(this.tableDir(table), `${key}.json`)
    const moved = `${path}.bak.${backupStamp(new Date())}`
    await this.tracked(rename(path, moved))
    this.watcher?.forget(path)
    return moved
  }

  /** Durably replace the global singleton. Only valid when declared. */
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    await this.tracked(this.writeDocument(join(this.dir, 'global.json'), value))
  }

  /**
   * Observe foreign writes under this unit's directory. The baseline is taken
   * asynchronously from the current medium state, so a write landing between
   * the caller's `loadAll` and that baseline is reported rather than missed.
   * Only one observer is supported — the domain layer is the single consumer,
   * and a second would need its own independent stamp set.
   * @param onExternal - Receives the locations whose stored bytes changed.
   * @returns a disposer that stops observation.
   */
  watchExternal(onExternal: (changed: readonly ExternalChange[]) => void): () => void {
    this.assertOpen()
    if (this.watcher !== undefined) {
      throw new Error(`unit '${this.descriptor.name}' is already observed`)
    }
    const watcher = new ExternalWatcher(this.descriptor, this.dir, EXTERNAL_WATCH_OPTIONS, onExternal)
    this.watcher = watcher
    // Failure to establish observation degrades to no observation, which is
    // the pre-existing behavior; it must not fail the caller's open.
    // The rejection arm cannot run: `start` tolerates every read failure and
    // watcher installation swallows its own, so nothing reaches the stop
    // below. It stays because a rejected open is the one outcome this path
    // must not produce.
    /* v8 ignore next 3 */
    void watcher.start().catch(() => {
      watcher.stop()
    })
    return () => {
      watcher.stop()
      if (this.watcher === watcher) this.watcher = undefined
    }
  }

  /* jscpd:ignore-start -- the two unit classes are standalone; the drain/guard lifecycle mirrors the shared KvUnit contract */
  /** Drain in-flight writes and release the unit. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight)
      return
    }
    this.closed = true
    this.watcher?.stop()
    this.watcher = undefined
    await Promise.allSettled(this.inFlight)
    this.onClose()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }
  /* jscpd:ignore-end */

  /** Resolve a declared table's directory; an undeclared table is a caller bug and throws. */
  private tableDir(table: string): string {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
    return join(this.dir, table)
  }

  /** Durably replace one document, creating its parent directory. */
  private writeDocument(path: string, value: unknown): Promise<void> {
    return (async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(this.descriptor.version, value))
      // Stamp this write as observed so the watcher does not report it back as
      // foreign. Ordering is safe either way: an unstamped self-write costs one
      // redundant report, which the domain diffs away.
      await this.watcher?.record(path)
    })()
  }

  /** Track one durable write so close() drains it. */
  private tracked(write: Promise<void>): Promise<void> {
    this.inFlight.add(write)
    // Swallow only on the tracking branch: the caller still awaits `write`
    // itself, so rejections stay observed exactly once.
    write.catch(() => {}).finally(() => this.inFlight.delete(write))
    return write
  }
}

/** Local-time `YYYYMMDDHHmm` suffix for backed-up documents. */
function backupStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** Reject a record key that would be unsafe as a path segment. */
function assertSafeKey(unit: string, key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(`unit '${unit}': per-record key '${key}' is not path-safe (must match ${SAFE_KEY_RE})`)
  }
}
