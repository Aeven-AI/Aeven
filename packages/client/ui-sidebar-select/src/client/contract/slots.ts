/** Slot contract of the right sidebar's content selection. */
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration into the SlotMap.
import type {} from '@aeven/client-ui-sidebar-right/client'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'

/**
 * Full composed props of the content selection. The body slot is
 * session-scoped, so `sessionId` arrives as a framework-standard prop.
 */
export type ContentSelectComponentProps =
  & PropsRuntime<'sidebar.right.body'>
  & PropsLocale<'sidebarSelect'>
