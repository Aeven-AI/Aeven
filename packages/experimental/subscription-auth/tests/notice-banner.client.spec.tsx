/**
 * @vitest-environment happy-dom
 *
 * A notice banner's dismissal contract: it offers its dismiss control only
 * when the caller supplied both a handler and a label, and an auto-hiding
 * banner stops its own timer rather than dismissing a page that has gone.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeBanner } from '../src/client/components/NoticeBanner.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('notice banner', () => {
  it('states its message with no dismiss control when the caller offers none', () => {
    render(<NoticeBanner message="This page is remote" />)

    expect(screen.getByRole('status').textContent).toBe('This page is remote')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('dismisses from the label the caller gave it', () => {
    const onDismiss = vi.fn()
    render(<NoticeBanner message="This page is remote" dismissLabel="Got it" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('offers no dismiss control from only half of the pair', () => {
    render(<NoticeBanner message="A label without a handler" dismissLabel="Got it" />)
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    render(<NoticeBanner message="A handler without a label" onDismiss={() => undefined} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('tints a success notice without changing what it says', () => {
    render(<NoticeBanner message="Saved" tone="success" dismissLabel="Close" onDismiss={() => undefined} />)

    expect(screen.getByRole('status').textContent).toContain('Saved')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('auto-hides itself once the caller’s delay has elapsed', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<NoticeBanner message="Saved" tone="success" autoHideMs={500} onDismiss={onDismiss} />)

    expect(screen.getByRole('status').textContent).toBe('Saved')
    vi.advanceTimersByTime(499)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('never auto-hides without a handler, however short the delay', () => {
    vi.useFakeTimers()
    render(<NoticeBanner message="Saved" autoHideMs={500} />)

    vi.advanceTimersByTime(5_000)
    expect(screen.getByRole('status').textContent).toBe('Saved')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending auto-hide when it unmounts first', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { unmount } = render(<NoticeBanner message="Saved" autoHideMs={500} onDismiss={onDismiss} />)

    unmount()
    vi.advanceTimersByTime(5_000)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
