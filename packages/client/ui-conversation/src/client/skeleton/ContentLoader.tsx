/** Content-column history overlay: appear immediately, fade out. */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Spinner } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ConversationRoot.module.css'

/** Fade duration shared with `.contentLoaderHide`. */
const FADE_MS = 400

/**
 * Overlay the conversation scrollport until its Session view has painted.
 * Mounted inside `.scrollArea`, so the box is the conversation root's width
 * and the scroll body's height; header and composer stay outside it. Showing
 * is synchronous so a Session switch covers the transcript on the same frame;
 * hiding fades opacity for {@link FADE_MS}.
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
      <Spinner className={css.contentLoaderSpinner} />
      <div className={css.contentLoaderBackground} aria-hidden="true" />
    </div>
  )
}
