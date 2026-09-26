/** Settings → Voice: the local recognizer's preparation steps, download progress, and explicit controls. */
import { useEffect, useState } from 'react'
import { Button, SectionHeader, StateDot, type StateDotState } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { SpeechPreparationOptions, SpeechPreparationState, SpeechProviderId, SpeechProviderView } from '@aeven/speech-to-text/types'
import type { HostObservable } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'
import type { SpeechReadiness } from './readiness.ts'
import { NS } from './locales.ts'
import css from './VoiceSection.module.css'

/** Host calls behind the preparation controls. */
export interface VoiceSectionInjected {
  hooks: { speechReadiness: HostObservable<SpeechReadiness> }
  prepare: (providerId: SpeechProviderId, options?: SpeechPreparationOptions) => Promise<void>
  cancelPreparation: (providerId: SpeechProviderId) => Promise<void>
}

/** Full props of the voice settings section. */
export type VoiceSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<VoiceSectionInjected>

type T = PropsLocale<typeof NS>['t']

function tone(state: SpeechPreparationState): StateDotState | undefined {
  if (state.phase === 'ready' || state.phase === 'standby') return 'done'
  if (state.phase === 'failed') return 'error'
  if (state.phase === 'unprepared' || state.phase === 'cancelled') return undefined
  return 'ongoing'
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1)
}

function Failure({ state, t }: { state: Extract<SpeechPreparationState, { phase: 'failed' }>; t: T }) {
  const failure = state.download
  if (!failure) return <p className={css.error} role="alert">{t('preparationFailed', { message: state.message })}</p>
  return <div className={css.failure} role="alert">
    <p className={css.error}>{t(`download.${failure.reason}`, { resource: failure.resource, status: String(failure.status) })}</p>
    <p className={css.desc}>{t(`downloadAdvice.${failure.reason}`)}</p>
    <p className={css.meta}>{t('downloadSource', { source: failure.source })}</p>
    {failure.code !== undefined && <p className={css.meta}>{t('downloadCode', { code: failure.code })}</p>}
  </div>
}

function ProviderCard({ provider, connected, prepare, cancelPreparation, t }: {
  provider: SpeechProviderView; connected: boolean; t: T
} & Pick<VoiceSectionInjected, 'prepare' | 'cancelPreparation'>) {
  const state = provider.preparation
  const [now, setNow] = useState(Date.now), [source, setSource] = useState(''), [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sources = provider.downloadSources ?? []
  const canPrepare = state.phase === 'unprepared' || state.phase === 'cancelled' || state.phase === 'failed'
  const preparing = tone(state) === 'ongoing'
  const running = state.steps?.find(step => step.status === 'running')
  const startedAt = running?.startedAt ?? ('startedAt' in state ? state.startedAt : undefined)
  useEffect(() => {
    if (!preparing || startedAt === undefined) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [preparing, startedAt])
  const act = async (action: () => Promise<void>): Promise<void> => {
    setError(''); setBusy(true)
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const summary = !connected ? t('reconnecting')
    : preparing && running ? t(`step.${running.kind}`, { name: provider.name })
      : state.phase === 'downloading' ? t('short.downloading')
        : state.phase === 'failed' ? t('short.failed')
          : t(`preparation.${state.phase}`, { name: provider.name })
  const metric = state.phase === 'downloading'
    ? state.totalBytes === undefined ? t('downloadUnknown', { completed: megabytes(state.completedBytes) })
      : t('downloadBytes', { completed: megabytes(state.completedBytes), total: megabytes(state.totalBytes),
        percent: String(Math.floor(state.completedBytes / state.totalBytes * 100)) })
    : preparing && startedAt !== undefined ? t('elapsed', { seconds: String(Math.max(0, Math.floor((now - startedAt) / 1000))) }) : ''
  const dot = tone(state)
  return <div className={css.card} data-speech-provider={provider.id}>
    <div className={css.row}>
      <div className={css.rowText}>
        <span className={css.title}>{provider.name}</span>
        <span className={css.desc} role="status">
          {dot !== undefined && <StateDot state={dot} />}{summary}{metric !== '' && <span className={css.meta}> · {metric}</span>}
        </span>
      </div>
      {canPrepare && <Button variant="primary" disabled={!connected || busy}
        onClick={() => { void act(() => prepare(provider.id, source === '' ? undefined : { downloadSource: source })) }}>
        {t(state.phase === 'unprepared' ? 'prepare' : 'retryPrepare')}
      </Button>}
      {preparing && state.phase !== 'waking' && <Button variant="outline" disabled={!connected || busy || state.phase === 'cancelling'}
        onClick={() => { void act(() => cancelPreparation(provider.id)) }}>{t('cancelPrepare')}</Button>}
    </div>
    {state.phase === 'downloading' && state.totalBytes !== undefined
      && <progress className={css.progress} aria-label={t('downloadProgress')} value={state.completedBytes} max={state.totalBytes} />}
    {state.phase === 'unprepared' && provider.setupEstimate && <dl className={css.estimate}>
      <div><dt>{t('setup.disk')}</dt><dd>{t('setup.diskValue', { gb: String(provider.setupEstimate.recommendedDiskBytes / 1_000_000_000) })}</dd></div>
      <div><dt>{t('setup.memory')}</dt><dd>{t('setup.memoryValue', { gb: String(provider.setupEstimate.expectedMemoryBytes / 1_000_000_000) })}</dd></div>
      <div><dt>{t('setup.time')}</dt><dd>{t('setup.timeValue', { min: String(provider.setupEstimate.minimumMinutes), max: String(provider.setupEstimate.maximumMinutes) })}</dd></div>
    </dl>}
    {(preparing || state.phase === 'failed' || state.phase === 'cancelled') && state.steps && <ol className={css.steps} aria-label={t('preparationSteps')}>
      {state.steps.map(step => <li key={step.kind} data-step-state={step.status}>
        <span className={css.stepMark} aria-hidden="true" />
        <span>{t(`step.${step.kind}`, { name: provider.name })}</span>
        <span className={css.meta}>{t(`stepStatus.${step.status}`)}</span>
      </li>)}
    </ol>}
    {state.phase === 'failed' && <Failure state={state} t={t} />}
    {canPrepare && sources.length > 1 && <label className={css.source}>
      <span className={css.desc}>{t('sourceChoice')}</span>
      <select value={source} disabled={!connected || busy} onChange={(event) => { setSource(event.target.value) }}>
        <option value="">{t('sourceAuto')}</option>
        {sources.map(origin => <option key={origin} value={origin}>
          {origin === 'https://huggingface.co' ? t('sourceHuggingFace') : origin === 'https://hf-mirror.com' ? t('sourceMirror') : origin}
        </option>)}
      </select>
      <span className={css.meta}>{t(source === '' ? 'sourceAutoHelp' : 'sourceManualHelp')}</span>
    </label>}
    {error !== '' && <p className={css.error} role="alert">{t('failed', { message: error })}</p>}
  </div>
}

/**
 * Render the voice section: the section header, then one card per registered recognizer.
 * @param props - readiness mirror and preparation controls.
 * @returns the section element tree.
 */
export function VoiceSection({ useSpeechReadiness, prepare, cancelPreparation, t }: VoiceSectionProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  return <div className={css.section}>
    <SectionHeader title={t('title')} description={t('intro')} />
    {catalog === null
      ? <p className={css.desc} role="status">{readiness.error ?? t('loading')}</p>
      : catalog.providers.map(provider => <ProviderCard key={provider.id} provider={provider} connected={readiness.connected}
        prepare={prepare} cancelPreparation={cancelPreparation} t={t} />)}
  </div>
}
