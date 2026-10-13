// Host controls' tooltips are the Markdown engine's own tippy.js tooltip, so
// every tip in the app shares one placement engine, trigger, fade, arrow and
// skin with the engine's toolbar tips (copy, full screen). A bubble clamped
// against a viewport edge stops at the frame's page inset, the same gutter the
// frame's own controls keep.

import { useEffect, useRef } from 'react'
import type { ReactElement, Ref } from 'react'
import { TippyTooltip, type TippyTooltipHandle } from '@aeven/client-hypermarkdown'

/** Bubble placement relative to the anchor; `-start`/`-end` align the bubble to that anchor edge. */
export type TooltipSide =
  | 'top' | 'top-start' | 'top-end'
  | 'bottom' | 'bottom-start' | 'bottom-end'
  | 'right' | 'left'

type TooltipLabel = string | (() => string)

/**
 * The frame's page inset, which the bubble keeps from the viewport edge as the
 * frame's own chrome does. Read from the token when a tooltip is created
 * rather than during render, so no render forces a style flush; a page without
 * the theme sheet reports none and leaves tippy's gutter in place.
 * @returns the inset in pixels, or undefined when no token is mounted.
 */
function pageInset(): number | undefined {
  const raw = getComputedStyle(document.body).getPropertyValue('--dsw-aeven-page-inset')
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * The edge gutter of an icon-anchored bubble: 8px inside the page inset. The
 * frame's corner icons sit one page inset in, and an arrow keeps 11px of
 * bubble on each side (half its 16px width plus tippy's 3px arrow padding), so
 * a bubble clamped at the inset itself would hold the arrow off the glyph's
 * centre.
 * @returns the gutter in pixels, or undefined when no token is mounted.
 */
function iconGutter(): number | undefined {
  const inset = pageInset()
  return inset === undefined ? undefined : Math.max(0, inset - 8)
}

/**
 * How far past the glyph's own edge an icon-anchored bubble hangs, so it
 * clears the mark rather than touching it.
 */
const ICON_TIP = 1

/**
 * The box an icon-anchored bubble is placed against: the icon's own box, so
 * the arrow sits on the glyph's centre across the placement axis and the
 * bubble hangs `ICON_TIP` past the glyph along it.
 *
 * The glyph, not the control's box, is what makes every icon control in a row
 * place its bubble on one line: a control's padding is part of its box, so
 * measuring the box put the same 30px circle's bubble 5px above the circle
 * beside it wherever one of the two stated a padding offset and the other did
 * not. Reading the glyph states the geometry once, in the mark itself. A
 * control without an icon keeps its own box.
 * @param reference - the tooltip's trigger element.
 * @param side - the bubble's placement.
 * @returns the placement box.
 */
function iconAnchorRect(reference: Element, side: TooltipSide): DOMRect {
  const box = reference.getBoundingClientRect()
  const icon = reference.querySelector('svg')
  if (icon === null) return box
  const glyph = icon.getBoundingClientRect()
  if (side === 'left' || side === 'right') {
    const left = side === 'left' ? glyph.left - ICON_TIP : box.left
    const right = side === 'right' ? glyph.right + ICON_TIP : box.right
    return new DOMRect(left, glyph.top, right - left, glyph.height)
  }
  const top = side.startsWith('top') ? glyph.top - ICON_TIP : box.top
  const bottom = side.startsWith('bottom') ? glyph.bottom + ICON_TIP : box.bottom
  return new DOMRect(glyph.left, top, glyph.width, bottom - top)
}

/**
 * Attach a hover tooltip to an anchor element. The whole anchor triggers it,
 * and the bubble is placed against the anchor's own box — never against a
 * glyph inside it: an anchor's padding is part of its control, and measuring
 * the icon made one bubble sit closer than the next wherever glyphs differ in
 * size (a 15px mark in the same 40px row as an 18px one put its bubble a pixel
 * higher, and a 20px mark in a 40px button put its bubble flush against the
 * button's edge). The frame's icon-only chrome buttons opt out with
 * `anchor="icon"`: see {@link iconAnchorRect}.
 * @param props.label - bubble text, or a resolver evaluated when the anchor renders.
 * @param props.side - preferred placement relative to the anchor (default 'right'); the
 * bubble flips or shifts where the viewport refuses it.
 * @param props.anchor - `'icon'` places the bubble against the control's glyph; `'box'`
 * (default) places it against the whole anchor.
 * @param props.boundary - resolves the element the bubble stays inside, flush with its
 * edges (e.g. a chat column); omitted or null keeps the viewport clamp at the page inset.
 * @param props.disabled - suppress the bubble while true, hiding one already open; the
 * anchor renders identically so toggling never remounts it.
 * @param props.children - a single anchor element; its own ref (callback or object) keeps receiving the element.
 * @returns the anchor; the bubble renders into `document.body` while open.
 */
export function Tooltip({ label, side = 'right', anchor = 'box', boundary, disabled = false, children }: {
  label: TooltipLabel
  side?: TooltipSide
  anchor?: 'box' | 'icon'
  boundary?: ((reference: Element) => Element | null) | undefined
  disabled?: boolean
  children: ReactElement<{ ref?: Ref<HTMLElement> }>
}) {
  const handle = useRef<TippyTooltipHandle>(null)

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  useEffect(() => {
    if (disabled) handle.current?.hide()
  }, [disabled])

  return (
    <TippyTooltip
      ref={handle}
      content={typeof label === 'function' ? label() : label}
      placement={side}
      trigger={disabled ? 'manual' : 'mouseenter'}
      touch={false}
      placementRect={anchor === 'icon' ? reference => iconAnchorRect(reference, side) : undefined}
      overflowPadding={anchor === 'icon' ? iconGutter : pageInset}
      overflowBoundary={boundary}
    >
      {children}
    </TippyTooltip>
  )
}
