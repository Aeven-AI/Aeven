/**
 * Calendar boundaries and the bounded backward walk: month ends, leap days,
 * quarter starts, daylight-saving transitions, and how far behind the current
 * local day each kind searches for the latest due occurrence.
 */
import { describe, expect, it } from 'vitest'
import { latestDueOccurrence, nextOccurrence } from '../src/recurrence.ts'
import type { AutomationSchedule } from '../src/types.ts'

describe('calendar boundaries', () => {
  it('skips a month that lacks the named month day and finds the previous one behind it', () => {
    const endOfMonth: AutomationSchedule = { kind: 'monthly', time: '10:00', days: [31], timeZone: 'UTC' }
    // February never matches, so the February-first scan lands on March 31.
    expect(nextOccurrence(endOfMonth, '2026-02-01T00:00:00.000Z')).toBe('2026-03-31T10:00:00.000Z')
    expect(nextOccurrence(endOfMonth, '2026-04-02T00:00:00.000Z')).toBe('2026-05-31T10:00:00.000Z')
    // April has no 31st, so March 31 is the latest due occurrence in early May.
    expect(latestDueOccurrence(endOfMonth, '2026-05-01T00:00:00.000Z')).toBe('2026-03-31T10:00:00.000Z')
  })

  it('measures the month-end gap the backward walk has to cross', () => {
    const endOfMonth: AutomationSchedule = { kind: 'monthly', time: '10:00', days: [31], timeZone: 'UTC' }
    // March 31 to May 31 is the longest gap for this schedule: 61 days.
    expect(latestDueOccurrence(endOfMonth, '2026-06-01T00:00:00.000Z')).toBe('2026-05-31T10:00:00.000Z')
    expect(nextOccurrence(endOfMonth, '2026-05-31T10:00:00.000Z')).toBe('2026-07-31T10:00:00.000Z')
  })

  it('fires a quarter start on the first of each quarter month', () => {
    const quarterStart: AutomationSchedule = { kind: 'monthly', time: '00:00', days: [1], timeZone: 'UTC' }
    expect(nextOccurrence(quarterStart, '2026-11-02T00:00:00.000Z')).toBe('2026-12-01T00:00:00.000Z')
    expect(latestDueOccurrence(quarterStart, '2026-11-02T00:00:00.000Z')).toBe('2026-11-01T00:00:00.000Z')
    const yearly: AutomationSchedule = { kind: 'yearly', time: '00:00', month: 1, day: 1, timeZone: 'UTC' }
    expect(nextOccurrence(yearly, '2026-10-23T19:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z')
  })

  it('does not fire on a fifth named weekday of a month', () => {
    const fourthMonday: AutomationSchedule = { kind: 'nth-weekday', time: '09:00', week: 4, weekday: 'MO', timeZone: 'UTC' }
    // March 2026 has Mondays on the 2nd, 9th, 16th, 23rd and 30th; the 30th is a fifth Monday.
    expect(nextOccurrence(fourthMonday, '2026-03-01T00:00:00.000Z')).toBe('2026-03-23T09:00:00.000Z')
    expect(latestDueOccurrence(fourthMonday, '2026-03-31T00:00:00.000Z')).toBe('2026-03-23T09:00:00.000Z')
  })

  it('reaches a leap day in the forward scan and inside the backward window', () => {
    const leapDay: AutomationSchedule = { kind: 'yearly', time: '12:00', month: 2, day: 29, timeZone: 'UTC' }
    expect(nextOccurrence(leapDay, '2026-03-01T00:00:00.000Z')).toBe('2028-02-29T12:00:00.000Z')
    expect(nextOccurrence(leapDay, '2028-03-01T00:00:00.000Z')).toBe('2032-02-29T12:00:00.000Z')
    expect(latestDueOccurrence(leapDay, '2028-06-01T00:00:00.000Z')).toBe('2028-02-29T12:00:00.000Z')
  })

  it('stops the yearly backward walk at 400 days, shorter than a leap-day gap', () => {
    const leapDay: AutomationSchedule = { kind: 'yearly', time: '12:00', month: 2, day: 29, timeZone: 'UTC' }
    // A leap day is more than 400 days behind the following year, so between leap
    // years the walk reports nothing rather than reaching it.
    expect(latestDueOccurrence(leapDay, '2029-05-01T00:00:00.000Z')).toBeNull()
    // The window counts whole local days back from today, so the 400th day back is
    // still searched and the next one is not.
    expect(latestDueOccurrence(leapDay, '2029-04-04T11:59:59.000Z')).toBe('2028-02-29T12:00:00.000Z')
    expect(latestDueOccurrence(leapDay, '2029-04-04T23:59:59.000Z')).toBe('2028-02-29T12:00:00.000Z')
    expect(latestDueOccurrence(leapDay, '2029-04-05T00:00:00.000Z')).toBeNull()
    // A yearly date every year stays inside the same window.
    const christmas: AutomationSchedule = { kind: 'yearly', time: '00:00', month: 12, day: 25, timeZone: 'UTC' }
    expect(latestDueOccurrence(christmas, '2026-12-26T00:00:00.000Z')).toBe('2026-12-25T00:00:00.000Z')
  })

  it('reaches yesterday for a late daily wall time', () => {
    const late: AutomationSchedule = { kind: 'daily', time: '23:00', timeZone: 'UTC' }
    expect(latestDueOccurrence(late, '2026-03-02T00:30:00.000Z')).toBe('2026-03-01T23:00:00.000Z')
  })

  it('crosses a full week for a single-weekday schedule', () => {
    const friday: AutomationSchedule = { kind: 'weekly', time: '08:00', weekdays: ['FR'], timeZone: 'UTC' }
    // Thursday the 12th is six days after the previous Friday.
    expect(latestDueOccurrence(friday, '2026-03-12T23:59:00.000Z')).toBe('2026-03-06T08:00:00.000Z')
    expect(nextOccurrence(friday, '2026-03-12T23:59:00.000Z')).toBe('2026-03-13T08:00:00.000Z')
  })

  it('terminates the bounded backward walk of a cron schedule whose day fields can never agree', () => {
    // February never has a 31st, so the walk exhausts its window and reports nothing.
    const impossible: AutomationSchedule = { kind: 'cron', expression: '0 0 31 2 *', timeZone: 'UTC' }
    expect(latestDueOccurrence(impossible, '2026-06-01T00:00:00.000Z')).toBeNull()
  })

  it('follows the zone offset across a daylight-saving change', () => {
    const newYork: AutomationSchedule = { kind: 'daily', time: '09:00', timeZone: 'America/New_York' }
    expect(nextOccurrence(newYork, '2026-01-10T00:00:00.000Z')).toBe('2026-01-10T14:00:00.000Z')
    expect(nextOccurrence(newYork, '2026-07-10T00:00:00.000Z')).toBe('2026-07-10T13:00:00.000Z')
  })

  it('skips a wall time the spring-forward hour erases', () => {
    const erased: AutomationSchedule = { kind: 'daily', time: '02:30', timeZone: 'America/New_York' }
    // 2026-03-08 02:30 does not exist in New York, so the day holds no occurrence.
    expect(nextOccurrence(erased, '2026-03-07T12:00:00.000Z')).toBe('2026-03-09T06:30:00.000Z')
    expect(latestDueOccurrence(erased, '2026-03-08T23:00:00.000Z')).toBe('2026-03-07T07:30:00.000Z')
  })

  it('resolves a wall time repeated by the fall-back hour to its first instant', () => {
    const repeated: AutomationSchedule = { kind: 'daily', time: '01:30', timeZone: 'America/New_York' }
    // 2026-11-01 01:30 happens twice; the schedule fires once, on the first.
    expect(nextOccurrence(repeated, '2026-10-31T12:00:00.000Z')).toBe('2026-11-01T05:30:00.000Z')
    expect(latestDueOccurrence(repeated, '2026-11-01T12:00:00.000Z')).toBe('2026-11-01T05:30:00.000Z')
  })
})
