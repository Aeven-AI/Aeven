/**
 * The share dialog's thumbnail: the card the link will unfurl with in chat apps,
 * drawn by the Aeven API for this message before the link exists. A grey sheet
 * with the loading mark holds its place and fades out once the card has loaded.
 * @module @aeven/client-ui-message-share/client/ShareThumb
 */

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@aeven/client-ui-primitives'
import type { MessageSharePreview } from '@aeven/host-message-share/types'
import type { ShareOutcome } from './slots.ts'
import css from './ShareAction.module.css'

/** Props of {@link ShareThumb}. */
export interface ShareThumbProps {
  /** Whether the dialog is open; each opening draws the card again. */
  readonly open: boolean
  /** Draws the card. */
  readonly load: () => Promise<ShareOutcome<MessageSharePreview>>
  /** Accessible name of the card. */
  readonly label: string
  /** Accessible name of the loading state. */
  readonly loadingLabel: string
}

/**
 * The card thumbnail with its loading sheet.
 * @param props - whether the dialog is open, the card loader, and the accessible names.
 * @returns the thumbnail, or null when the card cannot be drawn.
 */
export function ShareThumb({ open, load, label, loadingLabel }: ShareThumbProps) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  // The loader is read when the dialog opens, so a new function identity on a re-render draws nothing again.
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!open) return
    let current = true
    setSource(null)
    setFailed(false)
    setReady(false)
    void loadRef.current().then((result) => {
      if (!current) return
      if (result.ok) setSource(`data:${result.value.mediaType};base64,${result.value.data}`)
      else setFailed(true)
    })
    return () => { current = false }
  }, [open])

  if (failed) return null
  return (
    <div className={css.thumb} data-ready={ready || undefined}>
      {source !== null && (
        <img className={css.thumbImage} src={source} alt={label} onLoad={() => { setReady(true) }} onError={() => { setFailed(true) }} />
      )}
      <div className={css.thumbLoading} role="status" aria-label={loadingLabel} aria-hidden={ready || undefined}>
        <Spinner />
      </div>
    </div>
  )
}
