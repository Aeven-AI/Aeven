import { createPortal } from 'react-dom'
import { IconCheckOutline16, IconCloseOutline16, IconWarningOutline16 } from './icons/index.tsx'
import css from './ConnectionIndicator.module.css'

/** Visual state rendered by {@link ConnectionIndicator}. */
export type ConnectionIndicatorState =
  | 'disconnected'
  | 'connecting'
  | 'recovered'

/**
 * Render the connection-recovery toast: a floating card centered at the top of
 * the viewport, portaled to `document.body` so no sidebar or transformed
 * ancestor clips it. Outage and retry states carry an immediate-reconnect
 * action; every state carries a dismiss button. The state glyph and the
 * dismiss control each sit in a 30px disc of the base surface, and the
 * trailing controls hold the toast's end.
 * @param props.state - visible outage, retry-attempt, or recovered state.
 * @param props.disconnectedLabel - localized outage text.
 * @param props.reconnectLabel - localized reconnect action text.
 * @param props.connectingLabel - localized retry text followed by the attempt dots.
 * @param props.recoveredLabel - localized recovery confirmation.
 * @param props.reconnectActionLabel - accessible label for the outage action.
 * @param props.restartActionLabel - accessible label for replacing an active attempt.
 * @param props.dismissLabel - accessible label for the dismiss button.
 * @param props.onReconnect - request an immediate reconnect attempt.
 * @param props.onDismiss - hide the toast; the owner decides when it returns.
 * @returns the toast, or null when no connection feedback is active.
 */
export function ConnectionIndicator({
  state,
  disconnectedLabel,
  reconnectLabel,
  connectingLabel,
  recoveredLabel,
  reconnectActionLabel,
  restartActionLabel,
  dismissLabel,
  onReconnect,
  onDismiss,
}: {
  state: ConnectionIndicatorState | undefined
  disconnectedLabel: string
  reconnectLabel: string
  connectingLabel: string
  recoveredLabel: string
  reconnectActionLabel: string
  restartActionLabel: string
  dismissLabel: string
  onReconnect: () => void
  onDismiss: () => void
}) {
  if (state === undefined) return null
  const recovered = state === 'recovered'
  const connecting = state === 'connecting'
  return createPortal(
    <div
      className={`${css.toast} ${recovered ? css.success : css.warning}`}
      data-phase={state}
      role={recovered ? 'status' : 'alert'}
    >
      <span className={css.icon} aria-hidden="true">
        {recovered ? <IconCheckOutline16 size={14} /> : <IconWarningOutline16 size={14} />}
      </span>
      <span className={css.label}>
        {recovered && recoveredLabel}
        {state === 'disconnected' && disconnectedLabel}
        {connecting && (
          <>
            {connectingLabel}
            <span className={css.dots} aria-hidden="true">
              <span>.</span>
              <span className={css.secondDot}>.</span>
              <span className={css.thirdDot}>.</span>
            </span>
          </>
        )}
      </span>
      <span className={css.end}>
        {!recovered && (
          <button
            type="button"
            className={css.action}
            aria-label={connecting ? restartActionLabel : reconnectActionLabel}
            onClick={onReconnect}
          >
            {reconnectLabel}
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
