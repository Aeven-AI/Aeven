// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ContentLoader } from '../src/client/skeleton/ContentLoader.tsx'

/** The frame-owned cover layer this loader portals into. */
function mountCoverLayer(): HTMLElement {
  const layer = document.createElement('div')
  layer.setAttribute('data-shell-cover', '')
  document.body.append(layer)
  return layer
}

afterEach(() => {
  cleanup()
  document.querySelector('[data-shell-cover]')?.remove()
  vi.useRealTimers()
})

describe('ContentLoader', () => {
  it('covers immediately when it becomes active and fades when it leaves', () => {
    vi.useFakeTimers()
    const view = render(<ContentLoader active={false} label="Loading content" />)
    expect(document.querySelector('[data-content-loader]')).toBeNull()
    // No frame layer yet: an active cover has nowhere to render.
    view.rerender(<ContentLoader active={true} label="Loading content" />)
    expect(document.querySelector('[data-content-loader]')).toBeNull()

    const layer = mountCoverLayer()
    view.rerender(<ContentLoader active={true} label="Loading content" />)
    const shown = layer.querySelector('[data-content-loader]')
    expect(shown).not.toBeNull()
    expect(shown?.getAttribute('data-hiding')).toBeNull()
    expect(shown?.getAttribute('role')).toBe('status')
    expect(shown?.getAttribute('aria-label')).toBe('Loading content')

    view.rerender(<ContentLoader active={false} label="Loading content" />)
    expect(layer.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBe('true')
    act(() => { vi.advanceTimersByTime(400) })
    expect(layer.querySelector('[data-content-loader]')).toBeNull()
  })

  it('cancels a fade and covers immediately when a new Session starts loading', () => {
    vi.useFakeTimers()
    const layer = mountCoverLayer()
    const view = render(<ContentLoader active={true} label="Loading content" />)
    view.rerender(<ContentLoader active={false} label="Loading content" />)
    expect(layer.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBe('true')
    view.rerender(<ContentLoader active={true} label="Loading content" />)
    expect(layer.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBeNull()
    act(() => { vi.advanceTimersByTime(400) })
    expect(layer.querySelector('[data-content-loader]')).not.toBeNull()
  })
})
