/**
 * The reader's picture, ported from Aeven's `Avatar` component.
 *
 * A reader who has never uploaded one still gets a stable, recognisable mark:
 * three hues folded out of their user id drive a gradient, so the same reader
 * always sees the same colours and two readers rarely share them.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** What the avatar needs to draw itself. */
export interface AvatarProps {
  /** The reader's id, which seeds the gradient. */
  userId: string | null
  /** Absolute URL of the uploaded picture, absent until a reader sets one. */
  imageUrl?: string
  /** Draw a pointer cursor, as Aeven does for the menu trigger. */
  pointer?: boolean
  /** Localized alternative text for the picture. */
  alt: string
}

/** Milliseconds a picture may take before the spinner appears. */
const SPINNER_DELAY_MS = 400

/** Milliseconds the loaded picture takes to cover the spinner. */
const SETTLE_MS = 400

/** FNV-1a over the id, so the colours are stable across pages and reloads. */
function hashCode(value: string): number {
  let hash = 2166136261 >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * The three gradient stops for one reader.
 * @param userId - the reader's id, or null before one is known.
 * @returns three CSS colours, from the same folding Aeven uses.
 */
export function colorsFromId(userId: string | null): [string, string, string] {
  const hash = hashCode(userId ?? 'aeven')
  const hue1 = hash % 360
  const hue2 = (hue1 + 47 + (hash % 53)) % 360
  const hue3 = (hue2 + 61 + (hash % 37)) % 360
  return [`hsl(${hue1}, 70%, 82%)`, `hsl(${hue2}, 70%, 76%)`, `hsl(${hue3}, 60%, 72%)`]
}

/** The spinner Aeven shows while a picture loads. */
const SPINNER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"'
  + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>'

/**
 * Render the reader's avatar.
 * @param props - reader identity, optional picture, and cursor.
 * @returns the avatar element.
 */
export function Avatar({ userId, imageUrl, pointer, alt }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preloaded, setPreloaded] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // A picture that arrives quickly never shows a spinner at all.
  useEffect(() => {
    if (imageUrl === undefined || failed || preloaded) return
    timer.current = window.setTimeout(() => { setLoading(true) }, SPINNER_DELAY_MS)
    return () => { window.clearTimeout(timer.current) }
  }, [imageUrl, failed, preloaded])

  const onLoad = useCallback(() => {
    window.clearTimeout(timer.current)
    setLoading(false)
    timer.current = window.setTimeout(() => { setPreloaded(true) }, SETTLE_MS)
  }, [])

  const onError = useCallback(() => {
    window.clearTimeout(timer.current)
    setFailed(true)
  }, [])

  useEffect(() => () => { window.clearTimeout(timer.current) }, [])

  const [c1, c2, c3] = colorsFromId(userId)
  const showImage = imageUrl !== undefined && !failed

  return (
    <span className={pointer === true ? 'avatar pointer' : 'avatar'}>
      <span className="image-container">
        <div
          className={`image-loader${loading ? ' loading' : ''}${preloaded ? ' preloaded' : ''}`}
        >
          <span className="spinner" dangerouslySetInnerHTML={{ __html: SPINNER_SVG }} />
        </div>
        {showImage
          ? (
            <img
              src={imageUrl}
              alt={alt}
              className="image"
              loading="lazy"
              draggable="false"
              onLoad={onLoad}
              onError={onError}
            />
          )
          : (
            <span
              className="gradient"
              style={{ '--c1': c1, '--c2': c2, '--c3': c3 } as Record<string, string>}
            />
          )}
      </span>
    </span>
  )
}
