/** Registers the content selection into the right sidebar's body. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the right sidebar's `sidebar.right.body` declaration.
import type {} from '@aeven/client-ui-sidebar-right/client'
import { ContentSelect } from './ContentSelect.tsx'
import type { ContentSelectInjected } from './contract/slots.ts'
import { SidebarContentRegistry } from './registry.ts'
import { en, zh, type SidebarSelectKey } from './locales.ts'

export type { ContentSelectComponentProps, ContentSelectInjected } from './contract/slots.ts'
export {
  SidebarContentRegistry, type SidebarContentComponent, type SidebarContentPaneProps, type SidebarSurfaceTab,
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
export const inject = ['slots', 'locale']

/**
 * Registers the selection as the right sidebar's body.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.plugin(SidebarContentRegistry)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-select: dictionaries')

  // The body is a single-occupant slot, so the selection waits for the shell to
  // declare it rather than racing the panel's own registration.
  ctx.slots.inject('sidebar.right.body', () =>
    ctx.slots.register({
      name: 'sidebar.right.body',
      locale: NS,
      // Resolved per render rather than captured: `ctx.plugin` publishes the
      // registry, and the same published instance is what a provider reaches
      // through `ctx.get`. A copy held here would leave the two sides
      // registering into different maps.
      inject: (): ContentSelectInjected => ({ registry: ctx.get('sidebarContent')! }),
    }, ContentSelect))
}
