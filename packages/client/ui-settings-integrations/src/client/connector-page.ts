/** Props and address formatting the connector account pages of the Connectors section share. */

import type { ReactNode } from 'react'
import type { AccountIntegrationsView, ConnectorId, TelegramPairingView } from '@aeven/api-remotes/client'
import type { PropsLocale } from '@aeven/client-ui-slots'

/** One connector account as the section lists it. */
export type Connection = AccountIntegrationsView['connectors'][number]

/** Locale lookup of the integrations copy. */
export type Translate = PropsLocale<'settings.integrations'>['t']

/**
 * Props the section passes to a connector page that pairs an account: the
 * accounts it lists, the section's operation runner and switch, and the flag
 * that starts a pairing as the page opens. WhatsApp and Telegram receive all
 * of them; the other connector pages take the subset their own sign-in needs.
 */
export interface PairingAccountsProps {
  t: Translate
  busy: boolean
  connections: readonly Connection[]
  /** The page's operation runner: shows progress, refreshes the list, and reports thrown failures. */
  run: (operation: () => Promise<unknown>) => Promise<void>
  /** The page's switch control. */
  toggle: (label: string, on: boolean, disabled: boolean, onChange: () => void) => ReactNode
  setConnectorEnabled: (id: ConnectorId, enabled: boolean) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
  /** Re-read the connector list after an account was signed in. */
  refresh: () => void
  /** Open the card and start pairing on first render, when the page was reached by turning the connector on. */
  startWithPairing: boolean
}

/** Telegram sign-in steps, exposed by the section's injected face and run by the Telegram page. */
export interface TelegramPairingOperations {
  startTelegramPairing: (phone: string) => Promise<TelegramPairingView>
  startTelegramQrPairing: () => Promise<TelegramPairingView>
  telegramPairing: (id: ConnectorId) => Promise<TelegramPairingView>
  submitTelegramCode: (id: ConnectorId, code: string) => Promise<TelegramPairingView>
  submitTelegramPassword: (id: ConnectorId, password: string) => Promise<TelegramPairingView>
  cancelTelegramPairing: (id: ConnectorId) => Promise<void>
}

/**
 * Format one international number the way the connector pages show it.
 * @param phone - the digits as the account reports them, without a country prefix.
 * @returns the number prefixed with `+`.
 */
export function formatPhone(phone: string): string {
  return `+${phone}`
}
