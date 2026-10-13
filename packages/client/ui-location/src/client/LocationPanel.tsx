/** Composer takeover that accompanies the browser's location prompt. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@aeven/client-ui-primitives'
import type { LocationComposerProps, PendingLocation } from './contract/slots.ts'
import { readDevicePosition } from './device-position.ts'
import css from './LocationPanel.module.css'

/**
 * Render one pending location request.
 * @param props - selector-matched request and standard Slot props.
 * @returns The location composer takeover.
 */
export function LocationPanel(props: LocationComposerProps) {
  return <LocationFlow key={props.matched.key} pending={props.matched} t={props.t} />
}

type Status =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Read the position as soon as the card shows, so the browser's own prompt is
 * the reader's one approval. A granted read answers the request; OK reads
 * again, and No declines this request only.
 */
function LocationFlow({ pending, t }: {
  pending: PendingLocation
  t: LocationComposerProps['t']
}) {
  const [status, setStatus] = useState<Status>({ kind: 'waiting' })
  const [reading, setReading] = useState(false)
  const active = useRef(true)
  const read = useCallback((): void => {
    setReading(true)
    setStatus({ kind: 'waiting' })
    void readDevicePosition().then((result) => {
      if (!active.current) return
      setReading(false)
      if (result.kind === 'device') {
        pending.answer(result)
        return
      }
      setStatus(result.kind === 'blocked' ? { kind: 'blocked' } : { kind: 'unavailable', reason: result.reason })
    })
  }, [pending])
  // The first read waits until the page is visible: a background window that
  // happens to show the session must not answer with a position the reader
  // never saw being requested.
  useEffect(() => {
    active.current = true
    if (document.visibilityState === 'visible') {
      read()
      return () => { active.current = false }
    }
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onVisible)
      read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active.current = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [read])
  const notice = status.kind === 'blocked'
    ? t('blocked')
    : status.kind === 'unavailable'
      ? t('unavailable', { reason: status.reason })
      : reading ? t('approvePrompt') : null
  return (
    <div className={css.root} data-location-key={pending.key} data-location-status={status.kind}>
      <div className={css.card} role="group" aria-label={t('title')}>
        <div className={css.body}>
          <div className={css.headline}>{t('title')}</div>
          {pending.purpose !== '' && <div className={css.purpose}>{pending.purpose}</div>}
          {notice !== null && (
            <div className={status.kind === 'waiting' ? css.explain : css.notice} role="status">{notice}</div>
          )}
        </div>
        <div className={css.actionRow}>
          <Button variant="outline" onClick={() => { pending.answer({ kind: 'declined' }) }}>{t('no')}</Button>
          {/* Always enabled: while the browser prompt is open a read never
              settles, and OK is how the reader asks again after dismissing it. */}
          <Button variant="primary" onClick={read}>{t('ok')}</Button>
        </div>
      </div>
    </div>
  )
}
