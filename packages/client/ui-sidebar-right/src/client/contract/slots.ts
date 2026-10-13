/** Slot contract of the right sidebar: the panel's own seat and props. */
// Type-only: pulls the frame's `rightbar` column declaration into the SlotMap.
import type {} from '@aeven/client-ui-layout/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@aeven/client-ui-slots'

declare module '@aeven/client-ui-slots' {
  interface SlotMap {
    /**
     * The panel's content area, below its collapse control: the rest of the
     * panel interior belongs to the occupant.
     *
     * Empty until a content plugin registers. The panel draws its surface
     * either way, so foldout, foldin and resize are usable before any content
     * exists.
     */
    'sidebar.right.body': { kind: 'single'; scope: 'session'; owner: SidebarRightBodyOwnerProps }
  }
}

/** Body owner share; sessionId arrives as a framework-standard prop. */
export interface SidebarRightBodyOwnerProps {
  /**
   * Whether the column is closed. It flips when the reader closes the panel,
   * ahead of the slide that narrows the body out of view.
   */
  readonly collapsed: boolean
}

/**
 * Full composed props of the right sidebar root. `collapsed` and `width`
 * arrive as the column's owner share from the frame. The panel carries no
 * control of its own, so it needs no injected face: the frame's corner owns
 * both directions of the toggle.
 */
export type SidebarRightRootComponentProps =
  & PropsRuntime<'rightbar'>
  & PropsRenderSlots<'sidebar.right.body'>
  & PropsLocale<'sidebarRight'>

/** What the plugin body hands the corner toggle. */
export interface ToggleButtonInjected {
  /**
   * Open one session's panel, or close it when it is open.
   * @param sessionId - session whose panel toggles.
   */
  toggleRightbar: (sessionId: string) => void
}

/**
 * Full composed props of the corner toggle. The seat is root-scoped, so the
 * session comes from the global `useSessions` rather than a standard prop.
 */
export type ToggleButtonComponentProps =
  & PropsRuntime<'shell.corner'>
  & PropsLocale<'sidebarRight'>
  & ToggleButtonInjected
