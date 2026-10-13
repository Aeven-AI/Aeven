/** Skills and Connectors navigation, backed by the signed-in account Remote. */

import { createReadCache, createSnapshotStore } from '@aeven/client-store'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import type { AccountIntegrationsView, RemoteResult } from '@aeven/api-remotes/client'
import { DetailBack, IntegrationsSection, type IntegrationsSectionInjected } from './IntegrationsSection.tsx'
import { en, zh, type IntegrationsLocaleKey } from './locales.ts'

export type { IntegrationsSectionInjected, IntegrationsSectionProps } from './IntegrationsSection.tsx'
export type { IntegrationsLocaleKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account-owned skills and connectors copy. */
    'settings.integrations': IntegrationsLocaleKey
  }
}

/** Services needed to mount the account management pages. */
export const inject = ['slots', 'locale', 'remote', 'remote.accountIntegrations']

/** Unwrap an account Remote result without exposing credential-bearing request data. */
async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error('account integration operation failed')
  return settled.value
}

/**
 * Register the two personal integration pages in Settings.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const namespace = 'settings.integrations'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'ui-settings-integrations: dictionaries')
  const t = ctx.locale.bind(namespace)
  const remote = ctx.remote.accountIntegrations
  const changes = createSnapshotStore(0)
  const refresh = (): void => { changes.set(changes.getSnapshot() + 1) }
  ctx.remote.$on('skills/change', refresh)
  ctx.on('connection/reset', refresh)
  // Both pages read this one list, so they share one cache entry: whichever
  // mounts second paints the answer the first already read and re-reads behind
  // it, and every mutation re-lists through the same call.
  const cache = createReadCache()
  const list = (): Promise<AccountIntegrationsView> => cache.read('list', () => value(remote.list()))
  const operations: Omit<IntegrationsSectionInjected, 'page'> = {
    hooks: { changes },
    list,
    cachedList: () => cache.peek<AccountIntegrationsView>('list'),
    // The catalog is read once per mount and never cached here: a mutation that installs a skill
    // re-lists the library, which is what flips the row to Installed.
    catalog: () => value(remote.catalog()),
    catalogSkillContent: name => value(remote.catalogSkillContent(name)),
    installCatalogSkill: name => value(remote.installCatalogSkill(name)),
    importSkill: files => value(remote.importSkill(files)),
    setSkillEnabled: (name, enabled) => value(remote.setSkillEnabled(name, enabled)),
    removeSkill: name => value(remote.removeSkill(name)),
    connect: request => value(remote.connect(request)),
    connectEmail: request => value(remote.connectEmail(request)),
    updateEmail: (id, request) => value(remote.updateEmail(id, request)),
    authorize: provider => value(remote.authorize(provider)),
    setConnectorEnabled: (id, enabled) => value(remote.setConnectorEnabled(id, enabled)),
    disconnect: id => value(remote.disconnect(id)),
    startWhatsAppPairing: () => value(remote.startWhatsAppPairing()),
    whatsAppPairing: id => value(remote.whatsAppPairing(id)),
    cancelWhatsAppPairing: id => value(remote.cancelWhatsAppPairing(id)),
    startTelegramPairing: phone => value(remote.startTelegramPairing(phone)),
    startTelegramQrPairing: () => value(remote.startTelegramQrPairing()),
    telegramPairing: id => value(remote.telegramPairing(id)),
    submitTelegramCode: (id, code) => value(remote.submitTelegramCode(id, code)),
    submitTelegramPassword: (id, password) => value(remote.submitTelegramPassword(id, password)),
    cancelTelegramPairing: id => value(remote.cancelTelegramPairing(id)),
  }
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: 'detail-back', locale: namespace,
  }, DetailBack))
  ctx.slots.inject('settings.section', function* () {
    // Voice also registers at 60; Connectors sits just before it so the nav order does not depend on load order.
    for (const [page, order] of [['skills', 55], ['connectors', 58]] as const) {
      yield ctx.slots.register({
        name: 'settings.section', id: page, order, label: () => t(page), locale: namespace,
        inject: () => ({ ...operations, page }),
      }, IntegrationsSection)
    }
  })
}
