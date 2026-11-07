/** Skills and Connectors navigation, backed by the signed-in account Remote. */

import { createReadCache, createSnapshotStore } from '@aeven/client-store'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import type { AccountIntegrationsView, RemoteResult } from '@aeven/api-remotes/client'
import { DetailBack, IntegrationsSection, type IntegrationsSectionInjected } from './IntegrationsSection.tsx'
import { en, es, zh, type IntegrationsLocaleKey } from './locales.ts'
import { en as cardEn, es as cardEs, zh as cardZh, type ConnectorCardKey } from './card-locales.ts'
import { CARD_TOOLS, registerConnectorCards } from './connector-cards.ts'
import { createMessageMediaCache } from './message-media.ts'
import { createWhatsAppMessagesCard } from './WhatsAppMessagesCard.tsx'
import type {} from '@aeven/client-ui-tool/client'
import type {} from '@aeven/client-ui-conversation/client'

export type { IntegrationsSectionInjected, IntegrationsSectionProps } from './IntegrationsSection.tsx'
export type { IntegrationsLocaleKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account-owned skills and connectors copy. */
    'settings.integrations': IntegrationsLocaleKey
    /** Connector cards drawn at the calls that read them, such as WhatsApp messages. */
    'connector-cards': ConnectorCardKey
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
  ctx.effect(() => ctx.locale.register(namespace, { en, zh, es }), 'ui-settings-integrations: dictionaries')
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
    importSkillReference: reference => value(remote.importSkillReference(reference)),
    systemSkills: () => value(remote.systemSkills()),
    installSystemSkill: id => value(remote.installSystemSkill(id)),
    setSkillEnabled: (name, enabled) => value(remote.setSkillEnabled(name, enabled)),
    setSkillModelInvocable: (name, modelInvocable) => value(remote.setSkillModelInvocable(name, modelInvocable)),
    retryReverseEngineering: () => value(remote.retryReverseEngineering()),
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
    whatsAppPhoneCode: (id, phone) => value(remote.whatsAppPhoneCode(id, phone)),
    startTelegramPairing: phone => value(remote.startTelegramPairing(phone)),
    startTelegramQrPairing: () => value(remote.startTelegramQrPairing()),
    telegramPairing: id => value(remote.telegramPairing(id)),
    submitTelegramCode: (id, code) => value(remote.submitTelegramCode(id, code)),
    submitTelegramPassword: (id, password) => value(remote.submitTelegramPassword(id, password)),
    cancelTelegramPairing: id => value(remote.cancelTelegramPairing(id)),
  }
  // WhatsApp message reads draw as chat cards; their media streams through this account's Host.
  ctx.effect(() => ctx.locale.register('connector-cards', { en: cardEn, zh: cardZh, es: cardEs }), 'ui-settings-integrations: card dictionaries')
  const media = createMessageMediaCache((toolName, chatJid, messageId) => value(remote.whatsAppMessageMedia(toolName, chatJid, messageId)))
  ctx.effect(() => () => { media.dispose() }, 'ui-settings-integrations: card media')
  const WhatsAppMessagesCard = createWhatsAppMessagesCard(toolName => media.sourceFor(toolName))
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of CARD_TOOLS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: 'connector-cards' }, WhatsAppMessagesCard)
    }
  })
  ctx.inject(['uiConversation'], (cardsCtx) => { registerConnectorCards(cardsCtx) })

  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: 'detail-back', locale: namespace,
  }, DetailBack))
  ctx.slots.inject('settings.section', function* () {
    // Skills sits directly above Connectors: what Aeven knows how to do, then
    // what it can reach.
    for (const [page, order] of [['skills', 22], ['connectors', 25]] as const) {
      yield ctx.slots.register({
        name: 'settings.section', id: page, order, label: () => t(page), locale: namespace,
        inject: () => ({ ...operations, page }),
      }, IntegrationsSection)
    }
  })
}
