/** Settings → General → Voice input: the dictation model, where it stands, and the one action that prepares it. */
import { useState } from 'react'
import { Button, SettingsGroup, SettingsRow, StateDot } from '@aeven/client-ui-primitives'
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

/** Full props of the Voice input group. */
export type VoiceSectionProps = PropsRuntime<'settings.general.item'> & PropsLocale<typeof NS> & InjectFace<VoiceSectionInjected>

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
  const action = connected && (failed || state.phase === 'unprepared')
    ? (
      <Button variant="primary" disabled={busy} onClick={start}>
        {t(state.phase === 'unprepared' ? 'prepare' : 'retryPrepare')}
      </Button>
    )
    : undefined
  return (
    <SettingsRow
      title={provider.name}
      control={(
        <>
          <span className={css.status} data-ready={ready ? 'true' : undefined} role="status">
            {connected && dot !== undefined && <StateDot state={dot} />}{status}
          </span>
          {action}
        </>
      )}
    >
      {detail !== '' && <p className={css.detail}>{detail}</p>}
      {preparing && (
        <span className={css.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('downloadProgress')}>
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
    </SettingsRow>
  )
}

/**
 * Render the Voice input group: one row per recognizer, with the state it is
 * in and the download that moves it on.
 * @param props - readiness mirror and preparation control.
 * @returns the group element tree.
 */
export function VoiceSection({ useSpeechReadiness, prepare, t }: VoiceSectionProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  return (
    <SettingsGroup title={t('title')} description={t('intro')}>
      {catalog === null
        ? <p className={css.notice} role="status">{readiness.error ?? t('loading')}</p>
        : catalog.providers.map(provider => (
          <ProviderCard key={provider.id} provider={provider} connected={readiness.connected} prepare={prepare} t={t} />
        ))}
    </SettingsGroup>
  )
}
