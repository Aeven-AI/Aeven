/** Registered /automations start address with the ordinary session composer and authenticated management. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@aeven/client-connection/client'
import type { UiWorkspace } from '@aeven/client-ui-workspace/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-sidebar/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-conversation/client'
import { AutomationRow, AutomationsPanel, type AutomationPanelInjected, type AutomationRowInjected } from './AutomationsPanel.tsx'
import { en, zh, type AutomationKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation management and starter copy. */
    automations: AutomationKey
  }
}
/** Services that own management transport, navigation, and slot composition. */
export const inject = ['connection', 'slots', 'locale', 'uiWorkspace']
/** Register an addressable management page and a sidebar link.
 * @param ctx - browser composition context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('automations', { en, zh }))
  const t = ctx.locale.bind('automations')
  const connection = ctx.get('connection') as ConnectionHandle
  const workspace = ctx.get('uiWorkspace') as UiWorkspace
  ctx.effect(() => workspace.registerStartAddress('/automations', {
    // The page's own composer prompt: what the reader describes here is an
    // automation, not a question.
    composerPlaceholder: () => t('composerPlaceholder'),
  }))
  const call = async (operation: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/automation-control', operation, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const operations: AutomationPanelInjected = {
    call, hooks: { generation: connection.generation },
    list: async () => await call('list', {}) as Awaited<ReturnType<AutomationPanelInjected['list']>>,
  }
  const navigation: AutomationRowInjected = { open: () => { workspace.openStartAddress('/automations') } }
  ctx.slots.inject('sidebar.nav', () => ctx.slots.register({ name: 'sidebar.nav', id: 'automations', order: 1, locale: 'automations', inject: () => navigation }, AutomationRow))
  ctx.slots.inject('conversation.start', () => ctx.slots.register({ name: 'conversation.start', key: '/automations', locale: 'automations', inject: () => operations }, AutomationsPanel))
}
