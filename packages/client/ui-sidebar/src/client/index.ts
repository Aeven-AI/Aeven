/** Registers the sidebar shell into the layout-owned slot. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@aeven/client-ui-session/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarHeaderActionOwnerProps, SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
  SidebarNavOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar shell controls copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar'

interface WorkspaceNavigation {
  startSession(
    workspaceId?: Parameters<SidebarRootInjected['startSession']>[0],
    sessionId?: Parameters<SidebarRootInjected['startSession']>[1],
  ): void
  /** Addresses a New Session link (see UiWorkspace). */
  newSessionHref(): { href: string; sessionId: Parameters<SidebarRootInjected['startSession']>[1] & string }
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'locale']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')

  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Session link rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId, sessionId) => {
      workspaceNavigation.startSession(workspaceId, sessionId)
    },
    newSessionHref: () => workspaceNavigation.newSessionHref(),
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
  })
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // The shell owns geometry; ui-workspace registers the browsing region's
      // search field at the row's leading edge and its view options + add
      // workspace cluster at the trailing one, and the browsing region below
      // the New Session link. ui-settings registers the foot trigger +
      // settings panel.
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.header.leading': { kind: 'single', scope: 'root' },
        'sidebar.header.action': { kind: 'list', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'sidebar.nav': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot),
    'ui-sidebar: slot registration',
  )
}
