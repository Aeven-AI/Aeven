/**
 * Where a bot runs when its owner chooses: Aeven Cloud, or one desktop of the account. A bot placed on one desktop
 * runs there and nowhere else, an explicit cloud choice never falls back to a desktop, a choice that cannot place the
 * bot is refused when it is saved, a new choice replaces the desktop, the bots page lists the account's desktops with
 * what each offers, and a desktop that was off at the scheduled instant records the occurrence as missed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@aeven/session'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import { eligibility, placementRefusal, resolvePlacement } from '../src/placement.ts'
import type { AutomationInput, AutomationSchedule, HostDevice, HostProfile } from '../src/types.ts'
import { advanceUntil, listAutomations, mountAutomations, QUIET_SCHEDULE, type AutomationHarness } from './harness.ts'

/** The account every device is signed in to. */
const OWNER = 'owner-1'
/** Every hour at :05, so one occurrence is five minutes after the fixed clock start. */
const HOURLY: AutomationSchedule = { kind: 'hours', everyHours: 1, atMinute: 5, timeZone: 'UTC' }
const START = '2026-06-01T00:00:00.000Z'

const device = (id: string) => id as HostDevice
const DESKTOP_A: HostProfile = { kind: 'device', provides: ['files', 'browser', 'computer-use'], device: device('a') }
const DESKTOP_B: HostProfile = { kind: 'device', provides: ['files'], device: device('b') }
const CLOUD: HostProfile = { kind: 'cloud', provides: [] }

describe('placement rules', () => {
  it('runs a bot placed on one desktop only on that desktop', () => {
    const placed = { requires: ['files'] as const, runOn: 'device' as const, desktop: device('b') }
    expect(eligibility({ ...placed, requires: ['files'] }, DESKTOP_B)).toBe('preferred')
    expect(eligibility({ ...placed, requires: ['files'] }, DESKTOP_A)).toBe('never')
    expect(eligibility({ ...placed, requires: ['files'] }, CLOUD)).toBe('never')
    expect(resolvePlacement({ ...placed, requires: ['files'] }, [DESKTOP_A, CLOUD])).toEqual({ runsOn: 'device', available: false })
    expect(resolvePlacement({ ...placed, requires: ['files'] }, [DESKTOP_A, DESKTOP_B])).toEqual({ runsOn: 'device', available: true })
  })

  it('keeps an explicit cloud bot off every desktop, while an automatic one falls back', () => {
    expect(eligibility({ requires: [], runOn: 'cloud' }, CLOUD)).toBe('preferred')
    expect(eligibility({ requires: [], runOn: 'cloud' }, DESKTOP_A)).toBe('never')
    expect(eligibility({ requires: [], runOn: 'auto' }, DESKTOP_A)).toBe('fallback')
    expect(resolvePlacement({ requires: [], runOn: 'cloud' }, [DESKTOP_A])).toEqual({ runsOn: 'cloud', available: false })
    expect(resolvePlacement({ requires: [], runOn: 'auto' }, [DESKTOP_A])).toEqual({ runsOn: 'device', available: true })
  })

  it('refuses a choice that cannot place the bot', () => {
    expect(placementRefusal({ requires: ['files'], runOn: 'cloud' }, [CLOUD])).toMatch('cannot run in Aeven Cloud')
    expect(placementRefusal({ requires: [], runOn: 'auto', desktop: device('a') }, [DESKTOP_A])).toMatch('only for a bot that runs on a desktop')
    expect(placementRefusal({ requires: ['browser'], runOn: 'device', desktop: device('b') }, [DESKTOP_B])).toMatch('cannot give this bot browser')
    expect(placementRefusal({ requires: ['files'], runOn: 'device', desktop: device('b') }, [DESKTOP_B])).toBeUndefined()
    // A desktop that has not registered a Host yet is accepted; it runs the bot once it registers one that can.
    expect(placementRefusal({ requires: ['browser'], runOn: 'device', desktop: device('c') }, [DESKTOP_B])).toBeUndefined()
    expect(placementRefusal({ requires: [], runOn: 'cloud' }, [DESKTOP_A])).toBeUndefined()
  })
})

const harnesses: AutomationHarness[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(START))
})

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(harness => harness.dispose()))
  vi.useRealTimers()
})

/** A Host of the account, signed in to account sync. */
async function host(sync: MemorySyncDevice, profile: Partial<HostProfile> = {}) {
  const harness = await mountAutomations(profile.kind === 'cloud'
    ? { placement: { kind: 'cloud', provides: [] } }
    : profile.provides === undefined ? {} : { placement: { kind: 'device', provides: [...profile.provides] } })
  harnesses.push(harness)
  harness.ctx.provide('sync', sync.asSync())
  harness.ctx.emit('sync/status', OWNER)
  return harness
}

/** Create one automation as the account's signed-in user on this Host. */
function create(harness: AutomationHarness, overrides: Partial<AutomationInput> = {}) {
  const agent = { ctx: harness.ctx, session: { id: SessionId('bot-placement-root'), header: { owner: OWNER } } }
  return harness.automations.create({
    name: 'Nightly report',
    prompt: 'Write the nightly report and verify its numbers.',
    schedule: QUIET_SCHEDULE,
    permission: 'read-only',
    ...overrides,
  }, agent as never)
}

/** Wait until a Host has received a definition from another device of the account. */
const received = (harness: AutomationHarness, name: string) =>
  advanceUntil(0, async () => (await listAutomations(harness)).definitions.some(definition => definition.name === name) ? true : undefined, `${name} on the other device`)

/** Wait until a Host lists a given number of registered Hosts for the account. */
const registered = (harness: AutomationHarness, count: number) =>
  advanceUntil(0, async () => {
    const hosts = (harness.automations as unknown as { synced: { hosts(owner: string): HostProfile[] } }).synced.hosts(OWNER)
    return hosts.length === count && hosts.every(profile => profile.kind === 'cloud' || profile.device !== undefined) ? hosts : undefined
  }, `${String(count)} registered Hosts`)

const scheduledRuns = async (harness: AutomationHarness) => (await listAutomations(harness)).runs.filter(run => run.trigger === 'schedule')

describe('bots placed by their owner', () => {
  it('runs a bot placed on one desktop there, not on the desktop that created it', async () => {
    const network = new MemorySyncNetwork()
    const syncA = network.device()
    const syncB = network.device()
    const a = await host(syncA)
    const b = await host(syncB)
    await registered(a, 2)
    const created = await create(a, { schedule: HOURLY, requires: ['files'], runOn: 'device', desktop: syncB.id })
    expect(created.desktop).toBe(syncB.id)
    await received(b, created.name)
    const admitted = await advanceUntil(5 * 60_000 + 1, async () => {
      const runs = await scheduledRuns(b)
      return runs.length > 0 ? runs : undefined
    }, 'the scheduled run on the chosen desktop')
    expect(admitted).toHaveLength(1)
    await advanceUntil(0, async () => b.agents.conversations.length === 1 ? true : undefined, 'the run conversation on the chosen desktop')
    expect(a.agents.conversations).toHaveLength(0)
    await expect(a.automations.runNow(created.id)).rejects.toThrow('cannot run on this computer')
    const manual = await b.automations.runNow(created.id)
    expect(manual.trigger).toBe('manual')
  })

  it('keeps an explicit cloud bot off the desktop while the cloud Host is away, and runs it there on return', async () => {
    const network = new MemorySyncNetwork()
    const desktop = await host(network.device())
    const cloudSync = network.device()
    const cloud = await host(cloudSync, { kind: 'cloud' })
    await registered(desktop, 2)
    const created = await create(desktop, { schedule: HOURLY, requires: [], runOn: 'cloud' })
    await received(cloud, created.name)
    cloudSync.setState('offline')
    // Past the occurrence and the desktop's fallback delay: an automatic cloud bot would run on the desktop by now.
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 120_000 + 60_000)
    expect(await scheduledRuns(desktop)).toEqual([])
    expect(desktop.agents.conversations).toHaveLength(0)
    const requested = await desktop.automations.runNow(created.id)
    expect(requested.status).toBe('queued')
    expect(desktop.agents.conversations).toHaveLength(0)
    cloudSync.setState('online')
    await advanceUntil(0, async () => (await listAutomations(desktop)).runs.find(run => run.id === requested.id && run.status === 'succeeded'), 'the cloud result')
    expect(cloud.agents.conversations.length).toBeGreaterThanOrEqual(1)
    expect(desktop.agents.conversations).toHaveLength(0)
  })

  it('refuses to save a choice that cannot run the bot', async () => {
    const network = new MemorySyncNetwork()
    const a = await host(network.device())
    const syncB = network.device()
    await host(syncB, { provides: [] })
    await registered(a, 2)
    await expect(create(a, { requires: ['files'], runOn: 'cloud' })).rejects.toThrow('cannot run in Aeven Cloud')
    await expect(create(a, { requires: [], runOn: 'auto', desktop: syncB.id })).rejects.toThrow('only for a bot that runs on a desktop')
    await expect(create(a, { requires: ['browser'], runOn: 'device', desktop: syncB.id })).rejects.toThrow('cannot give this bot browser')
    const created = await create(a, { requires: ['browser'] })
    await expect(a.automations.update(created.id, { runOn: 'device', desktop: syncB.id })).rejects.toThrow('cannot give this bot browser')
    expect((await listAutomations(a)).definitions.map(definition => definition.desktop)).toEqual([undefined])
  })

  it('replaces the desktop with a new choice and keeps it through other edits', async () => {
    const network = new MemorySyncNetwork()
    const a = await host(network.device())
    const elsewhere = device('device-elsewhere')
    const created = await create(a, { requires: [], runOn: 'device', desktop: elsewhere })
    const renamed = await a.automations.update(created.id, { name: 'Morning report' })
    expect(renamed).toMatchObject({ runOn: 'device', desktop: elsewhere })
    const moved = await a.automations.update(created.id, { runOn: 'cloud' })
    expect(moved.runOn).toBe('cloud')
    expect(moved.desktop).toBeUndefined()
    expect(a.medium.table('automations', 'definitions')[created.id]).not.toHaveProperty('desktop')
    const back = await a.automations.update(created.id, { runOn: 'device', desktop: elsewhere })
    expect(back.desktop).toBe(elsewhere)
    await expect(a.automations.update(created.id, { runOn: 'auto' })).resolves.not.toHaveProperty('desktop')
  })

  it('lists the account\'s desktops with what each offers bots, this desktop first', async () => {
    const network = new MemorySyncNetwork()
    const syncA = network.device()
    const syncB = network.device()
    const a = await host(syncA)
    await host(syncB, { provides: ['files'] })
    await host(network.device(), { kind: 'cloud' })
    await registered(a, 3)
    a.ctx.provide('sessionHandoff', {
      devicesOf: () => ({
        device: syncA.id, name: 'MacBook', alwaysOnHere: false,
        desktops: [
          { device: syncB.id, name: 'Ubuntu VM', present: false, seenAt: 1_000 },
          { device: 'device-old', name: 'Old laptop', present: true },
        ],
      }),
    } as never)
    const hosts = await a.ctx.identityUsers.runAs({ id: OWNER }, async () => (await listAutomations(a)).hosts)
    expect(hosts).toEqual({
      cloud: true,
      desktops: [
        { device: syncA.id, name: 'MacBook', present: true, self: true, provides: ['files', 'browser', 'computer-use'] },
        { device: syncB.id, name: 'Ubuntu VM', present: false, seenAt: 1_000, self: false, provides: ['files'] },
        { device: 'device-old', name: 'Old laptop', present: true, self: false, provides: undefined },
      ],
    })
  })

  it('records an occurrence as missed when the chosen desktop was off at its instant', async () => {
    const network = new MemorySyncNetwork()
    const a = await host(network.device())
    const syncB = network.device()
    const created = await create(a, { schedule: HOURLY, requires: [], runOn: 'device', desktop: syncB.id })
    // Past the occurrence and the fifteen-minute catch-up grace, with the chosen desktop not running.
    await vi.advanceTimersByTimeAsync(25 * 60_000)
    expect(await scheduledRuns(a)).toEqual([])
    const b = await host(syncB)
    await received(b, created.name)
    const missed = await advanceUntil(0, async () => {
      const runs = await scheduledRuns(b)
      return runs.length > 0 ? runs : undefined
    }, 'the missed occurrence on the chosen desktop')
    expect(missed).toHaveLength(1)
    expect(missed[0]).toMatchObject({ status: 'skipped', scheduledFor: '2026-06-01T00:05:00.000Z' })
    expect(missed[0]?.error).toMatch('unavailable')
    expect(b.agents.conversations).toHaveLength(0)
  })
})
