/**
 * First-run setup, ported from t3code's DeviceSetup wizard: enable the hub,
 * check each platform's toolchain, and decide whether the model may control
 * devices. Nothing installs or starts before the first switch is turned on.
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Spinner } from '@aeven/client-ui-primitives'
import type { DevicePlatform, DeviceServiceState } from '@aeven/device/types'
import { Switch, type DeviceTranslate } from './controls.tsx'
import { Check, CircleAlert } from './icons.tsx'
import type { DeviceClient } from './state.ts'
import css from './DevicePane.module.css'

type Pending = 'hub' | 'check' | 'agent' | 'complete' | null

/**
 * One platform's readiness as the setup explains it.
 * @param t - the device dictionary.
 * @param state - the device state.
 * @param platform - the platform.
 * @returns whether it is ready and why.
 */
export function platformStatus(t: DeviceTranslate, state: DeviceServiceState, platform: DevicePlatform): { ready: boolean; message: string } {
  const name = platform === 'ios' ? 'iOS' : 'Android'
  const availability = state.hosts.flatMap(host => host.platforms).find(candidate => candidate.platform === platform)
  if (availability?.available !== true) return { ready: false, message: availability?.reason ?? t('setup.notDetected', { platform: name }) }
  if (state.status === 'ready' && !state.devices.some(device => device.platform === platform)) {
    return { ready: false, message: t(platform === 'ios' ? 'setup.iosEmpty' : 'setup.androidEmpty') }
  }
  return { ready: true, message: t(platform === 'ios' ? 'setup.iosReady' : 'setup.androidReady') }
}

/**
 * Render the setup card.
 * @param props - the device state and client.
 * @returns the setup card.
 */
export function DeviceSetup(props: { readonly t: DeviceTranslate; readonly client: DeviceClient; readonly state: DeviceServiceState; readonly onDismiss: () => void }): ReactNode {
  const { t, client, state } = props
  const [pending, setPending] = useState<Pending>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const enabled = state.status !== 'disabled'
  const busy = state.status === 'installing' || state.status === 'starting'
  const locked = busy || pending !== null

  const run = async (kind: Exclude<Pending, null>, command: () => ReturnType<DeviceClient['list']>): Promise<void> => {
    setPending(kind)
    setError(null)
    const result = await command()
    setPending(null)
    if (!result.ok) setError(result.message)
  }

  const steps = [t('setup.step.hub'), t('setup.step.platforms'), t('setup.step.agent')]
  return (
    <div className={css.setup}>
      <div className={css.setupCard}>
        <h2 className={css.setupTitle}>{t('setup.title')}</h2>
        <p className={css.setupDescription}>{t('setup.description')}</p>
        <ol className={css.setupSteps}>
          {steps.map((label, index) => (
            <li key={label} className={css.setupStep} data-reached={index <= step || undefined} data-current={index === step || undefined}>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className={css.setupSection}>
            <h3 className={css.setupSectionTitle}>{t('setup.hubTitle')}</h3>
            <div className={css.setupSwitchRow}>
              <p>{t('setup.hubDescription')}</p>
              <Switch label={t('setup.enableHub')} checked={enabled} disabled={locked}
                onChange={(checked) => {
                  void run('hub', () => client.configure({ enabled: checked, ...checked ? {} : { agentAccessEnabled: false } }))
                }} />
            </div>
            {(pending === 'hub' || busy || state.status === 'ready') && (
              <p className={pending === 'hub' || busy ? css.status : `${css.status} ${css.statusReady}`} role="status">
                {pending === 'hub' || busy ? <Spinner /> : <Check />}
                {state.status === 'installing'
                  ? state.statusDetail ?? t('setup.installingHub')
                  : state.status === 'starting'
                    ? t('setup.startingHub')
                    : pending === 'hub' ? t('setup.updating') : t('setup.hubReady')}
              </p>
            )}
          </section>
        )}

        {step === 1 && (
          <section className={css.setupSection}>
            <h3 className={css.setupSectionTitle}>{t('setup.platformsTitle')}</h3>
            {(['ios', 'android'] as const).map((platform) => {
              const status = platformStatus(t, state, platform)
              return (
                <div key={platform} className={css.platform} data-ready={status.ready || undefined}>
                  {status.ready ? <Check /> : <CircleAlert />}
                  <div>
                    <p className={css.platformName}>{platform === 'ios' ? 'iOS' : 'Android'}</p>
                    <p className={css.platformMessage}>{status.message}</p>
                  </div>
                </div>
              )
            })}
            <p className={css.muted}>{t('setup.platformsHint')}</p>
            <div>
              <Button variant="outline" size="sm" disabled={!enabled || locked} onClick={() => { void run('check', () => client.list()) }}>
                {pending === 'check' ? t('setup.checking') : t('setup.checkAgain')}
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className={css.setupSection}>
            <h3 className={css.setupSectionTitle}>{t('setup.agentTitle')}</h3>
            <div className={css.setupSwitchRow}>
              <p>{t('setup.agentDescription')}</p>
              <Switch label={t('setup.allowAgent')} checked={state.agentAccessEnabled} disabled={!enabled || locked}
                onChange={(checked) => { void run('agent', () => client.configure({ agentAccessEnabled: checked })) }} />
            </div>
            {pending === 'agent'
              ? (
                <p className={css.status} role="status">
                  <Spinner />
                  {state.status === 'installing' ? t('setup.installingAgent') : state.status === 'starting' ? t('setup.startingAgent') : t('setup.updating')}
                </p>
              )
              : state.agentAccessEnabled && state.status === 'ready' && state.hosts.some(host => host.agentInstalled) && (
                <p className={`${css.status} ${css.statusReady}`} role="status"><Check />{t('setup.agentReady')}</p>
              )}
            <p className={css.muted}>{t('setup.agentHint')}</p>
          </section>
        )}

        {error !== null && <p className={css.setupError} role="alert">{error}</p>}
        {error === null && state.status === 'failed' && state.statusDetail !== undefined && (
          <p className={css.setupError} role="alert">{state.statusDetail}</p>
        )}
        {state.status === 'failed' && state.hosts.map(host => (
          <Button key={host.id} variant="outline" size="sm" disabled={locked}
            onClick={() => { void run('check', () => client.retryHost(host.id)) }}>{t('retry')}</Button>
        ))}

        <div className={css.setupFooter}>
          {step === 0 && (
            <Button variant="outline" size="sm" disabled={locked} onClick={props.onDismiss}>{t('setup.cancel')}</Button>
          )}
          {step > 0 && (
            <Button variant="outline" size="sm" disabled={locked} onClick={() => { setStep(step - 1) }}>{t('setup.back')}</Button>
          )}
          {step < 2
            ? (
              <Button variant="primary" size="sm" disabled={state.status !== 'ready' || pending !== null} onClick={() => { setStep(step + 1) }}>
                {t('setup.continue')}
              </Button>
            )
            : (
              <Button variant="primary" size="sm" disabled={state.status !== 'ready' || pending !== null}
                onClick={() => { void run('complete', () => client.configure({ onboardingCompleted: true })) }}>
                {pending === 'complete' ? t('setup.saving') : t('setup.done')}
              </Button>
            )}
        </div>
      </div>
    </div>
  )
}
