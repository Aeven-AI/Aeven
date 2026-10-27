/**
 * Merging learned procedures is maintenance over memory every device of an account shares: with account sync,
 * only the device holding the account's maintenance lease merges, and a device without sync always may.
 */
import { describe, expect, it, vi } from 'vitest'
import { MemorySyncNetwork } from '../../../sync/sync/tests/memory.ts'
import { CapabilityLearner, type LearnerConfig } from '../src/learner.ts'

const CONFIG: LearnerConfig = {
  minSteps: 1,
  timeoutMs: 5_000,
  maxOutputTokens: 4_000,
  maxInputTokens: 100_000,
  candidateTtlDays: 30,
  store: 'memory',
  consolidateAbove: 1,
  maintenanceTtlMs: 60_000,
  maintenanceRenewMs: 60_000,
}

function learner(sync: unknown): { learner: CapabilityLearner; procedures: ReturnType<typeof vi.fn> } {
  const procedures = vi.fn(() => Promise.resolve([]))
  const ctx = {
    logger: () => ({ info: vi.fn(), warn: vi.fn() }),
    get: (name: string) => (name === 'sync' ? sync : undefined),
    memory: { procedures },
  }
  return { learner: new CapabilityLearner(ctx as never, CONFIG), procedures }
}

const recent = { owner: 'owner', route: { provider: 'p', model: 'm' }, work: {} }

function consolidate(target: CapabilityLearner): void {
  (target as unknown as { consolidateWhenNeeded(recent: unknown, kinds: number): void }).consolidateWhenNeeded(recent, 5)
}

describe('procedure merging under account sync', () => {
  it('merges on the device that holds the maintenance lease and not on another', async () => {
    const network = new MemorySyncNetwork()
    const holder = learner(network.device().asSync())
    const other = learner(network.device().asSync())
    consolidate(holder.learner)
    expect(holder.procedures).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(network.leases.size).toBe(1) })
    consolidate(holder.learner)
    await vi.waitFor(() => { expect(holder.procedures).toHaveBeenCalledOnce() })
    consolidate(other.learner)
    await new Promise(resolve => setTimeout(resolve, 10))
    consolidate(other.learner)
    expect(other.procedures).not.toHaveBeenCalled()
    holder.learner.dispose()
    other.learner.dispose()
  })

  it('merges without account sync', async () => {
    const plain = learner(undefined)
    consolidate(plain.learner)
    await vi.waitFor(() => { expect(plain.procedures).toHaveBeenCalledOnce() })
    plain.learner.dispose()
  })
})
