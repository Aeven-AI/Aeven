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
 * The box an icon-anchored bubble is placed against: across the placement
 * axis it is the control's icon, so the arrow sits on the glyph's centre;
 * along it, the control's own edge pulled in by `--dsw-aeven-tooltip-icon-offset`
 * (read from the control, so a control or its group can restate it), which
 * brings the bubble closer to a glyph centred in a padded button. A control
 * without an icon keeps its own box.
 * @param reference - the tooltip's trigger element.
 * @param side - the bubble's placement.
 * @returns the placement box.
 */
function iconAnchorRect(reference: Element, side: TooltipSide): DOMRect {
  const box = reference.getBoundingClientRect()
  const icon = reference.querySelector('svg')
  if (icon === null) return box
  const glyph = icon.getBoundingClientRect()
  const offset = Number.parseFloat(getComputedStyle(reference).getPropertyValue('--dsw-aeven-tooltip-icon-offset')) || 0
  if (side === 'left' || side === 'right') {
    const left = side === 'left' ? box.left + offset : box.left
    const right = side === 'right' ? box.right - offset : box.right
    return new DOMRect(left, glyph.top, right - left, glyph.height)
  }
  const top = side.startsWith('top') ? box.top + offset : box.top
  const bottom = side.startsWith('bottom') ? box.bottom - offset : box.bottom
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
 * @param props.anchor - `'icon'` points the arrow at the control's icon and pulls the bubble
 * in by the icon offset token; `'box'` (default) places it against the whole anchor.
 * @param props.disabled - suppress the bubble while true, hiding one already open; the
 * anchor renders identically so toggling never remounts it.
 * @param props.children - a single anchor element; its own ref (callback or object) keeps receiving the element.
 * @returns the anchor; the bubble renders into `document.body` while open.
 */
export function Tooltip({ label, side = 'right', anchor = 'box', disabled = false, children }: {
  label: TooltipLabel
  side?: TooltipSide
  anchor?: 'box' | 'icon'
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
    >
      {children}
    </TippyTooltip>
  )
}
