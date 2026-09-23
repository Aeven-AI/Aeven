/**
 * Distinguish a reader's hover from content moving under a resting pointer.
 *
 * When a streaming transcript grows or scrolls, the browser re-targets the
 * resting pointer and dispatches `mouseover`/`mouseenter` on whatever now lies
 * under it, with no `pointermove`. A hover the reader made is always preceded
 * by a trusted `pointermove` in the same input frame, so tooltips open only on
 * an enter that follows real pointer movement.
 */

/** How recent the last real pointer movement must be for an enter to count as the reader's. */
const MOVE_WINDOW_MS = 100

let lastMoveAt = Number.NEGATIVE_INFINITY
let listening = false

/**
 * Start recording real pointer movement. Idempotent; a no-op outside a browser.
 * Call it when a hover-triggered surface mounts, before any enter can arrive.
 */
export function watchPointerIntent(): void {
  if (listening || typeof document === 'undefined') {
    return
  }

  listening = true
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.isTrusted) {
        lastMoveAt = event.timeStamp
      }
    },
    { capture: true, passive: true },
  )
}

/**
 * Whether the pointer really moved just now, so an enter at `timeStamp` is a
 * reader's hover rather than content shifting under a resting pointer.
 * @param timeStamp - the enter event's `timeStamp`, or now when omitted.
 * @returns true when real pointer movement preceded the enter.
 */
export function pointerMovedRecently(timeStamp?: number): boolean {
  const at = timeStamp ?? performance.now()

  return at - lastMoveAt <= MOVE_WINDOW_MS
}
