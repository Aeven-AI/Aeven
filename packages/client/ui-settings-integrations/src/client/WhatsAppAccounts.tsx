/** WhatsApp connector page: one row per linked number and the QR card that links another. */

import { useEffect, useId, useRef, useState } from 'react'
import type { ConnectorId, WhatsAppPairingView, WhatsAppPhoneCodeView } from '@aeven/api-remotes/client'
import { IconTrashOutline16, Spinner } from '@aeven/client-ui-primitives'
import { ConnectorAccountRows } from './ConnectorAccountRows.tsx'
import { formatPhone, type PairingAccountsProps } from './connector-page.ts'
import css from './IntegrationsSection.module.css'
import { guessCallingCode, internationalPhone, splitPhone } from './whatsapp-phone.ts'

/** Interval between pairing-state reads while the card is open. */
const POLL_MS = 1500

/**
 * Session-storage key holding the open attempt's id. Scanning the code means leaving the page for WhatsApp, and a
 * phone browser may discard the backgrounded tab; a reload then resumes the same attempt instead of starting over.
 */
const ATTEMPT_KEY = 'aeven.whatsapp.pairing'

/**
 * Remember or forget the open attempt for this tab.
 * @param id - the attempt to remember, or undefined to forget it.
 */
function rememberAttempt(id: ConnectorId | undefined): void {
  try {
    if (id === undefined) sessionStorage.removeItem(ATTEMPT_KEY)
    else sessionStorage.setItem(ATTEMPT_KEY, id)
  } catch {
    // Storage refused (private mode, quota): a discarded tab then starts a new attempt.
  }
}

/**
 * Read the attempt this tab left open.
 * @returns the attempt id, or undefined when none is remembered.
 */
function rememberedAttempt(): ConnectorId | undefined {
  try {
    return (sessionStorage.getItem(ATTEMPT_KEY) ?? undefined) as ConnectorId | undefined
  } catch {
    // Storage unreadable: nothing to resume.
    return undefined
  }
}

/**
 * The reader's country as the Host stated it in the page (`__AVN_READER_COUNTRY__`, set by the hosted bundle from the
 * edge's country header).
 * @returns the ISO 3166 alpha-2 code, or undefined when the Host stated none.
 */
function readerCountry(): string | undefined {
  const country = (globalThis as { __AVN_READER_COUNTRY__?: unknown }).__AVN_READER_COUNTRY__
  return typeof country === 'string' ? country : undefined
}

/** Props from the connector page. */
export interface WhatsAppAccountsProps extends PairingAccountsProps {
  startWhatsAppPairing: () => Promise<WhatsAppPairingView>
  whatsAppPairing: (id: ConnectorId) => Promise<WhatsAppPairingView>
  cancelWhatsAppPairing: (id: ConnectorId) => Promise<void>
  whatsAppPhoneCode: (id: ConnectorId, phone: string) => Promise<WhatsAppPhoneCodeView>
}

/**
 * Whether linking should open on the phone-number path: a touch screen is most likely the phone being linked,
 * which cannot scan a QR code shown on its own screen.
 * @returns true on a coarse primary pointer.
 */
function prefersPhoneCode(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
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
  const { whatsAppPairing, cancelWhatsAppPairing, refresh } = props
  const waiting = pairing?.state === 'starting' || pairing?.state === 'qr'
  // The phone-number path: the reader's number, then the code WhatsApp issued for it.
  const [method, setMethod] = useState<'qr' | 'phone'>(() => (prefersPhoneCode() ? 'phone' : 'qr'))
  const [phone, setPhone] = useState('')
  const phoneFieldId = useId()
  const [phoneCode, setPhoneCode] = useState<WhatsAppPhoneCodeView>()
  const [requesting, setRequesting] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setPhoneCode(undefined) }, [pairing?.id])
  // On the phone being linked the code is typed into WhatsApp on the same screen, so it can be carried there.
  const copyCode = (code: string): void => {
    void navigator.clipboard.writeText(code).then(() => { setCopied(true) }, () => {
      // Clipboard refused (insecure context, denied permission): the code stays on screen to type.
    })
  }
  // The code WhatsApp first issued, and the one valid now: WhatsApp replaces it when the phone was given a code that
  // did not match, and the Host reports the replacement with the pairing state. Shown and copied as its 8 characters
  // in capitals, because a pasted dash or lowercase letter is a different code to WhatsApp.
  const issued = phoneCode?.state === 'code' ? phoneCode.code : undefined
  const latest = pairing?.phoneCode ?? issued
  const currentCode = latest === undefined ? undefined : latest.replace(/[^0-9a-z]/giu, '').toUpperCase()
  const refreshed = issued !== undefined && pairing?.phoneCode !== undefined && pairing.phoneCode !== issued
  useEffect(() => { setCopied(false) }, [currentCode])
  // The country-code box starts at the browser's own country; a number typed with `+` or `00` replaces it.
  const [callingCode, setCallingCode] = useState(() => guessCallingCode(readerCountry(), navigator.languages))
  const requestCode = (): void => {
    const id = pairing?.id
    if (id === undefined || pairing?.state !== 'qr') return
    const international = internationalPhone(callingCode, phone)
    if (international === undefined) {
      setPhoneCode({ state: 'invalid-phone' })
      return
    }
    setRequesting(true)
    props.whatsAppPhoneCode(id, international).then(setPhoneCode, () => { setPhoneCode({ state: 'failed' }) })
      .finally(() => { setRequesting(false) })
  }
  useEffect(() => { rememberAttempt(waiting ? pairing.id : undefined) }, [pairing?.id, waiting])

  const start = (): void => {
    setPairing({ state: 'starting' })
    props.startWhatsAppPairing().then(setPairing, () => { setPairing({ state: 'failed' }) })
  }
  // The attempt belongs to the Host, which retires an unscanned one on its own: leaving the page for WhatsApp, or a
  // phone discarding the tab meanwhile, must not cancel the scan in progress. Only Cancel/Close does.
  useEffect(() => {
    const resumed = rememberedAttempt()
    if (resumed === undefined) {
      if (props.startWithPairing) start()
      return
    }
    setPairing({ id: resumed, state: 'starting' })
    whatsAppPairing(resumed).then((next) => {
      setPairing(next)
      if (next.state === 'connected') refresh()
    }, () => { setPairing({ id: resumed, state: 'expired' }) })
  }, [])
  const read = useRef<() => void>(() => {})
  read.current = () => {
    const id = pairing?.id
    if (id === undefined || !waiting) return
    void whatsAppPairing(id).then((next) => {
      setPairing(next)
      if (next.state === 'connected') refresh()
    }, () => {
      // A failed read is retried on the next interval or the next return to the page.
    })
  }
  useEffect(() => {
    if (pairing?.id === undefined || !waiting) return
    const timer = setInterval(() => { read.current() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [pairing?.id, waiting])
  // A background tab's interval is throttled or suspended, so coming back from WhatsApp reads the live state at once
  // rather than painting a stale code first.
  useEffect(() => {
    const resume = (): void => { if (document.visibilityState === 'visible') read.current() }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pageshow', resume)
    return () => {
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('pageshow', resume)
    }
  }, [])
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
    <ConnectorAccountRows connections={props.connections} row={connection => <>
      <span className={css.skillSummary}>
        <strong>{connection.name}</strong>
        {connection.whatsapp !== undefined && connection.name !== formatPhone(connection.whatsapp.phone) && (
          <span className={css.address}>{formatPhone(connection.whatsapp.phone)}</span>
        )}
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
    </>} />
    {pairing === undefined && <button type="button" className={css.secondaryAction} disabled={busy} onClick={start}>{t('whatsappAdd')}</button>}
    {pairing !== undefined && <div className={css.card}>
      {pairing.state === 'connected'
        ? <p role="status" className={css.testing}>{t('whatsappConnected')}</p>
        : failure !== undefined
          ? <p role="alert" className={css.error}>{failure}</p>
          : method === 'phone'
            ? currentCode !== undefined
              ? <div className={css.qrLayout}>
                {refreshed && <p role="alert" className={css.error}>{t('whatsappCodeRefreshed')}</p>}
                <p className={css.phoneCode} aria-live="polite">{`${currentCode.slice(0, 4)}-${currentCode.slice(4)}`}</p>
                <button type="button" className={css.secondaryAction} onClick={() => { copyCode(currentCode) }}>{t(copied ? 'copied' : 'copy')}</button>
                <ol className={css.qrSteps}>
                  <li>{t('whatsappCodeStepOpen')}</li>
                  <li>{t('whatsappCodeStepLink')}</li>
                  <li>{t('whatsappCodeStepEnter')}</li>
                </ol>
              </div>
              : <form className={css.phoneForm} onSubmit={(event) => { event.preventDefault(); requestCode() }}>
                <div className={css.field}>
                  <label htmlFor={phoneFieldId}>{t('whatsappPhoneLabel')}</label>
                  <span className={css.phoneRow}>
                    <input className={css.callingCode} type="tel" inputMode="tel" aria-label={t('whatsappCountryLabel')} value={callingCode} disabled={requesting} onChange={(event) => { setCallingCode(event.currentTarget.value); setPhoneCode(undefined) }} />
                    <input id={phoneFieldId} type="tel" inputMode="tel" autoComplete="tel-national" value={phone} placeholder={t('whatsappPhonePlaceholder')} disabled={requesting} onChange={(event) => {
                      const parts = splitPhone(event.currentTarget.value, callingCode)
                      setCallingCode(parts.callingCode)
                      setPhone(parts.number)
                      setPhoneCode(undefined)
                    }} />
                  </span>
                </div>
                <button type="submit" className={css.primaryAction} disabled={requesting || pairing.state !== 'qr' || phone.trim() === ''}>{t('whatsappPhoneSubmit')}</button>
                {phoneCode?.state === 'invalid-phone' && <p role="alert" className={css.error}>{t('whatsappPhoneInvalid')}</p>}
                {(phoneCode?.state === 'failed' || phoneCode?.state === 'expired') && <p role="alert" className={css.error}>{t('whatsappPhoneFailed')}</p>}
                {phoneCode?.state === 'rate-limited' && <p role="alert" className={css.error}>{t('whatsappPhoneRateLimited')}</p>}
              </form>
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
      {(pairing.state === 'starting' || pairing.state === 'qr') && (method === 'qr' || pairing.qr === undefined || phoneCode?.state === 'code') && <p role="status" className={`${css.testing} ${css.pairingStatus}`}><Spinner />{t(pairing.qr === undefined ? 'whatsappPreparing' : method === 'phone' ? 'whatsappCodeWaiting' : 'whatsappWaiting')}</p>}
      {pairing.state !== 'connected' && <div className={`${css.actions} ${css.pairingActions}`}>
        {(pairing.state === 'starting' || pairing.state === 'qr') && <button type="button" className={css.secondaryAction} onClick={() => { setMethod(method === 'phone' ? 'qr' : 'phone') }}>{t(method === 'phone' ? 'whatsappUseQr' : 'whatsappUsePhone')}</button>}
        {failure !== undefined && pairing.state !== 'limit' && pairing.state !== 'unavailable' && <button type="button" className={css.primaryAction} disabled={busy} onClick={start}>{t('whatsappRetry')}</button>}
        <button type="button" className={css.secondaryAction} disabled={busy} onClick={cancel}>{t(failure === undefined ? 'cancel' : 'close')}</button>
      </div>}
      <p className={`${css.hint} ${css.pairingHint}`}>{t('whatsappPrivacy')}</p>
    </div>}
  </>
}
