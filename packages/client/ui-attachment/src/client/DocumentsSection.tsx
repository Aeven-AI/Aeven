/** Settings → Documents: reader readiness, the formats they accept, and LibreOffice preparation. */
import { useState } from 'react'
import { Button, SectionHeader, StateDot, type StateDotState } from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'
import type { DocumentExtractProviderId, DocumentExtractProviderState, DocumentPreparationState } from '@aeven/document-extract/types'
import type { DocumentReadiness } from './document-readers.ts'
import css from './DocumentsSection.module.css'

/** Host calls behind the preparation controls. */
export interface DocumentsSectionInjected {
  hooks: { documentReadiness: HostObservable<DocumentReadiness> }
  prepare: (providerId: DocumentExtractProviderId) => Promise<void>
  cancelPreparation: (providerId: DocumentExtractProviderId) => Promise<void>
}

/** Full props of the documents settings section. */
export type DocumentsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'conversation'> & InjectFace<DocumentsSectionInjected>

type T = PropsLocale<'conversation'>['t']

function tone(state: DocumentPreparationState): StateDotState | undefined {
  switch (state.phase) {
    case 'ready': return 'done'
    case 'preparing': return 'ongoing'
    case 'failed': return 'error'
    default: return undefined
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(0)
}

function status(state: DocumentPreparationState, t: T): string {
  switch (state.phase) {
    case 'ready': return t('documents.ready')
    case 'unprepared': return t('documents.unprepared', { size: megabytes(state.downloadBytes ?? 0) })
    case 'preparing': return state.totalBytes === undefined || state.receivedBytes >= state.totalBytes
      ? t('documents.installing')
      : t('documents.preparing', {
        received: megabytes(state.receivedBytes),
        total: megabytes(state.totalBytes),
        percent: String(Math.floor(state.receivedBytes / state.totalBytes * 100)),
      })
    case 'failed': return t('documents.failed', { reason: state.reason })
    case 'unavailable': return state.reason
  }
}

function ReaderCard({ provider, connected, prepare, cancelPreparation, t }: {
  provider: DocumentExtractProviderState
  connected: boolean
  t: T
} & Pick<DocumentsSectionInjected, 'prepare' | 'cancelPreparation'>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = provider.preparation
  const act = async (action: () => Promise<void>): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const dot = tone(state)
  return (
    <div className={css.card} data-document-reader={provider.id}>
      <div className={css.row}>
        <div className={css.rowText}>
          <span className={css.title}>{provider.label}</span>
          <span className={css.desc} role="status">
            {dot !== undefined && <StateDot state={dot} />}
            {status(state, t)}
          </span>
        </div>
        {(state.phase === 'unprepared' || state.phase === 'failed') && (
          <Button variant="primary" disabled={!connected || busy} onClick={() => { void act(() => prepare(provider.id)) }}>
            {t(state.phase === 'failed' ? 'documents.retry' : 'documents.prepare')}
          </Button>
        )}
        {state.phase === 'preparing' && (
          <Button variant="outline" disabled={!connected || busy} onClick={() => { void act(() => cancelPreparation(provider.id)) }}>
            {t('documents.cancel')}
          </Button>
        )}
      </div>
      {state.phase === 'preparing' && state.totalBytes !== undefined && (
        <progress className={css.progress} value={state.receivedBytes} max={state.totalBytes} />
      )}
      <p className={css.meta}>{t('documents.formats', { list: provider.formats.extensions.map(extension => `.${extension}`).join(' ') })}</p>
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}

/**
 * Render the documents section: one card per registered reader.
 * @param props - readiness mirror and preparation controls.
 * @returns the section element tree.
 */
export function DocumentsSection({ useDocumentReadiness, prepare, cancelPreparation, t }: DocumentsSectionProps) {
  const readiness = useDocumentReadiness(value => value)
  const catalog = readiness.catalog
  return (
    <div className={css.section}>
      <SectionHeader title={t('documents.title')} description={t('documents.intro')} />
      {catalog === null
        ? <p className={css.desc} role="status">{readiness.error ?? t('documents.loading')}</p>
        : catalog.providers.map(provider => (
          <ReaderCard
            key={provider.id}
            provider={provider}
            connected={readiness.connected}
            prepare={prepare}
            cancelPreparation={cancelPreparation}
            t={t}
          />
        ))}
    </div>
  )
}
