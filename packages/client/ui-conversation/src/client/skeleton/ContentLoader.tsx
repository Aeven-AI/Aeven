/** Content-column history overlay: appear immediately, fade out. */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './ConversationRoot.module.css'

/** Fade duration shared with `.contentLoaderHide`. */
const FADE_MS = 400

/** Aeven content-loader spinner. */
const SPINNER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"'
  + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>'

/**
 * Overlay the transcript until its Session view has painted. Header and
 * composer stay outside this overlay. Showing is synchronous so a Session
 * switch covers the transcript on the same frame; hiding fades opacity for
 * {@link FADE_MS}.
 * @param active - True while the transcript should stay covered.
 * @param label - Localized accessible status text.
 */
export function ContentLoader({ active, label }: { active: boolean; label: string }) {
  const [shown, setShown] = useState(active)
  const [hiding, setHiding] = useState(false)
  if (active && (!shown || hiding)) {
    setShown(true)
    setHiding(false)
  }

  useEffect(() => {
    if (active || !shown) return
    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(false)
      setHiding(false)
      return
    }
    setHiding(true)
    const timer = window.setTimeout(() => {
      setShown(false)
      setHiding(false)
    }, FADE_MS)
    return () => { window.clearTimeout(timer) }
  }, [active, shown])

  if (!shown) return null
  return (
    <div
      className={clsx(css.contentLoader, hiding && css.contentLoaderHide)}
      data-content-loader=""
      data-hiding={hiding || undefined}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div
        className={css.contentLoaderSpinner}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: SPINNER_SVG }}
      />
      <div className={css.contentLoaderBackground} aria-hidden="true" />
    </div>
  )
}
