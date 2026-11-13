/**
 * The lucide glyphs the meeting pane uses beyond the ui-primitives set
 * (lucide-static v1.72.0, ISC), drawn at the 1.75 stroke of that set.
 */
import type { ReactNode } from 'react'

/**
 * Build a glyph component from lucide's 24×24 stroke paths; sized by CSS.
 * @param body - the SVG children.
 * @returns the glyph component.
 */
function glyph(body: ReactNode): () => ReactNode {
  return () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {body}
    </svg>
  )
}

/** lucide `message-square-plus`: add the transcript to the chat. */
export const MessageSquarePlus = glyph(<>
  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  <path d="M12 8v6" />
  <path d="M9 11h6" />
</>)

/** lucide `list`: the saved recordings. */
export const List = glyph(<>
  <path d="M3 5h.01" />
  <path d="M3 12h.01" />
  <path d="M3 19h.01" />
  <path d="M8 5h13" />
  <path d="M8 12h13" />
  <path d="M8 19h13" />
</>)

/** Filled rounded square: stop. */
export const StopSquare = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden>
    <rect width="12" height="12" x="6" y="6" rx="2.5" fill="currentColor" />
  </svg>
)
