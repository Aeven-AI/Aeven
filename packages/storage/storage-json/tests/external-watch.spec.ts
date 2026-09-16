/**
 * Foreign-write detection for the `per-record` layout. The convergence these
 * reports drive is covered end to end in the storage-domain suite; this one
 * pins the detector's own guarantees, including the sweep that has to hold
 * when `fs.watch` delivers nothing.
 * @module
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExternalChange } from '@deepseek-ai/dsh-storage'
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

/** Write one record document the way the unit does, bypassing the unit's self-write stamping. */
async function writeDocument(dir: string, table: string, key: string, value: unknown): Promise<void> {
  await mkdir(join(dir, table), { recursive: true })
  await writeFile(join(dir, table, `${key}.json`), serializeRecord(descriptor.version, value), 'utf8')
}

/** Resolve once `predicate` holds over everything reported so far. */
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

describe('ExternalWatcher', () => {
  it('reports a record another writer created, and its later modification', async () => {
    const dir = await freshUnitDir()
    const reported: ExternalChange[] = []
    const watcher = new ExternalWatcher(
      descriptor, dir,
      { debounceMs: 10, sweepIntervalMs: 5_000 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeDocument(dir, 't', 'k1', { v: 1 })
      await until(reported, changes => changes.some(c => c.key === 'k1'), 3_000)
      reported.length = 0
      // A second write to the same document must report again: the stamp
      // comparison has to notice content changes, not just appearance.
      await writeDocument(dir, 't', 'k1', { v: 2 })
      await until(reported, changes => changes.some(c => c.key === 'k1'), 3_000)
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
      { debounceMs: 10, sweepIntervalMs: 5_000 },
      changes => reported.push(...changes),
    )
    await watcher.start()
    try {
      await writeFile(join(dir, 'global.json'), serializeRecord(descriptor.version, { order: ['a'] }), 'utf8')
      await until(reported, changes => changes.some(c => c.table === '' && c.key === ''), 3_000)
      await rm(join(dir, 't', 'doomed.json'))
      await until(reported, changes => changes.some(c => c.key === 'doomed'), 3_000)
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
