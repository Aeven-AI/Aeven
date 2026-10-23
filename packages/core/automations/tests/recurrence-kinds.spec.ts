/**
 * Every schedule kind the Host evaluates, through the two exported lookups:
 * the first occurrence strictly after an instant, and the latest occurrence at
 * or before one.
 */
import { describe, expect, it } from 'vitest'
import { latestDueOccurrence, nextOccurrence, SCHEDULE_KINDS } from '../src/recurrence.ts'
import type { AutomationSchedule } from '../src/types.ts'

describe('schedule kinds', () => {
  it('lists the nine kinds in the order the management projection lists them', () => {
    expect(SCHEDULE_KINDS).toEqual(['once', 'interval', 'hours', 'daily', 'weekly', 'monthly', 'nth-weekday', 'yearly', 'cron'])
  })

  it('fires a one-time occurrence once, strictly after an earlier instant', () => {
    const once: AutomationSchedule = { kind: 'once', at: '2026-03-01T10:00:00.000Z', timeZone: 'UTC' }
    expect(nextOccurrence(once, '2026-02-28T00:00:00.000Z')).toBe('2026-03-01T10:00:00.000Z')
    expect(nextOccurrence(once, '2026-03-01T10:00:00.000Z')).toBeNull()
    expect(latestDueOccurrence(once, '2026-03-01T09:59:59.000Z')).toBeNull()
    expect(latestDueOccurrence(once, '2026-03-01T10:00:00.000Z')).toBe('2026-03-01T10:00:00.000Z')
    // The result is the UTC instant, whatever offset the caller passed in.
    expect(latestDueOccurrence(once, '2026-03-01T13:00:00+02:00')).toBe('2026-03-01T10:00:00.000Z')
  })

  it('counts an interval from its anchor, so the anchor itself is not a run', () => {
    const interval: AutomationSchedule = { kind: 'interval', everyMinutes: 30, anchor: '2026-01-01T00:00:00.000Z', timeZone: 'UTC' }
    expect(nextOccurrence(interval, '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:30:00.000Z')
    expect(nextOccurrence(interval, '2026-01-01T00:44:00.000Z')).toBe('2026-01-01T01:00:00.000Z')
    expect(latestDueOccurrence(interval, '2026-01-01T00:29:00.000Z')).toBeNull()
    expect(latestDueOccurrence(interval, '2026-01-01T00:44:00.000Z')).toBe('2026-01-01T00:30:00.000Z')
  })

  it('walks hour countdowns from local midnight at the chosen minute', () => {
    const hours: AutomationSchedule = { kind: 'hours', everyHours: 6, atMinute: 15, timeZone: 'UTC' }
    expect(nextOccurrence(hours, '2026-03-02T00:00:00.000Z')).toBe('2026-03-02T00:15:00.000Z')
    expect(nextOccurrence(hours, '2026-03-02T06:15:00.000Z')).toBe('2026-03-02T12:15:00.000Z')
    expect(latestDueOccurrence(hours, '2026-03-02T06:14:00.000Z')).toBe('2026-03-02T00:15:00.000Z')
    expect(latestDueOccurrence(hours, '2026-03-02T06:15:00.000Z')).toBe('2026-03-02T06:15:00.000Z')
  })

  it('starts the hour countdown at midnight, so a stride that does not divide a day restarts there', () => {
    const everyFive: AutomationSchedule = { kind: 'hours', everyHours: 5, atMinute: 0, timeZone: 'UTC' }
    // Midnight, 05:00, 10:00, 15:00, 20:00, then midnight again rather than 25:00.
    expect(nextOccurrence(everyFive, '2026-03-02T20:00:00.000Z')).toBe('2026-03-03T00:00:00.000Z')
    const daily: AutomationSchedule = { kind: 'hours', everyHours: 24, atMinute: 59, timeZone: 'UTC' }
    expect(nextOccurrence(daily, '2026-03-02T00:00:00.000Z')).toBe('2026-03-02T00:59:00.000Z')
    expect(nextOccurrence(daily, '2026-03-02T00:59:00.000Z')).toBe('2026-03-03T00:59:00.000Z')
  })

  it('reads a daily wall time in the schedule zone, not the Host zone', () => {
    const tokyo: AutomationSchedule = { kind: 'daily', time: '09:30', timeZone: 'Asia/Tokyo' }
    expect(nextOccurrence(tokyo, '2026-03-01T12:00:00.000Z')).toBe('2026-03-02T00:30:00.000Z')
    expect(latestDueOccurrence(tokyo, '2026-03-02T00:29:00.000Z')).toBe('2026-03-01T00:30:00.000Z')
    const late: AutomationSchedule = { kind: 'daily', time: '23:00', timeZone: 'UTC' }
    expect(latestDueOccurrence(late, '2026-03-02T00:30:00.000Z')).toBe('2026-03-01T23:00:00.000Z')
    expect(latestDueOccurrence(late, '2026-03-02T22:59:00.000Z')).toBe('2026-03-01T23:00:00.000Z')
  })

  it('keeps weekly to the selected weekdays, normalizing their order', () => {
    const weekly: AutomationSchedule = { kind: 'weekly', time: '08:00', weekdays: ['FR', 'MO'], timeZone: 'UTC' }
    // 2026-03-04 is a Wednesday; the next selected day is Friday.
    expect(nextOccurrence(weekly, '2026-03-04T12:00:00.000Z')).toBe('2026-03-06T08:00:00.000Z')
    expect(latestDueOccurrence(weekly, '2026-03-07T12:00:00.000Z')).toBe('2026-03-06T08:00:00.000Z')
    expect(latestDueOccurrence(weekly, '2026-03-09T07:59:00.000Z')).toBe('2026-03-06T08:00:00.000Z')
  })

  it('fires monthly on the named days and skips a month that lacks one', () => {
    const monthly: AutomationSchedule = { kind: 'monthly', time: '10:00', days: [1, 15], timeZone: 'UTC' }
    expect(nextOccurrence(monthly, '2026-01-20T00:00:00.000Z')).toBe('2026-02-01T10:00:00.000Z')
    expect(latestDueOccurrence(monthly, '2026-02-20T00:00:00.000Z')).toBe('2026-02-15T10:00:00.000Z')
    const onlyThirtyFirst: AutomationSchedule = { kind: 'monthly', time: '10:00', days: [31], timeZone: 'UTC' }
    expect(nextOccurrence(onlyThirtyFirst, '2026-02-01T00:00:00.000Z')).toBe('2026-03-31T10:00:00.000Z')
  })

  it('counts an nth weekday from the first of the month', () => {
    const secondTuesday: AutomationSchedule = { kind: 'nth-weekday', time: '09:00', week: 2, weekday: 'TU', timeZone: 'UTC' }
    expect(nextOccurrence(secondTuesday, '2026-03-01T00:00:00.000Z')).toBe('2026-03-10T09:00:00.000Z')
    expect(nextOccurrence(secondTuesday, '2026-03-11T00:00:00.000Z')).toBe('2026-04-14T09:00:00.000Z')
    expect(latestDueOccurrence(secondTuesday, '2026-04-01T00:00:00.000Z')).toBe('2026-03-10T09:00:00.000Z')
    const firstSunday: AutomationSchedule = { kind: 'nth-weekday', time: '09:00', week: 1, weekday: 'SU', timeZone: 'UTC' }
    expect(nextOccurrence(firstSunday, '2026-03-02T00:00:00.000Z')).toBe('2026-04-05T09:00:00.000Z')
  })

  it('fires yearly on its month and day, including a leap day', () => {
    const leapDay: AutomationSchedule = { kind: 'yearly', time: '12:00', month: 2, day: 29, timeZone: 'UTC' }
    expect(nextOccurrence(leapDay, '2026-03-01T00:00:00.000Z')).toBe('2028-02-29T12:00:00.000Z')
    const newYear: AutomationSchedule = { kind: 'yearly', time: '00:00', month: 1, day: 1, timeZone: 'UTC' }
    expect(nextOccurrence(newYear, '2026-12-31T23:59:00.000Z')).toBe('2027-01-01T00:00:00.000Z')
    expect(latestDueOccurrence(newYear, '2026-12-31T23:59:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('reads a five-field cron expression in the schedule zone', () => {
    const weekdays: AutomationSchedule = { kind: 'cron', expression: '*/15 9-17 * * 1-5', timeZone: 'UTC' }
    expect(nextOccurrence(weekdays, '2026-03-06T09:00:00.000Z')).toBe('2026-03-06T09:15:00.000Z')
    // 2026-03-06 is a Friday; the next matching instant is Monday morning.
    expect(nextOccurrence(weekdays, '2026-03-06T17:45:00.000Z')).toBe('2026-03-09T09:00:00.000Z')
    expect(latestDueOccurrence(weekdays, '2026-03-07T12:00:00.000Z')).toBe('2026-03-06T17:45:00.000Z')
  })

  it('evaluates one local wall time differently in each named IANA zone', () => {
    const at = '2026-01-10T00:00:00.000Z'
    const zone = (timeZone: string): AutomationSchedule => ({ kind: 'daily', time: '09:00', timeZone })
    expect(nextOccurrence(zone('Asia/Tokyo'), at)).toBe('2026-01-11T00:00:00.000Z')
    expect(nextOccurrence(zone('America/New_York'), at)).toBe('2026-01-10T14:00:00.000Z')
    expect(nextOccurrence(zone('UTC'), at)).toBe('2026-01-10T09:00:00.000Z')
  })

  it('stops both lookups at an inclusive end instant', () => {
    const daily: AutomationSchedule = { kind: 'daily', time: '09:00', timeZone: 'UTC', until: '2026-03-05T23:59:59.000Z' }
    expect(nextOccurrence(daily, '2026-03-04T10:00:00.000Z')).toBe('2026-03-05T09:00:00.000Z')
    expect(nextOccurrence(daily, '2026-03-05T10:00:00.000Z')).toBeNull()
    // A Host that wakes after the end time still reports the last ordered occurrence.
    expect(latestDueOccurrence(daily, '2026-03-10T00:00:00.000Z')).toBe('2026-03-05T09:00:00.000Z')
  })
})
