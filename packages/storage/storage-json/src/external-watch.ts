/**
 * Foreign-write detection for the `per-record` JSON layout: reports which
 * record documents under a unit directory changed on the medium, so a domain
 * sharing its root with another process converges instead of serving its
 * open-time snapshot forever.
 *
 * The detector owns one fact — the stat identity (`mtimeMs`, `size`, `ino`)
 * of every document it has observed — and reports a location whenever that
 * identity differs from what it recorded. It never reads or reports record
 * values: the medium is authoritative and the domain re-reads it.
 *
 * `fs.watch` is an accelerator, not the authority. It coalesces, it is
 * edge-triggered, and on some filesystems it delivers nothing at all, so a
 * watch event only schedules the same reconcile pass that a periodic sweep
 * runs anyway. A dropped event therefore costs latency until the next sweep,
 * never a permanently stale value — which is the property that lets the
 * domain treat this as a hint channel and keep the medium as the truth.
 * @module @deepseek-ai/dsh-storage-json/src/external-watch
 */

import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExternalChange, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/** The stat identity of one observed document; a change in any field reports the location. */
interface DocumentStamp {
  mtimeMs: number
  size: number
  ino: number
}

/** Detection cadence, plus the switch that exercises the degraded medium. */
export interface ExternalWatchOptions {
  /** Quiet period after a watch event before reconciling, coalescing a burst of writes. */
  debounceMs: number
  /** Longest time between reconcile passes when no watch event arrives; `0` disables the sweep. */
  sweepIntervalMs: number
  /**
   * Install no filesystem watchers, leaving the sweep as the only detector.
   * This is what a filesystem that delivers no events looks like, and it is
   * the configuration in which convergence must still hold.
   */
  sweepOnly?: boolean
}

/** `global.json` lives at the unit root and carries the global slot's empty table/key names. */
const GLOBAL_DOCUMENT = 'global.json'

/**
 * Observe foreign writes under one `per-record` unit directory.
 *
 * Self-writes are excluded by stamp, not by path bookkeeping: the unit calls
 * {@link ExternalWatcher.record} after each of its own durable writes, so the
 * resulting stat identity is already the observed one and the following
 * reconcile finds nothing to report. A self-write that races a foreign write
 * to the same document reports it, which is correct — the bytes on the medium
 * are no longer the ones this process wrote.
 */
export class ExternalWatcher {
  private readonly stamps = new Map<string, DocumentStamp>()
  private readonly watchers: FSWatcher[] = []
  /** Paths that already carry a watcher, so re-installation stays idempotent. */
  private readonly watched = new Set<string>()
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private reconciling = false
  private pending = false
  private stopped = false

  /**
   * @param descriptor - Static identity and shape of the watched unit.
   * @param dir - The unit directory (`<root>/<name>`).
   * @param options - Debounce and sweep cadence.
   * @param onExternal - Receives the locations whose stored bytes changed.
   */
  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly dir: string,
    private readonly options: ExternalWatchOptions,
    private readonly onExternal: (changed: readonly ExternalChange[]) => void,
  ) {}

  /**
   * Record the current stat identity of one document this unit just wrote, so
   * the write is not reported back as foreign. A stat failure leaves the
   * document unstamped, which costs one redundant report.
   * @param path - Absolute path of the written document.
   */
  async record(path: string): Promise<void> {
    const stamp = await stampOf(path)
    if (stamp === undefined) this.stamps.delete(path)
    else this.stamps.set(path, stamp)
  }

  /**
   * Forget a document this unit just removed, so its absence is not reported
   * back as a foreign change.
   * @param path - Absolute path of the removed document.
   */
  forget(path: string): void {
    this.stamps.delete(path)
  }

  /**
   * Take the directory's current stat identities as the baseline without
   * reporting anything, then begin observing. Called once, after the unit's
   * open-time `loadAll`, so the domain's snapshot and this baseline describe
   * the same medium state.
   * @returns resolution once the baseline is taken and observation started.
   */
  async start(): Promise<void> {
    await this.scan(false)
    if (this.stopped) return
    this.installWatchers()
    if (this.options.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => { this.schedule(0) }, this.options.sweepIntervalMs)
      this.sweepTimer.unref()
    }
  }

  /** Stop observing and release every watcher and timer. Idempotent. */
  stop(): void {
    this.stopped = true
    for (const watcher of this.watchers) watcher.close()
    this.watchers.length = 0
    this.watched.clear()
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer)
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.sweepTimer = undefined
    this.debounceTimer = undefined
  }

  /**
   * Watch the backend root, the unit directory, and every table directory
   * that currently exists.
   *
   * Every level below the root is created lazily — the unit directory by the
   * unit's first write, each table directory by the first write to that
   * table — and `fs.watch` cannot observe a directory that does not exist
   * yet. The backend root is the one level guaranteed to exist (the backend
   * creates it when it opens), so watching it is what makes a unit that has
   * never been written converge promptly once another process materializes
   * it. Each reconcile calls this again, so a newly created directory picks
   * up its own watcher on the pass that first sees it.
   *
   * Idempotent per path: already-watched paths are skipped.
   */
  private installWatchers(): void {
    if (this.stopped || this.options.sweepOnly === true) return
    const paths = [dirname(this.dir), this.dir, ...this.descriptor.tables.map(table => join(this.dir, table))]
    for (const path of paths) {
      if (this.watched.has(path)) continue
      try {
        const watcher = watch(path, () => { this.schedule(this.options.debounceMs) })
        // A watch error (the directory is removed, the medium stops
        // delivering) degrades this path to sweep-only rather than failing:
        // the sweep is the floor precisely so detection can lose its
        // accelerator without losing convergence.
        watcher.on('error', () => {
          watcher.close()
          this.watched.delete(path)
        })
        this.watchers.push(watcher)
        this.watched.add(path)
      } catch {
        // ENOENT for a table directory that has no documents yet, or a
        // platform that cannot watch this path at all. Sweep-only covers both,
        // and a later reconcile retries this path once it exists.
      }
    }
  }

  /** Coalesce reconcile requests: a burst of events runs one pass after the quiet period. */
  private schedule(delayMs: number): void {
    if (this.stopped) return
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.reconcile()
    }, delayMs)
    this.debounceTimer.unref()
  }

  /** Whether another reconcile was requested while this one ran, and is still worth running. */
  private takePending(): boolean {
    return this.pending && !this.stopped
  }

  /** Run one reconcile pass, serializing concurrent requests into one follow-up run. */
  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.pending = true
      return
    }
    this.reconciling = true
    try {
      // `takePending()` reads through a method so the re-entrant write during
      // the awaited `scan` stays visible; a direct field read is narrowed to
      // its last assignment and the loop would look single-pass.
      do {
        this.pending = false
        await this.scan(true)
        // Table directories materialize on their first write, so a directory
        // that could not be watched at start may exist now.
        this.installWatchers()
      } while (this.takePending())
    } finally {
      this.reconciling = false
    }
  }

  /**
   * Compare every document's stat identity against the recorded baseline.
   * @param report - Whether differences are reported; `false` only records them.
   */
  private async scan(report: boolean): Promise<void> {
    const seen = new Set<string>()
    const changed: ExternalChange[] = []
    for (const table of this.descriptor.tables) {
      await this.scanDirectory(join(this.dir, table), table, seen, changed)
    }
    if (this.descriptor.hasGlobal) {
      await this.scanDocument(join(this.dir, GLOBAL_DOCUMENT), '', '', seen, changed)
    }
    // A document that vanished is a foreign delete: report the location so the
    // domain re-reads it as absent.
    for (const path of [...this.stamps.keys()]) {
      if (seen.has(path)) continue
      this.stamps.delete(path)
      const location = this.locationOf(path)
      if (location !== undefined) changed.push(location)
    }
    if (!report || changed.length === 0 || this.stopped) return
    try {
      this.onExternal(changed)
    } catch {
      // The consumer owns its failures; detection must keep running or this
      // unit silently stops converging.
    }
  }

  /** Stat every `.json` document in one table directory. */
  private async scanDirectory(
    dir: string,
    table: string,
    seen: Set<string>,
    changed: ExternalChange[],
  ): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return // Absent table directory: nothing materialized yet.
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      await this.scanDocument(join(dir, entry), table, entry.slice(0, -'.json'.length), seen, changed)
    }
  }

  /** Stat one document and record it as changed when its identity differs. */
  private async scanDocument(
    path: string,
    table: string,
    key: string,
    seen: Set<string>,
    changed: ExternalChange[],
  ): Promise<void> {
    const stamp = await stampOf(path)
    if (stamp === undefined) return
    seen.add(path)
    const previous = this.stamps.get(path)
    this.stamps.set(path, stamp)
    if (previous === undefined
      || previous.mtimeMs !== stamp.mtimeMs
      || previous.size !== stamp.size
      || previous.ino !== stamp.ino) {
      changed.push({ table, key })
    }
  }

  /** Recover the `{ table, key }` a tracked path names, or `undefined` when it names neither. */
  private locationOf(path: string): ExternalChange | undefined {
    if (path === join(this.dir, GLOBAL_DOCUMENT)) return { table: '', key: '' }
    for (const table of this.descriptor.tables) {
      const prefix = join(this.dir, table)
      if (!path.startsWith(`${prefix}/`)) continue
      const name = path.slice(prefix.length + 1)
      if (!name.endsWith('.json')) continue
      return { table, key: name.slice(0, -'.json'.length) }
    }
    return undefined
  }
}

/** The stat identity of one document, or `undefined` when it is absent or unreadable. */
async function stampOf(path: string): Promise<DocumentStamp | undefined> {
  try {
    const info = await stat(path)
    return { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino }
  } catch {
    return undefined
  }
}
