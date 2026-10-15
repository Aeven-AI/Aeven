/** Settings → Voice: the dictation model, where it stands, and the one action that prepares it. */
import { useState } from 'react'
import { Button, SectionHeader, StateDot } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { SpeechProviderId, SpeechProviderView } from '@aeven/speech-to-text/types'
import type { HostObservable } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'
import type { SpeechReadiness } from './readiness.ts'
import { NS } from './locales.ts'
import css from './VoiceSection.module.css'

/** Host call behind model preparation and retry. */
export interface VoiceSectionInjected {
  hooks: { speechReadiness: HostObservable<SpeechReadiness> }
  prepare: (providerId: SpeechProviderId) => Promise<void>
}

/** Full props of the voice settings section. */
export type VoiceSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<VoiceSectionInjected>

function ProviderCard({ provider, connected, prepare, t }: {
  provider: SpeechProviderView
  connected: boolean
} & Pick<VoiceSectionProps, 'prepare' | 't'>) {
  const state = provider.preparation
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = state.phase === 'ready' || state.phase === 'standby'
  const failed = state.phase === 'failed' || state.phase === 'cancelled' || error !== ''
  const preparing = connected && !ready && !failed && state.phase !== 'unprepared'
  const percent = state.phase === 'downloading' && state.totalBytes !== undefined
    ? Math.floor(state.completedBytes / state.totalBytes * 100)
    : 0

  const start = (): void => {
    setError('')
    setBusy(true)
    void prepare(provider.id).catch((failure: unknown) => { setError(String(failure)) }).finally(() => { setBusy(false) })
  }

  const status = !connected ? t('reconnecting')
    : failed ? t('modelFailed')
      : ready ? t('modelReady')
        : preparing ? t('modelPreparing') : t('modelUnprepared')
  const dot = failed ? 'error' : ready ? 'done' : preparing ? 'ongoing' : undefined
  // A refused preparation names what went wrong; the status line states the
  // step it belongs to, so the two read as one sentence pair.
  const detail = connected ? (state.phase === 'failed' ? state.message : error) : ''
  return <div className={css.card} data-speech-provider={provider.id} data-ready={ready ? 'true' : undefined}>
    <div className={css.head}>
      <span className={css.name}>{provider.name}</span>
      <span className={css.status} role="status">
        {connected && dot !== undefined && <StateDot state={dot} />}{status}
      </span>
    </div>
    {detail !== '' && <p className={css.detail}>{detail}</p>}
    {preparing && <span className={css.meter} role="meter" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percent} aria-label={t('downloadProgress')}>
      <span style={{ width: `${percent}%` }} />
    </span>}
    {connected && (failed || state.phase === 'unprepared') && <div className={css.actions}>
      <Button variant="primary" disabled={busy} onClick={start}>
        {t(state.phase === 'unprepared' ? 'prepare' : 'retryPrepare')}
      </Button>
    </div>}
  </div>
}

/**
 * Render the voice section: one recognizer per filled card, with the state it
 * is in and the download that moves it on.
 * @param props - readiness mirror and preparation control.
 * @returns the section element tree.
 */
export function VoiceSection({ useSpeechReadiness, prepare, t }: VoiceSectionProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  return <div className={css.section}>
    <SectionHeader title={t('title')} description={t('intro')} />
    {catalog === null
      ? <p className={css.notice} role="status">{readiness.error ?? t('loading')}</p>
      : catalog.providers.map(provider => <ProviderCard key={provider.id} provider={provider} connected={readiness.connected}
        prepare={prepare} t={t} />)}
  </div>
}
