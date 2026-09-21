/** Registers the right sidebar shell into the layout-owned column. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls ctx.layout and the frame's column declarations.
import type {} from '@aeven/client-ui-layout/client'
// Type-only: pulls the Session root standard-props merge (useSessions).
import type {} from '@aeven/client-ui-session/client'
// Type-only: pulls the conversation header seat declarations.
import type {} from '@aeven/client-ui-conversation/client'
import type { SidebarRightRootInjected, ToggleButtonInjected } from './contract/slots.ts'
import { SidebarRightRoot } from './SidebarRightRoot.tsx'
import { ToggleButton } from './ToggleButton.tsx'
import { en, zh, type SidebarRightKey } from './locales.ts'

export type {
  SidebarRightBodyOwnerProps, SidebarRightRootComponentProps, SidebarRightRootInjected,
  ToggleButtonComponentProps, ToggleButtonInjected,
} from './contract/slots.ts'
export type { SidebarRightKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right sidebar shell controls copy. */
    sidebarRight: SidebarRightKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebarRight'

/** Services required by the right sidebar plugin. */
export const inject = ['slots', 'layout', 'locale']

/**
 * Registers the right sidebar shell and its toggle callback.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-right: dictionaries')

  // The panel is per session, so the toggle names the session it belongs to.
  // The framework supplies that id to the inject hook for a session-scoped
  // seat, which is the same id the frame reads the column's width under.
  const injectProps = (sessionId: string): SidebarRightRootInjected => ({
    toggleRightbar: () => { ctx.layout.toggleRightbar(sessionId) },
  })

  ctx.effect(
    () => ctx.slots.register({
      name: 'rightbar',
      locale: NS,
      // The shell owns geometry; a content plugin fills the body.
      children: {
        'sidebar.right.body': { kind: 'single', scope: 'session' },
      },
      inject: injectProps,
    }, SidebarRightRoot),
    'ui-sidebar-right: slot registration',
  )

  // Reopening lives in the navigation band, ahead of the account avatar
  // (order 100): a collapsed column has no width to hold a control of its own.
  ctx.slots.inject('conversation.navigation.utilities', () =>
    ctx.slots.register({
      name: 'conversation.navigation.utilities',
      id: 'rightbar-toggle',
      order: 90,
      locale: NS,
      inject: (): ToggleButtonInjected => ({
        toggleRightbar: (sessionId: string) => { ctx.layout.toggleRightbar(sessionId) },
      }),
    }, ToggleButton))
}
