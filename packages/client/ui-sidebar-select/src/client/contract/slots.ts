/** Slot contract of the right sidebar's content selection. */
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration into the SlotMap.
import type {} from '@aeven/client-ui-sidebar-right/client'
// Type-only: pulls the frame's `shell.corner` declaration into the SlotMap.
import type {} from '@aeven/client-ui-layout/client'
// Type-only: pulls the Session standard-props merge (sessionId).
import type {} from '@aeven/client-ui-session/client'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { SurfaceFullscreen } from '../fullscreen.ts'
import type { SidebarContentRegistry } from '../registry.ts'

/** What the selection needs from its host beyond the framework shares. */
export interface ContentSelectInjected {
  /** The registry the body reads to resolve a chosen kind's pane. */
  readonly registry: SidebarContentRegistry
  /** Which session's column is full screen, shared with the corner toggle. */
  readonly fullscreen: SurfaceFullscreen
  /** Show the session's right sidebar when a provider opens a surface. */
  readonly openRightbar: (sessionId: string) => void
}

/**
 * Full composed props of the content selection. The body slot is
 * session-scoped, so `sessionId` arrives as a framework-standard prop.
 */
export type ContentSelectComponentProps =
  & PropsRuntime<'sidebar.right.body'>
  & PropsLocale<'sidebarSelect'>
  & ContentSelectInjected

/** What the plugin hands the corner's full screen toggle. */
export interface FullscreenButtonInjected {
  /** Which session's column is full screen, shared with the column. */
  readonly fullscreen: SurfaceFullscreen
}

/**
 * Full composed props of the corner's full screen toggle. The seat is
 * root-scoped, so the session comes from the global `useSessions`.
 */
export type FullscreenButtonComponentProps =
  & PropsRuntime<'shell.corner'>
  & PropsLocale<'sidebarSelect'>
  & FullscreenButtonInjected
