import type { ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lift a fullscreen block onto `document.body`.
 *
 * WebKit treats the transcript scroller as the containing block for
 * `position: fixed`, so an in-flow overlay only covers the conversation
 * column. A hidden spacer keeps the reserved height so opening fullscreen
 * does not jump the scroll.
 *
 * @param tree - The fullscreen wrapper.
 * @param spacerClass - In-flow class list, without `fullscreen`.
 * @param height - Measured height of the in-flow box before the lift.
 * @returns The spacer plus the portaled tree, or `tree` during SSR.
 */
export function portalFullscreen(
  tree: ReactElement,
  spacerClass: string,
  height: number | undefined,
): ReactNode {
  if (typeof document === 'undefined') {
    return tree
  }

  return (
    <>
      <div
        className={spacerClass}
        aria-hidden="true"
        style={{ visibility: 'hidden', height }}
      />
      {createPortal(
        <div className="hypermarkdown">{tree}</div>,
        document.body,
      )}
    </>
  )
}
