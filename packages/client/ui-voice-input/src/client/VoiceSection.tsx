/** Settings → General → Voice input: the dictation model, where it stands, and the switch that turns voice input on. */
import { useState } from 'react'
import { SettingsGroup, SettingsMeter, SettingsRow, Spinner, Switch } from '@aeven/client-ui-primitives'
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
  /** Stop a model download in progress. */
  cancel: (providerId: SpeechProviderId) => Promise<void>
  /** Turn voice input on or off for this user. */
  setEnabled: (enabled: boolean) => Promise<void>
}

/** Full props of the Voice input group. */
export type VoiceSectionProps = PropsRuntime<'settings.general.item'> & PropsLocale<typeof NS> & InjectFace<VoiceSectionInjected>

function ProviderCard({ provider, enabled, connected, prepare, cancel, setEnabled, t }: {
  provider: SpeechProviderView
  enabled: boolean
  connected: boolean
} & Pick<VoiceSectionProps, 'prepare' | 'cancel' | 'setEnabled' | 't'>) {
  const state = provider.preparation
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = state.phase === 'ready' || state.phase === 'standby' || state.phase === 'waking'
  const failed = state.phase === 'failed' || state.phase === 'cancelled' || error !== ''
  const preparing = connected && enabled && !ready && !failed && state.phase !== 'unprepared'
  const percent = state.phase === 'downloading' && state.totalBytes !== undefined
    ? Math.floor(state.completedBytes / state.totalBytes * 100)
    : null

  const act = (operation: () => Promise<void>): void => {
    setError('')
    setBusy(true)
    void operation().catch((failure: unknown) => { setError(String(failure)) }).finally(() => { setBusy(false) })
  }
  // On turns dictation on and downloads the model it still needs; off turns it off and stops a download.
  const toggle = (next: boolean): void => {
    act(async () => {
      await setEnabled(next)
      if (next && !ready) await prepare(provider.id)
      if (!next && preparing) await cancel(provider.id)
    })
  }

  const status = !connected ? t('reconnecting')
    : !enabled ? t('off')
      : failed ? t('modelFailed')
        : ready ? t('modelReady')
          : preparing ? t('modelPreparing') : t('modelUnprepared')
  // A refused preparation names what went wrong; the status line states the
  // step it belongs to, so the two read as one sentence pair.
  const detail = connected && enabled ? (state.phase === 'failed' ? state.message : error) : ''
  return (
    <SettingsRow
      title={provider.name}
      description={<span className={failed && enabled ? css.failed : undefined}>{status}</span>}
      control={(
        <>
          {(preparing || busy) && <Spinner />}
          <Switch
            checked={enabled && !failed && state.phase !== 'unprepared'}
            tone="success"
            label={provider.name}
            disabled={!connected || busy}
            onChange={toggle}
          />
        </>
      )}
    >
      {detail !== '' && <p className={css.detail}>{detail}</p>}
      {preparing && (
        <SettingsMeter
          label={t('modelPreparing')}
          value={percent === null ? undefined : `${String(percent)}%`}
          percent={percent}
          ariaLabel={t('downloadProgress')}
        />
      )}
    </SettingsRow>
  )
}

/**
 * Render the Voice input group: one row per recognizer, with the state it is
 * in and the switch that turns voice input on and downloads its model.
 * @param props - readiness mirror and preparation control.
 * @returns the group element tree.
 */
export function VoiceSection({ useSpeechReadiness, prepare, cancel, setEnabled, t }: VoiceSectionProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  return (
    <SettingsGroup title={t('title')} description={t('intro')}>
      {catalog === null
        ? <p className={css.notice} role="status">{readiness.error ?? t('loading')}</p>
        : catalog.providers.map(provider => (
          <ProviderCard
            key={provider.id} provider={provider} enabled={catalog.selection.enabled} connected={readiness.connected}
            prepare={prepare} cancel={cancel} setEnabled={setEnabled} t={t}
          />
        ))}
    </SettingsGroup>
  )
}
