/** Registered bot pages: the overview at /bots, one bot at /bots/<id>, and runs at /bots/runs. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@aeven/client-connection/client'
import type { StartAddressClaim, UiWorkspace } from '@aeven/client-ui-workspace/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-sidebar/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/api-session-controller/client'
import type {} from '@aeven/client-ui-settings/client'
import type { ClientRemote } from '@aeven/api-remotes/client'
import { AutomationsPanel } from './AutomationsPanel.tsx'
import { AutomationRow, type AutomationRowInjected } from './shared.tsx'
import type { AutomationList, AutomationPanelInjected, AutomationView } from './model.ts'
import { botPath } from './Overview.tsx'
import { en, es, zh, type AutomationKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Bot page and starter copy. */
    automations: AutomationKey
  }
}
/** Start address of each bot page; `runs` is exact and wins over the `/bots/:id` pattern. */
const VIEW_PATHS = { overview: '/bots', bot: '/bots/:id', runs: '/bots/runs' } as const satisfies Record<AutomationView, string>

/**
 * A bot's name as the label of its wire mention: brackets and line breaks would end the label early.
 * @param name - the bot's stored name.
 * @returns the name with those characters replaced by spaces.
 */
function mentionLabel(name: string): string {
  return name.replace(/[[\]\n\r]/gu, ' ').trim()
}

/** Services that own management transport, navigation, and slot composition. */
export const inject = ['connection', 'slots', 'locale', 'uiWorkspace', 'sessions']
/** Register the addressable bot pages and a sidebar link.
 * @param ctx - browser composition context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('automations', { en, zh, es }))
  const t = ctx.locale.bind('automations')
  const connection = ctx.get('connection') as ConnectionHandle
  const workspace = ctx.get('uiWorkspace') as UiWorkspace
  /** The last list a page read, so the bot page can name its bot in the first message. */
  let lastList: AutomationList | null = null
  const claims: Record<AutomationView, StartAddressClaim> = {
    overview: { composerPlaceholder: () => t('composerPlaceholder') },
    runs: { composer: false },
    bot: {
      composerPlaceholder: () => t('detailPlaceholder'),
      // The reader types only the change; the message names the bot as a mention the bubble shows as a chip.
      frameMessage: (path, text) => {
        const id = path.slice(path.lastIndexOf('/') + 1)
        const name = lastList?.definitions.find(task => task.id === id)?.name
        return `@[${mentionLabel(name ?? t('title'))}](avn-bot:${id}) ${text}`
      },
    },
  }
  for (const view of Object.keys(VIEW_PATHS) as AutomationView[]) {
    ctx.effect(() => workspace.registerStartAddress(VIEW_PATHS[view], claims[view]))
  }
  const call = async (operation: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/automation-control', operation, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const operations: Omit<AutomationPanelInjected, 'view'> = {
    call, hooks: { generation: connection.generation, address: workspace.startAddress },
    showView: (view) => { workspace.openStartAddress(VIEW_PATHS[view]) },
    showBot: (id) => { workspace.openStartAddress(botPath(id)) },
    openRun: (sessionId) => { ctx.sessions.open(sessionId as Parameters<typeof ctx.sessions.open>[0]) },
    list: async () => {
      const value = await call('list', {}) as AutomationList
      lastList = value
      return value
    },
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
  const navigation: AutomationRowInjected = { open: () => { workspace.openStartAddress(VIEW_PATHS.overview) } }
  ctx.slots.inject('sidebar.nav', () => ctx.slots.register({ name: 'sidebar.nav', id: 'automations', order: 0, locale: 'automations', inject: () => navigation }, AutomationRow))
  for (const view of Object.keys(VIEW_PATHS) as AutomationView[]) {
    ctx.slots.inject('conversation.start', () => ctx.slots.register({ name: 'conversation.start', key: VIEW_PATHS[view], locale: 'automations', inject: () => ({ ...operations, view }) }, AutomationsPanel))
  }
}
