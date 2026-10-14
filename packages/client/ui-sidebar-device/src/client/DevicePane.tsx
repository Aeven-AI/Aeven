/**
 * One device surface of the right sidebar, ported from t3code's DevicePanel.
 *
 * A pill shows the device list until a device is opened, then that device's
 * live screen. The Host records which session looks at which device, so a
 * device the model opens with `device_open` appears in an open pane of that
 * session. Closing the pill leaves the device running; the control row's
 * power button shuts it down.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconLucideChevronRight, IconLucideRefreshCw, IconLucideSettings2, IconLucideSmartphone, IconLucideX, Modal, Spinner, StateDot,
} from '@aeven/client-ui-primitives'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import type { DeviceHostId, DevicePlatform, DeviceServiceState, DeviceSummary } from '@aeven/device/types'
import type { SessionId } from '@aeven/session/types'
import { IconButton, type DeviceTranslate } from './controls.tsx'
import { DeviceLoading, DeviceStream, type DeviceStreamHandle } from './DeviceStream.tsx'
import { DeviceSetup } from './DeviceSetup.tsx'
import { DeviceTools } from './DeviceTools.tsx'
import { deviceHubAccess } from './hub-access.ts'
import { ChevronLeft, CirclePlay, Home, List, Power, RotateCcw, Square } from './icons.tsx'
import type { DeviceClient } from './state.ts'
import css from './DevicePane.module.css'

/** What the plugin hands every device pane beyond the column's props. */
export interface DevicePaneProps extends SidebarContentPaneProps {
  readonly t: DeviceTranslate
  readonly client: DeviceClient
}

/** A device's address within the state. */
interface DeviceKey {
  readonly hostId: string
  readonly deviceId: string
}

/** Stage width at which the tools drawer docks beside the screen instead of floating over it. */
const DRAWER_DOCK_MIN_WIDTH = 620

/**
 * Track whether one element is at least `minWidth` wide, as state.
 *
 * A container condition cannot read a `@media` width — this pane's width is the
 * sidebar's, not the viewport's — so the element that owns the layout reads its
 * own box and states the outcome for the sheet to select on. Reported width is
 * the content box, which is what a size query measures.
 * @param ref - the measured element.
 * @param minWidth - the threshold in CSS pixels.
 * @returns whether the element has been observed at or above the threshold.
 */
function useMinWidth(ref: { readonly current: HTMLElement | null }, minWidth: number): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWide(entry.contentRect.width >= minWidth)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [ref, minWidth])
  return wide
}

const sameDevice = (a: DeviceKey, b: { readonly hostId: string; readonly id: string }): boolean =>
  a.hostId === b.hostId && a.deviceId === b.id

/** Key prefix for the device a pill shows; one record per pill. */
const TARGET_PREFIX = 'avn.sidebar-device.target'

function readTarget(sessionId: string, surfaceId: string): DeviceKey | undefined {
  try {
    const raw = localStorage.getItem(`${TARGET_PREFIX}.${sessionId}.${surfaceId}`)
    const parsed: unknown = raw === null ? undefined : JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { hostId, deviceId } = parsed as Record<string, unknown>
    return typeof hostId === 'string' && typeof deviceId === 'string' ? { hostId, deviceId } : undefined
  } catch {
    // Storage unavailable or the record unparsable: the pill opens on its list.
    return undefined
  }
}

function writeTarget(sessionId: string, surfaceId: string, target: DeviceKey | undefined): void {
  try {
    const key = `${TARGET_PREFIX}.${sessionId}.${surfaceId}`
    if (target === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(target))
  } catch {
    // Same unavailable storage as readTarget: the choice holds for this mount.
  }
}

/**
 * Render one device surface.
 * @param props - the column's pane props plus the plugin's copy and device client.
 * @returns the pane.
 */
export function DevicePane({ sessionId, surfaceId, active, setTab, closeSurface, t, client }: DevicePaneProps): ReactNode {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const failure = useSyncExternalStore(client.subscribe, client.getFailure)
  const loaded = state.revision >= 0
  const [target, setTargetState] = useState<DeviceKey | undefined>(() => readTarget(sessionId, surfaceId))
  const setTarget = useCallback((next: DeviceKey | undefined) => {
    setTargetState(next)
    writeTarget(sessionId, surfaceId, next)
  }, [sessionId, surfaceId])
  const [pending, setPending] = useState<DeviceSummary | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [handle, setHandle] = useState<DeviceStreamHandle | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [axOverlay, setAxOverlay] = useState(false)
  // The stage owns the drawer's docked breakpoint; see DRAWER_DOCK_MIN_WIDTH.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drawerDocked = useMinWidth(stageRef, DRAWER_DOCK_MIN_WIDTH)
  // Until this pane's first listing settles, an empty device list means "not yet discovered", not "none".
  const [listed, setListed] = useState(false)
  const disabled = state.status === 'disabled'

  const sessions = useMemo(() => state.sessions.filter(session => session.sessionId === sessionId), [state.sessions, sessionId])
  const activeSession = target === undefined
    ? undefined
    : sessions.find(session => session.hostId === target.hostId && session.deviceId === target.deviceId)
  const activeDevice = activeSession === undefined
    ? undefined
    : state.devices.find(device => sameDevice({ hostId: activeSession.hostId, deviceId: activeSession.deviceId }, device))

  // A device the model opens for this session takes over the pane.
  const newest = sessions.reduce<(typeof sessions)[number] | undefined>(
    (latest, session) => latest === undefined || session.openedAt > latest.openedAt ? session : latest, undefined)
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (newest === undefined || newest.openedAt === seen.current) return
    seen.current = newest.openedAt
    if (pending === undefined) setTarget({ hostId: newest.hostId, deviceId: newest.deviceId })
  }, [newest, pending, setTarget])

  // Opening the pane never grants permission to install or start helpers.
  useEffect(() => {
    if (!active || !loaded || disabled || !state.onboardingCompleted) return
    void client.list().then(() => { setListed(true) })
  }, [active, client, disabled, loaded, state.onboardingCompleted])

  useEffect(() => {
    setTab(activeDevice === undefined ? undefined : { title: activeDevice.name })
  }, [activeDevice?.name, setTab])
  useEffect(() => () => { setTab(undefined) }, [setTab])

  const hostLabel = (hostId: string): string => state.hosts.find(host => host.id === hostId)?.label ?? hostId
  // The host names a device only when more than one host could run it.
  const deviceMeta = (device: DeviceSummary): string =>
    state.hosts.length > 1 ? t('hostVersion', { host: hostLabel(device.hostId), version: device.version }) : device.version
  const access = useMemo(
    () => activeDevice === undefined ? undefined : deviceHubAccess(state.hubBasePath, activeDevice.hostId),
    [activeDevice?.hostId, state.hubBasePath],
  )

  const select = async (device: DeviceSummary): Promise<void> => {
    setError(undefined)
    setPending(device)
    const result = await client.open(sessionId as SessionId, { hostId: device.hostId, deviceId: device.id, platform: device.platform })
    setPending(undefined)
    if (!result.ok) setError(result.message)
    else {
      seen.current = result.value.openedAt
      setTarget({ hostId: result.value.hostId, deviceId: result.value.deviceId })
    }
  }

  const closeActive = async (powerOff: boolean): Promise<void> => {
    if (activeSession === undefined) return
    setError(undefined)
    setToolsOpen(false)
    const result = await client.close(sessionId as SessionId, {
      hostId: activeSession.hostId,
      deviceId: activeSession.deviceId,
      shutdown: powerOff,
    })
    if (!result.ok) setError(result.message)
    else setTarget(undefined)
  }

  if (loaded && (!state.onboardingCompleted || disabled)) {
    return (
      <section className={css.root} data-sidebar-device="">
        <Modal open={active} onClose={closeSurface} title={t('setup.title')} headless className={css.setupDialog as string}>
          <DeviceSetup t={t} client={client} state={state} onDismiss={closeSurface} />
        </Modal>
      </section>
    )
  }

  const booting = new Set(state.booting.filter(device => device.sessionId === sessionId)
    .map(device => `${device.hostId}\u0000${device.id}`))
  const hostReady = Object.values(state.hostStates).some(host => host.status === 'ready')
  const hostBusy = !hostReady && Object.values(state.hostStates).some(host => host.status === 'installing' || host.status === 'starting')
  const groups = groupDevices(state)
  const captioned = activeDevice ?? pending

  return (
    <section className={css.root} data-sidebar-device="">
      <div className={css.toolbar}>
        <span className={css.caption}>
          <span className={css.captionName}>{captioned?.name ?? t('choose')}</span>
          {captioned !== undefined && <span className={css.captionMeta}>{deviceMeta(captioned)}</span>}
        </span>
        {activeDevice !== undefined
          ? (
            <>
              <IconButton label={t('home')} disabled={handle?.inputConnected !== true} onClick={() => { handle?.pressButton('home') }}><Home /></IconButton>
              {activeDevice.platform === 'android'
                ? (
                  <>
                    <IconButton label={t('back')} disabled={handle?.inputConnected !== true} onClick={() => { handle?.pressButton('back') }}><ChevronLeft /></IconButton>
                    <IconButton label={t('recents')} disabled={handle?.inputConnected !== true} onClick={() => { handle?.pressButton('recents') }}><Square /></IconButton>
                  </>
                )
                : <IconButton label={t('rotate')} disabled={handle?.inputConnected !== true} onClick={() => { handle?.rotate() }}><RotateCcw /></IconButton>}
              <IconButton label={t('tools')} pressed={toolsOpen} onClick={() => { setToolsOpen(open => !open) }}><IconLucideSettings2 /></IconButton>
              <IconButton label={t('devices')} onClick={() => { void closeActive(false) }}><List /></IconButton>
              <IconButton label={t('powerOff')} danger onClick={() => { void closeActive(true) }}><Power /></IconButton>
            </>
          )
          : loaded && !hostBusy && pending === undefined && (
            <IconButton label={t('refresh')} onClick={() => { void client.list() }}><IconLucideRefreshCw /></IconButton>
          )}
      </div>

      <div ref={stageRef} className={css.stage} data-drawer-docked={drawerDocked ? '' : undefined}>
        {activeDevice !== undefined && access !== undefined
          ? (
            <>
              <DeviceStream
                key={`${activeDevice.hostId}\u0000${activeDevice.id}`}
                t={t}
                access={access}
                platform={activeDevice.platform}
                deviceId={activeDevice.id}
                deviceName={activeDevice.name}
                visible={active}
                axOverlay={axOverlay}
                onHandle={setHandle}
              />
              {toolsOpen && (
                <DeviceTools
                  key={`${activeDevice.hostId}\u0000${activeDevice.id}`}
                  t={t}
                  client={client}
                  device={activeDevice}
                  access={access}
                  axOverlay={axOverlay}
                  onAxOverlayChange={setAxOverlay}
                  onClose={() => { setToolsOpen(false) }}
                />
              )}
            </>
          )
          : failure !== undefined && !loaded
            ? (
              <DeviceLoading message={failure} error>
                <button type="button" className={css.chip} onClick={() => { client.retry() }}>{t('retry')}</button>
              </DeviceLoading>
            )
            : pending !== undefined || hostBusy || !loaded || (!listed && groups.length === 0)
              ? (
                <DeviceLoading
                  name={pending?.name}
                  message={pending !== undefined
                    ? t(pending.booted ? 'opening' : 'startingDevice')
                    : state.status === 'installing' ? state.statusDetail ?? t('installing') : t('finding')}
                />
              )
              : <DeviceList t={t} state={state} groups={groups} hostReady={hostReady} booting={booting} deviceMeta={deviceMeta}
                onSelect={(device) => { void select(device) }}
                onRetry={(hostId) => { void client.retryHost(hostId) }} />}
      </div>

      {/* Status and errors float over the stage's foot, so their arrival never
          moves the list or the screen. */}
      {(error !== undefined || (hostReady && state.statusDetail !== undefined && state.statusDetail !== '')) && (
        <div className={css.toasts}>
          {hostReady && state.statusDetail !== undefined && state.statusDetail !== '' && (
            <p className={css.toast} role="status">{state.statusDetail}</p>
          )}
          {error !== undefined && (
            <div className={css.toast} data-error="" role="alert">
              <p className={css.toastText}>{error}</p>
              <button type="button" className={css.toastDismiss} aria-label={t('dismissError')} onClick={() => { setError(undefined) }}><IconLucideX /></button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function DeviceList(props: {
  readonly t: DeviceTranslate
  readonly state: DeviceServiceState
  readonly groups: readonly { platform: DevicePlatform; devices: DeviceSummary[] }[]
  readonly hostReady: boolean
  /** `hostId\u0000deviceId` of each device this session is starting. */
  readonly booting: ReadonlySet<string>
  readonly deviceMeta: (device: DeviceSummary) => string
  readonly onSelect: (device: DeviceSummary) => void
  readonly onRetry: (hostId: DeviceHostId) => void
}): ReactNode {
  const { t, state, groups } = props
  const androidUnavailable = state.hosts.some(host => host.platforms.some(platform => platform.platform === 'android' && !platform.available))
  if (groups.length === 0) {
    return (
      <div className={css.empty}>
        <IconLucideSmartphone />
        <p className={css.emptyText}>{state.status === 'failed' ? state.statusDetail ?? t('hubFailed') : t('noDevices')}</p>
        {state.status === 'failed' && state.hosts.map(host => (
          <button key={host.id} type="button" className={css.chip} onClick={() => { props.onRetry(host.id) }}>{t('retry')}</button>
        ))}
      </div>
    )
  }
  return (
    <div className={css.list}>
      {groups.map(group => (
        <section key={group.platform} className={css.group}>
          <h3 className={css.groupTitle}><span className={css.slot}><IconLucideSmartphone /></span>{t(`platform.${group.platform}`)}</h3>
          {group.devices.map((device) => {
            const starting = props.booting.has(`${device.hostId}\u0000${device.id}`)
            return (
              <button
                key={`${device.hostId}\u0000${device.id}`}
                type="button"
                className={css.row}
                aria-label={t(device.booted ? 'openNamed' : 'startNamed', { name: device.name })}
                onClick={() => { props.onSelect(device) }}
              >
                <span className={css.slot}>
                  {starting ? <Spinner /> : device.booted ? <StateDot state="done" size={8} /> : <span className={css.stateDot} />}
                </span>
                <span className={css.rowTitle}>{device.name}</span>
                <span className={css.rowMeta}>{props.deviceMeta(device)}</span>
                <span className={css.rowAction}>{device.booted ? <IconLucideChevronRight /> : <CirclePlay />}</span>
              </button>
            )
          })}
        </section>
      ))}
      {props.hostReady && !androidUnavailable && !state.devices.some(device => device.platform === 'android') && (
        <p className={css.hint}>{t('noAndroid')}</p>
      )}
    </div>
  )
}

function groupDevices(state: DeviceServiceState): { platform: DevicePlatform; devices: DeviceSummary[] }[] {
  const groups: { platform: DevicePlatform; devices: DeviceSummary[] }[] = []
  for (const platform of ['ios', 'android'] as const) {
    const devices = state.devices.filter(device => device.platform === platform)
      .sort((a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name))
    if (devices.length > 0) groups.push({ platform, devices })
  }
  return groups
}
