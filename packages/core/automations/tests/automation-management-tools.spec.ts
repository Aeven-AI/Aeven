/**
 * The model-facing management tools: the definitions a root conversation
 * receives, the schedule vocabulary each one advertises, and what an argument
 * for one of the new kinds does when it reaches the durable service.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { JsonValue } from '@aeven/util-values'
import type { AutomationSchedule } from '../src/types.ts'
import { createAutomation, installManagementTools, listAutomations, mountAutomations } from './harness.ts'
import type { AutomationHarness, AutomationList } from './harness.ts'

const harnesses: AutomationHarness[] = []
const toolDisposers: (() => void)[] = []

/** The advertised schedule object, as the tool surface publishes it. */
interface ScheduleProperties {
  additionalProperties: boolean
  properties: Record<string, unknown>
  required: string[]
}

afterEach(async () => {
  for (const dispose of toolDisposers.splice(0)) dispose()
  await Promise.all(harnesses.splice(0).map(harness => harness.dispose()))
})

/** Mount one Host with the management tools installed on a stand-in root conversation. */
async function mount(): Promise<AutomationHarness> {
  const harness = await mountAutomations()
  harnesses.push(harness)
  toolDisposers.push(installManagementTools(harness))
  return harness
}

/** Resolve one advertised tool, failing loudly when the surface dropped it. */
function tool(harness: AutomationHarness, name: string) {
  const definition = harness.tools.get(name)
  if (definition === undefined) throw new Error(`expected the ${name} tool to be registered`)
  return definition
}

/** Call one tool body as the executor would, with an unaborted signal. */
function call(harness: AutomationHarness, name: string, args: unknown): Promise<unknown> {
  return tool(harness, name).execute(args, { signal: new AbortController().signal } as never)
}

describe('automation management tools', () => {
  it('publishes the five management tools and removes them on disposal', async () => {
    const harness = await mount()
    expect([...harness.tools.registered.keys()]).toEqual([
      'automation_create', 'automation_list', 'automation_update', 'automation_run_now', 'automation_retry',
    ])
    for (const dispose of toolDisposers.splice(0)) dispose()
    expect([...harness.tools.registered.keys()]).toEqual([])
  })

  it('advertises every schedule kind on create, with the field each one reads', async () => {
    const harness = await mount()
    const parameters = tool(harness, 'automation_create').parameters as {
      additionalProperties: boolean
      properties: Record<string, unknown> & { schedule: ScheduleProperties }
      required: string[]
    }
    expect(parameters.required).toEqual(['name', 'prompt', 'schedule', 'permission'])
    expect(parameters.additionalProperties).toBe(false)
    const schedule = parameters.properties.schedule
    expect(schedule.required).toEqual(['kind', 'timeZone'])
    expect(schedule.additionalProperties).toBe(false)
    expect(schedule.properties.kind).toEqual({
      type: 'string',
      enum: ['once', 'interval', 'hours', 'daily', 'weekly', 'monthly', 'nth-weekday', 'yearly', 'cron'],
    })
    // One field per new kind, each stating what it does in the model's words.
    expect(schedule.properties.everyHours).toEqual({
      type: 'integer', minimum: 1, maximum: 24, description: 'Hours between runs, counted from local midnight, for hours.',
    })
    expect(schedule.properties.atMinute).toEqual({
      type: 'integer', minimum: 0, maximum: 59, description: 'Minute past the hour, for hours.',
    })
    expect(schedule.properties.days).toEqual({
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 31 },
      description: 'Days of the month, for monthly; a month without the day is skipped.',
    })
    expect(schedule.properties.week).toEqual({
      type: 'integer', enum: [1, 2, 3, 4], description: 'Which weekday of the month, for nth-weekday.',
    })
    expect(schedule.properties.weekday).toEqual({
      type: 'string',
      enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
      description: 'Weekday of the month, for nth-weekday.',
    })
    expect(schedule.properties.month).toEqual({
      type: 'integer', minimum: 1, maximum: 12, description: 'Month of the year, for yearly.',
    })
    expect(schedule.properties.day).toEqual({
      type: 'integer', minimum: 1, maximum: 31, description: 'Day of that month, for yearly.',
    })
    expect(schedule.properties.expression).toEqual({
      type: 'string',
      description: 'Five-field cron expression (minute, hour, day of month, month, day of week) for cron.',
    })
    expect(schedule.properties.time).toEqual({
      type: 'string', description: 'Local HH:mm for hours, daily, weekly, monthly, nth-weekday, and yearly.',
    })
    expect(schedule.properties.until).toEqual({
      type: 'string', description: 'Optional inclusive ISO end time. Omit for a recurring task without an end date.',
    })
  })

  it('offers the same schedule vocabulary to update, and the pause status', async () => {
    const harness = await mount()
    const parameters = tool(harness, 'automation_update').parameters as {
      properties: Record<string, unknown> & { schedule: { properties: Record<string, { enum?: unknown }> } }
      required: string[]
    }
    expect(parameters.required).toEqual(['id'])
    expect(parameters.properties.schedule.properties.kind?.enum).toEqual([
      'once', 'interval', 'hours', 'daily', 'weekly', 'monthly', 'nth-weekday', 'yearly', 'cron',
    ])
    expect(parameters.properties.schedule.properties.expression).toEqual({
      type: 'string',
      description: 'Five-field cron expression (minute, hour, day of month, month, day of week) for cron.',
    })
    expect(parameters.properties.status).toEqual({ type: 'string', enum: ['active', 'paused'] })
    expect(parameters.properties.id).toEqual({ type: 'string' })
  })

  it('keeps the retry argument named as an earlier run, not an automation', async () => {
    const harness = await mount()
    const parameters = tool(harness, 'automation_retry').parameters as {
      properties: Record<string, { description?: string }>
      required: string[]
    }
    expect(parameters.required).toEqual(['id'])
    expect(parameters.properties.id?.description).toBe('Earlier run ID, not the automation ID.')
  })

  it('states the create guidance the model reads while turning a request into a task', async () => {
    const harness = await mount()
    expect(tool(harness, 'automation_create').description).toBe(
      'Create a built-in automation after human confirmation. Translate the user’s request into a self-contained task and explicit local schedule. Ask only for missing requirements. Future runs start fresh conversations with this account’s capabilities. An external action that needs approval asks the user in the run conversation; once the user approves it there, later runs perform it without asking.',
    )
    expect(tool(harness, 'automation_update').description).toBe(
      'Adjust a task, schedule, or file permissions after confirmation, or pause an automation immediately. Omitted fields remain unchanged.',
    )
    expect(tool(harness, 'automation_list').description).toBe(
      'List this account’s automations and recent run history. Use the stable IDs for subsequent changes.',
    )
  })

  it('creates one automation per new kind and stores the schedule it was given', async () => {
    const harness = await mount()
    const schedules: AutomationSchedule[] = [
      { kind: 'hours', everyHours: 3, atMinute: 10, timeZone: 'Europe/Amsterdam' },
      { kind: 'monthly', time: '07:00', days: [15, 28], timeZone: 'Europe/Amsterdam' },
      { kind: 'nth-weekday', time: '07:00', week: 4, weekday: 'MO', timeZone: 'Europe/Amsterdam' },
      { kind: 'yearly', time: '07:00', month: 12, day: 25, timeZone: 'Europe/Amsterdam' },
      { kind: 'cron', expression: '30 6 * * 1-5', timeZone: 'Europe/Amsterdam' },
    ]
    for (const [index, schedule] of schedules.entries()) {
      const created = await call(harness, 'automation_create', {
        name: `Kind ${String(index)}`,
        prompt: 'Do the scheduled work and report the evidence.',
        schedule,
        permission: 'read-only',
      }) as { schedule: AutomationSchedule; status: string; revision: number }
      expect(created.schedule).toEqual(schedule)
      expect(created.status).toBe('active')
      expect(created.revision).toBe(1)
    }
    const listed = await listAutomations(harness)
    // The projection lists the most recently changed definition first.
    expect(listed.definitions.map(definition => definition.schedule.kind))
      .toEqual(['cron', 'yearly', 'nth-weekday', 'monthly', 'hours'])
    // Each definition also states when it next runs, so the model can read the cadence back.
    for (const definition of listed.definitions) expect(typeof definition.nextRunAt).toBe('string')
  })

  it('rejects an argument the schedule cannot evaluate before storing anything', async () => {
    const harness = await mount()
    const base = { name: 'Broken', prompt: 'Work.', permission: 'read-only' }
    await expect(call(harness, 'automation_create', { ...base, schedule: { kind: 'cron', expression: '0 6 * *', timeZone: 'UTC' } }))
      .rejects.toThrow(/must have five fields/)
    await expect(call(harness, 'automation_create', { ...base, schedule: { kind: 'cron', expression: '30 6 * * 1-5', timeZone: 'Mars/Olympus' } }))
      .rejects.toThrow(/must be an explicit IANA zone/)
    await expect(call(harness, 'automation_create', { ...base, schedule: { kind: 'nth-weekday', time: '07:00', week: 5, weekday: 'MO', timeZone: 'UTC' } }))
      .rejects.toThrow()
    await expect(call(harness, 'automation_create', { ...base, schedule: { kind: 'monthly', time: '07:00', days: [], timeZone: 'UTC' } }))
      .rejects.toThrow()
    await expect(call(harness, 'automation_create', { ...base, schedule: { kind: 'yearly', time: '07:00', month: 2, day: 30, timeZone: 'UTC' } }))
      .rejects.toThrow(/yearly\.day/)
    await expect(call(harness, 'automation_create', { ...base, schedule: { kind: 'hours', everyHours: 3, atMinute: 10, timeZone: 'UTC' } }))
      .resolves.toBeDefined()
    expect((await listAutomations(harness)).definitions).toHaveLength(1)
  })

  it('adjusts a stored schedule to a new kind, leaving omitted fields unchanged', async () => {
    const harness = await mount()
    const definition = await createAutomation(harness, { name: 'Weekly sweep', prompt: 'Sweep the queue.', schedule: { kind: 'daily', time: '07:00', timeZone: 'UTC' } })
    const cron: AutomationSchedule = { kind: 'cron', expression: '0 7 * * 1', timeZone: 'UTC' }
    const updated = await call(harness, 'automation_update', { id: definition.id, schedule: cron }) as { schedule: AutomationSchedule; name: string; prompt: string; revision: number }
    expect(updated.schedule).toEqual(cron)
    expect(updated.name).toBe('Weekly sweep')
    expect(updated.prompt).toBe('Sweep the queue.')
    expect(updated.revision).toBe(2)

    const paused = await call(harness, 'automation_update', { id: definition.id, status: 'paused' }) as { status: string; schedule: AutomationSchedule; revision: number }
    expect(paused.status).toBe('paused')
    expect(paused.schedule).toEqual(cron)
    expect(paused.revision).toBe(3)
  })

  it('names the fields an update argument must and must not carry', async () => {
    const harness = await mount()
    const definition = await createAutomation(harness)
    await expect(call(harness, 'automation_update', { id: definition.id, schedule: { kind: 'cron', expression: '@daily', timeZone: 'UTC' } }))
      .rejects.toThrow(/must have five fields/)
    await expect(call(harness, 'automation_update', { id: definition.id, worker: 'remote' }))
      .rejects.toThrow()
    await expect(call(harness, 'automation_run_now', {})).rejects.toThrow()
    await expect(call(harness, 'automation_retry', {})).rejects.toThrow()
  })

  it('renders each result as one JSON text block', async () => {
    const harness = await mount()
    const definition = await createAutomation(harness)
    const listed = await call(harness, 'automation_list', {}) as AutomationList
    const render = tool(harness, 'automation_list').output.render?.bind(tool(harness, 'automation_list').output)
    // The tool's declared value is lossless JSON; the projection type only adds branded ids.
    expect(render?.({}, listed as unknown as JsonValue)).toEqual([{ type: 'text', text: JSON.stringify(listed) }])
    expect(listed.definitions[0]).toMatchObject({ id: definition.id })
  })
})
