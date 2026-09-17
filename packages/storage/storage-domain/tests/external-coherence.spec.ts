/**
 * Cross-process convergence over the real JSON backend: two independently
 * opened domains share one root, exactly as two harness processes share one
 * `~/.avn`. These run on disk rather than the memory double because the
 * behavior under test is detection of another writer's bytes.
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@aeven/storage'
import * as StorageJson from '@aeven/storage-json'
import * as StorageDomain from '../src/index.ts'
import { defineDomain, domainTable, DomainFacility } from '../src/index.ts'
import type { Domain } from '../src/domain.ts'
import type { DomainChanged } from '../src/events.ts'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'

const noteSchema = z.object({ title: z.string() })

const spec = defineDomain({
  name: 'notes',
  version: 1,
  layout: 'per-record',
  global: {
    schema: z.object({ order: z.array(z.string()) }),
    initial: { order: [] },
  },
  tables: { notes: domainTable<string, { title: string }>(noteSchema) },
})

/** One simulated process: its own Context, backend, and facility over a shared root. */
async function openProcess(root: string): Promise<{
  ctx: Context
  domain: Domain<typeof spec>
  changes: DomainChanged[]
  close: () => Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  const changes: DomainChanged[] = []
  ctx.on('domain/changed', (change: DomainChanged) => { changes.push(change) })
  const fiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  const domain = await ctx.storageDomain.open(spec)
  return {
    ctx,
    domain,
    changes,
    close: async () => {
      await domain.close()
      await fiber.dispose()
    },
  }
}

/**
 * Poll until `predicate` holds, so an assertion never depends on watch
 * latency. The budget clears the backend's 5-second sweep with room to spare:
 * these specs run beside the rest of the suite, and under that contention a
 * filesystem event can arrive late enough that convergence comes from the
 * sweep instead of the watch. Both paths are correct, so the assertion must
 * accept the slower one — the watch's own latency is pinned separately, in
 * the storage-json watcher spec.
 */
async function until(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for convergence')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('cross-process domain coherence', () => {
  it('converges a second process on a record the first one wrote', { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-coherence-'))
    const alpha = await openProcess(root)
    const beta = await openProcess(root)
    try {
      // Neither process can see a record that does not exist yet.
      expect(beta.domain.table('notes').get('n1')).toBeUndefined()

      await alpha.domain.table('notes').put('n1', { title: 'written by alpha' })

      await until(() => beta.domain.table('notes').get('n1') !== undefined)
      expect(beta.domain.table('notes').get('n1')).toEqual({ title: 'written by alpha' })
      // The foreign write reaches beta as an ordinary change event, which is
      // what drives every existing consumer (client feeds included).
      expect(beta.changes).toContainEqual({
        domain: 'notes', table: 'notes', key: 'n1', operation: 'put', value: { title: 'written by alpha' },
      })
    } finally {
      await beta.close()
      await alpha.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('converges the global singleton, the slot that held workspace ordering', { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-coherence-global-'))
    const alpha = await openProcess(root)
    const beta = await openProcess(root)
    try {
      await alpha.domain.global.set({ order: ['a', 'b'] })
      await until(() => beta.domain.global.get().order.length === 2)
      expect(beta.domain.global.get()).toEqual({ order: ['a', 'b'] })
    } finally {
      await beta.close()
      await alpha.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('converges a foreign delete', { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-coherence-delete-'))
    const alpha = await openProcess(root)
    await alpha.domain.table('notes').put('gone', { title: 'doomed' })
    const beta = await openProcess(root)
    try {
      expect(beta.domain.table('notes').get('gone')).toEqual({ title: 'doomed' })
      await alpha.domain.table('notes').delete('gone')
      await until(() => beta.domain.table('notes').get('gone') === undefined)
      expect(beta.changes).toContainEqual({
        domain: 'notes', table: 'notes', key: 'gone', operation: 'deleted',
      })
    } finally {
      await beta.close()
      await alpha.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not report a process its own writes', { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-coherence-self-'))
    const alpha = await openProcess(root)
    try {
      await alpha.domain.table('notes').put('mine', { title: 'local' })
      // Wait past a full sweep: a self-write that escaped stamping would be
      // re-reported by the sweep even when no watch event fired.
      await new Promise(resolve => setTimeout(resolve, 7_000))
      const forKey = alpha.changes.filter(change => change.key === 'mine')
      expect(forKey).toHaveLength(1)
    } finally {
      await alpha.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the current value when a foreign write fails this build schema', { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-coherence-invalid-'))
    const alpha = await openProcess(root)
    await alpha.domain.table('notes').put('n1', { title: 'valid' })
    const beta = await openProcess(root)
    const warn = vi.spyOn(beta.ctx.logger, 'warn').mockImplementation(() => {})
    try {
      // A record this build cannot read — the cross-version case that made
      // titles vanish. It must not erase the value already held.
      await alpha.domain.table('notes').put('n1', { nope: 1 } as never)
      await until(() => warn.mock.calls.length > 0)
      expect(beta.domain.table('notes').get('n1')).toEqual({ title: 'valid' })
    } finally {
      warn.mockRestore()
      await beta.close()
      await alpha.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

/**
 * `applyExternal` driven directly over the memory double.
 *
 * The disk suite above proves convergence end to end; these pin the apply
 * ladder's own decisions — re-read, validate, mutate memory, then emit — which
 * a timing-dependent wait cannot isolate: an unchanged value, a location that
 * moved nothing, a domain that already stopped observing, and a failed re-read
 * all have to be distinguishable from a converged one.
 */
describe('applyExternal over the memory double', () => {
  const settingsSchema = z.object({ order: z.array(z.string()) })

  const globalSpec = defineDomain({
    name: 'notesglobal',
    version: 1,
    global: { schema: settingsSchema, initial: { order: [] } },
    tables: { notes: domainTable<string, { title: string }>(noteSchema) },
  })

  const noGlobalSpec = defineDomain({
    name: 'notesnoglobal',
    version: 1,
    tables: { notes: domainTable<string, { title: string }>(noteSchema) },
  })

  /** Boot a memory-backed facility whose units report foreign locations on demand. */
  async function memoryHarness(): Promise<{
    ctx: Context
    pool: MemoryMediaPool
    changes: DomainChanged[]
    open: (spec: typeof globalSpec | typeof noGlobalSpec) => Promise<Domain<never>>
  }> {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const pool = new MemoryMediaPool()
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    const changes: DomainChanged[] = []
    ctx.on('domain/changed', (change: DomainChanged) => { changes.push(change) })
    return {
      ctx,
      pool,
      changes,
      open: async spec => await facility.open(spec),
    }
  }

  it('re-reads the medium for a reported location, mutating memory before it emits', async () => {
    const { pool, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    await domain.table('notes').put('n1', { title: 'local' })
    // The peer's bytes are already on the medium; the report only says where.
    pool.media.get('notesglobal')?.tables.get('notes')?.set('n1', { title: 'foreign' })
    pool.media.get('notesglobal')?.tables.get('notes')?.set('n2', { title: 'appeared' })
    changes.length = 0
    const report = pool.externalWatchers.at(-1)
    expect(report).toBeDefined()

    report?.([{ table: 'notes', key: 'n1' }])
    // The emission rides the write chain, so await the change rather than a tick.
    await until(() => changes.length === 1)
    expect(domain.table('notes').get('n1')).toEqual({ title: 'foreign' })
    expect(changes).toEqual([
      { domain: 'notesglobal', table: 'notes', key: 'n1', operation: 'put', value: { title: 'foreign' } },
    ])

    // A location memory never held is a first sight, not a change of value.
    report?.([{ table: 'notes', key: 'n2' }])
    await until(() => changes.length === 2)
    expect(changes[1]).toEqual({
      domain: 'notesglobal', table: 'notes', key: 'n2', operation: 'put', value: { title: 'appeared' },
    })
  })

  it('stays silent when the medium already holds the value memory does', async () => {
    const { pool, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    await domain.table('notes').put('same', { title: 'equal' })
    changes.length = 0
    pool.externalWatchers.at(-1)?.([{ table: 'notes', key: 'same' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toEqual([])
    expect(domain.table('notes').get('same')).toEqual({ title: 'equal' })
  })

  it('drops a record the peer deleted and reports the deletion once', async () => {
    const { pool, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    await domain.table('notes').put('gone', { title: 'doomed' })
    changes.length = 0
    pool.media.get('notesglobal')?.tables.get('notes')?.delete('gone')
    const report = pool.externalWatchers.at(-1)
    report?.([{ table: 'notes', key: 'gone' }])
    await until(() => changes.length === 1)
    expect(changes).toEqual([
      { domain: 'notesglobal', table: 'notes', key: 'gone', operation: 'deleted' },
    ])
    expect(domain.table('notes').get('gone')).toBeUndefined()

    // Reporting the same absence again moves nothing, so it stays silent.
    report?.([{ table: 'notes', key: 'gone' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toHaveLength(1)
  })

  it('ignores a global report on a domain that declares no global slot', async () => {
    const { pool, changes, open } = await memoryHarness()
    const domain = await open(noGlobalSpec) as unknown as Domain<typeof noGlobalSpec>
    await domain.table('notes').put('n1', { title: 'kept' })
    changes.length = 0
    // The global singleton exists at the unit root whatever the spec declares,
    // so a peer's write there reaches applyExternal; a spec without the slot
    // has nothing to converge and nothing to report.
    pool.media.get('notesnoglobal')!.global = { order: ['a'] }
    pool.externalWatchers.at(-1)?.([{ table: '', key: '' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toEqual([])
    expect(domain.table('notes').get('n1')).toEqual({ title: 'kept' })
  })

  it('treats a null stored global and an unchanged global as no change', async () => {
    const { pool, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    changes.length = 0
    const report = pool.externalWatchers.at(-1)
    // A peer deleting `global.json` reads back as the never-written sentinel.
    report?.([{ table: '', key: '' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toEqual([])
    expect(domain.global.get()).toEqual({ order: [] })

    // A peer writing the value already held is not a change either.
    await domain.global.set({ order: ['x'] })
    changes.length = 0
    report?.([{ table: '', key: '' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toEqual([])
  })

  it('converges the global and keeps the current value when a foreign global fails schema', async () => {
    const { pool, ctx, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    pool.media.get('notesglobal')!.global = { order: ['peer'] }
    changes.length = 0
    pool.externalWatchers.at(-1)?.([{ table: '', key: '' }])
    await until(() => changes.length === 1)
    expect(domain.global.get()).toEqual({ order: ['peer'] })
    expect(changes[0]).toEqual({
      domain: 'notesglobal', table: '', key: '', operation: 'put', value: { order: ['peer'] },
    })

    // A global this build cannot read leaves the converged value in place.
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    pool.media.get('notesglobal')!.global = { order: [42] }
    pool.externalWatchers.at(-1)?.([{ table: '', key: '' }])
    await until(() => warn.mock.calls.length > 0)
    expect(domain.global.get()).toEqual({ order: ['peer'] })
    expect(changes).toHaveLength(1)
    warn.mockRestore()
  })

  it('keeps memory as it was when a reconcile pass cannot re-read the medium', async () => {
    const { pool, ctx, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    await domain.table('notes').put('n1', { title: 'local' })
    changes.length = 0
    // Convergence is best-effort: a failed pass must not surface as a rejected
    // callback (the detector would drop the report) or as a torn value.
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    pool.failNextLoads = 1
    expect(() => pool.externalWatchers.at(-1)?.([{ table: 'notes', key: 'n1' }])).not.toThrow()
    await until(() => warn.mock.calls.length > 0)
    expect(warn.mock.calls[0]?.[0]).toMatch(/applying an external change failed; memory stays as it was/)
    expect(domain.table('notes').get('n1')).toEqual({ title: 'local' })
    expect(changes).toEqual([])
    warn.mockRestore()
  })

  it('drops a report that lands after the domain stopped converging', async () => {
    const { pool, changes, open } = await memoryHarness()
    const domain = await open(globalSpec) as unknown as Domain<typeof globalSpec>
    const report = pool.externalWatchers.at(-1)
    await domain.close()
    // The watcher is stopped by the unit's close, but a report already in
    // flight must not apply onto a closed domain.
    expect(() => report?.([{ table: 'notes', key: 'late' }])).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toEqual([])
  })
})
