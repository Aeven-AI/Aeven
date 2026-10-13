/**
 * The Æven mark: the angled monogram the product signs itself with.
 *
 * Geometry carried over from the reference client's sidebar logo and the
 * shipped favicon, which draw the same eight bars, so the mark a reader sees
 * in the tab is the mark the sidebar shows.
 * @module
 */

import type { IconProps } from './icons/props.ts'

/** Native viewBox of the mark (width and height in user units). */
export const AEVEN_MARK_VIEWBOX = { width: 671, height: 581 }

/** The monogram's bars, in the reference's drawing order. */
const AEVEN_MARK_PATHS = [
  'm225.301 0 305.5 529.142-43.301 25L182 25z',
  'M140 529.141 445.5 0l43.302 25-305.5 529.141z',
  'M167.901 530.059h335v50h-335z',
  'm43.302 264.5 167.5 290.119-43.302 25L0 289.5zM503.302 0l167.5 290.119-43.302 25L460 25z',
  'M460 554.618 627.5 264.5l43.301 25-167.5 290.118zM0 290.118 167.5 0 210.8 25l-167.5 290.118z',
  'M167.5 0h57.8v50h-57.8zM445.5 0h57.8v50h-57.8zM72.5 405.3 306.5 0l43.302 25-234 405.3z',
  'm364.301 0 234 405.3-43.3 25L321 25z',
  'M306.5 0h57.8v50h-57.8z',
] as const

/**
 * Render the Æven mark.
 * @param props.size - width in px (default 24; height follows the artwork).
 * @param props.className - extra class for layout placement.
 * @returns the monogram svg (aria-hidden decorative brand art).
 */
export function AevenMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * AEVEN_MARK_VIEWBOX.height) / AEVEN_MARK_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${AEVEN_MARK_VIEWBOX.width} ${AEVEN_MARK_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      {AEVEN_MARK_PATHS.map(path => <path key={path} d={path} fill="currentColor" />)}
    </svg>
  )
}
