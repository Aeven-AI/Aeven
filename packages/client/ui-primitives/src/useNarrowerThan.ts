/**
 * Element-width breakpoints for components whose width is not the window's: a
 * conversation beside the right sidebar, a gap beside the transcript column.
 * No `@media` width can stand in for those, and a container query needs Safari
 * 16.0, below the client's iOS/Safari 14.5 baseline.
 */
import { useLayoutEffect, useState } from 'react'

/**
 * The content-box width of one element: its padding is not part of it, the way
 * a `ResizeObserver` entry's `contentRect` reports it.
 * @param element - the measured element.
 * @returns the width in CSS pixels.
 */
function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
}

/**
 * Track whether one element's content box is narrower than `minWidth`, as
 * state. The first value is measured before the first paint, so a narrow
 * element never paints its wide layout first; later values follow its resizes,
 * and a resize that stays on one side of the threshold re-renders nothing.
 * @param ref - the measured element.
 * @param minWidth - the threshold in CSS pixels.
 * @returns whether the element is below the threshold; false until it mounts,
 *   and where `ResizeObserver` is absent after the first measurement.
 */
export function useNarrowerThan(ref: { readonly current: HTMLElement | null }, minWidth: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    setNarrow(contentWidth(element) < minWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setNarrow(entry.contentRect.width < minWidth)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [ref, minWidth])
  return narrow
}
