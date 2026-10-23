/**
 * Schedule rejection: the validation every recurrence path runs before it
 * reads or evaluates a schedule, and the diagnostic each refusal publishes.
 */
import { describe, expect, it } from 'vitest'
import { assertValidSchedule, nextOccurrence } from '../src/recurrence.ts'
import type { AutomationSchedule } from '../src/types.ts'

/** Assert one schedule is refused with the published message. */
function rejects(schedule: unknown, message: string): void {
  expect(() => { assertValidSchedule(schedule as AutomationSchedule) }).toThrow(new Error(message))
}

describe('schedule validation', () => {
  it('requires an explicit IANA time zone', () => {
    rejects(
      { kind: 'daily', time: '09:00', timeZone: 'Mars/Olympus' },
      "timeZone 'Mars/Olympus' must be an explicit IANA zone such as Asia/Shanghai",
    )
    rejects({ kind: 'daily', time: '09:00', timeZone: '' }, "timeZone '' must be an explicit IANA zone such as Asia/Shanghai")
    expect(() => { assertValidSchedule({ kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }) }).not.toThrow()
  })

  it('requires every instant to carry an offset', () => {
    rejects(
      { kind: 'once', at: '2026-03-01T10:00:00', timeZone: 'UTC' },
      'once.at must be an ISO-8601 instant with an explicit offset',
    )
    rejects(
      { kind: 'interval', everyMinutes: 10, anchor: '2026-01-01T00:00:00', timeZone: 'UTC' },
      'interval.anchor must be an ISO-8601 instant with an explicit offset',
    )
    rejects(
      { kind: 'daily', time: '09:00', timeZone: 'UTC', until: '2026-03-05T23:59:59' },
      'until must be an ISO-8601 instant with an explicit offset',
    )
    // The instant a lookup is anchored on is validated the same way.
    expect(() => nextOccurrence({ kind: 'daily', time: '09:00', timeZone: 'UTC' }, '2026-03-01T10:00:00'))
      .toThrow(new Error('afterExclusive must be an ISO-8601 instant with an explicit offset'))
  })

  it('refuses a one-time occurrence that ends before it starts', () => {
    rejects(
      { kind: 'once', at: '2026-03-01T10:00:00.000Z', timeZone: 'UTC', until: '2026-03-01T09:00:00.000Z' },
      'The end time precedes the one-time occurrence.',
    )
    // An end instant equal to the occurrence keeps it: the end is inclusive.
    const once: AutomationSchedule = { kind: 'once', at: '2026-03-01T10:00:00.000Z', timeZone: 'UTC', until: '2026-03-01T10:00:00.000Z' }
    expect(nextOccurrence(once, '2026-02-28T00:00:00.000Z')).toBe('2026-03-01T10:00:00.000Z')
    expect(nextOccurrence(once, '2026-03-01T10:00:00.000Z')).toBeNull()
  })

  it('keeps an interval at five minutes or more', () => {
    rejects({ kind: 'interval', everyMinutes: 4, anchor: '2026-01-01T00:00:00.000Z', timeZone: 'UTC' }, 'interval.everyMinutes must be an integer of at least 5')
    rejects({ kind: 'interval', everyMinutes: 7.5, anchor: '2026-01-01T00:00:00.000Z', timeZone: 'UTC' }, 'interval.everyMinutes must be an integer of at least 5')
    expect(() => { assertValidSchedule({ kind: 'interval', everyMinutes: 5, anchor: '2026-01-01T00:00:00.000Z', timeZone: 'UTC' }) }).not.toThrow()
  })

  it('bounds an hour countdown to a day and its minute to an hour', () => {
    rejects({ kind: 'hours', everyHours: 0, atMinute: 0, timeZone: 'UTC' }, 'hours.everyHours must be an integer from 1 through 24')
    rejects({ kind: 'hours', everyHours: 25, atMinute: 0, timeZone: 'UTC' }, 'hours.everyHours must be an integer from 1 through 24')
    rejects({ kind: 'hours', everyHours: 2, atMinute: 60, timeZone: 'UTC' }, 'hours.atMinute must be an integer from 0 through 59')
    rejects({ kind: 'hours', everyHours: 2, atMinute: -1, timeZone: 'UTC' }, 'hours.atMinute must be an integer from 0 through 59')
    expect(() => { assertValidSchedule({ kind: 'hours', everyHours: 24, atMinute: 59, timeZone: 'UTC' }) }).not.toThrow()
  })

  it('requires every calendar wall time in 24-hour HH:mm form', () => {
    const message = 'daily.time must use 24-hour HH:mm format'
    rejects({ kind: 'daily', time: '9:30', timeZone: 'UTC' }, message)
    rejects({ kind: 'daily', time: '24:00', timeZone: 'UTC' }, message)
    rejects({ kind: 'daily', time: '09:60', timeZone: 'UTC' }, message)
    rejects({ kind: 'daily', time: '09:00:00', timeZone: 'UTC' }, message)
    expect(() => { assertValidSchedule({ kind: 'daily', time: '23:59', timeZone: 'UTC' }) }).not.toThrow()
  })

  it('requires weekly days to be named once each', () => {
    rejects({ kind: 'weekly', time: '09:00', weekdays: [], timeZone: 'UTC' }, 'weekly.weekdays must not be empty')
    rejects({ kind: 'weekly', time: '09:00', weekdays: ['MO', 'MO'], timeZone: 'UTC' }, 'weekly.weekdays must not contain duplicates')
    rejects({ kind: 'weekly', time: '09:00', weekdays: ['XX'], timeZone: 'UTC' }, "invalid weekday 'XX'")
  })

  it('requires month days to be named at least once and inside a month', () => {
    rejects({ kind: 'monthly', time: '09:00', days: [], timeZone: 'UTC' }, 'monthly.days must not be empty')
    rejects({ kind: 'monthly', time: '09:00', days: [0], timeZone: 'UTC' }, 'monthly.days must be integers from 1 through 31')
    rejects({ kind: 'monthly', time: '09:00', days: [32], timeZone: 'UTC' }, 'monthly.days must be integers from 1 through 31')
    rejects({ kind: 'monthly', time: '09:00', days: [1.5], timeZone: 'UTC' }, 'monthly.days must be integers from 1 through 31')
    // A repeated day is redundant rather than invalid, unlike a repeated weekday.
    expect(() => { assertValidSchedule({ kind: 'monthly', time: '09:00', days: [15, 15, 1], timeZone: 'UTC' }) }).not.toThrow()
  })

  it('supports the first four weeks of a month, so the last one has no schedule', () => {
    rejects({ kind: 'nth-weekday', time: '09:00', week: 5, weekday: 'MO', timeZone: 'UTC' }, 'nth-weekday.week must be 1, 2, 3, or 4')
    rejects({ kind: 'nth-weekday', time: '09:00', week: 0, weekday: 'MO', timeZone: 'UTC' }, 'nth-weekday.week must be 1, 2, 3, or 4')
    rejects({ kind: 'nth-weekday', time: '09:00', week: 1, weekday: 'XX', timeZone: 'UTC' }, "invalid weekday 'XX'")
  })

  it('accepts a yearly leap day and refuses a day its month never reaches', () => {
    rejects({ kind: 'yearly', time: '09:00', month: 13, day: 1, timeZone: 'UTC' }, 'yearly.month must be an integer from 1 through 12')
    rejects({ kind: 'yearly', time: '09:00', month: 2, day: 30, timeZone: 'UTC' }, 'yearly.day must be a day of month 2')
    rejects({ kind: 'yearly', time: '09:00', month: 4, day: 31, timeZone: 'UTC' }, 'yearly.day must be a day of month 4')
    // Leap year 2024 fixes the accepted month length, so February 29 stays valid.
    expect(() => { assertValidSchedule({ kind: 'yearly', time: '09:00', month: 2, day: 29, timeZone: 'UTC' }) }).not.toThrow()
  })

  it('rejects an unparseable cron expression at validation time', () => {
    expect(() => { assertValidSchedule({ kind: 'cron', expression: '0 0 1 *', timeZone: 'UTC' }) })
      .toThrow(/must have five fields/)
  })
})
