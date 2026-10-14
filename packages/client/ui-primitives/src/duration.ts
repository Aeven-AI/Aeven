/**
 * Elapsed-duration figures shared by the surfaces that tick a running number.
 * The bucketing and the two-digit padding live here so the jobs list and the
 * subagent lineage tick the same way; the words stay in each plugin's own
 * dictionary, per locale-owned copy.
 *
 * @module @aeven/client-ui-primitives/duration
 */

/** The three templates one figure reads: its unit and the adjacent smaller one. */
export type DurationKey = 'duration.seconds' | 'duration.minutes' | 'duration.hours'

/**
 * The duration seat: a translate function bound to the caller's own
 * `duration.*` templates, such as a plugin's `t` seat.
 */
export type DurationTranslate = (key: DurationKey, params?: Record<string, unknown>) => string

/** Two-digit zero padding, so figures keep one width as they tick. */
function padded(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Elapsed time in at most two adjacent units: hours with minutes, minutes with
 * seconds, else seconds alone. Hours is the widest unit, so a figure that
 * outlives one stays in hours rather than growing a day or month vocabulary.
 * @param ms - elapsed milliseconds; a negative figure reads as zero.
 * @param t - the caller's duration seat.
 * @returns the caller's localized figure, every unit padded to two digits.
 */
export function formatDuration(ms: number, t: DurationTranslate): string {
  const total = Math.floor(Math.max(0, ms) / 1_000)
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  if (hours > 0) return t('duration.hours', { hours: padded(hours), minutes: padded(minutes) })
  if (minutes > 0) return t('duration.minutes', { minutes: padded(minutes), seconds: padded(seconds) })
  return t('duration.seconds', { seconds: padded(seconds) })
}
