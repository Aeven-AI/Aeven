/**
 * The passkey popup: after a sign-in on this page it offers to move the account key onto a passkey, and whenever
 * this device waits on the account's passkey, or on the user after the relay took the key back, it asks for that.
 * Every question can be put off for the rest of the page; Settings → Sync offers the same actions. A locked device
 * names the passkeys that unlock it and offers a recovery key, when the account has one, and starting over from its
 * own data. Protecting the account offers a recovery key once the passkey holds the key.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { SyncPasskeyPurpose, SyncView } from '@aeven/api-remotes/client'
import { Button, Input, Modal } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import { hasRecoveryKey, unlockHint } from './holders.ts'
import { openPasskeyPage, useSyncStatus, type SyncOperations } from './passkey.ts'
import { RecoveryKeyDialog } from './RecoveryKeyDialog.tsx'
import css from './SyncSection.module.css'

/** Registration-side operations the popup calls. */
export interface SyncPasskeyPopupInjected extends SyncOperations {
  /** Whether the reader signed in on this page rather than arriving with a restored session. */
  signedInThisPage: () => boolean
}

/** Composed props: standard kit, the injected operations, and the `settings.sync` dictionaries. */
export type SyncPasskeyPopupProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.sync'>
  & InjectFace<SyncPasskeyPopupInjected>

/** Shortest time between two status reads the popup makes; it only follows who holds the account key. */
const STATUS_INTERVAL_MS = 2_000

/** What the popup asks. */
type Question = 'offer' | 'unlock' | 'downgraded'

/** A screen the reader opened from a question: typing a recovery key, confirming a start over, or saving a new key. */
type Screen = 'recovery' | 'startOver' | 'recoveryOffer' | 'recoveryKey'

/**
 * The question the status calls for, if any.
 * @param view - the caller's sync status.
 * @param signedIn - whether the reader signed in on this page.
 * @returns the question, or undefined when nothing waits on the reader.
 */
function questionOf(view: SyncView, signedIn: boolean): Question | undefined {
  const protection = view.protection
  if (protection === undefined || view.state === 'disabled') return undefined
  if (protection.downgraded) return 'downgraded'
  if (protection.locked) return 'unlock'
  if (protection.mode === 'server' && signedIn && view.state === 'online') return 'offer'
  return undefined
}

/**
 * Render the popup, or nothing while no question waits and no step started here runs.
 * @param props - standard kit, injected operations, and the `settings.sync` dictionaries.
 * @returns the popup or null.
 */
export function SyncPasskeyPopup(props: SyncPasskeyPopupProps) {
  const { t } = props
  const ops: SyncPasskeyPopupInjected = props
  const { load, refresh } = useSyncStatus(ops, STATUS_INTERVAL_MS)
  const [later, setLater] = useState<ReadonlySet<Question>>(new Set())
  // A step started from this popup stays in it until the step ends.
  const [started, setStarted] = useState<SyncPasskeyPurpose | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [screen, setScreen] = useState<Screen | undefined>(undefined)
  const [typed, setTyped] = useState('')
  const [recoveryKey, setRecoveryKey] = useState<string | undefined>(undefined)
  const view = load.status === 'ready' ? load.view : undefined
  // A protect step started here that ended with the passkey holding the key offers a recovery key, once.
  useEffect(() => {
    if (started !== 'protect' || view === undefined || view.passkey !== undefined) return
    setStarted(undefined)
    if (view.protection?.mode === 'passkey' && !view.protection.locked) setScreen('recoveryOffer')
  }, [started, view])
  if (view === undefined) return null
  const question = questionOf(view, ops.signedInThisPage())
  const step = started === undefined ? undefined : view.passkey
  if (screen === undefined && step === undefined && (question === undefined || later.has(question))) return null
  const holders = view.protection?.holders ?? []

  const close = (): void => {
    if (question !== undefined && screen !== 'recoveryOffer' && screen !== 'recoveryKey') setLater(new Set([...later, question]))
    if (step !== undefined) void ops.cancelPasskey().finally(() => { void refresh() })
    setStarted(undefined)
    setFailed(false)
    setScreen(undefined)
    setTyped('')
    setRecoveryKey(undefined)
  }
  const act = (operation: () => Promise<unknown>, after?: () => void): void => {
    setFailed(false)
    void operation().then(() => { after?.(); return refresh() }, () => { setFailed(true) })
  }
  const passkey = (purpose: SyncPasskeyPurpose): void => {
    setStarted(purpose)
    setScreen(undefined)
    act(() => openPasskeyPage(ops, purpose))
  }
  const open = (next: Screen): void => {
    setFailed(false)
    setScreen(next)
  }

  // Every question is one sentence or two in the Modal description, as in the app's other confirmations.
  let title: string
  let description: string
  let footer: ReactNode
  let body: ReactNode
  if (screen === 'recoveryKey' && recoveryKey !== undefined) return <RecoveryKeyDialog recoveryKey={recoveryKey} t={t} onClose={close} />
  if (screen === 'recoveryOffer') {
    title = t('recoveryOfferTitle')
    description = t('recoveryOfferBody')
    footer = (
      <>
        <Button variant="outline" onClick={close}>{t('skip')}</Button>
        <Button variant="primary" onClick={() => {
          setFailed(false)
          void ops.createRecoveryKey().then(({ key }) => {
            setRecoveryKey(key)
            setScreen('recoveryKey')
          }, () => { setFailed(true) })
        }}>{t('createRecovery')}</Button>
      </>
    )
  } else if (step !== undefined) {
    title = question === 'unlock' ? t('unlockTitle') : t('offerTitle')
    description = step.state === 'waiting' ? t('waiting')
      : step.state === 'wrong-passkey' ? `${t('wrongPasskey')} ${unlockHint(holders, t)}`
        : step.state === 'duplicate' ? t('duplicate')
          : step.state === 'failed' ? t('stepFailed')
            : t('unsupported')
    footer = step.state === 'failed' || step.state === 'wrong-passkey' || step.state === 'duplicate'
      ? (
        <>
          <Button variant="outline" onClick={close}>{t('close')}</Button>
          <Button variant="primary" onClick={() => { passkey(step.purpose) }}>{t('tryAgain')}</Button>
        </>
      )
      : <Button variant="outline" onClick={close}>{step.state === 'waiting' ? t('cancel') : t('dismiss')}</Button>
  } else if (screen === 'recovery') {
    title = t('recoveryTitle')
    description = t('recoveryBody')
    body = (
      <Input
        value={typed}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder={t('recoveryPlaceholder')}
        aria-label={t('recoveryTitle')}
        onChange={(event) => { setTyped(event.target.value) }}
      />
    )
    footer = (
      <>
        <Button variant="outline" onClick={() => { setScreen(undefined) }}>{t('back')}</Button>
        <Button variant="primary" disabled={typed.trim() === ''} onClick={() => { act(() => ops.unlockWithRecoveryKey(typed), close) }}>{t('unlock')}</Button>
      </>
    )
  } else if (screen === 'startOver') {
    title = t('startOverTitle')
    description = t('startOverBody')
    footer = (
      <>
        <Button variant="outline" onClick={() => { setScreen(undefined) }}>{t('back')}</Button>
        <Button variant="primary" onClick={() => { act(() => ops.unprotect(), close) }}>{t('startOverConfirm')}</Button>
      </>
    )
  } else if (question === 'downgraded') {
    title = t('downgraded')
    description = t('downgradedBody')
    footer = (
      <>
        <Button variant="outline" onClick={close}>{t('notNow')}</Button>
        <Button variant="primary" onClick={() => { act(() => ops.acceptServerKey()) }}>{t('keepSyncing')}</Button>
      </>
    )
  } else if (question === 'unlock') {
    title = t('unlockTitle')
    description = `${t('unlockBody')} ${unlockHint(holders, t)}`
    body = (
      <div className={css.stepActions}>
        {hasRecoveryKey(holders) ? <Button size="sm" onClick={() => { open('recovery') }}>{t('useRecovery')}</Button> : undefined}
        <Button size="sm" onClick={() => { open('startOver') }}>{t('startOver')}</Button>
      </div>
    )
    footer = (
      <>
        <Button variant="outline" onClick={close}>{t('notNow')}</Button>
        <Button variant="primary" onClick={() => { passkey('unlock') }}>{t('unlock')}</Button>
      </>
    )
  } else {
    title = t('offerTitle')
    description = `${t('offerBody')} ${t('passkeyLoss')}`
    footer = (
      <>
        <Button variant="outline" onClick={close}>{t('notNow')}</Button>
        <Button variant="primary" onClick={() => { passkey('protect') }}>{t('usePasskey')}</Button>
      </>
    )
  }
  const error = failed ? <p className={css.failed} role="alert">{screen === 'recovery' ? t('recoveryWrong') : t('failed')}</p> : undefined
  return (
    <Modal open onClose={close} title={title} description={description} closeLabel={t('close')} footer={footer}>
      {/* undefined, not false: Modal draws its body area for any child it is given. */}
      {body === undefined && error === undefined ? undefined : <>{body}{error}</>}
    </Modal>
  )
}
