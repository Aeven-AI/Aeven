/**
 * Foreign-write detection for the `per-record` layout. The convergence these
 * reports drive is covered end to end in the storage-domain suite; this one
 * pins the detector's own guarantees, including the sweep that has to hold
 * when `fs.watch` delivers nothing.
 * @module
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExternalChange } from '@aeven/storage'
import { ExternalWatcher } from '../src/external-watch.ts'
import { serializeRecord } from '../src/format.ts'

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
})

async function freshUnitDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-watch-'))
  roots.push(root)
  const dir = join(root, 'recs')
  await mkdir(dir, { recursive: true })
  return dir
}

const descriptor = { name: 'recs', version: 2, layout: 'per-record' as const, tables: ['t'], hasGlobal: true }

/** Cadence for the passes a spec drives itself: no sweep, and a debounce it advances by hand. */
const OPTIONS = { debounceMs: 1, sweepIntervalMs: 0, sweepOnly: true } as const

/** Window long enough for one pass's real reads to land, paid once per driven pass. */
const PASS_SETTLE_MS = 60

/** Write one record document the way the unit does, bypassing the unit's self-write stamping. */
async function writeDocument(dir: string, table: string, key: string, value: unknown): Promise<void> {
  await mkdir(join(dir, table), { recursive: true })
  await writeFile(join(dir, table, `${key}.json`), serializeRecord(descriptor.version, value), 'utf8')
}

/**
 * Resolve once `predicate` holds over everything reported so far.
 *
 * Budgets here must clear the watcher's own sweep interval, not just its
 * expected watch latency: these specs run beside the rest of the suite, and
 * under that contention a filesystem event can arrive late enough that the
 * sweep is what reports the change. Both paths are correct, so an assertion
 * that only tolerated the watch would fail on load rather than on a defect.
 */
async function until(
  reported: ExternalChange[],
  predicate: (changes: ExternalChange[]) => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate(reported)) {
    if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(reported)}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/**
 * Run one reconcile pass through the production trigger, and wait for it.
 *
 * A watcher whose sweep is disabled runs a pass only when the debounced watch
 * event fires, so asking for that pass is `schedule(0)` — the call both
 * production triggers make, `fs.watch` with `options.debounceMs` and the sweep
 * with `0` — and the settle window then covers that pass's reads, which are
 * real filesystem work no clock can shorten. No production entry point is
 * widened for the sake of a spec, and no assertion depends on when the medium
 * happens to deliver an event.
 */
async function drivePass(watcher: ExternalWatcher): Promise<void> {
  schedulePass(watcher, 0)
  await new Promise(resolve => setTimeout(resolve, PASS_SETTLE_MS))
}

/**
 * Ask the watcher for a reconcile pass the way its own triggers do.
 *
 * `schedule` is private because nothing outside the class is meant to request
 * a pass; both production triggers — `fs.watch` with `options.debounceMs` and
 * the sweep timer with `0` — go through this same call, so a spec that wants a
 * deterministic pass makes it too rather than widening the class to expose a
 * test-only entry point (`AGENTS.md`: a test hook is not configurability).
 */
function schedulePass(watcher: ExternalWatcher, delayMs: number): void {
  const internal: { schedule(delayMs: number): void } = watcher as unknown as {
    schedule(delayMs: number): void
  }
  internal.schedule(delayMs)
}

describe('ExternalWatcher', () => {
  it('reports a record another writer created, and its later modification', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 10, sweepIntervalMs: 500 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'k1', { v: 1 })
      await until(reported, changes => changes.some(c => c.key === 'k1'), 8_000)
      reported.length = 0
      // A second write to the same document must report again: the stamp
      // comparison has to notice content changes, not just appearance.
      await writeDocument(dir, 't', 'k1', { v: 2 })
      await until(reported, changes => changes.some(c => c.key === 'k1'), 8_000)
    } finally {
      watcher.stop()
    }
  })

  it('reports the global singleton and a foreign delete', async () => {
    const dir = await freshUnitDir()
    await writeDocument(dir, 't', 'doomed', { v: 1 })
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 10, sweepIntervalMs: 500 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeFile(join(dir, 'global.json'), serializeRecord(descriptor.version, { order: ['a'] }), 'utf8')
      await until(reported, changes => changes.some(c => c.table === '' && c.key === ''), 8_000)
      await rm(join(dir, 't', 'doomed.json'))
      await until(reported, changes => changes.some(c => c.key === 'doomed'), 8_000)
    } finally {
      watcher.stop()
    }
  })

  it('takes the existing tree as its baseline instead of reporting it', async () => {
    const dir = await freshUnitDir()
    await writeDocument(dir, 't', 'pre', { v: 1 })
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 10, sweepIntervalMs: 100 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      // Several sweeps go by; a quiet medium stays silent.
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('converges through the sweep when no watch event ever arrives', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    // No filesystem watchers at all: only the sweep remains, which is what a
    // filesystem delivering no events leaves behind.
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 10, sweepIntervalMs: 150, sweepOnly: true },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'swept', { v: 1 })
      await until(reported, changes => changes.some(c => c.key === 'swept'), 5_000)
    } finally {
      watcher.stop()
    }
  })

  it('stops reporting once stopped', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 10, sweepIntervalMs: 50 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    watcher.stop()
    await writeDocument(dir, 't', 'after', { v: 1 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(reported).toEqual([])
  })
})

/**
 * Self-write stamping, the location ladder, and teardown.
 *
 * The specs above prove convergence on a real filesystem through the watch;
 * these pin the decisions a single end-to-end wait cannot separate — a
 * self-write that must not come back as foreign, a tracked path no table
 * claims, a stop that lands while a pass is running, and a pass queued behind
 * one already in flight. Each drives the detector's own timer, so nothing
 * depends on when the medium happens to deliver an event.
 */
describe('ExternalWatcher stamping and teardown', () => {
  it('does not report a document this unit wrote itself', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(descriptor, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'self', { v: 1 })
      // `record` is what the unit calls after each durable write: the stamp is
      // the identity the medium already has, so the pass that follows — the
      // pass that would report any other document as foreign — finds nothing.
      await watcher.record(join(dir, 't', 'self.json'))
      await drivePass(watcher)
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('forgets a document this unit deleted, and drops a stamp it can no longer stat', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(descriptor, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'gone', { v: 1 })
      await watcher.record(join(dir, 't', 'gone.json'))
      // The unit's own delete calls `forget` first, so removing the document
      // does not come back as a foreign delete.
      await rm(join(dir, 't', 'gone.json'))
      watcher.forget(join(dir, 't', 'gone.json'))
      await drivePass(watcher)
      expect(reported).toEqual([])

      // A stat failure drops the stamp instead of keeping a stale one, which
      // costs a redundant report at worst — the medium decides.
      await writeDocument(dir, 't', 'stale', { v: 1 })
      await rm(join(dir, 't', 'stale.json'))
      await watcher.record(join(dir, 't', 'stale.json'))
      await drivePass(watcher)
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('reports nothing for a tracked path no table claims', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(descriptor, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      // A stamp can name any document the unit was handed; only a declared
      // table's `.json` path is a reportable location. The first path sits
      // under a directory the descriptor does not declare as a table, the
      // second under one that it does but as a non-record document.
      for (const relative of ['other/gone.json', 't/notes.txt']) {
        await mkdir(dirname(join(dir, relative)), { recursive: true })
        await writeFile(join(dir, relative), 'not a record', 'utf8')
        await watcher.record(join(dir, relative))
        await rm(join(dir, relative))
      }
      await drivePass(watcher)
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('stops reporting for a path it is told to forget', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(descriptor, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      // A document first seen by a pass reports once; that is the baseline
      // this test then removes.
      await writeDocument(dir, 't', 'k1', { v: 1 })
      await drivePass(watcher)
      expect(reported).toEqual([{ table: 't', key: 'k1' }])

      // Forgetting drops the stamp before the document goes, which is the
      // unit's own-delete contract: the next pass reads the absence as a
      // first sight of nothing, not as a foreign delete to report.
      reported.length = 0
      await rm(join(dir, 't', 'k1.json'))
      watcher.forget(join(dir, 't', 'k1.json'))
      await drivePass(watcher)
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('skips a non-record document in a table directory', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(descriptor, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      // Backups land beside records as `<key>.json.bak.<stamp>`; the scan must
      // not treat them as records, now or later.
      await mkdir(join(dir, 't'), { recursive: true })
      await writeFile(join(dir, 't', 'k1.json.bak.202601010000'), 'backup bytes', 'utf8')
      await drivePass(watcher)
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('takes the global document as a tracked path', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(descriptor, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      // The global singleton is a tracked path with its own location: deleting
      // it is a foreign change like any other.
      await writeFile(join(dir, 'global.json'), serializeRecord(descriptor.version, { order: ['a'] }), 'utf8')
      await drivePass(watcher)
      expect(reported).toEqual([{ table: '', key: '' }])
      reported.length = 0
      await rm(join(dir, 'global.json'))
      await drivePass(watcher)
      expect(reported).toEqual([{ table: '', key: '' }])
    } finally {
      watcher.stop()
    }
  })

  it('takes its baseline without a global document when the unit declares none', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    await writeDocument(dir, 't', 'pre', { v: 1 })
    await writeFile(join(dir, 'global.json'), serializeRecord(descriptor.version, { order: [] }), 'utf8')
    // A unit without the global slot scans only its tables: the document at
    // the unit root is not part of its medium and cannot be reported.
    const watcher = new ExternalWatcher({ ...descriptor, hasGlobal: false }, dir, OPTIONS, changes => reported.push(...changes))
    await watcher.start()
    try {
      await drivePass(watcher)
      expect(reported).toEqual([])
    } finally {
      watcher.stop()
    }
  })

  it('reports a foreign write the sweep finds, and stays silent on a self-write the sweep sees', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    // The sweep is the floor a dropped event falls back on. Its `schedule(0)`
    // means "the next tick, with no debounce", so a dropped event costs at
    // most one sweep interval — and a write this unit stamped stays silent
    // whether the watch or the sweep is what runs the pass.
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 0, sweepIntervalMs: 30 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'mine', { v: 1 })
      await watcher.record(join(dir, 't', 'mine.json'))
      await writeDocument(dir, 't', 'foreign', { v: 1 })
      await until(reported, changes => changes.some(change => change.key === 'foreign'), 5_000)
      // The stamped self-write never appears, however many passes the sweep
      // runs; the foreign document does.
      expect(reported.filter(change => change.key === 'mine')).toEqual([])
      expect(reported).toContainEqual({ table: 't', key: 'foreign' })
    } finally {
      watcher.stop()
    }
  })

  it('serializes a pass requested while another was still in flight', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    // A sweep cadence short enough that a watch event's own request arrives
    // while the sweep's pass is still running. Two passes over one medium must
    // not lose a document or report one twice.
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 5, sweepIntervalMs: 40 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'one', { v: 1 })
      // Long enough for the watch event's debounce to arm and fire inside the
      // sweep's own pass.
      await new Promise(resolve => setTimeout(resolve, 20))
      await writeDocument(dir, 't', 'two', { v: 1 })
      await until(reported, changes => changes.some(change => change.key === 'two'), 5_000)
      expect(new Set(reported.map(change => change.key))).toEqual(new Set(['one', 'two']))
      expect(reported.every(change => change.table === 't')).toBe(true)
    } finally {
      watcher.stop()
    }
  })

  it('discards a pending follow-up when the watcher stops mid-pass', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    let stoppedDuringFirstPass = false
    const watcher: ExternalWatcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 1, sweepIntervalMs: 20 },
      (changes) => {
        reported.push(...changes)
        if (!stoppedDuringFirstPass) {
          stoppedDuringFirstPass = true
          // A second request arrives while this pass runs, then the caller
          // stops: the queued follow-up is no longer worth running.
          schedulePass(watcher, 0)
          watcher.stop()
        }
      },
    )
    await watcher.start()
    await writeDocument(dir, 't', 'k1', { v: 1 })
    await until(reported, changes => changes.some(change => change.key === 'k1'), 5_000)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(reported).toEqual([{ table: 't', key: 'k1' }])
  })

  it('keeps detecting after a watched directory disappears under it', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 1, sweepIntervalMs: 20 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      // Removing a watched directory is what raises the watcher's error event
      // on the platforms that deliver one. Either way the contract is the
      // same — the path degrades and detection keeps running — so the
      // assertion is that a later document is still reported.
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      await writeDocument(dir, 't', 'after', { v: 1 })
      await until(reported, changes => changes.some(change => change.key === 'after'), 5_000)
    } finally {
      watcher.stop()
    }
  })

  it('does not arm a debounce on a watcher that was already stopped', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    // A sweep cadence short enough that the request raced by `stop()` is
    // armed by a timer that is already dead: the guard is what keeps a
    // stopped watcher from coming back to life.
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 1, sweepIntervalMs: 3 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    await writeDocument(dir, 't', 'k1', { v: 1 })
    await new Promise(resolve => setTimeout(resolve, 25))
    watcher.stop()
    await writeDocument(dir, 't', 'k2', { v: 1 })
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(reported.every(change => change.key === 'k1')).toBe(true)
  })

  it('degrades to sweep-only when the caller stops before observation begins', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    // A stop that lands between the baseline scan and watcher installation —
    // the shape of a unit closed while its open is still settling.
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 1, sweepIntervalMs: 60_000 },
      changes => reported.push(...changes),
    )
    const started = watcher.start()
    watcher.stop()
    await started
    await writeDocument(dir, 't', 'late', { v: 1 })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(reported).toEqual([])
  })

  it('stops idempotently when no sweep timer was ever installed', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 1, sweepIntervalMs: 0, sweepOnly: true },
      changes => reported.push(...changes),
    )
    await watcher.start()
    await writeDocument(dir, 't', 'x', { v: 1 })
    // With no sweep and no watchers, the only timer that could be armed is the
    // debounce one; a second stop must be as harmless as the first.
    watcher.stop()
    watcher.stop()
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(reported).toEqual([])
  })
})
