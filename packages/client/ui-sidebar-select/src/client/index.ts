/** Registers the content selection into the right sidebar's body. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-layout/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration.
import type {} from '@aeven/client-ui-sidebar-right/client'
import { ContentSelect } from './ContentSelect.tsx'
import type { ContentSelectInjected, FullscreenButtonInjected } from './contract/slots.ts'
import { FullscreenButton } from './FullscreenButton.tsx'
import { SurfaceFullscreen } from './fullscreen.ts'
import { SidebarContentRegistry } from './registry.ts'
import { en, zh, type SidebarSelectKey } from './locales.ts'

export type {
  ContentSelectComponentProps, ContentSelectInjected, FullscreenButtonComponentProps, FullscreenButtonInjected,
} from './contract/slots.ts'
export { SurfaceFullscreen } from './fullscreen.ts'
export {
  SidebarContentRegistry, type SidebarContentComponent, type SidebarContentPaneProps, type SidebarSurfaceCloseHandler,
  type SidebarContentLauncher, type SidebarSurfaceTab,
} from './registry.ts'
export type { SidebarSurface, SurfaceState } from './surfaces.ts'
export type { SidebarSelectKey } from './locales.ts'
export {
  AVAILABLE_CONTENT_KINDS, SIDEBAR_CONTENT_KINDS,
  readSelection, writeSelection, type SidebarContentKind,
} from './selection.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right sidebar content selection copy. */
    sidebarSelect: SidebarSelectKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarSelect'

/** Services required by the selection plugin. */
export const inject = ['slots', 'locale', 'layout']

/**
 * Registers the selection as the right sidebar's body.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.plugin(SidebarContentRegistry)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-select: dictionaries')
  const fullscreen = new SurfaceFullscreen()

  // The body is a single-occupant slot, so the selection waits for the shell to
  // declare it rather than racing the panel's own registration. It also waits
  // for `ctx.plugin` to publish the registry, which lands after this apply
  // returns; the body renders only while that published instance, the one
  // providers register into, exists.
  ctx.inject(['sidebarContent'], (scoped) => {
    const registry = scoped.sidebarContent
    scoped.slots.inject('sidebar.right.body', () =>
      scoped.slots.register({
        name: 'sidebar.right.body',
        locale: NS,
        inject: (): ContentSelectInjected => ({ registry, fullscreen, openRightbar: (sessionId) => { scoped.layout.openRightbar(sessionId) } }),
      }, ContentSelect))
  })

  // Ahead of the right sidebar's own toggle (order 90) in the frame's corner.
  ctx.slots.inject('shell.corner', () =>
    ctx.slots.register({
      name: 'shell.corner',
      id: 'rightbar-fullscreen',
      order: 80,
      locale: NS,
      inject: (): FullscreenButtonInjected => ({ fullscreen }),
    }, FullscreenButton))
}
