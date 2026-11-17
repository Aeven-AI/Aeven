/** Naming the passkeys that hold the account key, so a locked device can say which one unlocks it. */
import type { SyncKeyHolderView, SyncPasskeyDeviceView } from '@aeven/api-remotes/client'
import type { SyncLocaleKey } from './locales.ts'

/**
 * Passkey providers by AAGUID (the provider registry the FIDO Alliance and the passkey community publish). The names
 * are the providers' own product names and stay untranslated.
 */
const PASSKEY_PROVIDERS: Readonly<Record<string, string>> = {
  fbfc3007154e4ecc8c0b6e020557d7bd: 'iCloud Keychain',
  dd4ec289e01d41c9bb8970fa845d4bf2: 'iCloud Keychain',
  ea9b8d664d011d213ce4b6b48cb575d4: 'Google Password Manager',
  '08987058cadc4b81b6e130de50dcbe96': 'Windows Hello',
  '9ddd1817af5a4672a2b93e3dd95000a9': 'Windows Hello',
  '6028b017b1d44c02b4b3afcdafc96bb2': 'Windows Hello',
  bada5566a7aa401fbd9645619a55120d: '1Password',
  d548826e79b4db40a3d811116f7e8349: 'Bitwarden',
  '531126d6e717415c93203d9aa6981239': 'Dashlane',
  '0ea242b443c44a1b8b17dd6d0b6baec6': 'Keeper',
  '53414d53554e47000000000000000000': 'Samsung Pass',
  adce000235bcc60a648b0b25f1f05503: 'Chrome',
  '771b48fdd3d44f749232fc157ab0507a': 'Edge',
}

const DEVICE_KEYS: Readonly<Record<Exclude<SyncPasskeyDeviceView, 'other'>, SyncLocaleKey>> = {
  mac: 'deviceMac',
  windows: 'deviceWindows',
  linux: 'deviceLinux',
  iphone: 'deviceIphone',
  ipad: 'deviceIpad',
  android: 'deviceAndroid',
  chromeos: 'deviceChromeos',
  external: 'deviceExternal',
}

/** Translate a key with `{name}` placeholders, as the section's `t` does. */
type Translate = (key: SyncLocaleKey, values?: Record<string, string>) => string

/**
 * Name one passkey: its provider, the device it was created on, and when it was added, as far as they are known.
 * @param holder - the passkey.
 * @param t - the section's translator.
 * @returns the phrase, or undefined for a passkey stored before providers and devices were recorded.
 */
function holderPhrase(holder: SyncKeyHolderView, t: Translate): string | undefined {
  if (holder.name !== undefined) return holder.addedAt === undefined ? holder.name : t('holderAdded', { holder: holder.name, date: formatDate(holder.addedAt) })
  const provider = holder.aaguid === undefined ? undefined : PASSKEY_PROVIDERS[holder.aaguid]
  const device = holder.device === undefined || holder.device === 'other' ? undefined : t(DEVICE_KEYS[holder.device])
  let phrase: string | undefined
  if (provider !== undefined && device !== undefined) phrase = t('holderBoth', { provider, device })
  else if (provider !== undefined) phrase = provider
  else if (device !== undefined) phrase = t('holderDeviceOnly', { device })
  if (phrase === undefined) return undefined
  if (holder.addedAt === undefined) return phrase
  return t('holderAdded', { holder: phrase, date: formatDate(holder.addedAt) })
}

/**
 * Write the date a holder was added, in the reader's locale.
 * @param iso - an ISO 8601 timestamp.
 * @returns the date, such as `17 Nov 2026`.
 */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

/**
 * The title of a passkey's row in Settings: the name the user gave it, else its provider and device, else "Passkey".
 * @param holder - the passkey.
 * @param t - the section's translator.
 * @returns the title, without the date.
 */
export function holderTitle(holder: SyncKeyHolderView, t: Translate): string {
  if (holder.name !== undefined) return holder.name
  const { addedAt: _addedAt, ...undated } = holder
  return holderPhrase(undated, t) ?? t('passkeyFallback')
}

/**
 * Say which passkeys unlock the account: every passkey the device can name, or a general hint when it can name none.
 * @param holders - the account key's holders.
 * @param t - the section's translator.
 * @returns one sentence.
 */
export function unlockHint(holders: readonly SyncKeyHolderView[], t: Translate): string {
  const named = holders.filter(holder => holder.kind === 'passkey').map(holder => holderPhrase(holder, t)).filter(phrase => phrase !== undefined)
  return named.length === 0 ? t('holderUnknown') : t('holderHint', { holders: named.join(t('holderOr')) })
}

/**
 * Whether one of the holders is a recovery key.
 * @param holders - the account key's holders.
 * @returns true when a recovery key also unlocks the account.
 */
export function hasRecoveryKey(holders: readonly SyncKeyHolderView[]): boolean {
  return holders.some(holder => holder.kind === 'recovery')
}
