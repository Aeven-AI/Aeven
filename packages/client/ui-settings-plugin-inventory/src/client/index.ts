/** Read-only Host plugin inventory registered into Web Settings. */

import type {} from '@aeven/client-locale/client'
import { createReadCache } from '@aeven/client-store'
import type { PluginInventorySnapshot } from '@aeven/api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  // One cached inventory, owned here: reopening the tab paints the inventory it
  // read last and re-reads behind it.
  const cache = createReadCache()
  const list: PluginInventorySettingsTabInjected['list'] = () => cache.read('list', async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  })
  const presetName: PluginInventorySettingsTabInjected['presetName'] = preset => preset.name ?? preset.id
  const injected = (): PluginInventorySettingsTabInjected => ({
    list,
    cachedList: () => cache.peek<PluginInventorySnapshot>('list'),
    presetName,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
}
