/**
 * The control that opens and closes the right sidebar, seated in the frame's
 * corner ahead of the account avatar.
 *
 * It sits in the frame's corner rather than in the conversation's navigation
 * band or in the panel itself. The band is laid out inside the centre column,
 * which the panel takes its width from, so a control there travels left as
 * the panel opens and ends up beneath it; the panel's own interior is
 * zero-wide while collapsed and has nowhere to put a way back in. The corner
 * is laid out against the frame, so one control holds one place and serves
 * both directions.
 *
 * The seat is root-scoped, so the session the panel belongs to is read here
 * from the global session list rather than injected.
 */
import { IconLucidePanelRight, Tooltip } from '@aeven/client-ui-primitives'
import type { ToggleButtonComponentProps } from './contract/slots.ts'
import css from './ToggleButton.module.css'

/** The right sidebar's corner toggle (see module doc). */
export function ToggleButton({ useSessions, rightbarCollapsed, toggleRightbar, t }: ToggleButtonComponentProps) {
  const sessionId = useSessions(s => s.current)
  // Without a session there is no panel to open, and so no control.
  if (sessionId === undefined) return null
  const label = rightbarCollapsed ? t('toggle.open') : t('toggle.collapse')
  return (
    <Tooltip label={label} side="bottom-end">
      <button
        type="button"
        className={css.toggle}
        aria-label={label}
        aria-expanded={!rightbarCollapsed}
        onClick={() => { toggleRightbar(sessionId) }}
      >
        <IconLucidePanelRight className={css.toggleIcon} />
      </button>
    </Tooltip>
  )
}
