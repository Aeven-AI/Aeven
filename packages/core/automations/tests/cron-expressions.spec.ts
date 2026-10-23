/**
 * Five-field cron: what each field expands to, cron's own day-of-month /
 * day-of-week rule, and the expressions this Host refuses to evaluate.
 */
import { describe, expect, it } from 'vitest'
import { assertCronExpression, latestDueOccurrence, nextOccurrence } from '../src/recurrence.ts'
import type { AutomationSchedule } from '../src/types.ts'

const cron = (expression: string, timeZone = 'UTC'): AutomationSchedule => ({ kind: 'cron', expression, timeZone })

describe('cron expressions', () => {
  it('reads the five fields as minute, hour, day of month, month, day of week', () => {
    expect(nextOccurrence(cron('* * * * *'), '2026-03-02T10:07:30.000Z')).toBe('2026-03-02T10:08:00.000Z')
    expect(nextOccurrence(cron('15 10 * * *'), '2026-03-02T10:07:00.000Z')).toBe('2026-03-02T10:15:00.000Z')
    expect(nextOccurrence(cron('15 10 * * *'), '2026-03-02T10:15:00.000Z')).toBe('2026-03-03T10:15:00.000Z')
  })

  it('expands a range in each field', () => {
    expect(nextOccurrence(cron('0 9-17 * * *'), '2026-03-02T18:00:00.000Z')).toBe('2026-03-03T09:00:00.000Z')
    expect(nextOccurrence(cron('0 1-3,9 * * *'), '2026-03-02T10:00:00.000Z')).toBe('2026-03-03T01:00:00.000Z')
    expect(nextOccurrence(cron('0 0 1 1 *'), '2026-10-23T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z')
  })

  it('steps a star and a range', () => {
    expect(nextOccurrence(cron('*/15 * * * *'), '2026-03-02T10:07:00.000Z')).toBe('2026-03-02T10:15:00.000Z')
    // Hours 0, 6, 12, 18.
    expect(nextOccurrence(cron('0 0-23/6 * * *'), '2026-03-02T07:00:00.000Z')).toBe('2026-03-02T12:00:00.000Z')
    // A bare value with a step runs to the field's maximum: minutes 0, 20, 40.
    expect(nextOccurrence(cron('0/20 * * * *'), '2026-03-02T10:07:00.000Z')).toBe('2026-03-02T10:20:00.000Z')
    expect(nextOccurrence(cron('30/10 * * * *'), '2026-03-02T10:31:00.000Z')).toBe('2026-03-02T10:40:00.000Z')
  })

  it('unions a comma list', () => {
    expect(nextOccurrence(cron('0 8,20 * * *'), '2026-03-02T09:00:00.000Z')).toBe('2026-03-02T20:00:00.000Z')
    expect(nextOccurrence(cron('*/15 8,20 * * *'), '2026-03-02T20:50:00.000Z')).toBe('2026-03-03T08:00:00.000Z')
  })

  it('lets a restricted day of month and day of week match either field', () => {
    // April 6 2026 is a Monday; April 13 is the 13th. Either alone satisfies the expression.
    expect(nextOccurrence(cron('0 12 13 * 1'), '2026-04-01T00:00:00.000Z')).toBe('2026-04-06T12:00:00.000Z')
  })

  it('requires both day fields when only one of them is restricted', () => {
    expect(nextOccurrence(cron('0 12 13 * *'), '2026-04-01T00:00:00.000Z')).toBe('2026-04-13T12:00:00.000Z')
    expect(nextOccurrence(cron('0 12 * * 1'), '2026-03-03T00:00:00.000Z')).toBe('2026-03-09T12:00:00.000Z')
  })

  it('names Sunday as either 0 or 7', () => {
    expect(nextOccurrence(cron('0 12 * * 0'), '2026-03-02T13:00:00.000Z')).toBe('2026-03-08T12:00:00.000Z')
    expect(nextOccurrence(cron('0 12 * * 7'), '2026-03-02T13:00:00.000Z')).toBe('2026-03-08T12:00:00.000Z')
  })

  it('evaluates the whole expression in the schedule zone', () => {
    expect(nextOccurrence(cron('0 9 * * *', 'Asia/Tokyo'), '2026-03-02T00:00:00.000Z')).toBe('2026-03-03T00:00:00.000Z')
  })

  it('accepts an expression padded with repeated whitespace', () => {
    expect(nextOccurrence(cron('  0   12  * * *  '), '2026-03-02T13:00:00.000Z')).toBe('2026-03-03T12:00:00.000Z')
  })

  it('reports the latest due instant of a cron schedule', () => {
    const schedule = cron('*/15 9-17 * * 1-5')
    expect(latestDueOccurrence(schedule, '2026-03-06T17:46:00.000Z')).toBe('2026-03-06T17:45:00.000Z')
    expect(latestDueOccurrence(schedule, '2026-03-07T12:00:00.000Z')).toBe('2026-03-06T17:45:00.000Z')
  })

  it('rejects an expression that is not exactly five fields', () => {
    const message = 'cron.expression must have five fields: minute, hour, day of month, month, day of week'
    for (const expression of ['', '@daily', '0 0 1 *', '0 0 1 * * *']) {
      expect(() => { assertCronExpression(expression) }).toThrow(new Error(message))
    }
  })

  it('rejects a field it cannot expand', () => {
    expect(() => { assertCronExpression('a * * * *') }).toThrow(new Error("cron.expression has an invalid minute field: 'a'"))
    expect(() => { assertCronExpression('** * * * *') }).toThrow(new Error("cron.expression has an invalid minute field: '**'"))
    expect(() => { assertCronExpression('1-2-3 * * * *') }).toThrow(new Error("cron.expression has an invalid minute field: '1-2-3'"))
    expect(() => { assertCronExpression('* * * MON *') }).toThrow(new Error("cron.expression has an invalid month field: 'MON'"))
    // Cron field names are outside the supported subset.
    expect(() => { assertCronExpression('0 9 * * MO-FR') }).toThrow(new Error("cron.expression has an invalid day of week field: 'MO-FR'"))
  })

  it('rejects a value outside its field range', () => {
    expect(() => { assertCronExpression('60 0 1 * *') }).toThrow(new Error("cron.expression minute field must stay within 0-59: '60'"))
    expect(() => { assertCronExpression('0 24 * * *') }).toThrow(new Error("cron.expression hour field must stay within 0-23: '24'"))
    expect(() => { assertCronExpression('0 0 0 * *') }).toThrow(new Error("cron.expression day of month field must stay within 1-31: '0'"))
    expect(() => { assertCronExpression('0 0 32 * *') }).toThrow(new Error("cron.expression day of month field must stay within 1-31: '32'"))
    expect(() => { assertCronExpression('0 0 1 13 *') }).toThrow(new Error("cron.expression month field must stay within 1-12: '13'"))
    expect(() => { assertCronExpression('0 0 1 * 8') }).toThrow(new Error("cron.expression day of week field must stay within 0-7: '8'"))
    expect(() => { assertCronExpression('5-1 * * * *') }).toThrow(new Error("cron.expression minute field must stay within 0-59: '5-1'"))
  })

  it('rejects a step that names no stride', () => {
    expect(() => { assertCronExpression('*/0 * * * *') }).toThrow(new Error("cron.expression has an invalid step in its minute field: '*/0'"))
    expect(() => { assertCronExpression('0 0 1 * 1-3/0') }).toThrow(new Error("cron.expression has an invalid step in its day of week field: '1-3/0'"))
  })

  it('validates the expression each time a cron schedule is evaluated', () => {
    expect(() => nextOccurrence(cron('61 * * * *'), '2026-03-02T10:00:00.000Z')).toThrow(/minute field must stay within 0-59/)
    expect(() => latestDueOccurrence(cron('@hourly'), '2026-03-02T10:00:00.000Z')).toThrow(/must have five fields/)
  })
})
