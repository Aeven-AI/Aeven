/** Settings → Personalization: how the signed-in person wants Aeven to talk with them, over the personalization Remote. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createReadCache } from '@aeven/client-store'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import type { PersonalizationView, RemoteResult } from '@aeven/api-remotes/client'
import { PersonalizationSection, type PersonalizationSectionInjected } from './PersonalizationSection.tsx'
import { en, es, zh, type PersonalizationLocaleKey } from './locales.ts'

export type { PersonalizationSectionInjected, PersonalizationSectionProps } from './PersonalizationSection.tsx'
export type { PersonalizationLocaleKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings → Personalization copy. */
    'settings.personalization': PersonalizationLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.personalization'

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.personalization']

/**
 * Unwrap one Remote result.
 * @param result - Remote outcome.
 * @returns the value.
 * @throws when the Remote call failed.
 */
async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error(`personalization: ${settled.error.code}: ${settled.error.message}`)
  return settled.value
}

/**
 * Register the Personalization section, last in the nav after Plugins.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-settings-personalization: dictionaries')

  const t = ctx.locale.bind(NS)
  const remote = ctx.remote.personalization
  // One cached view, owned here: a revisit paints the view the page read last
  // and re-reads behind it. A write moves that view, so it drops the entry.
  const cache = createReadCache()
  const operations: PersonalizationSectionInjected = {
    read: () => cache.read('view', () => value(remote.get())),
    cachedView: () => cache.peek<PersonalizationView>('view'),
    update: async (update) => {
      const change = await value(remote.update(update))
      cache.invalidate()
      return change
    },
    resetMasterPrompt: async () => {
      const change = await value(remote.resetMasterPrompt())
      cache.invalidate()
      return change
    },
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personalization',
    order: 90,
    label: () => t('nav'),
    locale: NS,
    inject: () => operations,
  }, PersonalizationSection))
}
