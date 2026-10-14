/**
 * The tools drawer for one open device, ported from t3code's
 * DeviceToolsPanel: current settings read from the device, one control per
 * supported action, and the read-only feeds the hub exposes.
 *
 * Every change is one `device/action` round trip whose returned detail
 * replaces local state, so a control never shows a value the device did not
 * confirm.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { IconLucideX, Spinner } from '@aeven/client-ui-primitives'
import type {
  DeviceActionBody, DeviceColorFilter, DeviceDetail, DeviceOrientation, DevicePermission, DeviceSummary, DeviceTextSize,
} from '@aeven/device/types'
import {
  Choice, Field, IconButton, Segmented, SubmitRow, SwitchRow, type ChoiceOption, type DeviceTranslate,
} from './controls.tsx'
import type { DeviceHubAccess } from './hub-access.ts'
import {
  type DeviceEventLogEntry, type DeviceForegroundInfo, subscribeDeviceEventLog, subscribeDeviceForeground,
} from './hub-api.ts'
import { ChevronDown } from './icons.tsx'
import type { DeviceClient } from './state.ts'
import css from './DevicePane.module.css'

const DEVICE_SIZES: readonly DeviceTextSize[] = ['small', 'default', 'large', 'extra-large']
const COLOR_FILTERS: readonly DeviceColorFilter[] = ['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow']
const ORIENTATIONS: readonly DeviceOrientation[] = ['portrait', 'landscape_left', 'portrait_upside_down', 'landscape_right']
const IOS_PERMISSIONS: readonly DevicePermission[] = [
  'camera', 'microphone', 'photos', 'contacts', 'calendar', 'reminders', 'location', 'notifications', 'motion',
  'media-library', 'faceid',
]
const ANDROID_PERMISSIONS: readonly DevicePermission[] = [
  'camera', 'microphone', 'photos', 'contacts', 'calendar', 'location', 'notifications', 'motion',
]
const LOCATION_PRESETS = [
  { key: 'tools.place.sf', latitude: 37.7749, longitude: -122.4194 },
  { key: 'tools.place.ny', latitude: 40.7128, longitude: -74.006 },
  { key: 'tools.place.london', latitude: 51.5074, longitude: -0.1278 },
  { key: 'tools.place.stockholm', latitude: 59.3293, longitude: 18.0686 },
  { key: 'tools.place.tokyo', latitude: 35.6762, longitude: 139.6503 },
] as const
const EVENT_LOG_LIMIT = 100

/**
 * Render the drawer for one device.
 * @param props - the device, its hub access, the device client, and the overlay switch.
 * @returns the drawer.
 */
export function DeviceTools(props: {
  readonly t: DeviceTranslate
  readonly client: DeviceClient
  readonly device: DeviceSummary
  readonly access: DeviceHubAccess
  readonly axOverlay: boolean
  readonly onAxOverlayChange: (enabled: boolean) => void
  readonly onClose: () => void
}): ReactNode {
  const { t, client, device, access } = props
  const [detail, setDetail] = useState<DeviceDetail | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [foreground, setForeground] = useState<DeviceForegroundInfo | null | undefined>(undefined)
  const isIos = device.platform === 'ios'

  // The drawer is keyed by device, so a mount is always a fresh device.
  useEffect(() => {
    let cancelled = false
    void client.detail({ hostId: device.hostId, deviceId: device.id }).then((result) => {
      if (cancelled) return
      if (result.ok) setDetail(result.value)
      else setError(result.message)
    })
    return () => { cancelled = true }
  }, [client, device.hostId, device.id])

  useEffect(() => subscribeDeviceForeground({ access, platform: device.platform, deviceId: device.id }, setForeground),
    [access, device.id, device.platform])

  const act = useCallback(async (body: DeviceActionBody): Promise<boolean> => {
    setPending(true)
    setError(null)
    const result = await client.action({ hostId: device.hostId, deviceId: device.id, ...body })
    setPending(false)
    if (result.ok) setDetail(result.value)
    else setError(result.message)
    return result.ok
  }, [client, device.hostId, device.id])

  const settings = detail?.settings
  const foregroundApp = foreground === undefined ? detail?.foregroundApp ?? null : foreground
  const disabled = pending || detail === null
  const options = <V extends string>(values: readonly V[], prefix: string): ChoiceOption<V>[] =>
    values.map(value => ({ value, label: t(`${prefix}.${value}` as Parameters<DeviceTranslate>[0]) }))

  return (
    <aside className={css.drawer} aria-label={t('tools.title')}>
      <div className={css.drawerHead}>
        <span>{t('tools.title')}</span>
        {pending && <Spinner />}
        <IconButton label={t('tools.close')} onClick={props.onClose}><IconLucideX /></IconButton>
      </div>
      <div className={`${css.drawerBody} no-scrollbar`}>
        {error !== null && <p className={css.error} role="alert">{error}</p>}
        {detail === null && error === null && (
          <p className={css.status} data-drawer-reading=""><Spinner />{t('tools.reading')}</p>
        )}

        <Section title={t('tools.app')}>
          <Field label={t('tools.foreground')}>
            <span className={css.mono} title={foregroundApp?.id}>{foregroundApp?.id ?? '—'}</span>
          </Field>
          {foregroundApp !== null && (
            <div className={css.inline}>
              <button type="button" className={css.chip} disabled={disabled} onClick={() => { void act({ type: 'terminateApp', appId: foregroundApp.id }) }}>
                {t('tools.terminate')}
              </button>
              <button type="button" className={css.chip} disabled={disabled} onClick={() => { void act({ type: 'launchApp', appId: foregroundApp.id }) }}>
                {t('tools.relaunch')}
              </button>
            </div>
          )}
          <SubmitRow placeholder={t('tools.urlPlaceholder')} action={t('tools.openUrl')} disabled={disabled}
            onSubmit={url => act({ type: 'openUrl', url })} />
          <SubmitRow placeholder={t(isIos ? 'tools.bundlePlaceholder' : 'tools.packagePlaceholder')} action={t('tools.launch')}
            disabled={disabled} onSubmit={appId => act({ type: 'launchApp', appId })} />
        </Section>

        <Section title={t(isIos ? 'tools.simulator' : 'tools.emulator')}>
          <Field label={t('tools.appearance')}>
            <Segmented label={t('tools.appearance')} value={settings?.appearance} disabled={disabled}
              options={[{ value: 'light', label: t('tools.light') }, { value: 'dark', label: t('tools.dark') }]}
              onChange={(value) => { void act({ type: 'setAppearance', value }) }} />
          </Field>
          <Field label={t('tools.textSize')}>
            <Choice label={t('tools.textSize')} value={settings?.textSize} options={options(DEVICE_SIZES, 'tools.size')}
              placeholder={t('tools.unknown')} disabled={disabled} onChange={(value) => { void act({ type: 'setTextSize', value }) }} />
          </Field>
          {isIos
            ? (
              <>
                <Field label={t('tools.liquidGlass')}>
                  <Segmented label={t('tools.liquidGlass')} value={settings?.liquidGlass} disabled={disabled || settings?.liquidGlass === undefined}
                    options={[{ value: 'clear', label: t('tools.clear') }, { value: 'tinted', label: t('tools.tinted') }]}
                    onChange={(value) => { void act({ type: 'setLiquidGlass', value }) }} />
                </Field>
                <Field label={t('tools.colorFilter')}>
                  <Choice label={t('tools.colorFilter')} value={settings?.colorFilter} options={options(COLOR_FILTERS, 'tools.filter')}
                    placeholder={t('tools.unknown')} disabled={disabled} onChange={(value) => { void act({ type: 'setColorFilter', value }) }} />
                </Field>
              </>
            )
            : (
              <Field label={t('tools.orientation')}>
                <Choice label={t('tools.orientation')} value={undefined} options={options(ORIENTATIONS, 'tools.orientation')}
                  placeholder={t('tools.rotateTo')} disabled={disabled} onChange={(value) => { void act({ type: 'setOrientation', value }) }} />
              </Field>
            )}
          <SwitchRow label={t('tools.reduceMotion')} checked={settings?.reduceMotion} disabled={disabled}
            onChange={(value) => { void act({ type: 'setToggle', setting: 'reduceMotion', value }) }} />
          {isIos
            ? (['increaseContrast', 'reduceTransparency', 'showBorders', 'voiceOver'] as const).map(setting => (
              <SwitchRow key={setting} label={t(`tools.${setting}`)} checked={settings?.[setting]} disabled={disabled}
                onChange={(value) => { void act({ type: 'setToggle', setting, value }) }} />
            ))
            : (
              <SwitchRow label={t('tools.network')} checked={settings?.networkEnabled} disabled={disabled}
                onChange={(value) => { void act({ type: 'setToggle', setting: 'networkEnabled', value }) }} />
            )}
        </Section>

        <Section title={t('tools.accessibility')}>
          <SwitchRow label={t('tools.overlay')} checked={props.axOverlay} disabled={false} onChange={props.onAxOverlayChange} />
        </Section>

        <LocationSection t={t} disabled={disabled} canClear={isIos}
          onSet={(latitude, longitude) => act({ type: 'setLocation', latitude, longitude })}
          onClear={() => act({ type: 'clearLocation' })} />

        <PermissionsSection t={t} permissions={isIos ? IOS_PERMISSIONS : ANDROID_PERMISSIONS} canReset={isIos}
          defaultAppId={foregroundApp?.id ?? ''} disabled={disabled}
          onDecide={(appId, permission, decision) => act({ type: 'setPermission', appId, permission, decision })} />

        {isIos && (
          <Section title={t('tools.push')}>
            <SubmitRow placeholder={t('tools.alertText')} action={t('tools.send')} disabled={disabled || foregroundApp === null}
              onSubmit={payload => foregroundApp === null ? Promise.resolve(false) : act({ type: 'sendPush', appId: foregroundApp.id, payload })} />
            {foregroundApp === null && <p className={css.muted}>{t('tools.openAppFirst')}</p>}
          </Section>
        )}

        {isIos && <EventLogSection t={t} access={access} device={device} />}
      </div>
    </aside>
  )
}

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{props.title}</h3>
      {props.children}
    </section>
  )
}

function LocationSection(props: {
  readonly t: DeviceTranslate
  readonly disabled: boolean
  readonly canClear: boolean
  readonly onSet: (latitude: number, longitude: number) => Promise<boolean>
  readonly onClear: () => Promise<boolean>
}): ReactNode {
  const { t } = props
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const parsed = { latitude: Number(latitude), longitude: Number(longitude) }
  const valid = latitude.trim() !== '' && longitude.trim() !== ''
    && Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)
    && Math.abs(parsed.latitude) <= 90 && Math.abs(parsed.longitude) <= 180
  return (
    <Section title={t('tools.location')}>
      <div className={css.inline}>
        <input className={css.textInput} placeholder={t('tools.latitude')} aria-label={t('tools.latitude')} inputMode="decimal"
          value={latitude} disabled={props.disabled} onChange={(event) => { setLatitude(event.target.value) }} />
        <input className={css.textInput} placeholder={t('tools.longitude')} aria-label={t('tools.longitude')} inputMode="decimal"
          value={longitude} disabled={props.disabled} onChange={(event) => { setLongitude(event.target.value) }} />
      </div>
      <div className={css.inline}>
        <Choice
          label={t('tools.preset')}
          value={undefined}
          options={LOCATION_PRESETS.map(preset => ({ value: preset.key, label: t(preset.key) }))}
          placeholder={t('tools.preset')}
          disabled={props.disabled}
          onChange={(key) => {
            const preset = LOCATION_PRESETS.find(candidate => candidate.key === key)
            if (preset === undefined) return
            setLatitude(String(preset.latitude))
            setLongitude(String(preset.longitude))
            void props.onSet(preset.latitude, preset.longitude)
          }}
        />
        <button type="button" className={css.chip} disabled={props.disabled || !valid}
          onClick={() => { void props.onSet(parsed.latitude, parsed.longitude) }}>
          {t('tools.set')}
        </button>
        {props.canClear && (
          <button type="button" className={css.chip} disabled={props.disabled} onClick={() => {
            setLatitude('')
            setLongitude('')
            void props.onClear()
          }}>
            {t('tools.clearLocation')}
          </button>
        )}
      </div>
    </Section>
  )
}

function PermissionsSection(props: {
  readonly t: DeviceTranslate
  readonly permissions: readonly DevicePermission[]
  readonly canReset: boolean
  readonly defaultAppId: string
  readonly disabled: boolean
  readonly onDecide: (appId: string, permission: DevicePermission, decision: 'grant' | 'revoke' | 'reset') => Promise<boolean>
}): ReactNode {
  const { t } = props
  const [appId, setAppId] = useState('')
  const [permission, setPermission] = useState<DevicePermission>('camera')
  const resolved = appId.trim() || props.defaultAppId
  const decide = (decision: 'grant' | 'revoke' | 'reset'): void => { void props.onDecide(resolved, permission, decision) }
  return (
    <Section title={t('tools.permissions')}>
      <input className={css.textInput} data-standalone="" placeholder={props.defaultAppId === '' ? t('tools.appId') : props.defaultAppId}
        aria-label={t('tools.appId')} value={appId} disabled={props.disabled} onChange={(event) => { setAppId(event.target.value) }} />
      <div className={css.inline}>
        <Choice label={t('tools.permissions')} value={permission}
          options={props.permissions.map(value => ({ value, label: t(`tools.permission.${value}`) }))}
          placeholder={t('tools.unknown')} disabled={props.disabled} onChange={setPermission} />
        <button type="button" className={css.chip} disabled={props.disabled || resolved === ''} onClick={() => { decide('grant') }}>{t('tools.grant')}</button>
        <button type="button" className={css.chip} disabled={props.disabled || resolved === ''} onClick={() => { decide('revoke') }}>{t('tools.revoke')}</button>
        {props.canReset && (
          <button type="button" className={css.chip} disabled={props.disabled || resolved === ''} onClick={() => { decide('reset') }}>{t('tools.reset')}</button>
        )}
      </div>
    </Section>
  )
}

function EventLogSection(props: {
  readonly t: DeviceTranslate
  readonly access: DeviceHubAccess
  readonly device: DeviceSummary
}): ReactNode {
  const { t, access, device } = props
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<readonly DeviceEventLogEntry[]>([])
  useEffect(() => {
    if (!open) return undefined
    const unsubscribe = subscribeDeviceEventLog({ access, platform: device.platform, deviceId: device.id }, (incoming, reset) => {
      setEntries((current) => {
        const merged = reset ? [...incoming] : [...current, ...incoming]
        return merged.length > EVENT_LOG_LIMIT ? merged.slice(-EVENT_LOG_LIMIT) : merged
      })
    })
    return () => {
      unsubscribe()
      setEntries([])
    }
  }, [open, access, device.id, device.platform])
  return (
    <section className={css.section}>
      <button type="button" className={css.sectionToggle} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className={css.sectionTitle}>{t('tools.eventLog')}</span>
        <ChevronDown />
      </button>
      {open && (
        <ol className={css.eventLog}>
          {entries.length === 0
            ? <li className={css.muted}>{t('tools.noEvents')}</li>
            : entries.map(entry => (
              <li key={entry.id}>
                <span className={css.eventTime}>{entry.timestamp.slice(11, 19)}</span>
                <span className={css.eventSummary}>{entry.summary}</span>
              </li>
            ))}
        </ol>
      )}
    </section>
  )
}
