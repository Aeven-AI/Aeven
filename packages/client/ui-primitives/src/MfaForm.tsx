/** Shared authenticator setup and verification, with credentials supplied by the caller. */
import { useEffect, useState } from 'react'
import type React from 'react'
import css from './MfaForm.module.css'

/** User-facing operations supported by the authenticator form. */
export type MfaMode = 'offer' | 'setup' | 'disable'
/** Responses contain enrollment material only during setup and recovery codes only on enable. */
export interface MfaAnswer {
  readonly secret?: string
  readonly qrCode?: string
  readonly recoveryCodes?: readonly string[]
  readonly enabled?: boolean
}
/** Localized copy shared by signup and Account settings. */
export type MfaKey = 'mfa.title' | 'mfa.intro' | 'mfa.setup' | 'mfa.skip' | 'mfa.scan' | 'mfa.manual'
  | 'mfa.code' | 'mfa.confirm' | 'mfa.cancel' | 'mfa.disable' | 'mfa.disableInfo'
  | 'mfa.error' | 'mfa.expired' | 'mfa.limited' | 'mfa.recovery' | 'mfa.recoveryInfo'
  | 'mfa.used' | 'mfa.restart' | 'mfa.recoveryCode' | 'mfa.failure' | 'mfa.saved' | 'mfa.copy' | 'mfa.copied' | 'mfa.loading' | 'mfa.useRecovery' | 'mfa.useApp'

/** The caller owns API credentials and navigation; no secret enters persistent browser storage. */
export interface MfaFormProps {
  /** Center the form in the available signup or sign-in screen. Card layout only. */
  readonly standalone?: boolean
  /**
   * Presentation of the same flow. `card` is the floating card the signup,
   * sign-in and challenge screens show; `cells` is the settings treatment —
   * left-aligned copy on the page itself, the QR code beside the fields, and
   * no card chrome, for a host section that already names the feature.
   */
  readonly layout?: 'card' | 'cells'
  readonly mode: MfaMode
  readonly t: (key: MfaKey) => string
  readonly request: (action: 'setup' | 'enable' | 'disable' | 'login', code?: string) => Promise<MfaAnswer>
  readonly onDone: () => void | Promise<void>
  readonly onCancel: () => void
}

/** Heading of the step the form is showing. */
function titleKey(mode: MfaMode): MfaKey {
  return mode === 'disable' ? 'mfa.disable' : 'mfa.title'
}

/** Instruction of the step the form is showing. */
function infoKey(mode: MfaMode): MfaKey {
  return mode === 'offer' ? 'mfa.intro' : mode === 'setup' ? 'mfa.scan' : 'mfa.disableInfo'
}

/** Failure response code of the enable or disable call. */
function errorKey(failure: unknown): MfaKey {
  const name = failure instanceof Error ? failure.message : ''
  return name === 'too-many-attempts' ? 'mfa.limited' : name === 'expired-code' ? 'mfa.expired' : name === 'invalid-code' ? 'mfa.error' : name === 'code-already-used' ? 'mfa.used' : 'mfa.failure'
}

/** Authenticator emblem shown at the head of the card layout. */
function Emblem() {
  return (
    <span className={css.emblem} aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg></span>
  )
}

/**
 * Render QR enrollment, a second-factor prompt, or one-time recovery-code disclosure.
 * @param props - localized labels, authenticated API operations, completion callbacks, and the presentation.
 * @returns the form; enabled state changes only after the server confirms a code.
 */
export function MfaForm({ mode: initialMode, t, request, onDone, onCancel, standalone = false, layout = 'card' }: MfaFormProps): React.JSX.Element {
  const [mode, setMode] = useState(initialMode)
  const [setup, setSetup] = useState<MfaAnswer>()
  const [codes, setCodes] = useState<readonly string[]>()
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MfaKey>()
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [verified, setVerified] = useState(false)
  const cells = layout === 'cells'

  useEffect(() => {
    if (mode !== 'setup') return
    let active = true
    setBusy(true)
    void request('setup').then((value) => { if (active) setSetup(value) })
      .catch(() => { if (active) setError('mfa.failure') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [mode, request])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(undefined)
    void (verified ? Promise.resolve<MfaAnswer>({}) : request(mode === 'setup' ? 'enable' : 'disable', code))
      .then((value) => {
        if (value.recoveryCodes !== undefined) setCodes(value.recoveryCodes)
        else {
          setVerified(true)
          return onDone()
        }
      })
      .catch((failure: unknown) => { setError(errorKey(failure)) })
      .finally(() => { setBusy(false) })
  }

  // Enrollment material: the QR code and its setup-key disclosure, or the
  // status line while setup is still being prepared.
  const enrollment = setup === undefined
    ? <p className={css.status} role="status">{busy ? t('mfa.loading') : ''}</p>
    : (
      <div className={css.qrBlock}>
        <img className={css.qr} src={setup.qrCode} alt={t('mfa.scan')} />
        <details className={css.manual}><summary>{t('mfa.manual')}</summary><code>{setup.secret}</code></details>
      </div>
    )

  const field = (
    <label className={css.field}>{t(recovery ? 'mfa.recoveryCode' : 'mfa.code')}
      <input
        autoFocus type="text" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code"
        maxLength={recovery ? 19 : 6} pattern={recovery ? '[a-fA-F0-9 -]{16,19}' : '[0-9]{6}'}
        value={code} onChange={(event) => { setCode(event.target.value) }} required disabled={busy || verified}
      />
    </label>
  )

  const failure = error === undefined ? null : <p className={css.error} role="alert">{t(error)}</p>

  // Recovery-code entry is the same challenge answered with a code format the
  // reader chooses; the setup step has no recovery code to offer.
  const alternate = mode !== 'setup' && !verified && (
    <button type="button" className={css.tertiary} onClick={() => { setRecovery(!recovery); setCode('') }}>
      {t(recovery ? 'mfa.useApp' : 'mfa.useRecovery')}
    </button>
  )

  const confirm = (
    <button type="submit" className={css.primary} disabled={busy || error === 'mfa.expired' || error === 'mfa.limited' || (mode === 'setup' && setup === undefined)}>
      {t(mode === 'disable' ? 'mfa.disable' : 'mfa.confirm')}
    </button>
  )

  const cancel = (
    <button type="button" className={css.secondary} disabled={busy} onClick={onCancel}>
      {t(error === 'mfa.expired' || error === 'mfa.limited' ? 'mfa.restart' : 'mfa.cancel')}
    </button>
  )

  const offer = (
    <>
      <button type="button" className={css.primary} onClick={() => { setMode('setup') }}>{t('mfa.setup')}</button>
      <button type="button" className={css.secondary} onClick={onCancel}>{t('mfa.skip')}</button>
    </>
  )

  if (codes !== undefined) {
    const disclosure = (
      <>
        <div className={css.codes}>{codes.map(value => <code key={value}>{value}</code>)}</div>
        <div className={css.actions}>
          <button type="button" className={css.secondary} onClick={() => {
            void navigator.clipboard.writeText(codes.join('\n')).then(() => { setCopied(true) }).catch(() => { setCopied(false) })
          }}>{t(copied ? 'mfa.copied' : 'mfa.copy')}</button>
        </div>
        <label className={css.saved}><input type="checkbox" checked={saved} onChange={(event) => { setSaved(event.target.checked) }} />{t('mfa.saved')}</label>
        {failure}
        <div className={css.actions}>
          <button type="button" className={css.primary} disabled={!saved || busy} onClick={() => {
            setBusy(true)
            setError(undefined)
            void Promise.resolve().then(onDone).catch(() => { setError('mfa.failure') }).finally(() => { setBusy(false) })
          }}>{t('mfa.confirm')}</button>
        </div>
      </>
    )
    return (
      <section className={cells ? css.cells : css.card}>
        {!cells && <span className={css.emblem} aria-hidden="true">✓</span>}
        <h2>{t('mfa.recovery')}</h2><p>{t('mfa.recoveryInfo')}</p>
        {disclosure}
      </section>
    )
  }

  const body = (
    <>
      <p>{t(infoKey(mode))}</p>
      <div className={css.grid}>
        {mode === 'setup' && enrollment}
        <div className={css.credentials}>
          {field}
          {alternate}
          {failure}
          <div className={css.actions}>
            {cancel}
            {confirm}
          </div>
        </div>
      </div>
    </>
  )

  const card = (
    <form className={cells ? css.cells : css.card} onSubmit={submit}>
      {!cells && <Emblem />}
      {!cells && <h2>{t(titleKey(mode))}</h2>}
      {mode === 'offer' ? <>
        <p>{t(infoKey(mode))}</p>
        {offer}
      </> : body}
    </form>
  )
  return standalone ? <div className={css.screen}>{card}</div> : card
}
