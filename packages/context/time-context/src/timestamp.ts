/** ISO-shaped time-context timestamp formatting shared by production and replay validation. */

type TimestampPart = 'day' | 'hour' | 'minute' | 'month' | 'second' | 'timeZoneName' | 'year'

/**
 * Create the exact formatter used by durable time-context readings.
 * @param timeZone - Explicit display zone, or `undefined` for the process fallback.
 * @returns A formatter with stable numeric local fields and long numeric offset.
 */
export function createTimestampFormatter(timeZone?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
}

/**
 * Format an epoch millisecond value as an ISO-shaped timestamp with offset and IANA zone.
 * @param now - Epoch milliseconds to display.
 * @param formatter - Formatter created for `timeZone`.
 * @param timeZone - Canonical zone label carried in brackets.
 * @returns The durable timestamp text.
 */
export function formatTimestamp(now: number, formatter: Intl.DateTimeFormat, timeZone: string): string {
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(part => [part.type, part.value]),
  ) as Record<TimestampPart, string>
  const offset = parts.timeZoneName.replace(/^GMT$/, 'GMT+00:00').slice(3)
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}:${parts['second']}${offset}[${timeZone}]`
}

/** The part of the day a local hour falls in, as a person would name it. */
function partOfDay(hour: number): string {
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

/**
 * Render the plain local-time line of one reading: weekday, date, time, and
 * part of the day, so the model does not have to derive them from the offset.
 * @param now - the sampled instant.
 * @param timeZone - the zone the reading is formatted in.
 * @returns the durable line, including how to weigh the person's own wording.
 */
export function formatLocalTime(now: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const partsAt = (time: number): Record<string, string> =>
    Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]))
  const day = (parts: Record<string, string>): string => `${String(parts['weekday'])} ${String(parts['day'])} ${String(parts['month'])}`
  const parts = partsAt(now)
  const hour = Number(parts['hour'])
  // Before dawn a person's day has not ended: "today" is the day they have been living, "tomorrow" the one after sleep.
  // Six hours back always lands on the previous evening.
  const night = hour < 5
    ? `Before dawn a person's "today" usually still means ${day(partsAt(now - 6 * 3_600_000))} and their "tomorrow" means ${day(parts)}. `
    : ''
  return `Local time: ${day(parts)} ${String(parts['year'])}, `
    + `${String(parts['hour'])}:${String(parts['minute'])} (${partOfDay(hour)}). `
    + night
    + 'When the person\'s wording about the time of day disagrees with this, go by this reading.'
}
