/**
 * Elapsed-duration figures: hours with minutes, minutes with seconds, else
 * seconds alone, every unit padded to two digits and a negative figure read
 * as zero.
 */
import { describe, expect, it, vi } from 'vitest'
import { formatDuration, type DurationTranslate } from '@aeven/client-ui-primitives'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** A duration seat that records the template and params one figure reads. */
const seat = () => vi.fn<DurationTranslate>(() => '')

describe('formatDuration', () => {
  it('reads hours with the adjacent minutes once a figure reaches an hour', () => {
    const t = seat()
    formatDuration(2 * HOUR + 3 * MINUTE + 59 * SECOND, t)
    expect(t).toHaveBeenCalledTimes(1)
    expect(t).toHaveBeenCalledWith('duration.hours', { hours: '02', minutes: '03' })
  })

  it('reads minutes with the adjacent seconds below an hour', () => {
    const t = seat()
    formatDuration(2 * MINUTE + 5 * SECOND, t)
    expect(t).toHaveBeenCalledWith('duration.minutes', { minutes: '02', seconds: '05' })
  })

  it('reads seconds alone below a minute', () => {
    const t = seat()
    formatDuration(9 * SECOND, t)
    expect(t).toHaveBeenCalledWith('duration.seconds', { seconds: '09' })
  })

  it('changes unit exactly at the minute and the hour', () => {
    const t = seat()
    formatDuration(59 * SECOND, t)
    expect(t).toHaveBeenLastCalledWith('duration.seconds', { seconds: '59' })
    formatDuration(MINUTE, t)
    expect(t).toHaveBeenLastCalledWith('duration.minutes', { minutes: '01', seconds: '00' })
    formatDuration(HOUR - SECOND, t)
    expect(t).toHaveBeenLastCalledWith('duration.minutes', { minutes: '59', seconds: '59' })
    formatDuration(HOUR, t)
    expect(t).toHaveBeenLastCalledWith('duration.hours', { hours: '01', minutes: '00' })
  })

  it('keeps every unit two digits wide and truncates none', () => {
    const t = seat()
    formatDuration(123 * HOUR + 4 * MINUTE, t)
    expect(t).toHaveBeenCalledWith('duration.hours', { hours: '123', minutes: '04' })
    formatDuration(10 * MINUTE, t)
    expect(t).toHaveBeenLastCalledWith('duration.minutes', { minutes: '10', seconds: '00' })
  })

  it('reads a negative figure as zero', () => {
    const t = seat()
    formatDuration(-1, t)
    formatDuration(-5 * HOUR, t)
    expect(t).toHaveBeenCalledTimes(2)
    expect(t).toHaveBeenLastCalledWith('duration.seconds', { seconds: '00' })
  })

  it('renders through the caller dictionary, so each surface keeps its own words', () => {
    const t: DurationTranslate = (key, params) => `${key}${JSON.stringify(params ?? {})}`
    expect(formatDuration(MINUTE + SECOND, t)).toBe('duration.minutes{"minutes":"01","seconds":"01"}')
  })
})
