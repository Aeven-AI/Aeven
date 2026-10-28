/** The Sync settings page: whether this device syncs the account, how far it is, and the account's devices. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncDeviceView, SyncView } from '@aeven/api-remotes/client'
import { Button, LoadingBlock, SectionHeader, SettingsGroup, SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './SyncSection.module.css'

/** Registration-side operations the page calls. */
export interface SyncSectionInjected {
  status: () => Promise<SyncView>
  setEnabled: (enabled: boolean) => Promise<SyncView>
  devices: () => Promise<SyncDeviceView[]>
  removeDevice: (id: string) => Promise<SyncDeviceView[]>
  /**
   * Call `listener` whenever the Host reports a sync change.
   * @param listener - refresh callback.
   * @returns a function that stops listening.
   */
  onChange: (listener: () => void) => () => void
}

/** Full component props assembled by the slot renderer. */
export type SyncSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.sync'>
  & InjectFace<SyncSectionInjected>

type Load = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly view: SyncView }

/** States whose documents open on this device, so its device list can be read. */
const SYNCING: ReadonlySet<SyncView['state']> = new Set(['online', 'offline', 'connecting'])

/**
 * The Sync section.
 * @param props - slot runtime, locale, and injected operations.
 * @returns the rendered section.
 */
export function SyncSection(props: SyncSectionProps) {
  const { t } = props
  const ops: SyncSectionInjected = props
  const [state, setState] = useState<Load>({ status: 'loading' })
  const [devices, setDevices] = useState<SyncDeviceView[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const run = ++generation.current
    try {
      const view = await ops.status()
      const listed = SYNCING.has(view.state) ? await ops.devices().catch(() => []) : []
      if (run !== generation.current) return
      setState({ status: 'ready', view })
      setDevices(listed)
    } catch {
      if (run === generation.current) setState({ status: 'error' })
    }
  }, [ops])

  useEffect(() => {
    void refresh()
    return ops.onChange(() => { void refresh() })
  }, [ops, refresh])

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      await ops.setEnabled(enabled)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const remove = async (id: string): Promise<void> => {
    setFailed(false)
    try {
      setDevices(await ops.removeDevice(id))
    } catch {
      setFailed(true)
    }
  }

  const header = <SectionHeader title={t('nav')} description={t('intro')} />
  if (state.status === 'loading') return <div className={css.section}>{header}<LoadingBlock label={t('loading')} /></div>
  if (state.status === 'error') {
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

  const { view } = state
  const enabled = view.state !== 'disabled'
  const conversations = view.sessionsTotal > 0
  const total = conversations ? view.sessionsTotal : view.queued
  const pending = conversations ? view.sessionsPending : view.pending
  const syncing = view.sessionsPending > 0 || view.pending > 0
  // Nothing in flight reads 0 / 0 rather than the totals of the last finished run.
  const shown = syncing ? total : 0
  const sent = syncing ? total - pending : 0
  const percent = shown === 0 ? 0 : Math.round((sent / shown) * 100)
  const progressLabel = t('progress', { sent: String(sent), total: String(shown) })
  return (
    <div className={css.section}>
      {header}
      <SettingsRow
        title={t('enabled')}
        description={t('enabledBody')}
        control={<Switch checked={enabled} onChange={(next) => { void toggle(next) }} label={t('enabled')} disabled={busy} />}
      >
        <div className={css.meterRow}>
          <span className={css.meterLine}>
            <span>{t(view.state === 'online' && syncing ? 'syncing' : view.state)}</span>
            <span className={css.meterLabel}>{progressLabel}</span>
          </span>
          <span
            className={css.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            aria-label={progressLabel}
          >
            <span style={{ width: `${String(syncing ? Math.max(percent, 2) : 0)}%` }} />
          </span>
        </div>
        {failed && <p className={css.failed} role="alert">{t('failed')}</p>}
      </SettingsRow>
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
    </div>
  )
}
