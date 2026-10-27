/**
 * Automations across two devices of one account: a definition created on one device reaches the other, an
 * edit travels with a newer timestamp, a removal travels as a tombstone, and an occurrence that comes due is
 * admitted by one device of the account rather than by each of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@aeven/session'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import type { AutomationInput, AutomationSchedule } from '../src/types.ts'
import { advanceUntil, listAutomations, mountAutomations, QUIET_SCHEDULE } from './harness.ts'
import type { AutomationHarness } from './harness.ts'

/** The account both devices are signed in to. */
const OWNER = 'owner-1'
/** Every hour at :05, so one occurrence is five minutes after the fixed clock start. */
const HOURLY: AutomationSchedule = { kind: 'hours', everyHours: 1, atMinute: 5, timeZone: 'UTC' }
const START = '2026-06-01T00:00:00.000Z'

const harnesses: AutomationHarness[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(START))
})

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.dispose()))
  vi.useRealTimers()
})

/** A device of the account, signed in, sharing the account's sync network with its siblings. */
async function device(network: MemorySyncNetwork, sync: MemorySyncDevice) {
  const harness = await mountAutomations()
  harnesses.push(harness)
  harness.ctx.provide('sync', sync.asSync())
  harness.ctx.emit('sync/status', OWNER)
  return harness
}

/** Create one automation as the account's signed-in user on this device. */
function create(harness: AutomationHarness, overrides: Partial<AutomationInput> = {}) {
  const agent = { ctx: harness.ctx, session: { id: SessionId('definitions-sync-root'), header: { owner: OWNER } } }
  return harness.automations.create({
    name: 'Nightly report',
    prompt: 'Write the nightly report and verify its numbers.',
    schedule: QUIET_SCHEDULE,
    permission: 'read-only',
    ...overrides,
  }, agent as never)
}

const names = async (harness: AutomationHarness) => (await listAutomations(harness)).definitions.map(definition => definition.name)

describe('automation definitions across devices', () => {
  it('gives the account\'s other device a definition created here', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network, network.device())
    const b = await device(network, network.device())
    await create(a, { name: 'Weekly digest' })
    await advanceUntil(0, async () => (await names(b)).includes('Weekly digest') ? true : undefined, 'the definition on the second device')
    expect(await names(b)).toEqual(['Weekly digest'])
  })

  it('carries an edit, keeps the newer change, and removes the automation on every device', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network, network.device())
    const b = await device(network, network.device())
    const created = await create(a, { name: 'Weekly digest' })
    await advanceUntil(0, async () => (await names(b)).includes('Weekly digest') ? true : undefined, 'the definition on the second device')
    await a.automations.update(created.id, { name: 'Monthly digest' })
    await advanceUntil(0, async () => (await names(b)).includes('Monthly digest') ? true : undefined, 'the edit on the second device')
    await a.automations.remove(created.id)
    await advanceUntil(0, async () => (await names(b)).length === 0 ? true : undefined, 'the removal on the second device')
    expect(await names(a)).toEqual([])
  })

  it('admits one occurrence of a due automation, not one per device', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network, network.device())
    const b = await device(network, network.device())
    await create(a, { schedule: HOURLY })
    await advanceUntil(0, async () => (await names(b)).includes('Nightly report') ? true : undefined, 'the definition on the second device')
    const scheduled = async () => {
      const runs = [...(await listAutomations(a)).runs, ...(await listAutomations(b)).runs]
      const admitted = runs.filter(run => run.trigger === 'schedule')
      return admitted.length > 0 ? admitted : undefined
    }
    const admitted = await advanceUntil(5 * 60_000 + 1, scheduled, 'the scheduled run')
    // Both devices hold the definition and both timers fire; the account's lease lets one admit.
    expect(admitted).toHaveLength(1)
    expect(admitted[0]?.scheduledFor).toBe('2026-06-01T00:05:00.000Z')
  })
})
