/** Draft-attachment thumbnail rail with native horizontal scrolling. */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { IconCloseFill14 } from '@aeven/client-ui-primitives'
import css from './AttachmentRail.module.css'

/** One rail thumbnail; strings arrive resolved (zero-cordis atom). */
export interface AttachmentRailItem {
  /** Stable identity for the React key. */
  id: string
  /** Object or data URL rendered as the thumbnail. */
  previewUrl: string
  /** Image alt text (display name with the owner's fallback applied). */
  alt: string
  /** Accessible label of the item's remove control. */
  removeLabel: string
}

/** Rail-level strings the owner resolves from its own locale namespace. */
export interface AttachmentRailLabels {
  /** Accessible name of the rail group. */
  group: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
}

/** Approximate pixels per wheel step for `deltaMode` LINE deltas (Firefox
 * notch wheels report lines, not pixels). */
const WHEEL_LINE_PX = 16

/**
 * Horizontal thumbnail rail over the caller's draft attachments.
 *
 * A vertical wheel pans the rail horizontally and is consumed exclusively.
 * A newly added item is revealed at the rail's end while a rail that mounts
 * over an existing draft keeps its start position. Each thumbnail opens on a
 * single click and reveals its remove control on hover or focus.
 *
 * @param props.items - resolved thumbnails in draft order.
 * @param props.labels - rail-level strings (group name and open tooltip).
 * @param props.onOpen - single-click open of one item's original image.
 * @param props.onRemove - remove one item from the draft.
 * @returns the horizontally scrolling rail group.
 */
export function AttachmentRail<T extends AttachmentRailItem>({ items, labels, onOpen, onRemove }: {
  items: readonly T[]
  labels: AttachmentRailLabels
  onOpen: (item: T) => void
  onRemove: (item: T) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  // null marks the first layout pass: a rail that MOUNTS over an existing
  // draft (session switch back to held images) is initial display, not
  // growth, and must not jump to the end.
  const countRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const grew = countRef.current !== null && items.length > countRef.current
    countRef.current = items.length
    const el = railRef.current
    /* v8 ignore next -- defensive: the rail div renders unconditionally, so the layout effect always finds it. */
    if (el === null) return
    // A newly added attachment lands at the rail's end: reveal it.
    if (grew) el.scrollLeft = el.scrollWidth - el.clientWidth
  }, [items.length])
  useEffect(() => {
    const el = railRef.current
    /* v8 ignore next -- defensive: the rail div renders unconditionally, so the mount effect always finds it. */
    if (el === null) return
    // The rail scrolls horizontally ONLY: any wheel tick with a vertical
    // component is consumed — without preventDefault it would also scroll the
    // conversation behind the composer, and React's root wheel listener is
    // passive, so the exclusion needs this manually attached non-passive
    // listener. A diagonal trackpad pan keeps its horizontal intent; a pure
    // vertical wheel converts to a horizontal step, with LINE and PAGE deltas
    // (Firefox notch wheels) normalized to pixels before the per-tick clamp
    // that keeps a fast wheel followable. A purely horizontal pan stays
    // native.
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (event.deltaY === 0) return
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1
      event.preventDefault()
      el.scrollBy({
        left: event.deltaX !== 0
          ? event.deltaX * scale
          : Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * scale, 60),
        behavior: 'auto',
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])
  return (
    <div className={css.root}>
      <div
        ref={railRef}
        className={css.rail}
        role="group"
        aria-label={labels.group}
      >
        {items.map(item => (
          <div key={item.id} className={css.item}>
            <button
              type="button"
              className={css.thumbnail}
              title={labels.open}
              onClick={() => { onOpen(item) }}
            >
              <img src={item.previewUrl} alt={item.alt} />
            </button>
            <button
              type="button"
              className={css.remove}
              aria-label={item.removeLabel}
              onClick={() => { onRemove(item) }}
            >
              <IconCloseFill14 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
