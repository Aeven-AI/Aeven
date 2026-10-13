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
import type { ToggleButtonInjected } from './contract/slots.ts'
import { SidebarRightRoot } from './SidebarRightRoot.tsx'
import { ToggleButton } from './ToggleButton.tsx'
import { en, zh, type SidebarRightKey } from './locales.ts'

export type {
  SidebarRightBodyOwnerProps, SidebarRightRootComponentProps,
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

  ctx.effect(
    () => ctx.slots.register({
      name: 'rightbar',
      locale: NS,
      // The shell owns geometry; a content plugin fills the body.
      children: {
        'sidebar.right.body': { kind: 'single', scope: 'session' },
      },
    }, SidebarRightRoot),
    'ui-sidebar-right: slot registration',
  )

  // The toggle lives in the frame's corner, ahead of the account avatar
  // (order 100), rather than in the conversation's navigation band: the band
  // is laid out inside the centre column, which this panel takes width from,
  // so a control there travels left as the panel opens and ends up under the
  // panel itself. The corner is laid out against the frame, so the one control
  // serves both directions from one place — it opens the panel and closes it.
  ctx.slots.inject('shell.corner', () =>
    ctx.slots.register({
      name: 'shell.corner',
      id: 'rightbar-toggle',
      order: 90,
      locale: NS,
      inject: (): ToggleButtonInjected => ({
        toggleRightbar: (sessionId: string) => { ctx.layout.toggleRightbar(sessionId) },
      }),
    }, ToggleButton))
}
