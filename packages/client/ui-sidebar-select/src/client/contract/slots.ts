/** Slot contract of the right sidebar's content selection. */
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration into the SlotMap.
import type {} from '@aeven/client-ui-sidebar-right/client'
// Type-only: pulls the Session standard-props merge (sessionId).
import type {} from '@aeven/client-ui-session/client'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { SidebarContentRegistry } from '../registry.ts'

/** What the selection needs from its host beyond the framework shares. */
export interface ContentSelectInjected {
  /** The registry the body reads to resolve a chosen kind's pane. */
  readonly registry: SidebarContentRegistry
}

/**
 * Full composed props of the content selection. The body slot is
 * session-scoped, so `sessionId` arrives as a framework-standard prop.
 */
export type ContentSelectComponentProps =
  & PropsRuntime<'sidebar.right.body'>
  & PropsLocale<'sidebarSelect'>
  & ContentSelectInjected
