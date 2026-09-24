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
 * The box a bubble points at: the icon of an icon-only control, so the arrow
 * sits on the glyph rather than the centre of its padded hit area; the whole
 * anchor otherwise (a control with visible text is pointed at as a whole).
 * @param reference - the tooltip's trigger element.
 * @returns the icon's box, or the anchor's.
 */
function iconRect(reference: Element): DOMRect {
  const icon = reference.querySelector('svg')
  if (icon === null || (reference.textContent ?? '').trim() !== '') return reference.getBoundingClientRect()
  return icon.getBoundingClientRect()
}

/**
 * Attach a hover tooltip to an anchor element. The whole anchor triggers it;
 * on an icon-only anchor the bubble and its arrow are placed against the icon.
 * @param props.label - bubble text, or a resolver evaluated when the anchor renders.
 * @param props.side - preferred placement relative to the anchor (default 'right'); the
 * bubble flips or shifts where the viewport refuses it.
 * @param props.disabled - suppress the bubble while true, hiding one already open; the
 * anchor renders identically so toggling never remounts it.
 * @param props.children - a single anchor element; its own ref (callback or object) keeps receiving the element.
 * @returns the anchor; the bubble renders into `document.body` while open.
 */
export function Tooltip({ label, side = 'right', disabled = false, children }: { label: TooltipLabel; side?: TooltipSide; disabled?: boolean; children: ReactElement<{ ref?: Ref<HTMLElement> }> }) {
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
      placementRect={iconRect}
      overflowPadding={pageInset}
    >
      {children}
    </TippyTooltip>
  )
}
