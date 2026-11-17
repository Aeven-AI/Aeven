/**
 * The passkey popup: after a sign-in on this page it offers to move the account key onto a passkey, and whenever
 * this device waits on the account's passkey, or on the user after the relay took the key back, it asks for that.
 * Every question can be put off for the rest of the page; Settings → Sync offers the same actions.
 */
import { useState, type ReactNode } from 'react'
import type { SyncPasskeyPurpose, SyncView } from '@aeven/api-remotes/client'
import { Button, Modal } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import { openPasskeyPage, useSyncStatus, type SyncOperations } from './passkey.ts'
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
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  if (load.status !== 'ready') return null
  const { view } = load
  const question = questionOf(view, ops.signedInThisPage())
  const step = started ? view.passkey : undefined
  if (step === undefined && (question === undefined || later.has(question))) return null

  const putOff = (): void => {
    if (question !== undefined) setLater(new Set([...later, question]))
    if (step !== undefined) void ops.cancelPasskey().finally(() => { void refresh() })
    setStarted(false)
    setFailed(false)
  }
  const act = (operation: () => Promise<unknown>): void => {
    setFailed(false)
    void operation().then(() => refresh(), () => { setFailed(true) })
  }
  const passkey = (purpose: SyncPasskeyPurpose): void => {
    setStarted(true)
    act(() => openPasskeyPage(ops, purpose))
  }

  // Every question is one sentence or two in the Modal description, as in the app's other confirmations.
  let title: string
  let description: string
  let footer: ReactNode
  if (step !== undefined) {
    title = question === 'unlock' ? t('unlockTitle') : t('offerTitle')
    description = step.state === 'waiting' ? t('waiting') : step.state === 'failed' ? t('stepFailed') : t('unsupported')
    footer = step.state === 'failed'
      ? (
        <>
          <Button variant="outline" onClick={putOff}>{t('close')}</Button>
          <Button variant="primary" onClick={() => { passkey(step.purpose) }}>{t('tryAgain')}</Button>
        </>
      )
      : <Button variant="outline" onClick={putOff}>{step.state === 'waiting' ? t('cancel') : t('dismiss')}</Button>
  } else if (question === 'downgraded') {
    title = t('downgraded')
    description = t('downgradedBody')
    footer = (
      <>
        <Button variant="outline" onClick={putOff}>{t('notNow')}</Button>
        <Button variant="primary" onClick={() => { act(() => ops.acceptServerKey()) }}>{t('keepSyncing')}</Button>
      </>
    )
  } else if (question === 'unlock') {
    title = t('unlockTitle')
    description = t('unlockBody')
    footer = (
      <>
        <Button variant="outline" onClick={putOff}>{t('notNow')}</Button>
        <Button variant="primary" onClick={() => { passkey('unlock') }}>{t('unlock')}</Button>
      </>
    )
  } else {
    title = t('offerTitle')
    description = `${t('offerBody')} ${t('passkeyLoss')}`
    footer = (
      <>
        <Button variant="outline" onClick={putOff}>{t('notNow')}</Button>
        <Button variant="primary" onClick={() => { passkey('protect') }}>{t('usePasskey')}</Button>
      </>
    )
  }
  return (
    <Modal open onClose={putOff} title={title} description={description} closeLabel={t('close')} footer={footer}>
      {/* undefined, not false: Modal draws its body area for any child it is given. */}
      {failed ? <p className={css.failed} role="alert">{t('failed')}</p> : undefined}
    </Modal>
  )
}
