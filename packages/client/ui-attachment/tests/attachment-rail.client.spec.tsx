// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AttachmentRail } from '../src/AttachmentRail.tsx'
import type { AttachmentRailItem, AttachmentRailLabels } from '../src/AttachmentRail.tsx'

afterEach(cleanup)

// jsdom implements no ResizeObserver; the stub records what the rail observes,
// and its emptiness is the assertion: a size subscription on this box is a
// per-frame layout read on a width that follows the composer through a sidebar
// fold, which is work the rail must not do.
function stubObservers(): Element[] {
  const observed: Element[] = []
  vi.stubGlobal('ResizeObserver', class {
    observe(el: Element) { observed.push(el) }
    unobserve() {}
    disconnect() {}
  })
  return observed
}

afterEach(() => { vi.unstubAllGlobals() })

const labels: AttachmentRailLabels = {
  group: '待发送图片',
  open: '查看原图',
}

function item(id: string): AttachmentRailItem {
  return { id, previewUrl: `blob:${id}`, alt: `${id}.png`, removeLabel: `移除图片 ${id}.png` }
}

/** Stub the rail's scroll geometry (jsdom reports 0 for every metric). */
function stubGeometry(rail: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(rail, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(rail, 'clientWidth', { value: clientWidth, configurable: true })
  let scrollLeft = 0
  Object.defineProperty(rail, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => { scrollLeft = value },
  })
  const scrollBy = vi.fn((options: { left: number }) => {
    scrollLeft = Math.max(0, Math.min(scrollWidth - clientWidth, scrollLeft + options.left))
  })
  rail.scrollBy = scrollBy as unknown as typeof rail.scrollBy
  return { scrollBy, setScrollLeft: (value: number) => { scrollLeft = value } }
}

describe('AttachmentRail', () => {
  it('renders thumbnails in order and routes open and remove clicks', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    const items = [item('a'), item('b')]
    const view = render(<AttachmentRail items={items} labels={labels} onOpen={onOpen} onRemove={onRemove} />)
    const rail = view.getByRole('group', { name: '待发送图片' })
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toEqual(['a.png', 'b.png'])
    fireEvent.click(view.getAllByTitle('查看原图')[0]!)
    expect(onOpen).toHaveBeenCalledWith(items[0])
    fireEvent.click(view.getByRole('button', { name: '移除图片 b.png' }))
    expect(onRemove).toHaveBeenCalledWith(items[1])
  })

  it('pages through native scrolling, with no edge arrow over the thumbnails', () => {
    const view = render(
      <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // The rail IS the scroller: a thumbnail overflows under its own bar rather
    // than behind a paging control, so the arrows that used to page it are gone
    // and the only buttons left are the per-item open and remove controls.
    expect(view.container.querySelectorAll('button')).toHaveLength(6)
    expect(view.queryByLabelText('向右滚动图片')).toBeNull()
    expect(view.queryByLabelText('向左滚动图片')).toBeNull()
    fireEvent.scroll(rail)
    expect(view.queryByLabelText('向右滚动图片')).toBeNull()
    // Nothing the rail does on its own calls scrollBy: the position is the
    // user's, so the wheel path below is the only programmatic page.
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('keeps native scrolling across a scroll-position change and a geometry change', () => {
    const view = render(
      <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    const { scrollBy, setScrollLeft } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // A scroll event is the engine's own report that the bar overflowed; the rail
    // renders nothing from it, so the position it reports stays where it was put.
    setScrollLeft(120)
    fireEvent.scroll(rail)
    expect(rail.scrollLeft).toBe(120)
    expect(rail.style.position).toBe('')
    // A resize changes nothing the rail recomputes: the box is the scroller, so
    // a wider box (here 320 of 400) simply scrolls less. No observer reports it,
    // and the rail still pages programmatically across the narrower range.
    Object.defineProperty(rail, 'clientWidth', { value: 320, configurable: true })
    expect(rail.scrollWidth - rail.clientWidth).toBe(80)
    rail.scrollBy({ left: 60, behavior: 'auto' })
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: 'auto' })
    expect(rail.scrollLeft).toBe(180)
  })

  it('pages without observing any box, and survives a runtime with no ResizeObserver', () => {
    // The rail's width follows the composer card, which is a container-relative
    // subtraction and resizes on every frame of a sidebar fold; an observer here
    // would force a layout read per frame to keep paging controls honest. There
    // are no controls to keep honest, so it observes nothing.
    const observed = stubObservers()
    const view = render(
      <AttachmentRail items={[item('a')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(view.getByRole('group', { name: '待发送图片' })).toBeTruthy()
    expect(observed).toEqual([])
    view.unmount()

    // The same path on a runtime that has no such constructor at all.
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', undefined)
    const bare = render(
      <AttachmentRail items={[item('a')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(bare.getByRole('group', { name: '待发送图片' })).toBeTruthy()
    bare.unmount()
  })

  it('pans horizontally on a vertical wheel, consuming the event, with clamped normalized travel', () => {
    const view = render(
      <AttachmentRail items={[item('a'), item('b')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // Converted ticks are consumed (preventDefault): fireEvent returns false.
    expect(fireEvent.wheel(rail, { deltaY: 30 })).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ left: 30, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: 500 })
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: -500 })
    expect(scrollBy).toHaveBeenCalledWith({ left: -60, behavior: 'auto' })
    // Firefox notch wheels report lines; a page-mode wheel reports viewports.
    fireEvent.wheel(rail, { deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(scrollBy).toHaveBeenCalledWith({ left: 32, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE })
    expect(scrollBy).toHaveBeenCalledWith({ left: -60, behavior: 'auto' })
    // A diagonal pan is consumed too — nothing vertical may escape the rail —
    // and keeps its horizontal intent.
    expect(fireEvent.wheel(rail, { deltaX: 12, deltaY: 30 })).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ left: 12, behavior: 'auto' })
    // A purely horizontal pan and a zero-delta wheel keep native behavior.
    expect(fireEvent.wheel(rail, { deltaX: 12, deltaY: 0 })).toBe(true)
    fireEvent.wheel(rail, { deltaY: 0 })
    expect(scrollBy).toHaveBeenCalledTimes(6)
  })

  it('pages instantly under a reduced-motion preference and when the user asked for none', () => {
    // Wheel translation is a gesture, not an animation: every page it performs
    // is instant, so the rail keeps up with the pointer and the run no longer
    // depends on a motion preference. The stub is what both preferences look
    // like through the rail's own reader.
    for (const matches of [true, false]) {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
      const view = render(
        <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
      )
      const rail = view.getByRole('group', { name: '待发送图片' })
      const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
      fireEvent.scroll(rail)
      fireEvent.wheel(rail, { deltaY: 30 })
      expect(scrollBy).toHaveBeenCalledWith({ left: 30, behavior: 'auto' })
      // A tick with no travel is not a page at all, whatever the preference.
      scrollBy.mockClear()
      fireEvent.wheel(rail, { deltaY: 0 })
      expect(scrollBy).not.toHaveBeenCalled()
      view.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('reveals the rail end when an item is added, not when one is removed', () => {
    const first = [item('a'), item('b')]
    const view = render(
      <AttachmentRail items={first} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    view.rerender(
      <AttachmentRail items={[...first, item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    expect(rail.scrollLeft).toBe(200)
    view.rerender(
      <AttachmentRail items={first} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} />,
    )
    // Removal keeps the position; only growth jumps to the end.
    expect(rail.scrollLeft).toBe(200)
  })
})
