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
import type {} from '@aeven/client-ui-account-aeven/client'
import type { RemoteResult, SyncSignInUnlock } from '@aeven/api-remotes/client'
import type { SyncOperations } from './passkey.ts'
import { SyncPasskeyPopup, type SyncPasskeyPopupInjected, type SyncPasskeyQuestion } from './SyncPasskeyPopup.tsx'
import { SyncSection } from './SyncSection.tsx'
import { AccountPrivacy } from './AccountPrivacy.tsx'
import { en, es, zh, type SyncLocaleKey } from './locales.ts'

export type { SyncSectionInjected, SyncSectionProps } from './SyncSection.tsx'
export type { SyncPasskeyPopupInjected, SyncPasskeyPopupProps, SyncPasskeyQuestion } from './SyncPasskeyPopup.tsx'
export type { SyncOperations } from './passkey.ts'
export type { SyncLocaleKey } from './locales.ts'

/** Page global the authentication gate states the signed-in reader on. */
interface ReaderScope {
  __AVN_AEVEN_READER__?: {
    readonly userId?: string
    readonly signedInThisPage?: true
    /** Takes, once, the unlock a passkey sign-in on this page prepared. */
    readonly takePasskeyUnlock?: () => SyncSignInUnlock | undefined
  }
}

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings → Sync copy. */
    'settings.sync': SyncLocaleKey
  }

  interface SlotMap {
    /** The account's workspace files on this device, shown inside Settings → Sync while sync is on. */
    'settings.sync.files': { kind: 'single'; scope: 'root' }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long putting a question off hides it on this device: declining protection is a choice the reader made, so it
 * stays quiet longest; a locked device does not sync, and a downgrade changes who can read the data, so those return
 * sooner. Settings → Sync offers every action meanwhile.
 */
const SNOOZE_MS: Readonly<Record<SyncPasskeyQuestion, number>> = { offer: 90 * DAY_MS, unlock: 7 * DAY_MS, downgraded: DAY_MS }

/**
 * The device storage key holding when the reader last put each question off, or undefined before a reader is known.
 * @param userId - the signed-in reader's id.
 * @returns the key.
 */
function snoozeKey(userId: string | undefined): string | undefined {
  return userId === undefined || userId === '' ? undefined : `avn.sync.passkeyPopup.snoozed.${userId}`
}

/**
 * Read when the reader put each question off; storage that is off, unreadable, or holds anything else reads as never.
 * @param key - the reader's storage key.
 * @returns epoch milliseconds per question.
 */
function readSnoozes(key: string): Partial<Record<SyncPasskeyQuestion, number>> {
  let raw: string | null
  try {
    raw = globalThis.localStorage.getItem(key)
  } catch {
    // Web Storage throws when site data is blocked; the popup then forgets dismissals at reload, as before.
    return {}
  }
  if (raw === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A value this plugin did not write reads as no dismissal; the next dismissal overwrites it.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const record = parsed as Record<string, unknown>
  const out: Partial<Record<SyncPasskeyQuestion, number>> = {}
  for (const question of Object.keys(SNOOZE_MS) as SyncPasskeyQuestion[]) {
    const at = record[question]
    if (typeof at === 'number' && Number.isFinite(at)) out[question] = at
  }
  return out
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
    startPasskey: (purpose, account, replaces) => value(remote.startPasskey(purpose, account, replaces)),
    cancelPasskey: () => value(remote.cancelPasskey()),
    unprotect: () => value(remote.unprotect()),
    acceptServerKey: () => value(remote.acceptServerKey()),
    createRecoveryKey: () => value(remote.createRecoveryKey()),
    unlockWithRecoveryKey: key => value(remote.unlockWithRecoveryKey(key)),
    renamePasskey: (id, name) => value(remote.renamePasskey(id, name)),
    removePasskey: id => value(remote.removePasskey(id)),
    unlockFromSignIn: unlock => value(remote.unlockFromSignIn(unlock)),
    onChange: listener => ctx.remote.$on('sync/status', () => { listener() }),
    onDevicesChange: listener => ctx.remote.$on('sync/devices', () => { listener() }),
  }
  // Taken once for the page: a later mount of the popup finds nothing left to apply.
  let signInUnlock = (globalThis as ReaderScope).__AVN_AEVEN_READER__?.takePasskeyUnlock?.()
  const reader = (): ReaderScope['__AVN_AEVEN_READER__'] => (globalThis as ReaderScope).__AVN_AEVEN_READER__
  const popup: SyncPasskeyPopupInjected = {
    ...operations,
    snoozed: (question) => {
      const key = snoozeKey(reader()?.userId)
      const at = key === undefined ? undefined : readSnoozes(key)[question]
      return at !== undefined && Date.now() - at < SNOOZE_MS[question]
    },
    snooze: (question) => {
      const key = snoozeKey(reader()?.userId)
      if (key === undefined) return
      try {
        globalThis.localStorage.setItem(key, JSON.stringify({ ...readSnoozes(key), [question]: Date.now() }))
      } catch {
        // Blocked or full Web Storage keeps the dismissal for this page only.
      }
    },
    signedInThisPage: () => reader()?.signedInThisPage === true,
    takeSignInUnlock: () => {
      const taken = signInUnlock
      signInUnlock = undefined
      return taken
    },
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sync',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    children: { 'settings.sync.files': { kind: 'single', scope: 'root' } },
    inject: () => operations,
  }, SyncSection))

  ctx.slots.inject('account.security', () => ctx.slots.register({
    name: 'account.security',
    locale: NS,
    inject: () => operations,
  }, AccountPrivacy))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sync-passkey',
    locale: NS,
    inject: () => popup,
  }, SyncPasskeyPopup))
}
