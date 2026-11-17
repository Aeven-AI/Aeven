/**
 * The passkey and encryption rows of Account → Security: whether passkeys hold the account key, each passkey with the
 * date it was added, adding and removing passkeys, the recovery key, and unlocking a locked device. One passkey both
 * signs in and unlocks the account's synced data.
 */
import { useState } from 'react'
import type { SyncKeyHolderView, SyncPasskeyPurpose, SyncView } from '@aeven/api-remotes/client'
import { Button, Modal, RiskConfirmation, SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-account-aeven/client'
import { holderTitle, unlockHint } from './holders.ts'
import { openPasskeyPage, useFocusAfterPasskey, useSyncStatus, type SyncOperations } from './passkey.ts'
import { RecoveryKeyDialog } from './RecoveryKeyDialog.tsx'
import css from './SyncSection.module.css'

/**
 * Composed props: standard kit with the account's email from Account → Security, the sync operations, and the
 * `settings.sync` dictionaries.
 */
export type AccountPrivacyProps =
  PropsRuntime<'account.security'>
  & PropsLocale<'settings.sync'>
  & InjectFace<SyncOperations>

type Translate = AccountPrivacyProps['t']

/**
 * The passkey step's line under the rows: waiting on the browser, or why it did not finish.
 * @param props - the status, the translator, and the verbs the line offers.
 * @returns the line, or nothing without a step.
 */
function PasskeyStep({ view, t, retry, dismiss }: {
  view: SyncView
  t: Translate
  retry: (purpose: SyncPasskeyPurpose, replaces?: string) => void
  dismiss: () => void
}) {
  const step = view.passkey
  if (step === undefined) return null
  const retryable = step.state === 'failed' || step.state === 'wrong-passkey' || step.state === 'duplicate'
  const line = step.state === 'waiting' ? t('waiting')
    : step.state === 'wrong-passkey' ? `${t('wrongPasskey')} ${unlockHint(view.protection?.holders ?? [], t)}`
      : step.state === 'duplicate' ? t('duplicate')
        : step.state === 'failed' ? t('stepFailed')
          : t('unsupported')
  return (
    <div className={css.step} role="status" aria-live="polite">
      <p className={retryable ? css.failed : css.note}>{line}</p>
      <div className={css.stepActions}>
        {retryable && <Button variant="outline" onClick={() => { retry(step.purpose, step.replaces) }}>{t('tryAgain')}</Button>}
        {step.state === 'waiting'
          ? <Button variant="primary" className={css.actionButton} onClick={dismiss}>{t('cancel')}</Button>
          : <Button variant="ghost" onClick={dismiss}>{t('dismiss')}</Button>}
      </div>
    </div>
  )
}

/**
 * One passkey, laid out like the other Settings rows: what it is, when it was added, and a Remove button. Removing the
 * only passkey turns passkey protection off, which the caller confirms first. A passkey that only unlocks also offers
 * to become one that signs in.
 * @param props - the passkey, the translator, the removal, and the upgrade.
 * @returns the row.
 */
function PasskeyRow({ holder, busy, t, onRemove, onUpgrade }: {
  holder: SyncKeyHolderView
  busy: boolean
  t: Translate
  onRemove: () => void
  onUpgrade: () => void
}) {
  const date = holder.addedAt === undefined ? undefined
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(holder.addedAt))
  return (
    <SettingsRow
      title={holderTitle(holder, t)}
      {...holder.signIn === false ? { description: t('passkeyUnlockOnly') }
        : date === undefined ? {} : { description: t('passkeyAdded', { date }) }}
      control={(
        <span className={css.stepActions}>
          {holder.signIn === false && <Button variant="primary" className={css.actionButton} disabled={busy} onClick={onUpgrade}>{t('useToSignIn')}</Button>}
          <Button variant="outline" disabled={busy} onClick={onRemove}>{t('remove')}</Button>
        </span>
      )}
    />
  )
}

/**
 * The rows, or nothing while this device does not sync the account.
 * @param props - standard kit, sync operations, and the `settings.sync` dictionaries.
 * @returns the rows.
 */
export function AccountPrivacy(props: AccountPrivacyProps) {
  const { t } = props
  const ops: SyncOperations = props
  const { load, refresh } = useSyncStatus(ops)
  useFocusAfterPasskey(load.status === 'ready' ? load.view : undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmOn, setConfirmOn] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | undefined>(undefined)
  const [removing, setRemoving] = useState<SyncKeyHolderView | undefined>(undefined)
  const [removingLast, setRemovingLast] = useState(false)

  if (load.status !== 'ready') return null
  const { view } = load
  const protection = view.protection
  if (view.state === 'disabled' || protection === undefined) return null
  // A step still waiting when the reader closed the browser leaves every button usable: pressing one again replaces it.
  const offline = view.state !== 'online'
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      await operation()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      void refresh()
    }
  }
  const passkey = (purpose: SyncPasskeyPurpose, replaces?: string): void => {
    void run(() => openPasskeyPage(ops, purpose, props.email, replaces))
  }
  const passkeys = protection.holders.filter(holder => holder.kind === 'passkey')
  const hasRecovery = protection.holders.some(holder => holder.kind === 'recovery')

  let rows
  if (protection.downgraded) {
    rows = (
      <SettingsRow
        title={t('downgraded')}
        description={t('downgradedBody')}
        control={<Button variant="primary" disabled={busy} onClick={() => { void run(() => ops.acceptServerKey()) }}>{t('keepSyncing')}</Button>}
      />
    )
  } else if (protection.locked) {
    rows = (
      <SettingsRow
        title={t('locked')}
        description={`${t('lockedBody')} ${unlockHint(protection.holders, t)}`}
        control={<Button variant="primary" disabled={busy} onClick={() => { passkey('unlock') }}>{t('unlock')}</Button>}
      />
    )
  } else {
    rows = (
      <>
        <SettingsRow
          title={t('passkey')}
          description={t(protection.mode === 'passkey' ? 'passkeyOn' : 'passkeyOff')}
          info={{ title: t('passkey'), body: t('passkeyInfo'), closeLabel: t('close') }}
          control={(
            <Switch
              checked={protection.mode === 'passkey'}
              label={t('passkey')}
              disabled={busy || offline}
              onChange={(next) => { if (next) { setAcknowledged(false); setConfirmOn(true) } else setConfirmOff(true) }}
            />
          )}
        />
        {protection.mode === 'passkey' && (
          <>
            <SettingsRow
              title={t('passkeys')}
              description={t('passkeysSignIn')}
              control={<Button variant="primary" className={css.actionButton} disabled={busy || offline} onClick={() => { passkey('add') }}>{t('addPasskey')}</Button>}
            />
            {passkeys.map(holder => (
              <PasskeyRow
                key={holder.id} holder={holder} t={t} busy={busy || offline}
                // The relay keeps one passkey while it holds the account key; the last one leaves with protection.
                onRemove={() => { if (passkeys.length > 1) setRemoving(holder); else setRemovingLast(true) }}
                onUpgrade={() => { passkey('upgrade', holder.id) }}
              />
            ))}
            <SettingsRow
              title={t('recoveryRow')}
              description={t(hasRecovery ? 'recoveryRowOn' : 'recoveryRowOff')}
              info={{ title: t('recoveryRow'), body: t('recoveryInfo'), closeLabel: t('close') }}
              control={(
                <Button
                  variant="primary" className={css.actionButton} disabled={busy || offline}
                  onClick={() => { void run(async () => { setRecoveryKey((await ops.createRecoveryKey()).key) }) }}
                >{t(hasRecovery ? 'replaceRecovery' : 'createRecovery')}</Button>
              )}
            />
          </>
        )}
      </>
    )
  }

  return (
    <>
      {rows}
      <PasskeyStep view={view} t={t} retry={passkey} dismiss={() => { void run(() => ops.cancelPasskey()) }} />
      {failed ? <p className={css.failed} role="alert">{t('failed')}</p> : undefined}
      {recoveryKey !== undefined && <RecoveryKeyDialog recoveryKey={recoveryKey} t={t} onClose={() => { setRecoveryKey(undefined) }} />}
      <Modal
        open={removing !== undefined}
        onClose={() => { setRemoving(undefined) }}
        title={t('removeTitle')}
        description={t('removeBody')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRemoving(undefined) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const holder = removing
                setRemoving(undefined)
                if (holder !== undefined) void run(() => ops.removePasskey(holder.id))
              }}
            >{t('remove')}</Button>
          </>
        )}
      />
      <Modal
        open={removingLast}
        onClose={() => { setRemovingLast(false) }}
        title={t('removeLastTitle')}
        description={t('removeLastBody')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRemovingLast(false) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { setRemovingLast(false); void run(() => ops.unprotect()) }}>{t('remove')}</Button>
          </>
        )}
      />
      <RiskConfirmation
        open={confirmOn}
        title={t('passkey')}
        description={t('passkeyOffDetail')}
        acknowledgeLabel={t('passkeyAcknowledge')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={t('usePasskey')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setConfirmOn(false) }}
        onConfirm={() => { setConfirmOn(false); passkey('protect') }}
      />
      <Modal
        open={confirmOff}
        onClose={() => { setConfirmOff(false) }}
        title={t('turnOffTitle')}
        description={t('turnOffBody')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setConfirmOff(false) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { setConfirmOff(false); void run(() => ops.unprotect()) }}>{t('turnOff')}</Button>
          </>
        )}
      />
    </>
  )
}
