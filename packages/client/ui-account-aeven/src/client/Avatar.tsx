/**
 * The reader's picture, ported from Aeven's `Avatar` component.
 *
 * A reader who has never uploaded one gets the first letter of their display
 * name, or of their email address when they have no name, on a black disc.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** What the avatar needs to draw itself. */
export interface AvatarProps {
  /** The reader's display name, the preferred source of the initial. */
  name?: string
  /** The reader's email address, the initial's source when there is no name. */
  email?: string
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

/**
 * The letter drawn in place of a missing picture.
 * @param name - the reader's display name, if any.
 * @param email - the reader's email address, if any.
 * @returns the upper-cased first character of the first non-blank source, or an empty string when neither has one.
 */
export function initialOf(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.trim() || ''
  const [first = ''] = source
  return first.toUpperCase()
}

/** The spinner Aeven shows while a picture loads. */
const SPINNER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"'
  + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>'

/**
 * Render the reader's avatar.
 * @param props - reader name and email, optional picture, and cursor.
 * @returns the avatar element.
 */
export function Avatar({ name, email, imageUrl, pointer, alt }: AvatarProps) {
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
            <span className="initial" aria-hidden="true">{initialOf(name, email)}</span>
          )}
      </span>
    </span>
  )
}
