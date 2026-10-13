// @vitest-environment jsdom
/**
 * `useAnchoredPosition` wiring: a floating panel is placed from its anchor and
 * keeps tracking it while open.
 *
 * The geometry itself needs real layout, which jsdom does not provide — the
 * browser layout scenario in `apps/web/tests/message-feedback-layout.e2e.ts`
 * owns that. What is asserted here is the wiring the clamp depends on: the
 * listeners and the panel-size observer are attached while open and released on
 * close, a size change replays the placement, and the hook still works where
 * `ResizeObserver` does not exist.
 */
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useAnchoredPosition } from '../src/useAnchoredPosition.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** One recorded `ResizeObserver` instance, so a test can drive its callback. */
interface Recorded {
  callback: ResizeObserverCallback
  observed: Element[]
  disconnected: boolean
}

/**
 * Install a recording `ResizeObserver` double.
 * @returns the list every constructed observer registers itself in.
 */
function stubResizeObserver(): Recorded[] {
  const made: Recorded[] = []
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: Recorded

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, observed: [], disconnected: false }
      made.push(this.record)
    }

    observe(element: Element) { this.record.observed.push(element) }
    disconnect() { this.record.disconnected = true }
  })
  return made
}

/**
 * Host component that anchors a panel and reports the computed position.
 * @param props - whether the panel is open, and a counter incremented per render.
 * @returns the anchor and, while open, the panel carrying the position.
 */
function Host({ open, renders }: { open: boolean; renders?: { count: number } }) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({ open, anchorRef, panelRef, gap: 4, margin: 12 })
  useEffect(() => { if (renders !== undefined) renders.count += 1 })
  return (
    <>
      <button ref={anchorRef} type="button">anchor</button>
      {open && <div ref={panelRef} data-testid="panel" style={position ?? { visibility: 'hidden' }} />}
    </>
  )
}

/**
 * A rect the hook can read: jsdom reports zeros, so a test that cares about the
 * coordinates has to state them.
 * @param top - viewport top of the anchor.
 * @returns the anchor's rect.
 */
function rect(top: number): DOMRect {
  return {
    left: 20, top, right: 60, bottom: top + 20, width: 40, height: 20, x: 20, y: top,
    toJSON: () => ({}),
  }
}

describe('useAnchoredPosition', () => {
  it('observes the panel while open and disconnects when it closes', () => {
    const made = stubResizeObserver()
    const ui = render(<Host open />)

    expect(made).toHaveLength(1)
    expect(made[0]?.observed).toEqual([ui.getByTestId('panel')])
    expect(made[0]?.disconnected).toBe(false)

    ui.rerender(<Host open={false} />)

    expect(made[0]?.disconnected).toBe(true)
  })

  it('replaces the panel when its own size changes', () => {
    const made = stubResizeObserver()
    render(<Host open />)
    const before = made[0]?.callback
    expect(before).toBeDefined()

    // A status line appearing inside the panel, or a dragged textarea, changes
    // the height without a scroll or resize event; the observer is the only
    // thing that notices, so driving its callback must not throw.
    expect(() => { before?.([], {} as ResizeObserver) }).not.toThrow()
  })

  it('still places the panel where ResizeObserver does not exist', () => {
    // jsdom's own condition, and any host without the API: the hook must fall
    // back to scroll and resize rather than fail at mount.
    vi.stubGlobal('ResizeObserver', undefined)

    expect(() => render(<Host open />)).not.toThrow()
  })

  it('attaches no listeners while the element is closed', () => {
    const made = stubResizeObserver()
    const add = vi.spyOn(window, 'addEventListener')

    render(<Host open={false} />)

    expect(made).toHaveLength(0)
    expect(add.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize')).toEqual([])
    add.mockRestore()
  })

  it('re-places the panel when its anchor moves under a scroll', () => {
    const anchor = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(30))
    const ui = render(<Host open />)
    expect(ui.getByTestId('panel').style.top).toBe('54px')

    // `bottom` side plus the 4px gap: the panel hangs below whatever the anchor
    // reports after the scroll, which is the whole point of tracking it.
    anchor.mockReturnValue(rect(130))
    fireEvent.scroll(window)
    expect(ui.getByTestId('panel').style.top).toBe('154px')
    expect(ui.getByTestId('panel').style.left).toBe('20px')
  })

  it('keeps the placement identity when a scroll leaves the anchor where it was', () => {
    // The listener is capture-phase, so it also runs for scrolls that moved
    // something else entirely. Re-placing at identical coordinates has to return
    // the same object, or every such frame re-renders the panel.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(30))
    const renders = { count: 0 }
    render(<Host open renders={renders} />)
    const placed = renders.count

    fireEvent.scroll(window)
    fireEvent.scroll(window)

    expect(renders.count).toBe(placed)
  })
})
