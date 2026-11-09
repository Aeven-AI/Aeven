// @vitest-environment jsdom
//
// Pressing a video's play button starts the provider's player under the
// poster. The poster stays on top until the player's frame has loaded and
// settled, then fades and leaves, so the tile never shows its empty
// background between the two.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import MarkdownVideo from '../../src/engine/video.tsx'

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = undefined
  host = undefined
  vi.useRealTimers()
})

function mount(): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(<MarkdownVideo data-provider="youtube" data-video-id="fsTtKywmWlU" data-title="Founders" />)
  })
  return host
}

describe('the hand-off from poster to player', () => {
  it('keeps the poster over the loading player, then fades it once the player has settled', () => {
    vi.useFakeTimers()
    const tile = mount()
    const poster = () => tile.querySelector<HTMLButtonElement>('.markdown-video-poster')

    act(() => { poster()!.click() })
    const frame = tile.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(poster()).not.toBeNull()
    expect(poster()!.hasAttribute('data-covering')).toBe(true)
    expect(poster()!.hasAttribute('data-revealed')).toBe(false)

    // The frame's document has loaded; the poster still covers it while the provider paints.
    act(() => { frame!.dispatchEvent(new Event('load')) })
    expect(poster()!.hasAttribute('data-revealed')).toBe(false)

    act(() => { vi.advanceTimersByTime(250) })
    expect(poster()!.hasAttribute('data-revealed')).toBe(true)

    // The fade ends and the poster leaves, handing the tile to the player.
    act(() => { poster()!.dispatchEvent(new Event('transitionend', { bubbles: true })) })
    expect(poster()).toBeNull()
    expect(tile.querySelector('iframe')).toBe(frame)
  })

  it('shows the poster alone until the reader presses play', () => {
    const tile = mount()
    expect(tile.querySelector('iframe')).toBeNull()
    const poster = tile.querySelector('.markdown-video-poster')
    expect(poster?.hasAttribute('data-covering')).toBe(false)
  })
})
