/**
 * How many runs execute at once: each account has its own `maxConcurrentRunsPerAccount` slots on a Host, so an account
 * at its limit queues its next run while another account's run starts, and the queued run starts when one of its own
 * account's runs finishes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@aeven/session'
import type { AutomationRun } from '../src/types.ts'
import { mountAutomations, QUIET_SCHEDULE, waitFor, type AutomationHarness } from './harness.ts'

const harnesses: AutomationHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.dispose()))
})

/** Create one bot owned by an account and run it now as that account. */
async function runFor(harness: AutomationHarness, owner: string, name: string) {
  const agent = { ctx: harness.ctx, session: { id: SessionId(`root-${owner}`), header: { owner } } }
  return harness.ctx.identityUsers.runAs({ id: owner }, async () => {
    const created = await harness.automations.create({
      name, prompt: `Run ${name}.`, schedule: QUIET_SCHEDULE, permission: 'read-only',
    }, agent as never)
    return harness.automations.runNow(created.id)
  })
}

/** The status of each stored run by its bot's name, across every account. */
const statuses = async (harness: AutomationHarness) => Object.fromEntries(
  Object.values(harness.medium.table('automations', 'runs') as Record<string, AutomationRun>).map(run => [run.definition.name, run.status]),
)

describe('run concurrency', () => {
  it('gives each account its own slots on one Host', async () => {
    const harness = await mountAutomations({ maxConcurrentRunsPerAccount: 1 })
    harnesses.push(harness)
    harness.agents.holdEveryRun()
    await runFor(harness, 'alice', 'Alice first')
    await runFor(harness, 'alice', 'Alice second')
    await runFor(harness, 'bob', 'Bob first')
    const held = await waitFor(async () => {
      const now = await statuses(harness)
      return now['Bob first'] === 'running' && harness.agents.conversations.length === 2 ? now : undefined
    }, 'the other account\'s run')
    expect(held).toEqual({ 'Alice first': 'running', 'Alice second': 'queued', 'Bob first': 'running' })
    expect(harness.agents.conversations).toHaveLength(2)

    const done = await waitFor(async () => {
      // A run that starts after a release is held too, so each probe releases again.
      harness.agents.release()
      const now = await statuses(harness)
      return Object.values(now).every(status => status === 'succeeded') ? now : undefined
    }, 'every run finished')
    expect(Object.keys(done)).toHaveLength(3)
  })
})
