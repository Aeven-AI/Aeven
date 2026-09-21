/**
 * The header control that opens the right sidebar, seated beside the other
 * navigation utilities and ahead of the account avatar.
 *
 * It sits in the header rather than in the panel because a collapsed column
 * is zero-wide at the frame's edge: a control inside it would have to hang
 * over the conversation to stay reachable, which is the left sidebar's
 * arrangement mirrored into a corner the header already occupies.
 *
 * The seat is root-scoped, so the session the panel belongs to is read here
 * from the global session list rather than injected.
 */
import { IconPanelRightOutline16, Tooltip } from '@aeven/client-ui-primitives'
import type { ToggleButtonComponentProps } from './contract/slots.ts'
import css from './ToggleButton.module.css'

/** The right sidebar's header toggle (see module doc). */
export function ToggleButton({ useSessions, toggleRightbar, t }: ToggleButtonComponentProps) {
  const sessionId = useSessions(s => s.current)
  // Without a session there is no panel to open, and so no control.
  if (sessionId === undefined) return null
  return (
    <Tooltip label={t('toggle.open')} delayMs={500}>
      <button
        type="button"
        className={css.toggle}
        aria-label={t('toggle.open')}
        onClick={() => { toggleRightbar(sessionId) }}
      >
        <IconPanelRightOutline16 size={18} />
      </button>
    </Tooltip>
  )
}
