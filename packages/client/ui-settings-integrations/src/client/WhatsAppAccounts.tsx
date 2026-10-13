/** WhatsApp connector page: one row per linked number and the QR card that links another. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccountIntegrationsView, ConnectorId, WhatsAppPairingView } from '@aeven/api-remotes/client'
import { IconTrashOutline16, Spinner } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import css from './IntegrationsSection.module.css'

type Connection = AccountIntegrationsView['connectors'][number]
type Translate = PropsLocale<'settings.integrations'>['t']

/** Interval between pairing-state reads while the card is open. */
const POLL_MS = 1500

/** Props from the connector page. */
export interface WhatsAppAccountsProps {
  t: Translate
  busy: boolean
  connections: readonly Connection[]
  /** The page's operation runner: shows progress, refreshes the list, and reports thrown failures. */
  run: (operation: () => Promise<unknown>) => Promise<void>
  /** The page's switch control. */
  toggle: (label: string, on: boolean, disabled: boolean, onChange: () => void) => ReactNode
  startWhatsAppPairing: () => Promise<WhatsAppPairingView>
  whatsAppPairing: (id: ConnectorId) => Promise<WhatsAppPairingView>
  cancelWhatsAppPairing: (id: ConnectorId) => Promise<void>
  setConnectorEnabled: (id: ConnectorId, enabled: boolean) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
  /** Re-read the connector list after a number was linked. */
  refresh: () => void
  /** Start linking on first render, when the page was reached by turning the connector on. */
  startWithPairing: boolean
}

/** International number in the `+<digits>` form WhatsApp shows. */
function formatPhone(phone: string): string {
  return `+${phone}`
}

/**
 * Render the linked numbers and the linking card.
 * @param props - page state and account operations.
 * @returns the WhatsApp connector page body.
 */
export function WhatsAppAccounts(props: WhatsAppAccountsProps) {
  const { t, busy } = props
  const [pairing, setPairing] = useState<WhatsAppPairingView>()
  const [confirming, setConfirming] = useState<ConnectorId>()
  const pairingId = useRef<ConnectorId>()
  pairingId.current = pairing !== undefined && (pairing.state === 'starting' || pairing.state === 'qr') ? pairing.id : undefined
  const { whatsAppPairing, cancelWhatsAppPairing, refresh } = props

  const start = (): void => {
    setPairing({ state: 'starting' })
    props.startWhatsAppPairing().then(setPairing, () => { setPairing({ state: 'failed' }) })
  }
  useEffect(() => { if (props.startWithPairing) start() }, [])
  // An attempt left open when the page closes is abandoned rather than left waiting for a scan.
  useEffect(() => () => { if (pairingId.current !== undefined) void cancelWhatsAppPairing(pairingId.current) }, [cancelWhatsAppPairing])
  useEffect(() => {
    const id = pairing?.id
    const waiting = pairing?.state === 'starting' || pairing?.state === 'qr'
    if (id === undefined || !waiting) return
    const timer = setInterval(() => {
      void whatsAppPairing(id).then((next) => {
        setPairing(next)
        if (next.state === 'connected') refresh()
      }, () => {
        // A failed read is retried on the next interval.
      })
    }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [pairing?.id, pairing?.state, whatsAppPairing, refresh])
  useEffect(() => {
    if (pairing?.state !== 'connected') return
    const timer = setTimeout(() => { setPairing(undefined) }, 2_000)
    return () => { clearTimeout(timer) }
  }, [pairing?.state])

  const cancel = (): void => {
    const id = pairing?.id
    setPairing(undefined)
    if (id !== undefined) void cancelWhatsAppPairing(id)
  }
  const outcome: Partial<Record<WhatsAppPairingView['state'], string>> = {
    expired: t('whatsappExpired'), failed: t('whatsappFailed'), duplicate: t('whatsappDuplicate'), limit: t('whatsappLimit'), unavailable: t('whatsappUnavailable'),
  }
  const failure = pairing === undefined ? undefined : outcome[pairing.state]

  return <>
    <div className={css.serverList}>{props.connections.map(connection => <div key={connection.id} className={css.serverRow}>
      <span className={css.skillSummary}>
        <strong>{connection.name}</strong>
        {connection.whatsapp !== undefined && connection.name !== formatPhone(connection.whatsapp.phone) && <span className={css.address}>{formatPhone(connection.whatsapp.phone)}</span>}
        {!connection.connected && <span className={css.attention}>{t('whatsappRelink')}</span>}
        {confirming === connection.id && <span className={css.actions}>
          <span className={css.hint}>{t('whatsappUnlinkConfirm')}</span>
          <button type="button" className={css.primaryAction} disabled={busy} onClick={() => {
            setConfirming(undefined)
            void props.run(() => props.disconnect(connection.id))
          }}>{t('whatsappUnlink')}</button>
          <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { setConfirming(undefined) }}>{t('cancel')}</button>
        </span>}
      </span>
      <button type="button" className={css.iconAction} aria-label={t('whatsappUnlink')} title={t('whatsappUnlink')} disabled={busy} onClick={() => { setConfirming(connection.id) }}><IconTrashOutline16 /></button>
      {props.toggle(connection.name, connection.enabled && connection.connected, !connection.connected, () => {
        void props.run(() => props.setConnectorEnabled(connection.id, !connection.enabled))
      })}
    </div>)}</div>
    {pairing === undefined && <button type="button" className={css.secondaryAction} disabled={busy} onClick={start}>{t('whatsappAdd')}</button>}
    {pairing !== undefined && <div className={css.card}>
      {pairing.state === 'connected'
        ? <p role="status" className={css.testing}>{t('whatsappConnected')}</p>
        : failure !== undefined
          ? <p role="alert" className={css.error}>{failure}</p>
          : <div className={css.qrLayout}>
            <div className={css.qrFrame}>
              {pairing.qr === undefined ? <Spinner /> : <img className={css.qrImage} src={pairing.qr} alt={t('whatsappQrAlt')} />}
            </div>
            <ol className={css.qrSteps}>
              <li>{t('whatsappStepOpen')}</li>
              <li>{t('whatsappStepLinked')}</li>
              <li>{t('whatsappStepScan')}</li>
            </ol>
          </div>}
      {(pairing.state === 'starting' || pairing.state === 'qr') && <p role="status" className={css.testing}><Spinner />{t(pairing.qr === undefined ? 'whatsappPreparing' : 'whatsappWaiting')}</p>}
      {pairing.state !== 'connected' && <div className={css.actions}>
        {failure !== undefined && pairing.state !== 'limit' && pairing.state !== 'unavailable' && <button type="button" className={css.primaryAction} disabled={busy} onClick={start}>{t('whatsappRetry')}</button>}
        <button type="button" className={css.secondaryAction} disabled={busy} onClick={cancel}>{t(failure === undefined ? 'cancel' : 'close')}</button>
      </div>}
      <p className={css.hint}>{t('whatsappPrivacy')}</p>
    </div>}
  </>
}
