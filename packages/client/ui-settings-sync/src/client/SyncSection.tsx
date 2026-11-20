/**
 * The Sync settings page: whether this device syncs the account, how far it is, and the account's devices. Who holds
 * the account key, the passkeys, and the recovery key live under Account → Security (AccountPrivacy).
 */
import { useEffect, useState } from 'react'
import type { SyncDeviceView, SyncView } from '@aeven/api-remotes/client'
import { Button, IconLucideLaptopMinimal, IconLucideLaptopMinimalCheck, IconWarningOutline16, LoadingBlock, Menu, SectionHeader, SettingsGroup, SettingsMeter, SettingsRow, Switch, Tooltip } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@aeven/client-ui-slots'
import { useSyncStatus, type SyncOperations } from './passkey.ts'
import css from './SyncSection.module.css'

/** Registration-side operations the page calls. */
export type SyncSectionInjected = SyncOperations

/** Full component props assembled by the slot renderer. */
export type SyncSectionProps =
  PropsRuntime<'settings.section'>
  & PropsRenderSlots<'settings.sync.files'>
  & PropsLocale<'settings.sync'>
  & InjectFace<SyncSectionInjected>

/** States whose documents open on this device, so its device list can be read. */
const SYNCING: ReadonlySet<SyncView['state']> = new Set(['online', 'offline', 'connecting'])

/**
 * A quiet status icon whose standard menu explains the failure and offers another attempt.
 * @param props - localized details and retry action.
 * @returns the icon and its anchored popup.
 */
function SyncIssue({ message, t, retry, busy = false }: {
  message: string
  t: SyncSectionProps['t']
  retry?: (() => void) | undefined
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open} portal align="end" compact
      onClose={() => { setOpen(false) }}
      items={[{ type: 'label', id: 'details', text: message }, ...retry === undefined ? [] : [{ id: 'retry', label: t('retry'), disabled: busy }]]}
      onSelect={() => { setOpen(false); retry?.() }}
      anchor={(
        <button
          type="button" className={css.issue} aria-label={t('syncDetails')} aria-haspopup="menu"
          aria-expanded={open} onClick={() => { setOpen(value => !value) }}
        ><IconWarningOutline16 size={14} /></button>
      )}
    />
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
  const [devicesFailed, setDevicesFailed] = useState(false)
  const [deviceRetry, setDeviceRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const syncing = load.status === 'ready' && SYNCING.has(load.view.state)
  useEffect(() => {
    if (!syncing) {
      setDevices([])
      setDevicesFailed(false)
      return
    }
    let live = true
    let reading = false
    let requested = 0
    let completed = 0
    const refreshDevices = async (): Promise<void> => {
      requested += 1
      if (reading) return
      reading = true
      try {
        do {
          const revision = requested
          try {
            const listed = await ops.devices()
            if (live) { setDevices(listed); setDevicesFailed(false) }
          } catch {
            if (live) setDevicesFailed(true)
          }
          completed = revision
        } while (live && completed !== requested)
      } finally {
        reading = false
      }
    }
    const stop = ops.onDevicesChange(() => { void refreshDevices() })
    void refreshDevices()
    return () => { live = false; stop() }
  }, [ops, syncing, deviceRetry])

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
  const conversations = view.sessionsPending > 0
  const total = conversations ? view.sessionsTotal : view.queued
  const pending = conversations ? view.sessionsPending : view.pending
  const uploading = view.sessionsPending > 0 || view.pending > 0
  // Nothing in flight reads 0 / 0 rather than the totals of the last finished run.
  const shown = uploading ? total : 0
  const sent = uploading ? total - pending : 0
  const percent = shown === 0 ? 0 : Math.round((sent / shown) * 100)
  const progressLabel = t('progress', { sent: String(sent), total: String(shown) })
  const transferError = enabled && view.error !== undefined ? t(view.error === 'upload' ? 'uploadFailed' : view.error === 'sign-in' ? 'signInNeeded' : 'downloadFailed') : undefined
  const statusText = t(transferError !== undefined ? 'paused' : view.state === 'online' && (uploading || view.catchingUp) ? 'syncing' : view.state)
  return (
    <div className={css.section}>
      {header}
      <SettingsRow
        title={t('enabled')}
        description={t('enabledBody')}
        control={<Switch checked={enabled} onChange={(next) => { void run(() => ops.setEnabled(next)) }} label={t('enabled')} disabled={busy} />}
      >
        {enabled && (
          <SettingsMeter
            label={(
              <>
                {statusText}
                {(transferError !== undefined || failed) && (
                  <SyncIssue message={transferError ?? t('failed')} t={t} busy={busy} retry={transferError === undefined ? undefined : () => { void run(() => ops.setEnabled(true)) }} />
                )}
              </>
            )}
            value={uploading ? progressLabel : view.catchingUp ? t('downloading') : view.state === 'online' && transferError === undefined ? '100%' : undefined}
            percent={uploading ? percent : view.catchingUp || view.state === 'connecting' ? null : view.state === 'online' && transferError === undefined ? 100 : 0}
            tone={transferError !== undefined ? 'error' : view.state === 'online' || view.state === 'connecting' ? 'success' : 'muted'}
            ariaLabel={uploading ? progressLabel : statusText}
          />
        )}
      </SettingsRow>
      {(devices.length > 0 || devicesFailed) && (
        <SettingsGroup
          title={t('devices')}
          aside={devicesFailed ? <SyncIssue message={t('devicesFailed')} t={t} retry={() => { setDeviceRetry(value => value + 1) }} /> : undefined}
        >
          {devices.map(device => (
            <SettingsRow
              key={device.id}
              title={device.name === '' ? t('unnamed') : device.name}
              control={device.current
                ? (
                  <Tooltip label={t('thisDevice')} side="top">
                    <span className={css.deviceIcon} role="img" aria-label={t('thisDevice')}><IconLucideLaptopMinimalCheck /></span>
                  </Tooltip>
                )
                : (
                  <span className={css.deviceIcon}><IconLucideLaptopMinimal /></span>
                )}
            />
          ))}
        </SettingsGroup>
      )}
      {enabled && <div className={css.files}>{props.renderSlot('settings.sync.files', {})}</div>}
    </div>
  )
}
