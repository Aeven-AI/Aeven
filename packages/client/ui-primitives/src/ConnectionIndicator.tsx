import { createPortal } from 'react-dom'
import { IconCheckOutline16, IconCloseOutline16, IconLucideRefreshCw } from './icons/index.tsx'
import { Spinner } from './Spinner.tsx'
import css from './ConnectionIndicator.module.css'

/** Visual state rendered by {@link ConnectionIndicator}. */
export type ConnectionIndicatorState =
  | 'disconnected'
  | 'connecting'
  | 'recovered'

/**
 * Render the connection-recovery toast: a floating card centered at the top of
 * the viewport, portaled to `document.body` so no sidebar or transformed
 * ancestor clips it. The outage state carries an immediate-reconnect icon
 * button; every state carries a dismiss button. The outage state shows no
 * leading glyph; a retry shows the shared loading spinner and recovery a check.
 * Each glyph, the reconnect button, and the dismiss button sit in a 30px disc
 * of the base surface, and the trailing buttons hold the toast's end.
 * @param props.state - visible outage, retry-attempt, or recovered state.
 * @param props.disconnectedLabel - localized outage text.
 * @param props.connectingLabel - localized retry text.
 * @param props.recoveredLabel - localized recovery confirmation.
 * @param props.reconnectActionLabel - accessible label for the reconnect button.
 * @param props.dismissLabel - accessible label for the dismiss button.
 * @param props.onReconnect - request an immediate reconnect attempt.
 * @param props.onDismiss - hide the toast; the owner decides when it returns.
 * @returns the toast, or null when no connection feedback is active.
 */
export function ConnectionIndicator({
  state,
  disconnectedLabel,
  connectingLabel,
  recoveredLabel,
  reconnectActionLabel,
  dismissLabel,
  onReconnect,
  onDismiss,
}: {
  state: ConnectionIndicatorState | undefined
  disconnectedLabel: string
  connectingLabel: string
  recoveredLabel: string
  reconnectActionLabel: string
  dismissLabel: string
  onReconnect: () => void
  onDismiss: () => void
}) {
  if (state === undefined) return null
  const recovered = state === 'recovered'
  const connecting = state === 'connecting'
  return createPortal(
    <div
      className={recovered ? `${css.toast} ${css.success}` : css.toast}
      data-phase={state}
      role={recovered ? 'status' : 'alert'}
    >
      {state !== 'disconnected' && (
        <span className={css.icon} aria-hidden="true">
          {recovered ? <IconCheckOutline16 size={14} /> : <Spinner />}
        </span>
      )}
      <span className={css.label}>
        {recovered && recoveredLabel}
        {state === 'disconnected' && disconnectedLabel}
        {connecting && connectingLabel}
      </span>
      <span className={css.end}>
        {state === 'disconnected' && (
          <button
            type="button"
            className={css.action}
            aria-label={reconnectActionLabel}
            onClick={onReconnect}
          >
            <IconLucideRefreshCw />
          </button>
        )}
        <button type="button" className={css.dismiss} aria-label={dismissLabel} onClick={onDismiss}>
          <IconCloseOutline16 size={14} />
        </button>
      </span>
    </div>,
    document.body,
  )
}
