/**
 * The surface column's full screen toggle, seated in the frame's corner ahead
 * of the right sidebar's own toggle. It fades in while the sidebar is open and
 * out while it is collapsed; collapsing also leaves full screen, so the column
 * reopens at its width.
 */
import { useEffect } from 'react'
import { IconLucideMaximize2, IconLucideMinimize2, Tooltip } from '@aeven/client-ui-primitives'
import type { FullscreenButtonComponentProps } from './contract/slots.ts'
import { useFullscreen } from './fullscreen.ts'
import css from './FullscreenButton.module.css'

/** The corner's full screen toggle (see module doc). */
export function FullscreenButton({ useSessions, rightbarCollapsed, fullscreen, t }: FullscreenButtonComponentProps) {
  const sessionId = useSessions(s => s.current)
  const active = useFullscreen(fullscreen, sessionId)
  useEffect(() => {
    if (rightbarCollapsed && active) fullscreen.set(null)
  }, [active, fullscreen, rightbarCollapsed])
  if (sessionId === undefined) return null
  const label = active ? t('fullscreen.exit') : t('fullscreen.enter')
  return (
    <Tooltip label={label} side="bottom" anchor="icon" disabled={rightbarCollapsed}>
      <button
        type="button"
        className={css.toggle}
        data-hidden={rightbarCollapsed || undefined}
        aria-hidden={rightbarCollapsed || undefined}
        tabIndex={rightbarCollapsed ? -1 : undefined}
        aria-label={label}
        aria-pressed={active}
        onClick={() => { fullscreen.set(active ? null : sessionId) }}
      >
        {active ? <IconLucideMinimize2 className={css.icon} /> : <IconLucideMaximize2 className={css.icon} />}
      </button>
    </Tooltip>
  )
}
