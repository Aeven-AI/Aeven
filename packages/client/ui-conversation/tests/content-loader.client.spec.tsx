// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ContentLoader } from '../src/client/skeleton/ContentLoader.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ContentLoader', () => {
  it('covers immediately when it becomes active and fades when it leaves', () => {
    vi.useFakeTimers()
    const view = render(<ContentLoader active={false} label="Loading content" />)
    expect(view.container.querySelector('[data-content-loader]')).toBeNull()
    view.rerender(<ContentLoader active={true} label="Loading content" />)
    const shown = view.container.querySelector('[data-content-loader]')
    expect(shown).not.toBeNull()
    expect(shown?.getAttribute('data-hiding')).toBeNull()
    view.rerender(<ContentLoader active={false} label="Loading content" />)
    expect(view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBe('true')
    act(() => { vi.advanceTimersByTime(400) })
    expect(view.container.querySelector('[data-content-loader]')).toBeNull()
  })

  it('cancels a fade and covers immediately when a new Session starts loading', () => {
    vi.useFakeTimers()
    const view = render(<ContentLoader active={true} label="Loading content" />)
    view.rerender(<ContentLoader active={false} label="Loading content" />)
    expect(view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBe('true')
    view.rerender(<ContentLoader active={true} label="Loading content" />)
    expect(view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBeNull()
    act(() => { vi.advanceTimersByTime(400) })
    expect(view.container.querySelector('[data-content-loader]')).not.toBeNull()
  })
})
