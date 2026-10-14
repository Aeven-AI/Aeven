/** Telegram connector page: one row per signed-in account and the card that signs in another, by QR code or phone number. */

import { useEffect, useRef, useState } from 'react'
import type { ConnectorId, TelegramLoginFailure, TelegramPairingView } from '@aeven/api-remotes/client'
import { IconTrashOutline16, Spinner } from '@aeven/client-ui-primitives'
import { ConnectorAccountRows } from './ConnectorAccountRows.tsx'
import { formatPhone, type PairingAccountsProps, type TelegramPairingOperations } from './connector-page.ts'
import { connectorIcons } from './connector-icons.ts'
import type { IntegrationsLocaleKey } from './locales.ts'
import css from './IntegrationsSection.module.css'

/** Interval between sign-in state reads while the card waits for a step or for Telegram. */
const POLL_MS = 1500

/** Props from the connector page. */
export interface TelegramAccountsProps extends PairingAccountsProps, TelegramPairingOperations {}

/** Fixed copy for each reason Telegram refused a step, so Telegram's own error text never reaches the page. */
const rejections = {
  'code-invalid': 'telegramReasonCodeInvalid', 'password-invalid': 'telegramReasonPasswordInvalid', 'phone-invalid': 'telegramReasonPhoneInvalid',
  'too-many-attempts': 'telegramReasonTooManyAttempts', 'unreachable': 'telegramReasonUnreachable', 'other': 'telegramReasonOther',
} as const satisfies Record<TelegramLoginFailure, IntegrationsLocaleKey>

/**
 * Render the signed-in accounts and the sign-in card.
 * @param props - page state and account operations.
 * @returns the Telegram connector page body.
 */
export function TelegramAccounts(props: TelegramAccountsProps) {
  const { t, busy } = props
  const [open, setOpen] = useState(false)
  /** The card opens on a QR code; the phone number sign-in works without the Telegram app on a phone. */
  const [mode, setMode] = useState<'qr' | 'phone'>('qr')
  const [attempt, setAttempt] = useState<TelegramPairingView>()
  const [confirming, setConfirming] = useState<ConnectorId>()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const attemptId = useRef<ConnectorId>()
  const waiting = attempt?.state === 'starting' || attempt?.state === 'code' || attempt?.state === 'qr' || attempt?.state === 'password'
  attemptId.current = waiting ? attempt.id : undefined
  const { telegramPairing, cancelTelegramPairing, refresh } = props

  const begin = (operation: () => Promise<TelegramPairingView>): void => {
    setCode('')
    setPassword('')
    setAttempt({ state: 'starting' })
    operation().then((next) => {
      setAttempt(next)
      if (next.state === 'connected') refresh()
    }, () => { setAttempt({ state: 'failed' }) })
  }
  const start = (): void => { begin(() => props.startTelegramPairing(phone.trim())) }
  const startQr = (): void => { begin(() => props.startTelegramQrPairing()) }
  const openQr = (): void => {
    setOpen(true)
    setMode('qr')
    startQr()
  }
  /** Leave the running attempt for the other way of signing in. */
  const switchTo = (next: 'qr' | 'phone'): void => {
    const id = attempt?.id
    if (id !== undefined) void props.cancelTelegramPairing(id)
    setAttempt(undefined)
    setMode(next)
    if (next === 'qr') startQr()
  }
  useEffect(() => { if (props.startWithPairing) openQr() }, [])
  // An attempt left open when the page closes is abandoned rather than left waiting for a code.
  useEffect(() => () => { if (attemptId.current !== undefined) void cancelTelegramPairing(attemptId.current) }, [cancelTelegramPairing])
  useEffect(() => {
    const id = attempt?.id
    if (id === undefined || !waiting) return
    const timer = setInterval(() => {
      void telegramPairing(id).then((next) => {
        setAttempt(next)
        if (next.state === 'connected') refresh()
      }, () => {
        // A failed read is retried on the next interval.
      })
    }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [attempt?.id, waiting, telegramPairing, refresh])
  useEffect(() => {
    if (attempt?.state !== 'connected') return
    const timer = setTimeout(() => {
      setOpen(false)
      setAttempt(undefined)
      setPhone('')
      setCode('')
      setPassword('')
    }, 2_000)
    return () => { clearTimeout(timer) }
  }, [attempt?.state])

  const close = (): void => {
    const id = attempt?.id
    setOpen(false)
    setMode('qr')
    setAttempt(undefined)
    setPhone('')
    setCode('')
    setPassword('')
    if (id !== undefined) void props.cancelTelegramPairing(id)
  }
  const submit = (operation: (id: ConnectorId) => Promise<TelegramPairingView>): void => {
    const id = attempt?.id
    if (id === undefined) return
    void operation(id).then((next) => {
      setAttempt(next)
      if (next.state === 'connected') refresh()
    }, () => {
      // The poll reports the state again; the typed value stays so the user can correct it.
    })
  }
  const outcome: Partial<Record<TelegramPairingView['state'], IntegrationsLocaleKey>> = {
    unlinked: 'telegramRelink', expired: 'telegramExpired', failed: 'telegramFailed',
    duplicate: 'telegramDuplicate', limit: 'telegramLimit', unavailable: 'telegramUnavailable',
  }
  const failure = attempt === undefined ? undefined : outcome[attempt.state]

  return <>
    <ConnectorAccountRows connections={props.connections} row={connection => <>
      <span className={css.skillSummary}>
        <strong>{connection.name}</strong>
        {connection.telegram?.username !== undefined && <span className={css.address}>@{connection.telegram.username}</span>}
        {connection.telegram?.phone !== undefined && connection.telegram.phone !== connection.name && (
          <span className={css.address}>{formatPhone(connection.telegram.phone)}</span>
        )}
        {!connection.connected && <span className={css.attention}>{t('telegramRelink')}</span>}
        {confirming === connection.id && <span className={css.actions}>
          <span className={css.hint}>{t('telegramUnlinkConfirm')}</span>
          <button type="button" className={css.primaryAction} disabled={busy} onClick={() => {
            setConfirming(undefined)
            void props.run(() => props.disconnect(connection.id))
          }}>{t('telegramUnlink')}</button>
          <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { setConfirming(undefined) }}>{t('cancel')}</button>
        </span>}
      </span>
      <button type="button" className={css.iconAction} aria-label={t('telegramUnlink')} title={t('telegramUnlink')} disabled={busy} onClick={() => { setConfirming(connection.id) }}><IconTrashOutline16 /></button>
      {props.toggle(connection.name, connection.enabled && connection.connected, !connection.connected, () => {
        void props.run(() => props.setConnectorEnabled(connection.id, !connection.enabled))
      })}
    </>} />
    {!open && <button type="button" className={css.secondaryAction} disabled={busy} onClick={openQr}>{t('telegramAdd')}</button>}
    {open && <div className={css.card}>
      {mode === 'phone' && attempt === undefined
        ? <label className={css.field}>{t('telegramPhoneLabel')}
          <input type="tel" inputMode="tel" autoComplete="tel" autoFocus value={phone} placeholder={t('telegramPhonePlaceholder')} disabled={busy} onChange={(event) => { setPhone(event.currentTarget.value) }} />
        </label>
        : mode === 'qr' ? <div className={css.qrLayout}>
          <div className={css.qrFrame}>
            {attempt?.qr !== undefined
              ? <img className={css.qrImage} src={attempt.qr} alt={t('telegramQrAlt')} />
              : attempt === undefined || attempt.state === 'starting' || attempt.state === 'qr'
                ? <Spinner />
                : <img className={css.qrImage} src={connectorIcons['telegram']} alt={t('telegramLogoAlt')} />}
          </div>
          <ol className={css.qrSteps}>
            <li>{t('telegramQrStepOpen')}</li>
            <li>{t('telegramQrStepDevices')}</li>
            <li>{t('telegramQrStepScan')}</li>
            <li>{t('telegramStepPassword')}</li>
          </ol>
        </div>
          : <div className={css.qrLayout}>
            <div className={css.qrFrame}>
              <img className={css.qrImage} src={connectorIcons['telegram']} alt={t('telegramLogoAlt')} />
            </div>
            <ol className={css.qrSteps}>
              <li>{t('telegramStepPhone')}</li>
              <li>{t('telegramStepCode')}</li>
              <li>{t('telegramStepPassword')}</li>
            </ol>
          </div>}
      {attempt?.state === 'code' && <label className={css.field}>{t('telegramCodeLabel')}
        <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} disabled={busy} onChange={(event) => { setCode(event.currentTarget.value) }} />
      </label>}
      {attempt?.state === 'password' && <label className={css.field}>{t('telegramPasswordLabel')}
        <input type="password" autoComplete="current-password" autoFocus value={password} disabled={busy} onChange={(event) => { setPassword(event.currentTarget.value) }} />
      </label>}
      {attempt?.reason !== undefined && <p role="alert" className={css.error}>{t(rejections[attempt.reason])}</p>}
      {attempt?.state === 'connected' && <p role="status" className={css.testing}>{t('telegramConnected')}</p>}
      {failure !== undefined && <p role="alert" className={css.error}>{t(failure)}</p>}
      {waiting && <p role="status" className={css.testing}><Spinner />{t(mode === 'qr' && (attempt.state === 'starting' || attempt.state === 'qr')
        ? attempt.qr === undefined ? 'telegramQrPreparing' : 'telegramQrWaiting'
        : 'telegramWaiting')}</p>}
      <div className={css.actions}>
        {mode === 'phone' && attempt === undefined && <button type="button" className={css.primaryAction} disabled={busy || phone.trim() === ''} onClick={start}>{t('telegramSendCode')}</button>}
        {mode === 'phone' && attempt === undefined && <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { switchTo('qr') }}>{t('telegramUseQr')}</button>}
        {mode === 'qr' && (attempt?.state === 'starting' || attempt?.state === 'qr') && <button type="button" className={css.secondaryAction} disabled={busy} onClick={() => { switchTo('phone') }}>{t('telegramUsePhone')}</button>}
        {attempt?.state === 'code' && <button type="button" className={css.primaryAction} disabled={busy || code.trim() === ''} onClick={() => { submit(id => props.submitTelegramCode(id, code.trim())) }}>{t('telegramVerifyCode')}</button>}
        {attempt?.state === 'password' && <button type="button" className={css.primaryAction} disabled={busy || password === ''} onClick={() => { submit(id => props.submitTelegramPassword(id, password)) }}>{t('telegramSubmitPassword')}</button>}
        {failure !== undefined && attempt?.state !== 'limit' && attempt?.state !== 'unavailable' && <button type="button" className={css.primaryAction} disabled={busy} onClick={() => {
          const retryMode = mode
          close()
          if (retryMode === 'qr') openQr()
          else { setOpen(true); setMode('phone') }
        }}>{t('telegramRetry')}</button>}
        {attempt?.state !== 'connected' && <button type="button" className={css.secondaryAction} disabled={busy} onClick={close}>{t(failure === undefined ? 'cancel' : 'close')}</button>}
      </div>
      <p className={css.hint}>{t('telegramPrivacy')}</p>
    </div>}
  </>
}
