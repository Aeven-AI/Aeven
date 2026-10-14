// @vitest-environment jsdom
/**
 * Tooltip is this package's adapter over the Markdown engine's tippy.js
 * tooltip: it decides the bubble's content, placement, trigger, anchor box and
 * edge clamp, and forwards the anchor's own ref. tippy is stubbed so those
 * decisions are observable without a live popper — placement flipping, width
 * capping, the hover delay and the clamp geometry are tippy's and popper's
 * behaviour, covered by the engine's own suite and by the assembled browser
 * case, not here.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The stubbed tippy factory, recording every creation and the props it received. */
const tippy = vi.hoisted(() => vi.fn((_reference: Element, _props: Record<string, unknown>) => ({
  destroy: vi.fn(),
  setProps: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
})))

vi.mock('tippy.js', () => ({ default: tippy }))

import { Tooltip } from '@aeven/client-ui-primitives'

/** Let the engine's dynamic tippy import and its `.then` settle inside act(). */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** The props the engine handed the last created tooltip. */
function created(): Record<string, unknown> {
  const call = tippy.mock.calls.at(-1)
  if (call === undefined) throw new Error('the engine never created a tooltip')
  return call[1]
}

/** The last created tooltip instance. */
function instance(): { hide: ReturnType<typeof vi.fn>; setProps: ReturnType<typeof vi.fn> } {
  const result = tippy.mock.results.at(-1)?.value as { hide: ReturnType<typeof vi.fn>; setProps: ReturnType<typeof vi.fn> } | undefined
  if (result === undefined) throw new Error('the engine never created a tooltip')
  return result
}

/** The overflow padding the engine resolved for the last created tooltip. */
function overflowPadding(): unknown {
  const popper = created()['popperOptions'] as
    | { modifiers?: { options?: { padding?: unknown } }[] }
    | undefined
  return popper?.modifiers?.[0]?.options?.padding
}

afterEach(() => {
  document.body.style.removeProperty('--dsw-aeven-page-inset')
  tippy.mockClear()
  cleanup()
})

describe('Tooltip', () => {
  it('resolves a lazy label on render and hands it to the bubble as content', async () => {
    const label = vi.fn(() => 'Timing details')
    const view = render(
      <Tooltip label={label}>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    expect(label).toHaveBeenCalled()
    expect(created()['content']).toBe('Timing details')

    // A label change reaches the live bubble without rebuilding it.
    view.rerender(
      <Tooltip label="Open sidebar">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    expect(instance().setProps).toHaveBeenCalledWith(expect.objectContaining({ content: 'Open sidebar' }))
  })

  it('hangs the requested side on the bubble, right by default', async () => {
    render(
      <Tooltip label="Open sidebar">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    expect(created()['placement']).toBe('right')

    cleanup()
    tippy.mockClear()
    render(
      <Tooltip label="Below" side="bottom-start">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    expect(created()['placement']).toBe('bottom-start')
  })

  it('measures the bubble against the whole anchor box by default', async () => {
    render(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    const box = {
      left: 10, right: 40, top: 5, bottom: 25, width: 30, height: 20, x: 10, y: 5, toJSON: () => ({}),
    } as DOMRect
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(box)
    await settle()
    // No glyph box: an anchor's padding is part of its control.
    const reference = created()['getReferenceClientRect'] as () => DOMRect
    expect(reference()).toBe(box)
  })

  it('places an icon-anchored bubble against the glyph, one pixel past its edge', async () => {
    // The frame's icon-only chrome buttons opt in: the arrow sits on the
    // glyph's centre rather than on the padded control's.
    const rectOf = (left: number, top: number, width: number, height: number): DOMRect => ({
      left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
    })
    render(
      <Tooltip label="Rail" anchor="icon">
        <button type="button"><svg data-testid="glyph" /></button>
      </Tooltip>,
    )
    const glyph = screen.getByTestId('glyph')
    const control = glyph.closest('button')!
    vi.spyOn(glyph, 'getBoundingClientRect').mockReturnValue(rectOf(40, 4, 16, 16))
    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(rectOf(36, 0, 24, 24))
    await settle()

    const placement = created()['getReferenceClientRect'] as () => DOMRect
    const placed = placement()
    // `right`: the bubble hangs one pixel past the glyph and keeps the
    // control's own box on the other axis.
    expect(placed.left).toBe(36)
    expect(placed.right).toBe(57)
    expect(placed.top).toBe(4)
    expect(placed.height).toBe(16)
  })

  it('keeps an icon-anchored bubble 8px inside the page inset', async () => {
    // The arrow needs 11px of bubble either side of the glyph, so a bubble
    // clamped at the inset itself would hold it off the glyph's centre.
    document.body.style.setProperty('--dsw-aeven-page-inset', '24px')
    render(
      <Tooltip label="Rail" anchor="icon">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    expect(overflowPadding()).toBe(16)
  })

  it('clamps the bubble inside a host surface instead of the viewport', async () => {
    const surface = document.createElement('div')
    document.body.append(surface)
    const boundary = vi.fn(() => surface)
    render(
      <Tooltip label="Rail" boundary={boundary}>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    expect(boundary).toHaveBeenCalledOnce()
    const popper = created()['popperOptions'] as
      | { modifiers: { options: { padding: unknown; boundary: unknown } }[] }
      | undefined
    // Flush with the host's own edges: the host's gutter replaces tippy's.
    expect(popper?.modifiers[0]?.options.boundary).toBe(surface)
    expect(popper?.modifiers[0]?.options.padding).toBe(0)
  })

  it('suppresses the bubble while disabled without remounting the anchor', async () => {
    const view = render(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    await settle()
    expect(created()['trigger']).toBe('manual')

    view.rerender(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    // Same DOM node: toggling disabled never remounted the anchor.
    expect(screen.getByText('anchor')).toBe(anchor)
    await settle()
    expect(instance().setProps).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'mouseenter' }))
  })

  it('drops an already-visible bubble when disabled flips mid-hover', async () => {
    // e.g. clicking a rail control expands the sidebar: no mouseleave fires.
    const view = render(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    await settle()
    const bubble = instance()

    view.rerender(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    expect(bubble.hide).toHaveBeenCalledOnce()
  })

  it("chains the anchor's own handlers ahead of the tooltip's", () => {
    const onMouseEnter = vi.fn()
    const onMouseLeave = vi.fn()
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(
      <Tooltip label="Chained">
        <button type="button" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onFocus={onFocus} onBlur={onBlur}>anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    fireEvent.focus(anchor)
    fireEvent.blur(anchor)
    expect(onMouseEnter).toHaveBeenCalledOnce()
    expect(onMouseLeave).toHaveBeenCalledOnce()
    expect(onFocus).toHaveBeenCalledOnce()
    expect(onBlur).toHaveBeenCalledOnce()
  })

  it('forwards the anchor element to the child ref (object and callback)', () => {
    const objectRef = { current: null as HTMLButtonElement | null }
    const callbackRef = vi.fn()
    const { rerender } = render(
      <Tooltip label="Add">
        <button type="button" ref={objectRef}>anchor</button>
      </Tooltip>,
    )
    expect(objectRef.current).toBe(screen.getByText('anchor'))
    rerender(
      <Tooltip label="Add">
        <button type="button" ref={callbackRef}>anchor</button>
      </Tooltip>,
    )
    expect(callbackRef).toHaveBeenCalledWith(screen.getByText('anchor'))
  })
})
