/**
 * The recurrence engine as the Host uses it: a stored schedule arms one timer for
 * its next occurrence, admits that occurrence as a run when the clock reaches it,
 * and records an occurrence the Host slept through instead of running it late.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun, AutomationSchedule } from '../src/types.ts'
import { advanceUntil, createAutomation, listAutomations, mountAutomations } from './harness.ts'
import type { AutomationHarness } from './harness.ts'

/** Every hour at :05, so one occurrence is five minutes after the fixed clock start. */
const HOURLY: AutomationSchedule = { kind: 'hours', everyHours: 1, atMinute: 5, timeZone: 'UTC' }

/** Clock instant each case starts from; the schedule above is read against it. */
const START = '2026-06-01T00:00:00.000Z'

let harness: AutomationHarness | undefined

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(START))
})

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
  vi.useRealTimers()
})

/** Read the first run the schedule admitted. */
async function scheduledRun(): Promise<AutomationRun | undefined> {
  return (await listAutomations(harness as AutomationHarness)).runs.find(run => run.trigger === 'schedule')
}

describe('scheduled admission', () => {
  it('projects the next occurrence of a stored schedule before any run', async () => {
    harness = await mountAutomations()
    await createAutomation(harness, { schedule: HOURLY })
    expect((await listAutomations(harness)).definitions[0]?.nextRunAt).toBe('2026-06-01T00:05:00.000Z')
    expect((await listAutomations(harness)).runs).toEqual([])
  })

  it('admits the occurrence when the clock reaches it and hands the run its task', async () => {
    harness = await mountAutomations()
    await createAutomation(harness, { schedule: HOURLY })
    const run = await advanceUntil(5 * 60_000 + 1, scheduledRun, 'the scheduled run')
    expect(run.scheduledFor).toBe('2026-06-01T00:05:00.000Z')
    expect(run.trigger).toBe('schedule')
    // The occurrence id is derived from the automation and its instant, so the same
    // occurrence cannot be admitted twice.
    expect(harness.agents.conversations).toHaveLength(1)
    const text = harness.agents.conversations[0]?.agent.sent[0]?.content[0]
    expect(text).toMatchObject({ type: 'text' })
    expect((text as { text: string }).text).toContain(`Run: ${run.id}`)
    expect((text as { text: string }).text).toContain('Scheduled for: 2026-06-01T00:05:00.000Z')
    // The admission advances the schedule to its next occurrence.
    expect((await listAutomations(harness)).definitions[0]?.nextRunAt).toBe('2026-06-01T01:05:00.000Z')
    expect((await listAutomations(harness)).definitions[0]?.lastAdmittedAt).toBe('2026-06-01T00:05:00.000Z')
  })

  it('records an occurrence it slept through as skipped instead of running it late', async () => {
    harness = await mountAutomations()
    await createAutomation(harness, { schedule: HOURLY })
    // The clock moves while no timer of this Host can run: the machine was off.
    vi.setSystemTime(new Date('2026-06-01T00:40:00.000Z'))
    const run = await advanceUntil(5 * 60_000 + 1, scheduledRun, 'the missed occurrence')
    expect(run.scheduledFor).toBe('2026-06-01T00:05:00.000Z')
    expect(run.status).toBe('skipped')
    expect(run.error).toBe('Missed while this computer was unavailable.')
    expect(run.finishedAt).not.toBeNull()
    // Nothing ran, so no conversation was opened for it.
    expect(harness.agents.conversations).toHaveLength(0)
    expect((await listAutomations(harness)).definitions[0]?.lastAdmittedAt).toBe('2026-06-01T00:05:00.000Z')
  })
})
