/** The Sync settings page: whether this device syncs the account, how far it is, and the account's devices. */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SyncDeviceView, SyncView } from '@aeven/api-remotes/client'
import { Button, LoadingBlock, SectionHeader } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './SyncSection.module.css'

/** Registration-side operations the page calls. */
export interface SyncSectionInjected {
  status: () => Promise<SyncView>
  setEnabled: (enabled: boolean) => Promise<SyncView>
  devices: () => Promise<SyncDeviceView[]>
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

  const header = <SectionHeader title={t('nav')} description={t('intro')} />
  if (state.status === 'loading') return <div className={css.section}>{header}<LoadingBlock label={t('loading')} /></div>
  if (state.status === 'error') {
    return (
      <div className={css.section}>
        {header}
        <div className={css.card}>
          <p className={css.body}>{t('error')}</p>
          <div className={css.actions}><Button variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button></div>
        </div>
      </div>
    )
  }

  const { view } = state
  const enabled = view.state !== 'disabled'
  const sent = view.queued - view.pending
  const percent = view.queued === 0 ? 100 : Math.round((sent / view.queued) * 100)
  const uploading = enabled && view.pending > 0
  return (
    <div className={css.section}>
      {header}
      <div className={css.card}>
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('enabled')}</span>
            <span className={css.note}>{t('enabledBody')}</span>
          </span>
          <button
            type="button" role="switch" aria-label={t('enabled')} aria-checked={enabled}
            className={css.switch} disabled={busy}
            onClick={() => { void toggle(!enabled) }}
          ><span className={css.thumb} /></button>
        </div>
        <div className={css.meterRow}>
          <span className={css.meterLine}>
            <span className={css.body}>{t(view.state)}</span>
            {uploading && <span className={css.meterLabel}>{t('uploading', { sent: String(sent), queued: String(view.queued) })}</span>}
          </span>
          {uploading && (
            <span
              className={css.meter} role="progressbar" aria-valuemin={0} aria-valuemax={view.queued} aria-valuenow={sent}
              aria-label={t('uploading', { sent: String(sent), queued: String(view.queued) })}
            >
              <span style={{ width: `${String(Math.max(percent, 2))}%` } as CSSProperties} />
            </span>
          )}
        </div>
        {failed && <p className={css.failed} role="alert">{t('failed')}</p>}
      </div>
      {devices.length > 0 && (
        <div className={css.card}>
          <h3 className={css.title}>{t('devices')}</h3>
          <ul className={css.devices}>
            {devices.map(device => (
              <li key={device.id} className={css.device}>
                <span>{device.name === '' ? t('unnamed') : device.name}{device.current ? ` · ${t('thisDevice')}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
