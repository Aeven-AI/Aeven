// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDot } from '@aeven/client-ui-primitives'
import type { StateDotState } from '@aeven/client-ui-primitives'

afterEach(cleanup)

describe('StateDot', () => {
  it.each(['done', 'warning', 'ongoing', 'error'] as const)('renders state %s as data-state', (state) => {
    const { container } = render(<StateDot state={state} />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.dataset['state']).toBe(state)
    expect(dot.getAttribute('aria-hidden')).toBe('true')
  })

  it('solid states are spans; ongoing seats the shared loading mark in one', () => {
    const { container, rerender } = render(<StateDot state="done" />)
    expect(container.firstElementChild?.tagName).toBe('SPAN')
    rerender(<StateDot state="ongoing" />)
    const seat = container.firstElementChild as HTMLElement
    expect(seat.tagName).toBe('SPAN')
    // Every wait in the product draws the one Aeven loading mark, so the
    // running state seats that glyph rather than a shape of its own.
    const mark = seat.querySelector('svg')
    expect(mark).not.toBeNull()
    expect(mark?.getAttribute('viewBox')).toBe('0 0 24 24')
  })

  it('sizes via the size prop in both shapes', () => {
    const { container, rerender } = render(<StateDot state="done" size={12} />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.style.width).toBe('12px')
    expect(dot.style.height).toBe('12px')
    rerender(<StateDot state="ongoing" size={12} />)
    // The seat carries the size; the mark inside it fills the seat.
    const seat = container.firstElementChild as HTMLElement
    expect(seat.style.width).toBe('12px')
    expect(seat.style.height).toBe('12px')
    expect(seat.querySelector('svg')).not.toBeNull()
  })

  it('rejects unknown states at the type level', () => {
    const bad = (state: StateDotState) => state
    // @ts-expect-error 'paused' is not one of the four states
    expect(bad('paused')).toBe('paused')
  })
})
