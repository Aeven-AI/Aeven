/**
 * The lucide glyphs t3code's browser chrome uses (lucide v0.564.0, ISC).
 *
 * Inlined rather than imported: `lucide-react` publishes a single CommonJS
 * entry, so the client bundle would carry every icon for these ten.
 */
import type { ReactNode } from 'react'

/** Props every glyph accepts. */
export interface GlyphProps {
  /** Rendered width and height in pixels; defaults to the surrounding CSS. */
  size?: number
  className?: string
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
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {body}
    </svg>
  )
}

export const ArrowLeft = glyph(<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>)
export const ArrowRight = glyph(<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>)
export const RefreshCw = glyph(<>
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />
</>)
export const ExternalLink = glyph(<>
  <path d="M15 3h6v6" /><path d="M10 14 21 3" />
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
</>)
export const Camera = glyph(<>
  <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
  <circle cx="12" cy="13" r="3" />
</>)
export const MoreVertical = glyph(<><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></>)
export const Check = glyph(<path d="M20 6 9 17l-5-5" />)
export const Minus = glyph(<path d="M5 12h14" />)
export const Plus = glyph(<><path d="M5 12h14" /><path d="M12 5v14" /></>)
export const RotateCcw = glyph(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>)
