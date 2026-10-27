/** Settings → Sync: turn account sync on, add this device, or approve a new one, over the sync Remote. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import type { RemoteResult } from '@aeven/api-remotes/client'
import { SyncSection, type SyncSectionInjected } from './SyncSection.tsx'
import { en, es, zh, type SyncLocaleKey } from './locales.ts'

export type { SyncSectionInjected, SyncSectionProps } from './SyncSection.tsx'
export type { SyncLocaleKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings → Sync copy. */
    'settings.sync': SyncLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.sync'

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.sync']

/**
 * Unwrap one Remote result.
 * @param result - Remote outcome.
 * @returns the value.
 * @throws when the Remote call failed.
 */
async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error(`sync: ${settled.error.code}: ${settled.error.message}`)
  return settled.value
}

/**
 * Register the Sync section once the `settings.section` declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-settings-sync: dictionaries')

  const t = ctx.locale.bind(NS)
  const remote = ctx.remote.sync
  const operations: SyncSectionInjected = {
    status: () => value(remote.status()),
    vaultExists: () => value(remote.vaultExists()),
    createVault: () => value(remote.createVault()),
    startJoin: () => value(remote.startJoin()),
    cancelJoin: () => value(remote.cancelJoin()),
    acceptJoins: () => value(remote.acceptJoins()),
    stopAcceptingJoins: () => value(remote.stopAcceptingJoins()),
    joinRequests: () => value(remote.joinRequests()),
    devices: () => value(remote.devices()),
    removeDevice: id => value(remote.removeDevice(id)),
    approveJoin: id => value(remote.approveJoin(id)),
    rejectJoin: id => value(remote.rejectJoin(id)),
    onChange: (listener) => {
      const stops = [
        ctx.remote.$on('sync/status', () => { listener() }),
        ctx.remote.$on('sync/join-requests', () => { listener() }),
      ]
      return () => { for (const stop of stops) stop() }
    },
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sync',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => operations,
  }, SyncSection))
}
