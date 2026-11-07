/**
 * Fit the document to the part of the window the reader can see. An on-screen
 * keyboard shrinks the visual viewport only: iOS Safari ignores the
 * `interactive-widget` viewport hint, so a frame sized against the layout
 * viewport keeps its floor, and the composer seated on it, under the keyboard,
 * while the browser pans the whole page to reveal the focused field.
 *
 * The follower publishes the visible height as `--avn-viewport-height` on the
 * root element, which `base.css` sizes the document from, and marks the root
 * with `data-avn-keyboard` while a keyboard covers part of the window. Height
 * is read as `height × scale`, so a pinch zoom, which shrinks the visual
 * viewport without covering anything, leaves the frame alone.
 */

/** A visible area this much shorter than the window means an on-screen keyboard rather than browser chrome. */
const KEYBOARD_MIN_PX = 120

/**
 * Follow the window's visual viewport for the life of the document.
 * @param win - the window whose viewport is followed.
 * @returns the disposer removing the listeners and the published facts.
 */
export function followVisualViewport(win: Window = window): () => void {
  const viewport = win.visualViewport
  if (viewport === null) return () => {}
  const root = win.document.documentElement
  const update = (): void => {
    const height = viewport.height * viewport.scale
    root.style.setProperty('--avn-viewport-height', `${String(Math.round(height))}px`)
    root.toggleAttribute('data-avn-keyboard', win.innerHeight - height > KEYBOARD_MIN_PX)
    // The document cannot scroll by design (base.css), but a browser revealing a focused field pans it anyway;
    // once the frame fits the visible area, that pan only pushes the top bar off screen. A pinch-zoomed reader
    // is panning on purpose.
    if (viewport.scale <= 1 && (win.scrollY !== 0 || win.scrollX !== 0)) win.scrollTo(0, 0)
  }
  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    root.style.removeProperty('--avn-viewport-height')
    root.removeAttribute('data-avn-keyboard')
  }
}
