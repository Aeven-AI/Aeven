/**
 * Browser half of the Aeven account menu.
 *
 * The reader AVN already authenticated is the reader this shows: it reads the
 * session the authentication library restored before the plugin graph booted,
 * and asks Aeven for nothing of its own.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createReadCache } from '@aeven/client-store'
import type { AevenReader } from '@aeven/client-ui-auth-aeven'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-layout/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-session/client'
import type {} from '@aeven/client-ui-settings/client'
import { AccountMenu, type AccountMenuInjected, type AccountReader } from './AccountMenu.tsx'
import { AccountSection, type AccountSectionInjected } from './AccountSection.tsx'
import { en, NS, zh, type AccountAevenKey } from './locales.ts'

export type { AccountMenuInjected, AccountMenuProps, AccountReader } from './AccountMenu.tsx'
export type { AccountSectionInjected, AccountSectionProps } from './AccountSection.tsx'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Aeven account-menu copy. */
    'account.aeven': AccountAevenKey
  }
}

/** Settings section id of the Account page. */
const ACCOUNT_SECTION = 'account'

/** Required services for locale registration, the header seat, and the Account page. */
export const inject = ['slots', 'locale']

/** Page global the authentication gate states the reader on. */
interface ReaderScope {
  __AVN_AEVEN_READER__?: AevenReader
}

/**
 * The signed-in reader.
 *
 * The gate is linked into the boot kernel, which no plugin bundle can import,
 * so it states the reader on the page and this reads it from there.
 * @returns the reader, or undefined when nobody is signed in.
 */
function publishedReader(): AevenReader | undefined {
  return (globalThis as ReaderScope).__AVN_AEVEN_READER__
}

/**
 * The reader as the menu draws them.
 * @returns the reader, or undefined when nobody is signed in.
 */
function currentReader(): AccountReader | undefined {
  const reader = publishedReader()
  if (reader === undefined) return undefined
  return {
    userId: reader.userId,
    ...reader.displayName === undefined ? {} : { displayName: reader.displayName },
    ...reader.email === undefined ? {} : { email: reader.email },
    ...reader.imageUrl === undefined ? {} : { imageUrl: reader.imageUrl },
  }
}

/**
 * The Aeven account page.
 * @returns the URL, or undefined when this deployment names no web client.
 */
function accountUrl(): string | undefined {
  return publishedReader()?.accountUrl
}

/** Register the dictionaries and the resident navigation-band account menu. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-account-aeven: dictionaries')

  const injected = (): AccountMenuInjected => ({
    reader: currentReader,
    openSettings: () => { ctx.emit('settings/open') },
    // A full load, not a route change: signing out invalidates the credential
    // every plugin was booted with, so the page starts again at the gate.
    signOut: () => {
      const reader = publishedReader()
      if (reader === undefined) return
      void reader.signOut().finally(() => { window.location.assign('/') })
    },
  })

  // The frame's corner, not a Session header seat: whether a reader is signed
  // in is a fact about the app, not about a Session, and a fresh install opens
  // on the no-Session hero where that header never renders. The corner is also
  // laid out against the frame rather than inside the centre column, so the
  // avatar holds one place on screen while the right sidebar takes width from
  // that column.
  ctx.slots.inject(
    'shell.corner',
    () => ctx.slots.register({
      name: 'shell.corner',
      id: 'aeven-account',
      order: 100,
      locale: NS,
      inject: injected,
    }, AccountMenu),
  )

  // Nobody signed in has no account to show; the page is registered only
  // when the gate stated a reader, so a deployment without Aeven has no tab.
  const reader = publishedReader()
  if (reader === undefined) return
  const t = ctx.locale.bind(NS)
  // The account routes are this plugin's own reads, so their cache is too: a
  // revisiting page paints the last answer and re-reads behind it. A write can
  // move any of them (a top-up changes the wallet and the allowance), so a
  // non-GET drops every key.
  const cache = createReadCache()
  const cloud = <T>(path: string, init?: RequestInit): Promise<T> => {
    if (init !== undefined) {
      cache.invalidate()
      return reader.cloud<T>(path, init)
    }
    return cache.read<T>(path, () => reader.cloud<T>(path, init))
  }
  const section: AccountSectionInjected = {
    reader: currentReader,
    accountUrl,
    signOut: injected().signOut,
    cloud,
    mfa: reader.mfa,
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- implements the injected reader's caller-side assertion
    cached: <T>(path: string) => cache.peek<T>(path),
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: ACCOUNT_SECTION,
    order: 10,
    label: () => t('section.nav'),
    locale: NS,
    inject: () => section,
  }, AccountSection))
}
