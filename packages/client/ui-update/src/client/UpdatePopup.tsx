/**
 * The Desktop update popup: what the shell's release stream is doing, and the
 * question the reader answers before Aeven replaces itself.
 */
import type { ReactNode } from 'react'
import { Button, Modal, Spinner } from '@aeven/client-ui-primitives'
import { assertNever } from '@aeven/util-values'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import type { DesktopUpdateStatus } from './update-carrier.ts'
import type { UpdateSurfaceState } from './update-store.ts'
import { NS } from './locales.ts'
import css from './UpdatePopup.module.css'

/** Registration-side business face for the popup. */
export interface UpdatePopupInjected {
  hooks: {
    /** Release-stream state and open request, bound by the renderer as useUpdate. */
    update: {
      getSnapshot(): UpdateSurfaceState
      subscribe(listener: () => void): () => void
    }
  }
  /** Check the release stream again, from the popup's retry. */
  check: () => void
  /** Install the downloaded release and restart the application. */
  install: () => void
  /** Dismiss the popup. */
  close: () => void
}

/** Composed props: standard kit, this entry's injected share, and the `update` dictionaries. */
export type UpdatePopupProps = PropsRuntime<'shell.overlay'> & InjectFace<UpdatePopupInjected> & PropsLocale<typeof NS>

/** Phases that report work in flight. */
function isBusy(phase: DesktopUpdateStatus['phase']): boolean {
  return phase === 'checking' || phase === 'available' || phase === 'downloading' || phase === 'preparing'
    || phase === 'installing'
}

/**
 * The popup's one sentence for a state.
 * @param status - the state the shell published.
 * @param t - this namespace's translate seat.
 * @returns the sentence to show.
 */
function describe(
  status: DesktopUpdateStatus,
  t: UpdatePopupProps['t'],
): string {
  switch (status.phase) {
    case 'idle':
      return t('current')
    case 'checking':
      return t('checking')
    case 'available':
    case 'downloading':
      return status.percent === undefined
        ? t('downloading', { version: status.version })
        : t('downloadingPercent', { version: status.version, percent: String(status.percent) })
    case 'preparing':
      return t('preparing', { version: status.version })
    case 'ready':
      return t('ready', { version: status.version })
    case 'installing':
      return t('installing', { version: status.version })
    case 'error':
      return status.message === undefined ? t('failed') : t('failedWith', { message: status.message })
    /* v8 ignore next 2 -- the phase union is closed; a new phase must extend describe() */
    default:
      return assertNever(status, 'desktop update phase')
  }
}

/**
 * The popup's action row, or nothing for a state the reader can only watch.
 * @param status - the state the shell published.
 * @param actions - the injected verbs.
 * @param t - this namespace's translate seat.
 * @returns the footer content.
 */
function actions(
  status: DesktopUpdateStatus,
  { check, install, close }: Pick<UpdatePopupInjected, 'check' | 'install' | 'close'>,
  t: UpdatePopupProps['t'],
): ReactNode {
  switch (status.phase) {
    case 'ready':
      // Installing restarts Aeven, so it happens on this answer and never on quit.
      return (
        <>
          <Button variant="primary" onClick={close}>{t('later')}</Button>
          <Button variant="primary" onClick={install}>{t('restart')}</Button>
        </>
      )
    case 'error':
      return (
        <>
          <Button variant="primary" onClick={close}>{t('close')}</Button>
          <Button variant="primary" onClick={check}>{t('retry')}</Button>
        </>
      )
    case 'idle':
      return <Button variant="primary" onClick={close}>{t('close')}</Button>
    case 'checking':
    case 'available':
    case 'downloading':
    case 'preparing':
    case 'installing':
      return undefined
    /* v8 ignore next 2 -- the phase union is closed; a new phase must extend actions() */
    default:
      return assertNever(status, 'desktop update phase')
  }
}

/**
 * Render the update popup: the shell's state, the download in progress, and the
 * restart question. It renders nothing while closed.
 * @param props - standard kit, injected verbs, and the `update` dictionaries.
 * @returns the popup, or null when the reader has it closed.
 */
export function UpdatePopup({ useUpdate, check, install, close, t }: UpdatePopupProps) {
  const surface = useUpdate(snapshot => snapshot)
  if (!surface.open) return null
  const { status } = surface
  return (
    <Modal
      open
      onClose={close}
      title={t('title')}
      closeLabel={t('close')}
      footer={actions(status, { check, install, close }, t)}
    >
      <div className={css.status} role="status" aria-live="polite">
        {isBusy(status.phase) && <Spinner className={css.spinner} />}
        <p className={css.message}>{describe(status, t)}</p>
      </div>
      {status.phase === 'ready' && <p className={css.detail}>{t('readyDetail')}</p>}
    </Modal>
  )
}
