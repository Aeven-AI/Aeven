/** Calendar recurrence adapted from titanwings/dsh-automation (MIT), commit 0d73a4e03639d4f63d0771ae4490e2718b7e7aa0. */
import { DateTime, IANAZone } from 'luxon'
import type { AutomationSchedule, Weekday } from './types.ts'

const WEEKDAY_NUMBERS: Readonly<Record<Weekday, number>> = {
  MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7,
}
const WEEKDAY_ORDER = Object.keys(WEEKDAY_NUMBERS) as Weekday[]
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const CRON_FIELD = /^(?:\*|\*\/\d+|\d+(?:-\d+)?(?:\/\d+)?)(?:,(?:\*|\*\/\d+|\d+(?:-\d+)?(?:\/\d+)?))*$/
const farFutureIso = '9999-12-31T23:59:59.999Z'

/** Schedule kinds this Host evaluates, in the order the management projection lists them. */
export const SCHEDULE_KINDS = ['once', 'interval', 'hours', 'daily', 'weekly', 'monthly', 'nth-weekday', 'yearly', 'cron'] as const

/** One wall-clock instant a calendar day may fire at. */
interface WallTime {
  readonly hour: number
  readonly minute: number
}

/**
 * A calendar recurrence reduced to two questions: whether a local date fires,
 * and which wall times it fires at. Both scans and closed-form lookups share it.
 */
interface CalendarPattern {
  /** Whether the local date holds an occurrence. */
  readonly dayMatches: (date: DateTime) => boolean
  /** Ascending wall times of one matching day. */
  readonly times: readonly WallTime[]
  /**
   * Days before the current local date searched for the latest due occurrence.
   * Longer than one period of the recurrence, so a Host that was closed still
   * finds the occurrence the misfire grace window is about to reject.
   */
  readonly lookbackDays: number
}

/** Reject invalid time zones, instants, wall times, cron expressions, and selector ranges.
 * @param schedule - recurrence to validate.
 */
export function assertValidSchedule(schedule: AutomationSchedule): void {
  assertTimeZone(schedule.timeZone)
  if (schedule.until !== undefined) parseInstant(schedule.until, 'until')
  if (schedule.kind === 'once') {
    const at = parseInstant(schedule.at, 'once.at')
    if (schedule.until !== undefined && at > parseInstant(schedule.until, 'until')) throw new Error('The end time precedes the one-time occurrence.')
    return
  }
  if (schedule.kind === 'interval') {
    if (!Number.isInteger(schedule.everyMinutes) || schedule.everyMinutes < 5) {
      throw new Error('interval.everyMinutes must be an integer of at least 5')
    }
    parseInstant(schedule.anchor, 'interval.anchor')
    return
  }
  if (schedule.kind === 'cron') {
    assertCronExpression(schedule.expression)
    return
  }
  if (schedule.kind === 'hours') {
    if (!Number.isInteger(schedule.everyHours) || schedule.everyHours < 1 || schedule.everyHours > 24) {
      throw new Error('hours.everyHours must be an integer from 1 through 24')
    }
    if (!Number.isInteger(schedule.atMinute) || schedule.atMinute < 0 || schedule.atMinute > 59) {
      throw new Error('hours.atMinute must be an integer from 0 through 59')
    }
    return
  }
  if (!LOCAL_TIME.test(schedule.time)) {
    throw new Error(`${schedule.kind}.time must use 24-hour HH:mm format`)
  }
  if (schedule.kind === 'weekly') {
    if (schedule.weekdays.length === 0) throw new Error('weekly.weekdays must not be empty')
    if (new Set(schedule.weekdays).size !== schedule.weekdays.length) {
      throw new Error('weekly.weekdays must not contain duplicates')
    }
    for (const weekday of schedule.weekdays) {
      if (!(weekday in WEEKDAY_NUMBERS)) throw new Error(`invalid weekday '${weekday}'`)
    }
    return
  }
  if (schedule.kind === 'monthly') {
    if (schedule.days.length === 0) throw new Error('monthly.days must not be empty')
    for (const day of schedule.days) {
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('monthly.days must be integers from 1 through 31')
    }
    return
  }
  if (schedule.kind === 'nth-weekday') {
    if (![1, 2, 3, 4].includes(schedule.week)) throw new Error('nth-weekday.week must be 1, 2, 3, or 4')
    if (!(schedule.weekday in WEEKDAY_NUMBERS)) throw new Error(`invalid weekday '${schedule.weekday}'`)
    return
  }
  if (schedule.kind === 'yearly') {
    if (!Number.isInteger(schedule.month) || schedule.month < 1 || schedule.month > 12) {
      throw new Error('yearly.month must be an integer from 1 through 12')
    }
    if (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > daysInMonth(schedule.month)) {
      throw new Error(`yearly.day must be a day of month ${schedule.month}`)
    }
  }
}

/** Days the named month reaches in a leap year, so `2`/`29` stays a valid yearly date. */
function daysInMonth(month: number): number {
  return DateTime.fromObject({ year: 2024, month, day: 1 }).daysInMonth ?? 31
}

function normalizeSchedule(schedule: AutomationSchedule): AutomationSchedule {
  assertValidSchedule(schedule)
  switch (schedule.kind) {
    case 'weekly': {
      const selected = new Set(schedule.weekdays)
      return { ...schedule, weekdays: WEEKDAY_ORDER.filter(day => selected.has(day)) }
    }
    case 'monthly':
      return { ...schedule, days: [...new Set(schedule.days)].sort((a, b) => a - b) }
    case 'cron':
      return { ...schedule, expression: schedule.expression.trim().split(/\s+/).join(' ') }
    default:
      return schedule
  }
}

/** Find the first occurrence strictly after an instant.
 * @param schedule - validated recurrence.
 * @param afterExclusive - ISO instant excluded from the result.
 * @returns next UTC instant, or null for an exhausted one-time schedule.
 */
export function nextOccurrence(schedule: AutomationSchedule, afterExclusive: string): string | null {
  const values = occurrencesBetween(schedule, afterExclusive, schedule.until ?? farFutureIso, 1)
  return values[0] ?? null
}

/** Latest scheduled occurrence at or before an instant without materializing a backlog.
 * @param schedule - recurrence.
 * @param now - inclusive ISO instant.
 * @returns latest UTC instant, or null when no occurrence is due.
 */
export function latestDueOccurrence(schedule: AutomationSchedule, now: string): string | null {
  assertValidSchedule(schedule)
  const nowMs = Math.min(parseInstant(now, 'now').toMillis(), schedule.until === undefined ? Infinity : parseInstant(schedule.until, 'until').toMillis())
  if (schedule.kind === 'once') {
    const at = parseInstant(schedule.at, 'once.at').toMillis()
    return at <= nowMs ? DateTime.fromMillis(at, { zone: 'utc' }).toISO() : null
  }
  if (schedule.kind === 'interval') {
    const anchor = parseInstant(schedule.anchor, 'interval.anchor').toMillis()
    const step = schedule.everyMinutes * 60_000
    // The anchor fixes cadence; it is not itself a run. "Every 30 minutes"
    // created now first fires 30 minutes from now, never immediately.
    if (anchor + step > nowMs) return null
    return DateTime.fromMillis(
      anchor + Math.floor((nowMs - anchor) / step) * step,
      { zone: 'utc' },
    ).toISO()
  }
  const pattern = calendarPattern(schedule)
  // Walk back from the current local day: the first wall time at or before `now`
  // on the first matching day is the latest due occurrence, however sparse the
  // recurrence is, without materializing the days in between.
  let date = DateTime.fromMillis(nowMs, { zone: 'utc' }).setZone(schedule.timeZone).startOf('day')
  for (let back = 0; back <= pattern.lookbackDays; back += 1) {
    if (pattern.dayMatches(date)) {
      let latest: number | null = null
      for (const time of pattern.times) {
        const candidate = localCandidate(date, time.hour, time.minute, schedule.timeZone)
        if (candidate === null) continue
        const millis = candidate.toMillis()
        if (millis <= nowMs && (latest === null || millis > latest)) latest = millis
      }
      if (latest !== null) return DateTime.fromMillis(latest, { zone: 'utc' }).toISO()
    }
    date = date.minus({ days: 1 })
  }
  return null
}

function occurrencesBetween(
  schedule: AutomationSchedule,
  afterExclusive: string,
  untilInclusive: string,
  limit = 1_000,
): string[] {
  const normalized = normalizeSchedule(schedule)
  const after = parseInstant(afterExclusive, 'afterExclusive').toUTC()
  const until = parseInstant(untilInclusive, 'untilInclusive').toUTC()
  if (until < after || !Number.isInteger(limit) || limit < 1) return []

  if (normalized.kind === 'once') {
    const at = parseInstant(normalized.at, 'once.at').toUTC()
    if (!(at > after && at <= until)) return []
    const iso = at.toISO()
    return iso === null ? [] : [iso]
  }
  if (normalized.kind === 'interval') {
    return intervalOccurrences(normalized.anchor, normalized.everyMinutes, after, until, limit)
  }

  const pattern = calendarPattern(normalized)
  const values: string[] = []
  let date = after.setZone(normalized.timeZone).startOf('day')
  const finalLocalDate = until.setZone(normalized.timeZone).startOf('day')
  while (date <= finalLocalDate && values.length < limit) {
    if (pattern.dayMatches(date)) {
      for (const time of pattern.times) {
        const candidate = localCandidate(date, time.hour, time.minute, normalized.timeZone)
        if (candidate === null) continue
        const utc = candidate.toUTC()
        const iso = utc.toISO()
        if (utc > after && utc <= until && iso !== null) {
          values.push(iso)
          if (values.length === limit) break
        }
      }
    }
    date = date.plus({ days: 1 })
  }
  return values
}

/** Reduce a calendar recurrence to its matching days and wall times.
 * @param schedule - validated recurrence other than `once` or `interval`.
 * @returns the pattern both occurrence scans evaluate.
 */
function calendarPattern(schedule: Exclude<AutomationSchedule, { kind: 'once' } | { kind: 'interval' }>): CalendarPattern {
  switch (schedule.kind) {
    case 'hours': {
      const hours: number[] = []
      for (let hour = 0; hour < 24; hour += schedule.everyHours) hours.push(hour)
      return { dayMatches: () => true, times: wallTimes(hours, [schedule.atMinute]), lookbackDays: 2 }
    }
    case 'daily': {
      const [hour, minute] = parseLocalTime(schedule.time)
      return { dayMatches: () => true, times: wallTimes([hour], [minute]), lookbackDays: 2 }
    }
    case 'weekly': {
      const allowed = new Set(schedule.weekdays.map(day => WEEKDAY_NUMBERS[day]))
      const [hour, minute] = parseLocalTime(schedule.time)
      return { dayMatches: date => allowed.has(date.weekday), times: wallTimes([hour], [minute]), lookbackDays: 8 }
    }
    case 'monthly': {
      const allowed = new Set(schedule.days)
      const [hour, minute] = parseLocalTime(schedule.time)
      return { dayMatches: date => allowed.has(date.day), times: wallTimes([hour], [minute]), lookbackDays: 62 }
    }
    case 'nth-weekday': {
      const weekday = WEEKDAY_NUMBERS[schedule.weekday]
      const week = schedule.week
      const [hour, minute] = parseLocalTime(schedule.time)
      return {
        dayMatches: date => date.weekday === weekday && Math.ceil(date.day / 7) === week,
        times: wallTimes([hour], [minute]),
        lookbackDays: 62,
      }
    }
    case 'yearly': {
      const [hour, minute] = parseLocalTime(schedule.time)
      const month = schedule.month
      const day = schedule.day
      return { dayMatches: date => date.month === month && date.day === day, times: wallTimes([hour], [minute]), lookbackDays: 400 }
    }
    case 'cron': {
      const spec = parseCron(schedule.expression)
      const daysOfMonth = new Set(spec.daysOfMonth)
      const daysOfWeek = new Set(spec.daysOfWeek)
      const months = new Set(spec.months)
      // Cron keeps `*` meaningful: with both day fields restricted, either may match.
      const bothRestricted = !spec.anyDayOfMonth && !spec.anyDayOfWeek
      return {
        dayMatches: date => months.has(date.month) && (bothRestricted
          ? daysOfMonth.has(date.day) || daysOfWeek.has(date.weekday % 7)
          : daysOfMonth.has(date.day) && daysOfWeek.has(date.weekday % 7)),
        times: wallTimes(spec.hours, spec.minutes),
        lookbackDays: 2_929,
      }
    }
  }
}

/** Ascending, de-duplicated wall times of the selected hours and minutes. */
function wallTimes(hours: readonly number[], minutes: readonly number[]): WallTime[] {
  const values: WallTime[] = []
  for (const hour of [...hours].sort((a, b) => a - b)) {
    for (const minute of [...minutes].sort((a, b) => a - b)) values.push({ hour, minute })
  }
  return values
}

/** One parsed five-field cron expression; `any*` records a field written as `*`. */
interface CronSpec {
  readonly minutes: readonly number[]
  readonly hours: readonly number[]
  readonly daysOfMonth: readonly number[]
  readonly months: readonly number[]
  readonly daysOfWeek: readonly number[]
  readonly anyDayOfMonth: boolean
  readonly anyDayOfWeek: boolean
}

/** Reject a cron expression this Host cannot evaluate.
 * @param expression - five-field cron text.
 */
export function assertCronExpression(expression: string): void {
  parseCron(expression)
}

/** Parse a five-field cron expression: minute, hour, day of month, month, day of week. */
function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('cron.expression must have five fields: minute, hour, day of month, month, day of week')
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]
  return {
    minutes: cronField(minute, 0, 59, 'minute'),
    hours: cronField(hour, 0, 23, 'hour'),
    daysOfMonth: cronField(dayOfMonth, 1, 31, 'day of month'),
    months: cronField(month, 1, 12, 'month'),
    // Both 0 and 7 name Sunday.
    daysOfWeek: cronField(dayOfWeek, 0, 7, 'day of week').map(day => day === 7 ? 0 : day).filter((day, index, all) => all.indexOf(day) === index).sort((a, b) => a - b),
    anyDayOfMonth: dayOfMonth === '*',
    anyDayOfWeek: dayOfWeek === '*',
  }
}

/** Expand one cron field into its ascending values.
 * @param field - a field such as `*`, `10`, `1-5`, or a star with a step.
 * @param min - inclusive lowest accepted value.
 * @param max - inclusive highest accepted value.
 * @param label - field name used in the diagnostic.
 */
function cronField(field: string, min: number, max: number, label: string): number[] {
  if (!CRON_FIELD.test(field)) throw new Error(`cron.expression has an invalid ${label} field: '${field}'`)
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [range = '', step] = part.includes('/') ? part.split('/') as [string, string] : [part, undefined]
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) throw new Error(`cron.expression has an invalid step in its ${label} field: '${part}'`)
    const stride = step === undefined ? 1 : Number(step)
    const [low, high] = range === '*' ? [min, max]
      : range.includes('-') ? range.split('-').map(Number) as [number, number]
      // A bare value with a step runs from that value to the field's maximum, as
      // in `0/20` for minutes 0, 20, and 40.
        : [Number(range), step === undefined ? Number(range) : max]
    if (!Number.isInteger(low) || !Number.isInteger(high) || low < min || high > max || low > high) {
      throw new Error(`cron.expression ${label} field must stay within ${min}-${max}: '${part}'`)
    }
    // A step larger than its range still names the range's first value, as cron does.
    for (let value = low; value <= high; value += stride) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

function intervalOccurrences(
  anchorIso: string,
  everyMinutes: number,
  after: DateTime,
  until: DateTime,
  limit: number,
): string[] {
  const anchor = parseInstant(anchorIso, 'interval.anchor').toUTC()
  const stepMs = everyMinutes * 60_000
  const elapsed = after.toMillis() - anchor.toMillis()
  // The anchor establishes cadence; the first occurrence is one full
  // interval later. This matches the persisted recurrence and due scanner.
  const steps = Math.max(1, Math.floor(elapsed / stepMs) + 1)
  let candidateMs = anchor.toMillis() + steps * stepMs
  const values: string[] = []
  while (candidateMs <= until.toMillis() && values.length < limit) {
    const iso = DateTime.fromMillis(candidateMs, { zone: 'utc' }).toISO()
    if (iso === null) break
    values.push(iso)
    candidateMs += stepMs
  }
  return values
}

function localCandidate(date: DateTime, hour: number, minute: number, zone: string): DateTime | null {
  const value = DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute, second: 0, millisecond: 0 },
    { zone },
  )
  // Luxon shifts nonexistent spring-forward wall times; skipping is explicit and stable.
  return value.isValid && value.hour === hour && value.minute === minute ? value : null
}

function parseInstant(value: string, field: string): DateTime {
  const parsed = DateTime.fromISO(value, { setZone: true })
  if (!parsed.isValid || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error(`${field} must be an ISO-8601 instant with an explicit offset`)
  }
  return parsed
}

function assertTimeZone(zone: string): void {
  if (!IANAZone.isValidZone(zone)) {
    throw new Error(`timeZone '${zone}' must be an explicit IANA zone such as Asia/Shanghai`)
  }
}

function parseLocalTime(value: string): [number, number] {
  const [hour, minute] = value.split(':').map(Number)
  if (hour === undefined || minute === undefined) {
    throw new Error(`'${value}' is not a 24-hour HH:mm time`)
  }
  return [hour, minute]
}
