/**
 * @vitest-environment happy-dom
 *
 * A usage meter reports the percentage it was given, clamped to the range a
 * percentage can express, and states its label and reset time only when the
 * caller has them.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressBar } from '../src/client/components/ProgressBar.tsx'

afterEach(cleanup)

/** The coloured fill inside the track; its width is the whole visible answer. */
function fillWidth(): string {
  const track = screen.getByRole('progressbar').firstElementChild as HTMLElement
  return track.style.width
}

describe('usage progress bar', () => {
  it('reports the percentage it was given, however full or empty', () => {
    for (const value of [95, 80, 10]) {
      const { unmount } = render(<ProgressBar value={value} />)
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(String(value))
      expect(fillWidth()).toBe(`${String(value)}%`)
      unmount()
    }
  })

  it('keeps an out-of-range value inside the scale a percentage can express', () => {
    render(<ProgressBar value={-20} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(fillWidth()).toBe('0%')
    cleanup()

    render(<ProgressBar value={180} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect(fillWidth()).toBe('100%')
  })

  it('states the window it measures without inventing a reset time', () => {
    render(<ProgressBar value={40} label="Weekly limit" />)

    expect(screen.getByText('Weekly limit')).toBeTruthy()
    expect(fillWidth()).toBe('40%')
    expect(screen.queryByText(/Resets/u)).toBeNull()
  })

  it('adds the reset time beside the label when the caller has one', () => {
    render(<ProgressBar value={40} label="Weekly limit" meta="Resets 3 Jan, 09:00" />)

    expect(screen.getByText('Weekly limit')).toBeTruthy()
    expect(screen.getByText('Resets 3 Jan, 09:00')).toBeTruthy()
  })

  it('shows no header at all when there is no label to head it', () => {
    render(<ProgressBar value={40} meta="Resets 3 Jan, 09:00" />)

    expect(screen.queryByText('Resets 3 Jan, 09:00')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
  })
})
