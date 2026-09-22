/** Session-switch cover: appear immediately, fade out. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Spinner } from '@aeven/client-ui-primitives'
import css from './ConversationRoot.module.css'

/** Fade duration shared with `.contentLoaderHide`. */
const FADE_MS = 400

/**
 * The frame's cover layer, or `null` before the frame has mounted one. The
 * node is the shell's, so this reads it from the document rather than holding
 * a reference the conversation has no way to be given.
 * @returns the layer element, or null where the shell renders none.
 */
function coverLayer(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector('[data-shell-cover]')
}

/**
 * Cover every column the Session switch is about to replace until its view
 * has painted. The box is the frame's cover layer — the conversation column,
 * the details and right sidebar columns, and the header and composer laid
 * over them — so one surface settles instead of a transcript blanking inside
 * chrome that stayed put. The left sidebar and the frame's corner controls
 * stay clear of it (ui-layout AppFrame.module.css).
 *
 * Showing is synchronous so a Session switch covers the transcript on the
 * same frame; hiding fades opacity for {@link FADE_MS}.
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

  // The layer is a sibling node the frame owns, so the cover renders into it
  // rather than into the conversation column, which clips it and is outranked
  // by the header and composer laid over that column. Resolved per render
  // while shown: the frame mounts the node before this tree can be covered,
  // and re-reading costs one selector call against a node that never moves.
  const layer = shown ? coverLayer() : null
  if (!shown || layer === null) return null
  return createPortal(
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
    </div>,
    layer,
  )
}
