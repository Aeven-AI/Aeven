/**
 * Sidebar shell: column geometry only, ported from the Aeven client's sidebar.
 * Collapse is one CSS state (`.visible`) driving four simultaneous 400ms
 * transitions — content width, panel width and opacity, menu-button width, and
 * chevron opacity. The shell repositions and remounts nothing while that runs,
 * so the motion stays continuous; the AppFrame grid track slides the layout on
 * the same duration and curve.
 *
 * The workspace/session browsing region between the New Session button and the
 * foot is the `sidebar.workspaces` registrant's, and the foot holds
 * `sidebar.settings` plus `sidebar.footer.action`; the shell hands them the
 * wide flag (plus an expand request callback for the browser). That flag stays
 * true for the whole collapse so occupants never re-lay-out mid-slide.
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import {
  FishLogo, IconChevronsLeftOutline14, IconMenuOutline16, IconNewChatOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  // The panel holds its expanded width while it slides shut, so the content
  // inside narrows from the last real column width rather than snapping to a
  // stale one. CSS reads it as --dsh-sidebar-width.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])


  return (
    <div
      ref={column}
      className={clsx(css.root, !collapsed && css.visible, !pointerInside && css.quietBars)}
      style={{ '--dsh-sidebar-width': `${String(collapsed ? lastWideWidth.current : width)}px` } as CSSProperties}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={css.content}>
        {/* The replaceable brand remains available to deployments; Aeven's
            presentation hides it behind the full-width menu row. */}
        <button
          type="button"
          className={css.brand}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <span className={css.brandIdentity} aria-hidden="true">
            <span className={css.brandMark}>
              {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
            </span>
            {/* No fallback: unoccupied, the brand is the mark alone. A
                deployment that wants wording here registers an occupant. */}
            <span className={css.brandName}>
              {renderSlot('sidebar.brand.name', {})}
            </span>
          </span>
        </button>

        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={css.toggle}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            <IconMenuOutline16 size={18} />
            <IconChevronsLeftOutline14 className={css.toggleEnd} size={14} />
          </button>
        </Tooltip>

        {/* Aeven `.side-content`: everything below the menu button narrows and
            fades as one body. */}
        <div className={css.sideContent}>
          {/* Fixed at the open width so nothing inside re-lays-out mid-slide. */}
          <div className={css.sideContentInner}>
            <Tooltip label={t('session.new.label')} delayMs={500} disabled>
              <button
                type="button"
                className={css.newSession}
                aria-label={t('session.new.label')}
                onClick={() => { startSession() }}
              >
                <IconNewChatOutline16 size={14} />
                <span className={css.newSessionLabel}>{t('session.new')}</span>
              </button>
            </Tooltip>

            {/* The browsing region fills the column between the controls and
                the foot; its occupant rides the same slot. */}
            <div className={css.regionArea}>
              {renderSlot('sidebar.workspaces', {
                wide: true,
                expandSidebar: () => { if (collapsed) toggleSidebar() },
              })}
            </div>

            {/* Footer actions stack above Settings. */}
            <div className={css.footArea}>
              <div className={css.footerActions}>
                {renderSlot('sidebar.footer.action', { wide: true })}
              </div>
              <div className={css.settingsArea}>
                {renderSlot('sidebar.settings', { wide: true })}
              </div>
            </div>
          </div>
        </div>

        {/* Aeven keeps the translucent panel last inside the content column so
            it paints under the z-indexed button and body above it. */}
        <div className={css.panel} aria-hidden="true" />
      </div>
    </div>
  )
}
