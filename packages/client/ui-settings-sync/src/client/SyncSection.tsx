/** The Sync settings page: turn sync on, add this device to an account that syncs, or approve a new device. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncDeviceView, SyncJoinRequestView, SyncPasskeyMode, SyncPasskeyStart, SyncView } from '@aeven/api-remotes/client'
import { Button, externalWindow, LoadingBlock, SectionHeader } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './SyncSection.module.css'

/** Registration-side operations the page calls. */
export interface SyncSectionInjected {
  status: () => Promise<SyncView>
  vaultExists: () => Promise<boolean>
  createVault: () => Promise<SyncView>
  startJoin: () => Promise<SyncView>
  cancelJoin: () => Promise<SyncView>
  acceptJoins: () => Promise<SyncView>
  stopAcceptingJoins: () => Promise<SyncView>
  joinRequests: () => Promise<SyncJoinRequestView[]>
  devices: () => Promise<SyncDeviceView[]>
  removeDevice: (id: string) => Promise<SyncView>
  approveJoin: (id: string) => Promise<SyncView>
  rejectJoin: (id: string) => Promise<SyncView>
  startPasskey: (mode: SyncPasskeyMode) => Promise<SyncPasskeyStart>
  cancelPasskey: () => Promise<SyncView>
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

/** How often the page asks for the status while a passkey step waits on the browser, in milliseconds. */
const PASSKEY_REFRESH_MS = 2_000

type Load = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly view: SyncView; readonly exists?: boolean }

/** Group a six-digit code as `123 456` so it reads aloud in two halves. */
function grouped(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`
}

/**
 * The Sync section.
 * @param props - slot runtime, locale, and injected operations.
 * @returns the rendered section.
 */
export function SyncSection(props: SyncSectionProps) {
  const { t } = props
  const ops: SyncSectionInjected = props
  const [state, setState] = useState<Load>({ status: 'loading' })
  const [requests, setRequests] = useState<SyncJoinRequestView[]>([])
  const [devices, setDevices] = useState<SyncDeviceView[]>([])
  const [removing, setRemoving] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const run = ++generation.current
    try {
      const view = await ops.status()
      const exists = view.state === 'unenrolled' ? await ops.vaultExists().catch(() => undefined) : undefined
      const pending = view.acceptingJoins ? await ops.joinRequests() : []
      const enrolled = view.state === 'online' || view.state === 'offline' || view.state === 'connecting'
      const listed = enrolled ? await ops.devices() : []
      if (run !== generation.current) return
      setState({ status: 'ready', view, ...exists === undefined ? {} : { exists } })
      setRequests(pending)
      setDevices(listed)
    } catch {
      if (run === generation.current) setState({ status: 'error' })
    }
  }, [ops])

  useEffect(() => {
    void refresh()
    return ops.onChange(() => { void refresh() })
  }, [ops, refresh])

  useEffect(() => () => { void ops.stopAcceptingJoins() }, [ops])

  // The passkey result reaches the Host from the site, which pushes no event, so the page asks until it lands.
  const waitingOnPasskey = state.status === 'ready' && state.view.passkey?.state === 'waiting'
  useEffect(() => {
    if (!waitingOnPasskey) return
    const timer = setInterval(() => { void refresh() }, PASSKEY_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [waitingOnPasskey, refresh])

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
  const act = (operation: () => Promise<unknown>) => () => { void run(operation) }
  // The browser tab opens inside the click, before the Host answers, or a browser blocks it as a popup.
  const passkey = (mode: SyncPasskeyMode) => () => {
    const target = externalWindow()
    void run(async () => {
      try {
        target.navigate((await ops.startPasskey(mode)).url)
      } catch (error) {
        target.cancel()
        throw error
      }
    })
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
  if (view.passkey !== undefined) {
    const { mode } = view.passkey
    return (
      <div className={css.section}>
        {header}
        <div className={css.card}>
          {view.passkey.state === 'waiting'
            ? <>
              <h3 className={css.title}>{t('passkeyTitle')}</h3>
              <p className={css.body}>{t('passkeyBody')}</p>
            </>
            : <>
              <h3 className={css.title}>{t('passkeyFailedTitle')}</h3>
              <p className={css.body}>{t('passkeyFailedBody')}</p>
            </>}
          <div className={css.actions}>
            {view.passkey.state === 'failed' && <Button variant="primary" disabled={busy} onClick={passkey(mode)}>{t('tryAgain')}</Button>}
            <Button variant="outline" disabled={busy} onClick={act(ops.cancelPasskey)}>{t('cancel')}</Button>
          </div>
        </div>
        {failed && <p className={css.failed} role="alert">{t('failed')}</p>}
      </div>
    )
  }
  return (
    <div className={css.section}>
      {header}
      {view.state === 'unenrolled' && (
        <div className={css.card}>
          <h3 className={css.title}>{state.exists === true ? t('joinTitle') : t('offTitle')}</h3>
          <p className={css.body}>{state.exists === true ? t('joinBody') : t('offBody')}</p>
          <div className={css.actions}>
            {state.exists === true
              ? <>
                <Button variant="primary" disabled={busy} onClick={act(ops.startJoin)}>{t('join')}</Button>
                <Button variant="outline" disabled={busy} onClick={passkey('unlock')}>{t('usePasskey')}</Button>
              </>
              : <Button variant="primary" disabled={busy} onClick={act(ops.createVault)}>{t('turnOn')}</Button>}
          </div>
        </div>
      )}
      {view.state === 'joining' && (
        <div className={css.card}>
          {view.joinCode === undefined
            ? <>
              <h3 className={css.title}>{t('waitingTitle')}</h3>
              <p className={css.body}>{t('waitingBody')}</p>
            </>
            : <>
              <h3 className={css.title}>{t('codeTitle')}</h3>
              <p className={css.code}>{grouped(view.joinCode)}</p>
              <p className={css.body}>{t('codeBody')}</p>
            </>}
          <div className={css.actions}>
            <Button variant="outline" disabled={busy} onClick={act(ops.cancelJoin)}>{t('cancel')}</Button>
          </div>
        </div>
      )}
      {(view.state === 'online' || view.state === 'connecting' || view.state === 'offline') && (
        <>
          <div className={css.card}>
            <h3 className={css.title}>{view.state === 'online' ? t('online') : view.state === 'connecting' ? t('connecting') : t('offline')}</h3>
            {view.pending > 0 && <p className={css.body}>{t('pending', { n: String(view.pending) })}</p>}
            <h4 className={css.subtitle}>{t('devices', { n: String(view.devices) })}</h4>
            <ul className={css.devices}>
              {devices.map(device => (
                <li key={device.id} className={css.device}>
                  <span>{device.name === '' ? t('unnamed') : device.name}{device.current ? ` · ${t('thisDevice')}` : ''}</span>
                  {!device.current && (removing === device.id
                    ? <div className={css.actions}>
                      <Button variant="primary" size="sm" disabled={busy} onClick={act(async () => { setRemoving(undefined); await ops.removeDevice(device.id) })}>{t('confirmRemove')}</Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRemoving(undefined) }}>{t('cancel')}</Button>
                    </div>
                    : <Button variant="ghost" size="sm" disabled={busy || view.state !== 'online'} onClick={() => { setRemoving(device.id) }}>{t('remove')}</Button>)}
                </li>
              ))}
            </ul>
            {removing !== undefined && <p className={css.note}>{t('removeNote')}</p>}
            <p className={css.note}>{view.recovery ? t('recoveryOn') : `${t('lossNote')} ${t('recoveryOff')}`}</p>
            {!view.acceptingJoins && (
              <div className={css.actions}>
                <Button variant="outline" disabled={busy || view.state !== 'online'} onClick={act(ops.acceptJoins)}>{t('addDevice')}</Button>
                <Button variant="ghost" disabled={busy || view.state !== 'online'} onClick={passkey('setup')}>
                  {view.recovery ? t('replaceRecovery') : t('setUpRecovery')}
                </Button>
              </div>
            )}
          </div>
          {view.acceptingJoins && (
            <div className={css.card}>
              <h3 className={css.title}>{t('addingTitle')}</h3>
              <p className={css.body}>{t('addingBody')}</p>
              {requests.map(request => (
                <div key={request.id} className={css.request}>
                  <span className={css.code}>{t('requestCode', { code: grouped(request.code) })}</span>
                  <div className={css.actions}>
                    <Button variant="primary" size="sm" disabled={busy} onClick={act(() => ops.approveJoin(request.id))}>{t('approve')}</Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={act(() => ops.rejectJoin(request.id))}>{t('reject')}</Button>
                  </div>
                </div>
              ))}
              <div className={css.actions}>
                <Button variant="outline" disabled={busy} onClick={act(ops.stopAcceptingJoins)}>{t('done')}</Button>
              </div>
            </div>
          )}
        </>
      )}
      {failed && <p className={css.failed} role="alert">{t('failed')}</p>}
    </div>
  )
}
