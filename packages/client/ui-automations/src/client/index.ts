/** Registered /automations and /automations/runs start addresses with the ordinary session composer and authenticated management. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@aeven/client-connection/client'
import type { UiWorkspace } from '@aeven/client-ui-workspace/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-sidebar/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/api-session-controller/client'
import type {} from '@aeven/client-ui-settings/client'
import type { ClientRemote } from '@aeven/api-remotes/client'
import { AutomationRow, AutomationsPanel, type AutomationPanelInjected, type AutomationRowInjected } from './AutomationsPanel.tsx'
import { en, es, zh, type AutomationKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation management and starter copy. */
    automations: AutomationKey
  }
}
/** Start address of each management view. */
const VIEW_PATHS = { automations: '/automations', runs: '/automations/runs' } as const satisfies Record<AutomationPanelInjected['view'], string>

/** Services that own management transport, navigation, and slot composition. */
export const inject = ['connection', 'slots', 'locale', 'uiWorkspace', 'sessions']
/** Register an addressable management page and a sidebar link.
 * @param ctx - browser composition context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('automations', { en, zh, es }))
  const t = ctx.locale.bind('automations')
  const connection = ctx.get('connection') as ConnectionHandle
  const workspace = ctx.get('uiWorkspace') as UiWorkspace
  for (const path of Object.values(VIEW_PATHS)) {
    ctx.effect(() => workspace.registerStartAddress(path, {
      // The page's own composer prompt: what the reader describes here is an
      // automation, not a question.
      composerPlaceholder: () => t('composerPlaceholder'),
    }))
  }
  const call = async (operation: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/automation-control', operation, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const operations: Omit<AutomationPanelInjected, 'view'> = {
    call, hooks: { generation: connection.generation },
    showView: (view) => { workspace.openStartAddress(VIEW_PATHS[view]) },
    openRun: (sessionId) => { ctx.sessions.open(sessionId as Parameters<typeof ctx.sessions.open>[0]) },
    list: async () => await call('list', {}) as Awaited<ReturnType<AutomationPanelInjected['list']>>,
    services: async () => {
      // Connector state only decides which starters offer a Connect action; a composition without
      // account integrations shows every starter without one.
      const integrations = ctx.get('remote.accountIntegrations') as ClientRemote['accountIntegrations'] | undefined
      if (integrations === undefined) return null
      const result = await integrations.list()
      if (!result.ok) return null
      return {
        connected: new Set(
          result.value.connectors.filter(connector => connector.connected && connector.enabled).map(connector => connector.provider),
        ),
        configured: new Set(result.value.providers.filter(provider => provider.configured).map(provider => provider.provider)),
      }
    },
    openConnector: (provider) => { ctx.emit('settings/open', 'connectors', provider) },
  }
  const navigation: AutomationRowInjected = { open: () => { workspace.openStartAddress(VIEW_PATHS.automations) } }
  ctx.slots.inject('sidebar.nav', () => ctx.slots.register({ name: 'sidebar.nav', id: 'automations', order: 1, locale: 'automations', inject: () => navigation }, AutomationRow))
  for (const [view, path] of Object.entries(VIEW_PATHS) as [AutomationPanelInjected['view'], string][]) {
    ctx.slots.inject('conversation.start', () => ctx.slots.register({ name: 'conversation.start', key: path, locale: 'automations', inject: () => ({ ...operations, view }) }, AutomationsPanel))
  }
}
