/**
 * Viewport placement for an absolutely positioned card that opens beside the
 * row it belongs to, and for the popup that holds such rows.
 *
 * The card's stylesheet places it after the row (`left: calc(100% + gap)`),
 * and that is where it stays when the viewport has the room. When it would
 * cross the trailing edge, the card takes the row's leading side; when neither
 * side has room (a phone, where popup plus card is wider than the screen), it
 * is stacked above its own row and slid sideways until both of its edges sit
 * inside the viewport margin. The row stays visible under the stacked card, so
 * a second press on it still closes the card.
 * @module @aeven/client-ui-primitives/useBesidePlacement
 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Which side of its row {@link useBesidePlacement} gave the card. */
export type BesideSide = 'end' | 'start' | 'stacked'

/** Inputs for {@link useBesidePlacement}. */
export interface BesidePlacementOptions {
  /** Whether the card is mounted and should be placed. */
  open: boolean
  /** The row's seat: the card's containing block, measured in viewport coordinates. */
  anchorRef: RefObject<HTMLElement | null>
  /** The card, measured so the side choice uses its real width. */
  panelRef: RefObject<HTMLElement | null>
  /** Distance between the seat's edge and the card on either side; the stylesheet's own `left` offset. */
  gap: number
  /** Distance kept between a stacked card's bottom edge and its row's top edge. */
  lift: number
  /** Distance kept between the card and each viewport edge. */
  margin: number
}

/** Where the card landed: the chosen side and the inline style that puts it there. */
export interface BesidePlacement {
  /** The chosen side, so an owner can measure vertical room from the right edge of the row. */
  side: BesideSide
  /** Inline overrides for the stylesheet's `end` placement; undefined on the `end` side itself. */
  style: CSSProperties | undefined
}

interface Measured {
  side: BesideSide
  /** Stacked card's left edge relative to the seat, in px; zero on the other sides. */
  left: number
}

/**
 * Choose the card's side from the seat's viewport rect and the card's width,
 * and keep it current while the card is open.
 * @param options - the open state, the two refs, and the gap/lift/margin distances.
 * @returns the chosen side and the inline style for the card.
 */
export function useBesidePlacement(options: BesidePlacementOptions): BesidePlacement {
  const { open, anchorRef, panelRef, gap, lift, margin } = options
  const [measured, setMeasured] = useState<Measured>({ side: 'end', left: 0 })
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      /* v8 ignore start -- geometry read from real layout: jsdom reports zero
         sizes, so the side arms are exercised in the browser. */
      const rect = anchorRef.current?.getBoundingClientRect()
      const width = panelRef.current?.offsetWidth ?? 0
      if (rect === undefined || width === 0) return
      const viewport = window.innerWidth
      let next: Measured
      if (rect.right + gap + width <= viewport - margin) next = { side: 'end', left: 0 }
      else if (rect.left - gap - width >= margin) next = { side: 'start', left: 0 }
      else next = { side: 'stacked', left: clampInto(rect.left, width, margin, viewport) - rect.left }
      /* v8 ignore stop */
      setMeasured(current => (current.side === next.side && current.left === next.left ? current : next))
    }
    return observePlacement(place, panelRef.current)
  }, [open, anchorRef, panelRef, gap, margin])
  return {
    side: measured.side,
    style: measured.side === 'end'
      ? undefined
      : measured.side === 'start'
        ? { left: 'auto', right: `calc(100% + ${String(gap)}px)` }
        : { left: `${String(measured.left)}px`, bottom: `calc(100% + ${String(lift)}px)` },
  }
}

/** Inputs for {@link useViewportClamp}. */
export interface ViewportClampOptions {
  /** Whether the panel is mounted and should be clamped. */
  open: boolean
  /** The panel's containing block; the stylesheet aligns the panel's left edge with it. */
  anchorRef: RefObject<HTMLElement | null>
  /** The panel, measured so the clamp uses its real width. */
  panelRef: RefObject<HTMLElement | null>
  /** Distance kept between the panel and each viewport edge. */
  margin: number
}

/**
 * Slide a left-aligned absolutely positioned panel sideways so both of its
 * edges stay inside the viewport margin, wherever its anchor is seated.
 * @param options - the open state, the two refs, and the margin.
 * @returns the inline `left` for the panel, or undefined while no shift is needed.
 */
export function useViewportClamp(options: ViewportClampOptions): CSSProperties | undefined {
  const { open, anchorRef, panelRef, margin } = options
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      /* v8 ignore start -- geometry read from real layout, as above. */
      const rect = anchorRef.current?.getBoundingClientRect()
      const width = panelRef.current?.offsetWidth ?? 0
      if (rect === undefined || width === 0) return
      setShift(clampInto(rect.left, width, margin, window.innerWidth) - rect.left)
      /* v8 ignore stop */
    }
    return observePlacement(place, panelRef.current)
  }, [open, anchorRef, panelRef, margin])
  return shift === 0 ? undefined : { left: `${String(shift)}px` }
}

/** The left edge nearest to `left` that keeps a `width`-wide box inside the viewport margin. */
function clampInto(left: number, width: number, margin: number, viewport: number): number {
  return Math.max(margin, Math.min(left, viewport - width - margin))
}

/**
 * Run `place` now and again on resize, capture-phase scroll, and the panel's
 * own size changes (a catalogue arriving inside it widens it without either
 * window event). The guard keeps the hooks usable where `ResizeObserver` is
 * absent, which is how jsdom runs.
 */
function observePlacement(place: () => void, panel: HTMLElement | null): () => void {
  place()
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  let observer: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined' && panel !== null) {
    observer = new ResizeObserver(place)
    observer.observe(panel)
  }
  return () => {
    observer?.disconnect()
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, true)
  }
}
