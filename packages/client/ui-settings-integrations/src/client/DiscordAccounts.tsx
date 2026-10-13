/** Discord connector page: one row per installed guild and the action that installs another. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccountIntegrationsView, ConnectorId } from '@aeven/api-remotes/client'
import { IconTrashOutline16, Spinner } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import css from './IntegrationsSection.module.css'

type Connection = AccountIntegrationsView['connectors'][number]
type Translate = PropsLocale<'settings.integrations'>['t']

/** Props from the connector page. */
export interface DiscordAccountsProps {
  t: Translate
  busy: boolean
  connections: readonly Connection[]
  /** The page's operation runner: shows progress, refreshes the list, and reports thrown failures. */
  run: (operation: () => Promise<unknown>) => Promise<void>
  /** The page's switch control. */
  toggle: (label: string, on: boolean, disabled: boolean, onChange: () => void) => ReactNode
  setConnectorEnabled: (id: ConnectorId, enabled: boolean) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
  /** Re-read the connector list once Discord reported the installation. */
  refresh: () => void
  /** Open Discord's authorization screen for the deployment's Aeven application. */
  startInstall: () => void
  /** Start an installation on first render, when the page was reached by turning the connector on. */
  startWithInstall: boolean
}

/**
 * Render the installed servers and the install action.
 * @param props - page state and account operations.
 * @returns the Discord connector page body.
 */
export function DiscordAccounts(props: DiscordAccountsProps) {
  const { t, busy } = props
  const [installing, setInstalling] = useState(false)
  const [confirming, setConfirming] = useState<ConnectorId>()
  /**
   * Connected servers when the install started. A new server and a re-added one whose bot had
   * left both raise it, while re-adding keeps the row count unchanged.
   */
  const before = useRef(0)
  const linked = props.connections.filter(connection => connection.connected).length
  const install = (): void => {
    before.current = linked
    setInstalling(true)
    props.startInstall()
  }
  useEffect(() => { if (props.startWithInstall) install() }, [])
  // Discord reports the result in the browser; a server becoming connected is what ends the wait here.
  useEffect(() => {
    if (!installing || linked <= before.current) return
    setInstalling(false)
  }, [installing, linked])

  return <>
    <div className={css.serverList}>{props.connections.map(connection => <div key={connection.id} className={css.serverRow}>
      <span className={css.connectorBadge} aria-hidden="true">
        {connection.discord?.icon === undefined
          ? <span className={css.connectorMonogram}>{t('discordMonogram')}</span>
          : <img className={css.connectorIcon} src={connection.discord.icon} alt="" />}
      </span>
      <span className={css.skillSummary}>
        <strong>{connection.discord?.guildName ?? connection.name}</strong>
        {connection.discord?.installedByName !== undefined && <span className={css.address}>{t('discordInstalledBy')}{connection.discord.installedByName}</span>}
        {!connection.connected && <span className={css.attention}>{t('discordRelink')}</span>}
        {confirming === connection.id && <span className={css.actions}>
          <span className={css.hint}>{t('discordRemoveConfirm')}</span>
          <button type="button" className={css.primaryAction} disabled={busy} onClick={() => {
            setConfirming(undefined)
            void props.run(() => props.disconnect(connection.id))
          }}>{t('discordRemove')}</button>
          <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { setConfirming(undefined) }}>{t('cancel')}</button>
        </span>}
      </span>
      <button type="button" className={css.iconAction} aria-label={t('discordRemove')} title={t('discordRemove')} disabled={busy} onClick={() => { setConfirming(connection.id) }}><IconTrashOutline16 /></button>
      {props.toggle(connection.name, connection.enabled && connection.connected, !connection.connected, () => {
        void props.run(() => props.setConnectorEnabled(connection.id, !connection.enabled))
      })}
    </div>)}</div>
    {!installing && <button type="button" className={css.secondaryAction} disabled={busy} onClick={install}>{t('discordAdd')}</button>}
    {installing && <div className={css.card}>
      <p role="status" className={css.testing}><Spinner />{t('discordWaiting')}</p>
      <p className={css.hint}>{t('discordInstall')}</p>
      <div className={css.actions}>
        <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { setInstalling(false) }}>{t('close')}</button>
      </div>
      <p className={css.hint}>{t('discordPrivacy')}</p>
    </div>}
  </>
}
