/**
 * Sidebar shell: column geometry only, ported from the Aeven client's sidebar.
 * Collapse is one CSS state (`.visible`). Above 1024px the in-flow column
 * snaps to its new width while its clipped content transitions; below it the
 * column overlays. The shell repositions and remounts nothing.
 *
 * The workspace/session browsing region between the New Session button and the
 * foot is the `sidebar.workspaces` registrant's, and the foot holds
 * `sidebar.settings` plus `sidebar.footer.action`; the shell hands them the
 * wide flag (plus an expand request callback for the browser). That flag stays
 * true for the whole collapse so occupants never re-lay-out mid-slide.
 *
 * The column no longer decides whether scroll regions nested in it draw a bar:
 * each region owns its own treatment, and the session list opts out of the bar
 * entirely (ui-theme's `no-scrollbar`), so nothing here tracks the pointer.
 */
import clsx from 'clsx'
import {
  FishLogo, IconChevronsLeftOutline14, IconMenuOutline16, IconNewChatOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  // The open width is the theme's Aeven token, exactly as the client's
  // `$widthSidebar` is. Nothing measures or publishes it: collapsing is the
  // `.visible` class alone, so no render writes a width during the transition.

  return (
    <div className={clsx(css.root, !collapsed && css.visible)}>
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

      {/* Aeven `.content-blocker`: below the med breakpoint the column overlays
          the conversation instead of pushing it, and this dims and blurs what
          it covers. Display is a CSS decision, so the node is always mounted;
          above the breakpoint it is `display: none` and reachable by nothing. */}
      <div
        className={css.contentBlocker}
        role="presentation"
        onClick={() => { toggleSidebar() }}
      />
    </div>
  )
}
