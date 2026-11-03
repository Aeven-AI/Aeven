/**
 * Settings → Sync: whether this device syncs the account, its progress, who holds the account key, and the account's
 * devices, over the sync Remote; and the passkey popup that offers protection after a sign-in and asks for the
 * account's passkey when this device waits on it.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-layout/client'
import type { RemoteResult } from '@aeven/api-remotes/client'
import type { SyncOperations } from './passkey.ts'
import { SyncPasskeyPopup, type SyncPasskeyPopupInjected } from './SyncPasskeyPopup.tsx'
import { SyncSection } from './SyncSection.tsx'
import { en, es, zh, type SyncLocaleKey } from './locales.ts'

export type { SyncSectionInjected, SyncSectionProps } from './SyncSection.tsx'
export type { SyncPasskeyPopupInjected, SyncPasskeyPopupProps } from './SyncPasskeyPopup.tsx'
export type { SyncOperations } from './passkey.ts'
export type { SyncLocaleKey } from './locales.ts'

/** Page global the authentication gate states the signed-in reader on. */
interface ReaderScope {
  __AVN_AEVEN_READER__?: { readonly signedInThisPage?: true }
}

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
  const operations: SyncOperations = {
    status: () => value(remote.status()),
    setEnabled: enabled => value(remote.setEnabled(enabled)),
    devices: () => value(remote.devices()),
    removeDevice: id => value(remote.removeDevice(id)),
    startPasskey: purpose => value(remote.startPasskey(purpose)),
    cancelPasskey: () => value(remote.cancelPasskey()),
    unprotect: () => value(remote.unprotect()),
    acceptServerKey: () => value(remote.acceptServerKey()),
    onChange: listener => ctx.remote.$on('sync/status', () => { listener() }),
  }
  const popup: SyncPasskeyPopupInjected = {
    ...operations,
    signedInThisPage: () => (globalThis as ReaderScope).__AVN_AEVEN_READER__?.signedInThisPage === true,
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sync',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => operations,
  }, SyncSection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sync-passkey',
    locale: NS,
    inject: () => popup,
  }, SyncPasskeyPopup))
}
