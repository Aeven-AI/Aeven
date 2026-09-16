/**
 * Cross-process convergence over the real JSON backend: two independently
 * opened domains share one root, exactly as two harness processes share one
 * `~/.dsh`. These run on disk rather than the memory double because the
 * behavior under test is detection of another writer's bytes.
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '../src/index.ts'
import { defineDomain, domainTable } from '../src/index.ts'
import type { Domain } from '../src/domain.ts'
import type { DomainChanged } from '../src/events.ts'

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
    const root = await mkdtemp(join(tmpdir(), 'dsh-coherence-'))
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
    const root = await mkdtemp(join(tmpdir(), 'dsh-coherence-global-'))
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
    const root = await mkdtemp(join(tmpdir(), 'dsh-coherence-delete-'))
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
    const root = await mkdtemp(join(tmpdir(), 'dsh-coherence-self-'))
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
    const root = await mkdtemp(join(tmpdir(), 'dsh-coherence-invalid-'))
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
