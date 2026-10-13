/**
 * The lucide glyphs the device pane uses (lucide v0.564.0, ISC), drawn at the
 * 1.75 stroke of the ui-primitives lucide set.
 *
 * Inlined rather than imported: `lucide-react` publishes a single CommonJS
 * entry, so the client bundle would carry every icon for these few.
 */
import type { ReactNode } from 'react'

/** Props every glyph accepts. */
export interface GlyphProps {
  /** Rendered width and height in pixels; defaults to the surrounding CSS. */
  size?: number
  className?: string | undefined
}

/**
 * Build a glyph component from lucide's 24×24 stroke paths.
 * @param body - the SVG children.
 * @returns the glyph component.
 */
function glyph(body: ReactNode): (props: GlyphProps) => ReactNode {
  return ({ size, className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {body}
    </svg>
  )
}

export const Home = glyph(<>
  <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
  <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
</>)
export const ChevronLeft = glyph(<path d="m15 18-6-6 6-6" />)
export const ChevronDown = glyph(<path d="m6 9 6 6 6-6" />)
export const Square = glyph(<rect width="18" height="18" x="3" y="3" rx="2" />)
export const RotateCcw = glyph(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>)
export const List = glyph(<>
  <path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" />
  <path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" />
</>)
export const Power = glyph(<><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></>)
export const Check = glyph(<path d="M20 6 9 17l-5-5" />)
export const CircleAlert = glyph(<>
  <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />
</>)
export const CirclePlay = glyph(<>
  <circle cx="12" cy="12" r="10" />
  <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" />
</>)
