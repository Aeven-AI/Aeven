/**
 * The Sync settings page: whether this device syncs the account, how far it is, who holds the account key, and the
 * account's devices.
 */
import { useEffect, useState } from 'react'
import type { SyncDeviceView, SyncPasskeyPurpose, SyncView } from '@aeven/api-remotes/client'
import { Button, LoadingBlock, Modal, SectionHeader, SettingsGroup, SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { openPasskeyPage, useSyncStatus, type SyncOperations } from './passkey.ts'
import css from './SyncSection.module.css'

/** Registration-side operations the page calls. */
export type SyncSectionInjected = SyncOperations

/** Full component props assembled by the slot renderer. */
export type SyncSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.sync'>
  & InjectFace<SyncSectionInjected>

/** States whose documents open on this device, so its device list can be read. */
const SYNCING: ReadonlySet<SyncView['state']> = new Set(['online', 'offline', 'connecting'])

/**
 * The passkey step's line under the privacy rows: waiting on the browser, or why it did not finish.
 * @param props - the step, the translate seat, and the verbs it offers.
 * @returns the line, or nothing without a step.
 */
function PasskeyStep({ view, t, retry, dismiss }: {
  view: SyncView
  t: SyncSectionProps['t']
  retry: (purpose: SyncPasskeyPurpose) => void
  dismiss: () => void
}) {
  const step = view.passkey
  if (step === undefined) return null
  const line = step.state === 'waiting' ? t('waiting') : step.state === 'failed' ? t('stepFailed') : t('unsupported')
  return (
    <div className={css.step} role="status" aria-live="polite">
      <p className={step.state === 'failed' ? css.failed : css.note}>{line}</p>
      <div className={css.stepActions}>
        {step.state === 'failed' && <Button variant="outline" size="sm" onClick={() => { retry(step.purpose) }}>{t('tryAgain')}</Button>}
        <Button variant="ghost" size="sm" onClick={dismiss}>{step.state === 'waiting' ? t('cancel') : t('dismiss')}</Button>
      </div>
    </div>
  )
}

/**
 * The Sync section.
 * @param props - slot runtime, locale, and injected operations.
 * @returns the rendered section.
 */
export function SyncSection(props: SyncSectionProps) {
  const { t } = props
  const ops: SyncOperations = props
  const { load, refresh } = useSyncStatus(ops)
  const [devices, setDevices] = useState<SyncDeviceView[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)

  const syncing = load.status === 'ready' && SYNCING.has(load.view.state)
  // Status reports arrive several times a second while data uploads; the device list is read once per syncing spell.
  useEffect(() => {
    if (!syncing) {
      setDevices([])
      return
    }
    let live = true
    void ops.devices().then((listed) => { if (live) setDevices(listed) }, () => {})
    return () => { live = false }
  }, [ops, syncing])

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
  const passkey = (purpose: SyncPasskeyPurpose): void => { void run(() => openPasskeyPage(ops, purpose)) }

  const remove = async (id: string): Promise<void> => {
    setFailed(false)
    try {
      setDevices(await ops.removeDevice(id))
    } catch {
      setFailed(true)
    }
  }

  const header = <SectionHeader title={t('nav')} description={t('intro')} />
  if (load.status === 'loading') return <div className={css.section}>{header}<LoadingBlock label={t('loading')} /></div>
  if (load.status === 'error') {
    return (
      <div className={css.section}>
        {header}
        <SettingsRow
          title={t('error')}
          control={<Button variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button>}
        />
      </div>
    )
  }

  const { view } = load
  const enabled = view.state !== 'disabled'
  const conversations = view.sessionsTotal > 0
  const total = conversations ? view.sessionsTotal : view.queued
  const pending = conversations ? view.sessionsPending : view.pending
  const uploading = view.sessionsPending > 0 || view.pending > 0
  // Nothing in flight reads 0 / 0 rather than the totals of the last finished run.
  const shown = uploading ? total : 0
  const sent = uploading ? total - pending : 0
  const percent = shown === 0 ? 0 : Math.round((sent / shown) * 100)
  const progressLabel = t('progress', { sent: String(sent), total: String(shown) })
  const protection = view.protection
  const waiting = view.passkey?.state === 'waiting'
  return (
    <div className={css.section}>
      {header}
      <SettingsRow
        title={t('enabled')}
        description={t('enabledBody')}
        control={<Switch checked={enabled} onChange={(next) => { void run(() => ops.setEnabled(next)) }} label={t('enabled')} disabled={busy} />}
      >
        <div className={css.meterRow}>
          <span className={css.meterLine}>
            <span>{t(view.state === 'online' && uploading ? 'syncing' : view.state)}</span>
            <span className={css.meterLabel}>{progressLabel}</span>
          </span>
          <span
            className={css.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            aria-label={progressLabel}
          >
            <span style={{ width: `${String(uploading ? Math.max(percent, 2) : 0)}%` }} />
          </span>
        </div>
        {failed && <p className={css.failed} role="alert">{t('failed')}</p>}
      </SettingsRow>
      {enabled && protection !== undefined && (
        <SettingsGroup title={t('privacy')}>
          {protection.downgraded
            ? (
              <SettingsRow
                title={t('downgraded')}
                description={t('downgradedBody')}
                control={<Button variant="primary" disabled={busy} onClick={() => { void run(() => ops.acceptServerKey()) }}>{t('keepSyncing')}</Button>}
              />
            )
            : protection.locked
              ? (
                <SettingsRow
                  title={t('locked')}
                  description={t('lockedBody')}
                  control={<Button variant="primary" disabled={busy || waiting} onClick={() => { passkey('unlock') }}>{t('unlock')}</Button>}
                />
              )
              : (
                <>
                  <SettingsRow
                    title={t('passkey')}
                    description={protection.mode === 'passkey' ? t('passkeyOn') : `${t('passkeyOff')} ${t('passkeyLoss')}`}
                    control={(
                      <Switch
                        checked={protection.mode === 'passkey'}
                        label={t('passkey')}
                        disabled={busy || waiting || view.state !== 'online'}
                        onChange={(next) => { if (next) passkey('protect'); else setConfirmOff(true) }}
                      />
                    )}
                  />
                  {protection.mode === 'passkey' && (
                    <SettingsRow
                      title={t('passkeys')}
                      description={t('passkeysBody', { count: String(protection.passkeys) })}
                      control={<Button variant="outline" disabled={busy || waiting || view.state !== 'online'} onClick={() => { passkey('add') }}>{t('addPasskey')}</Button>}
                    />
                  )}
                </>
              )}
          <PasskeyStep view={view} t={t} retry={passkey} dismiss={() => { void run(() => ops.cancelPasskey()) }} />
        </SettingsGroup>
      )}
      {devices.length > 0 && (
        <SettingsGroup title={t('devices')}>
          {devices.map(device => (
            <SettingsRow
              key={device.id}
              title={device.name === '' ? t('unnamed') : device.name}
              control={device.current
                ? <span className={css.tag}>{t('thisDevice')}</span>
                : <Button variant="ghost" size="sm" onClick={() => { void remove(device.id) }}>{t('remove')}</Button>}
            />
          ))}
        </SettingsGroup>
      )}
      <Modal
        open={confirmOff}
        onClose={() => { setConfirmOff(false) }}
        title={t('turnOffTitle')}
        description={t('turnOffBody')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setConfirmOff(false) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOff(false)
                void run(() => ops.unprotect())
              }}
            >
              {t('turnOff')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
