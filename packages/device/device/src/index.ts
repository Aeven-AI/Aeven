/**
 * Device discovery, per-session device sessions, and the state stream the
 * right sidebar's device pane renders, ported from t3code's DeviceService.
 *
 * Hosts register here (`@aeven/device-local` is the machine the Host runs
 * on). The service owns which session is looking at which device, so the pane
 * and the model's `device_*` tools agree, and a `device_open` from the model
 * reaches every client watching that session. Nothing installs or starts
 * until the user enables device support; model control needs a second,
 * separate consent.
 *
 * @module @aeven/device
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { avnHomePath } from '@aeven/home-paths'
import type { SessionId } from '@aeven/session/types'
import type {} from '@aeven/session'
import type { User } from '@aeven/identity-user'
import type {} from '@aeven/settings'
import type { SettingsScope } from '@aeven/settings'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import { readDeviceDetail, runDeviceAction } from './actions.ts'
import { agentDeviceConfigPath, agentDeviceSession, ensureAgentDeviceLauncher, writeAgentDeviceConfig } from './agent-device.ts'
import type { DeviceHost, DeviceHostAgentReady, DeviceHostPhase, DeviceHostReady } from './host.ts'
import { installHubProxy } from './hub-proxy.ts'
import { bootFailureReason, hubAction, hubListDevices, hubScreenshot, vendorPrefix } from './hub.ts'
import { LOCAL_DEVICE_HOST_ID } from './local-host-id.ts'
import type {
  DeviceActionRequest, DeviceCloseRequest, DeviceConfigureRequest, DeviceDetail, DeviceHostId,
  DeviceHostState, DeviceId, DeviceOpenRequest, DevicePlatform, DeviceServiceState,
  DeviceSession, DeviceSummary, DeviceTarget,
} from './types.ts'

export type * from './types.ts'
export { LOCAL_DEVICE_HOST_ID } from './local-host-id.ts'
export type * from './host.ts'
export { runDeviceAction, readDeviceDetail, supportsAction } from './actions.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Simulators and emulators on registered device hosts. */
    devices: DeviceService
  }
}

/** The user's consent switches; defaults are the composed starting point. */
export interface DeviceConsent {
  /** Install and start the streaming hub on demand. */
  enabled: boolean
  /** Let the model start and drive devices. */
  agentAccessEnabled: boolean
  /** The setup flow was finished once. */
  onboardingCompleted: boolean
}

/** Deployment timeouts, the hub route mount, and the consent defaults. */
export interface Config extends DeviceConsent {
  /** Origin-relative path the hub proxy (hub-proxy.ts) serves the hub under. */
  hubMount: string
  /** Hub JSON request deadline, in ms. */
  requestTimeoutMs: number
  /** Simulator or emulator boot deadline, in ms. */
  bootTimeoutMs: number
  /** Screenshot deadline, in ms. */
  screenshotTimeoutMs: number
  /** Where agent-device endpoint files and the launcher live. Omit for `<AVN_HOME>/runtime/device`. */
  stateDir?: string
}

const ConsentSchema: z<DeviceConsent> = z.object({
  enabled: z.boolean().default(false),
  agentAccessEnabled: z.boolean().default(false),
  onboardingCompleted: z.boolean().default(false),
})

/** Settings namespace holding {@link DeviceConsent}. */
const SETTINGS_NAMESPACE = 'device'

/** A registered host's readiness, addressed by host. */
export interface DeviceReadiness extends DeviceHostReady {
  readonly hostId: DeviceHostId
}

/** How the model's agent-device commands reach one device. */
export interface AgentDeviceTarget {
  /** The launcher to run, from {@link ensureAgentDeviceLauncher}. */
  readonly command: string
  /** Flags every command carries: platform, device, config, and session. */
  readonly args: readonly string[]
}

/** A device's screen, as PNG bytes. */
export interface DeviceScreenshot {
  readonly device: DeviceSummary
  readonly png: Uint8Array
}

const hostError = (hostId: string, message: string, cause?: unknown) =>
  new RemoteError('device/host-unavailable', message, { hostId }, cause === undefined ? undefined : { cause })

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Discovery, sessions, consent, and device control over registered hosts. */
export class DeviceService extends TypertRemoteService {
  static Config: z<Config> = z.object({
    enabled: z.boolean().default(false),
    agentAccessEnabled: z.boolean().default(false),
    onboardingCompleted: z.boolean().default(false),
    hubMount: z.string().default('/device-hub'),
    requestTimeoutMs: z.number().step(1).min(1).default(15_000),
    bootTimeoutMs: z.number().step(1).min(1).default(180_000),
    screenshotTimeoutMs: z.number().step(1).min(1).default(20_000),
    stateDir: z.string(),
  })

  /** Origin-relative path the hub is proxied under. */
  readonly hubMount: string
  /** Agent-device endpoint files and the launcher. */
  readonly stateDir: string
  private readonly hosts = new Map<DeviceHostId, DeviceHost>()
  private readonly listeners = new Set<(state: DeviceServiceState) => void>()
  private consentScope: SettingsScope<DeviceConsent> | undefined
  private consentFallback: DeviceConsent
  private state: DeviceServiceState
  /** Serializes host start, consent changes, and session commits, as t3code's lifecycle lock does. */
  private lifecycle: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - owning context.
   * @param config - timeouts, hub mount, and consent defaults.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'devices', { namespace: 'device' })
    this.hubMount = config.hubMount
    this.stateDir = config.stateDir ?? avnHomePath('runtime', 'device')
    this.consentFallback = {
      enabled: config.enabled, agentAccessEnabled: config.agentAccessEnabled, onboardingCompleted: config.onboardingCompleted,
    }
    const consent = this.consent()
    this.state = {
      hosts: [],
      status: consent.enabled ? 'idle' : 'disabled',
      hostStates: {},
      devices: [],
      sessions: [],
      booting: [],
      onboardingCompleted: consent.onboardingCompleted,
      agentAccessEnabled: consent.agentAccessEnabled,
      hubBasePath: config.hubMount,
      revision: 0,
    }
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, ConsentSchema, { base: this.consentFallback })
      this.consentScope = scope
      this.applyConsent()
      const stop = scope.watch(() => { this.applyConsent() })
      settingsCtx.effect(() => () => {
        stop()
        this.consentScope = undefined
        this.applyConsent()
      }, 'devices.settings')
    })
    // The hub is reachable from a browser only through this proxy.
    ctx.inject(['webServer', 'connection'], (webCtx) => { installHubProxy(webCtx, this) })
    ctx.effect(() => () => {
      this.listeners.clear()
      return Promise.allSettled([...this.hosts.values()].map(host => host.stop())).then(() => undefined)
    }, 'devices.hosts')
  }

  /**
   * Add a host. Its devices appear on the next list.
   * @param host - the host implementation.
   * @returns disposer removing the host, its devices, and its sessions.
   */
  registerHost(host: DeviceHost): () => void {
    if (this.hosts.has(host.id)) throw new Error(`devices: duplicate host "${host.id}"`)
    this.hosts.set(host.id, host)
    void this.refreshHosts()
    return () => {
      if (this.hosts.get(host.id) !== host) return
      this.hosts.delete(host.id)
      void host.stop()
      this.publish(state => ({
        ...state,
        hostStates: Object.fromEntries(Object.entries(state.hostStates).filter(([id]) => id !== host.id)),
        devices: state.devices.filter(device => device.hostId !== host.id),
        sessions: state.sessions.filter(session => session.hostId !== host.id),
      }))
      void this.refreshHosts()
    }
  }

  /** The current state snapshot. */
  snapshot(): DeviceServiceState {
    return this.state
  }

  /**
   * Follow the state: the current snapshot, then every change. Intermediate
   * states a slow reader missed collapse into the latest.
   * @param signal - stream cancellation.
   * @returns the state stream.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<DeviceServiceState> {
    const caller = this.ctx.get('identityUsers')?.actingUser()
    let latest: DeviceServiceState | undefined = this.state
    let wake: (() => void) | undefined
    const listener = (state: DeviceServiceState): void => {
      latest = state
      wake?.()
    }
    const abort = (): void => { wake?.() }
    this.listeners.add(listener)
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (latest !== undefined) {
          const next: DeviceServiceState = latest
          latest = undefined
          yield this.forCaller(next, caller)
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.listeners.delete(listener)
      signal.removeEventListener('abort', abort)
    }
  }

  /**
   * Refresh every host's devices. Starts the hubs only after device support
   * was enabled; reports host failures in the state rather than throwing.
   * @returns the refreshed state.
   */
  @Remote
  async list(): Promise<DeviceServiceState> {
    return this.forCaller(await this.listAll(), this.ctx.get('identityUsers')?.actingUser())
  }

  /**
   * The state as one caller sees it: devices are the machine's and every
   * account sees them, while the Sessions a device is opened or booting for
   * are listed only for their owner.
   * @param state - the full state.
   * @param caller - the user the state is for.
   * @returns the state without other accounts' Sessions.
   */
  private forCaller(state: DeviceServiceState, caller: User | undefined): DeviceServiceState {
    const identity = this.ctx.get('identityUsers')
    if (identity === undefined) return state
    const sessions = this.ctx.get('sessions')
    const visible = (sessionId: SessionId): boolean => identity.mayAccess(sessions?.get(sessionId)?.header.owner, caller)
    return {
      ...state,
      sessions: state.sessions.filter(entry => visible(entry.sessionId)),
      booting: state.booting.filter(entry => visible(entry.sessionId)),
    }
  }

  private async listAll(): Promise<DeviceServiceState> {
    if (!this.consent().enabled) return this.state
    await Promise.all([...this.hosts.values()].map(async (host) => {
      try {
        const ready = await this.readinessIfSupported(host.id)
        if (ready !== undefined) await this.refresh(ready)
      } catch (error) {
        this.setHostState(host.id, { status: 'failed', detail: errorMessage(error) })
      }
    }))
    return this.state
  }

  /**
   * Retry one failed host, including its agent tools when agent access was granted.
   * @param hostId - the host.
   * @returns the state after the retry.
   */
  @Remote
  async retryHost(hostId: DeviceHostId): Promise<DeviceServiceState> {
    this.resolveHost(hostId)
    if (!this.consent().enabled) return this.state
    try {
      const ready = await this.agentReadinessIfSupported(hostId) ?? await this.readinessIfSupported(hostId)
      if (ready !== undefined) await this.refresh(ready)
    } catch (error) {
      this.setHostState(hostId, { status: 'failed', detail: errorMessage(error) })
    }
    return this.state
  }

  /**
   * Change the consent switches. Turning support off stops every helper;
   * revoking agent access stops only the agent daemons.
   * @param request - the switches to change.
   * @returns the state after the change and a device refresh.
   */
  @Remote
  async configure(request: DeviceConfigureRequest): Promise<DeviceServiceState> {
    const current = this.consent()
    const next: DeviceConsent = {
      enabled: request.enabled ?? current.enabled,
      agentAccessEnabled: request.agentAccessEnabled ?? current.agentAccessEnabled,
      onboardingCompleted: request.onboardingCompleted ?? current.onboardingCompleted,
    }
    await this.serialize(async () => {
      if (this.consentScope !== undefined) await this.consentScope.update(next)
      else this.consentFallback = next
      if (!next.enabled) await Promise.all([...this.hosts.values()].map(host => host.stop()))
      else if (request.agentAccessEnabled === false) await Promise.all([...this.hosts.values()].map(host => host.stopAgent()))
      this.publish(state => ({
        ...state,
        status: next.enabled ? 'idle' : 'disabled',
        statusDetail: undefined,
        hostStates: {},
        devices: next.enabled ? state.devices : [],
        sessions: next.enabled ? state.sessions : [],
        booting: next.enabled ? state.booting : [],
        agentAccessEnabled: next.agentAccessEnabled,
        onboardingCompleted: next.onboardingCompleted,
      }))
    })
    if (next.enabled && next.agentAccessEnabled && request.agentAccessEnabled === true) {
      await Promise.all([...this.hosts.keys()].map(hostId => this.agentReadinessIfSupported(hostId).catch((error: unknown) => {
        this.setHostState(hostId, { status: 'failed', detail: errorMessage(error) })
      })))
    }
    return await this.list()
  }

  /**
   * Refuse a request that names a Session the caller does not own.
   * @param sessionId - the Session the device is opened for.
   */
  private requireCallerSession(sessionId: SessionId): void {
    const owner = this.ctx.get('sessions')?.get(sessionId)?.header.owner
    if (this.ctx.get('identityUsers')?.mayAccess(owner) === false) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
  }

  /**
   * Open a device for a session, booting it unless the request says not to.
   * @param sessionId - the session looking at the device.
   * @param request - the device and whether to boot it.
   * @returns the session's device session.
   */
  @Remote
  async open(sessionId: SessionId, request: DeviceOpenRequest): Promise<DeviceSession> {
    this.requireCallerSession(sessionId)
    const host = this.resolveHost(request.hostId)
    const availability = await host.platformAvailability(request.platform)
    if (!availability.available) {
      throw new RemoteError('device/platform-unavailable',
        `${request.platform} devices are unavailable on host ${host.id}: ${availability.reason ?? 'toolchain missing'}`,
        { hostId: host.id, platform: request.platform })
    }
    const ready = await this.readiness(host.id)
    let device = this.findDevice(await this.refresh(ready), host.id, request.deviceId)
    if (device === undefined) throw this.notFound(host.id, request.deviceId)
    if (!device.booted && request.boot !== false) {
      const booting = { ...device, sessionId }
      const matches = (entry: DeviceSummary) => entry.hostId === booting.hostId && entry.id === booting.id
      this.publish(state => ({ ...state, booting: [...state.booting.filter(entry => !matches(entry)), booting] }))
      let bootedId: string
      try {
        bootedId = await this.boot(ready, device)
      } finally {
        this.publish(state => ({ ...state, booting: state.booting.filter(entry => !matches(entry)) }))
      }
      const state = await this.refresh(ready)
      device = this.findDevice(state, host.id, bootedId as DeviceId) ?? this.findDevice(state, host.id, device.id)
      if (device === undefined) throw this.notFound(host.id, bootedId)
    } else if (device.platform === 'ios' && device.booted) {
      // A simulator booted outside Aeven has no serve-sim helper attached yet.
      await this.attachIosStream(ready, device.id)
    }
    const opened = device
    return await this.serialize(() => {
      if (!this.consent().enabled) throw hostError(host.id, 'Device support was turned off while the device was opening.')
      if (this.hosts.get(host.id) !== host) throw hostError(host.id, 'Host configuration changed. Retry the operation.')
      const session: DeviceSession = {
        sessionId, hostId: host.id, deviceId: opened.id, platform: opened.platform, openedAt: new Date().toISOString(),
      }
      this.publish(state => ({
        ...state,
        sessions: [
          ...state.sessions.filter(existing => !(existing.sessionId === sessionId
            && existing.hostId === session.hostId && existing.deviceId === session.deviceId)),
          session,
        ],
      }))
      return Promise.resolve(session)
    })
  }

  /**
   * Close a session's device sessions, optionally powering the devices off.
   * @param sessionId - the session.
   * @param request - which device, and whether to shut it down.
   */
  @Remote
  async close(sessionId: SessionId, request: DeviceCloseRequest): Promise<void> {
    this.requireCallerSession(sessionId)
    const closing = this.state.sessions.filter(session => session.sessionId === sessionId
      && (request.hostId === undefined || session.hostId === request.hostId)
      && (request.deviceId === undefined || session.deviceId === request.deviceId))
    if (closing.length === 0) return
    this.publish(state => ({ ...state, sessions: state.sessions.filter(session => !closing.includes(session)) }))
    if (request.shutdown === true) {
      for (const session of closing) await this.shutdownDevice(session.hostId, session.deviceId, session.platform)
    }
  }

  /**
   * Power one device off; its sessions close in every session.
   * @param target - the device.
   * @param platform - the device's platform.
   */
  @Remote
  async shutdown(target: DeviceTarget, platform: DevicePlatform): Promise<void> {
    const host = this.resolveHost(target.hostId)
    await this.shutdownDevice(host.id, target.deviceId, platform)
  }

  /**
   * Read one device's settings and foreground app.
   * @param target - the device.
   * @returns the detail.
   */
  @Remote
  async detail(target: DeviceTarget): Promise<DeviceDetail> {
    const { ready, device } = await this.resolveDevice(target.hostId, target.deviceId)
    const read = await readDeviceDetail(ready, device.platform, device.id)
    return { hostId: ready.hostId, deviceId: device.id, ...read, readAt: new Date().toISOString() }
  }

  /**
   * Run one action, then read the device back.
   * @param request - the device and the action.
   * @returns the refreshed detail, so the pane shows what the device confirmed.
   */
  @Remote
  async action(request: DeviceActionRequest): Promise<DeviceDetail> {
    const { hostId, deviceId, ...body } = request
    const { ready, device } = await this.resolveDevice(hostId, deviceId)
    await runDeviceAction(ready, device.platform, device.id, body)
    return await this.detail({ hostId: ready.hostId, deviceId: device.id })
  }

  /**
   * Capture a device's screen.
   * @param target - the device.
   * @returns the device and its PNG.
   */
  async screenshot(target: DeviceTarget): Promise<DeviceScreenshot> {
    const { ready, device } = await this.resolveDevice(target.hostId, target.deviceId)
    return { device, png: await hubScreenshot(ready.hubOrigin, device.platform, device.id, this.config.screenshotTimeoutMs) }
  }

  /**
   * The device sessions one session holds, oldest first.
   * @param sessionId - the session.
   * @returns its device sessions.
   */
  sessionsFor(sessionId: SessionId): readonly DeviceSession[] {
    return this.state.sessions.filter(session => session.sessionId === sessionId)
  }

  /**
   * A host's running hub, without starting anything; the hub proxy's lookup.
   * @param hostId - the host; the local host when omitted.
   * @returns the hub's loopback origin, or undefined while it is not running.
   */
  hubOrigin(hostId?: string): string | undefined {
    return this.hosts.get((hostId ?? LOCAL_DEVICE_HOST_ID) as DeviceHostId)?.current()?.hubOrigin
  }

  /**
   * Point the model's agent-device commands at one device: start the host's
   * agent daemon, write its endpoint file, and write the launcher.
   * @param sessionId - the session driving the device.
   * @param device - the device.
   * @returns the launcher and the flags every command carries.
   */
  async agentTarget(sessionId: SessionId, device: DeviceSummary): Promise<AgentDeviceTarget> {
    const ready = await this.agentReadinessIfSupported(device.hostId)
    if (ready === undefined) {
      throw hostError(device.hostId,
        'Model device access needs device support, agent access, and an available simulator platform on this host.')
    }
    const config = agentDeviceConfigPath(this.stateDir, device.hostId)
    await writeAgentDeviceConfig(config, ready.agentDevice)
    const command = await ensureAgentDeviceLauncher(this.stateDir, ready.nodePath, ready.agentDevice.entryPath)
    return {
      command,
      args: [
        ...device.platform === 'ios' ? ['--platform', 'ios', '--udid', device.id] : ['--platform', 'android', '--serial', device.id],
        '--config', config,
        '--session', agentDeviceSession(sessionId, device.hostId, device.id),
      ],
    }
  }

  /**
   * A host's endpoints, installing and starting its hub when needed.
   * @param hostId - the host; the local host when omitted.
   * @returns the ready host.
   */
  async readiness(hostId?: DeviceHostId): Promise<DeviceReadiness> {
    const host = this.resolveHost(hostId)
    return await this.serialize(async () => {
      if (!this.consent().enabled) {
        throw new RemoteError('device/disabled', 'Device support is off. Enable it in the device pane before installing or starting device tools.', {})
      }
      let ready: DeviceHostReady
      try {
        ready = await host.ensureReady((phase, detail) => { this.setPhase(host.id, phase, detail) })
      } catch (error) {
        this.setHostState(host.id, { status: 'failed', detail: errorMessage(error) })
        throw hostError(host.id, `Device support failed to start: ${errorMessage(error)}`, error)
      }
      if (this.hosts.get(host.id) !== host) throw hostError(host.id, 'Host configuration changed. Retry the operation.')
      if (this.state.hostStates[host.id]?.status !== 'ready') this.setHostState(host.id, { status: 'ready' })
      return { hostId: host.id, ...ready }
    })
  }

  /**
   * {@link readiness} only when the host can run at least one platform; a
   * machine without a simulator toolchain never installs or starts anything.
   * @param hostId - the host.
   * @returns the ready host, or undefined when unsupported or disabled.
   */
  async readinessIfSupported(hostId?: DeviceHostId): Promise<DeviceReadiness | undefined> {
    if (!this.consent().enabled) return undefined
    const summary = await this.resolveHost(hostId).summary()
    if (!summary.platforms.some(platform => platform.available)) return undefined
    return await this.readiness(summary.id)
  }

  /**
   * The host with its agent daemon running, once agent access was granted.
   * @param hostId - the host.
   * @returns the agent-ready host, or undefined without consent or a platform.
   */
  async agentReadinessIfSupported(hostId?: DeviceHostId): Promise<(DeviceHostAgentReady & { hostId: DeviceHostId }) | undefined> {
    const consent = this.consent()
    if (!consent.enabled || !consent.agentAccessEnabled) return undefined
    const host = this.resolveHost(hostId)
    const summary = await host.summary()
    if (!summary.platforms.some(platform => platform.available)) return undefined
    return await this.serialize(async () => {
      let ready: DeviceHostAgentReady
      try {
        ready = await host.ensureAgentReady((phase, detail) => { this.setPhase(host.id, phase, detail) })
      } catch (error) {
        this.setHostState(host.id, { status: 'failed', detail: errorMessage(error) })
        throw hostError(host.id, `Agent device tools failed to start: ${errorMessage(error)}`, error)
      }
      await this.refreshHosts()
      this.setHostState(host.id, { status: 'ready' })
      return { hostId: host.id, ...ready }
    })
  }

  private consent(): DeviceConsent {
    return this.consentScope?.get() ?? this.consentFallback
  }

  /** Publish a consent change made outside {@link configure}, such as an edited settings file. */
  private applyConsent(): void {
    const consent = this.consent()
    if (!consent.enabled && this.state.status !== 'disabled') {
      void Promise.all([...this.hosts.values()].map(host => host.stop()))
    }
    this.publish(state => ({
      ...state,
      status: consent.enabled ? state.status === 'disabled' ? 'idle' : state.status : 'disabled',
      agentAccessEnabled: consent.agentAccessEnabled,
      onboardingCompleted: consent.onboardingCompleted,
      ...consent.enabled ? {} : { devices: [], sessions: [], booting: [], hostStates: {} },
    }))
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(run, run)
    this.lifecycle = next.catch(() => undefined)
    return next
  }

  private publish(update: (state: DeviceServiceState) => DeviceServiceState): void {
    this.state = { ...update(this.state), revision: this.state.revision + 1 }
    for (const listener of this.listeners) listener(this.state)
  }

  private setPhase(hostId: DeviceHostId, phase: DeviceHostPhase, detail: string | undefined): void {
    this.setHostState(hostId, detail === undefined ? { status: phase } : { status: phase, detail })
  }

  private setHostState(hostId: DeviceHostId, hostState: DeviceHostState): void {
    if (!this.hosts.has(hostId)) return
    this.publish(state => ({
      ...state,
      ...hostId === LOCAL_DEVICE_HOST_ID && state.status !== 'disabled'
        ? { status: hostState.status, statusDetail: hostState.detail }
        : {},
      hostStates: { ...state.hostStates, [hostId]: hostState },
    }))
  }

  private async refreshHosts(): Promise<void> {
    const summaries = await Promise.all([...this.hosts.values()].map(host => host.summary()))
    this.publish(state => ({ ...state, hosts: summaries }))
  }

  private resolveHost(hostId: DeviceHostId | undefined): DeviceHost {
    const id = hostId ?? LOCAL_DEVICE_HOST_ID
    const host = this.hosts.get(id)
    if (host === undefined) throw hostError(id, `Device host ${id} is not registered.`)
    return host
  }

  private findDevice(state: DeviceServiceState, hostId: DeviceHostId, deviceId: DeviceId): DeviceSummary | undefined {
    return state.devices.find(device => device.hostId === hostId && device.id === deviceId)
  }

  private notFound(hostId: string, deviceId: string): RemoteError<'device/not-found'> {
    return new RemoteError('device/not-found', `Device ${deviceId} was not found on host ${hostId}.`, { hostId, deviceId })
  }

  private async fetchDevices(ready: DeviceReadiness): Promise<{ devices: DeviceSummary[]; detail: string | undefined }> {
    const list = await hubListDevices(ready.hubOrigin, this.config.requestTimeoutMs)
    const devices: DeviceSummary[] = list.devices.map(device => ({
      ...device, hostId: ready.hostId, id: device.id as DeviceId,
    }))
    const host = this.resolveHost(ready.hostId)
    if ((await host.platformAvailability('android')).available) {
      // The hub lists running emulators only; stopped AVDs come from the SDK.
      const avds = await ready.run('emulator', ['-list-avds'])
      if (avds.code === 0) {
        for (const name of avds.stdout.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)) {
          if (devices.some(device => device.platform === 'android' && device.name === name)) continue
          devices.push({
            hostId: ready.hostId, id: name as DeviceId, name, platform: 'android', version: 'Android', booted: false, physical: false,
          })
        }
      }
    }
    return { devices, detail: list.detail }
  }

  private async refresh(ready: DeviceReadiness): Promise<DeviceServiceState> {
    const host = this.hosts.get(ready.hostId)
    const { devices, detail } = await this.fetchDevices(ready)
    const summaries = await Promise.all([...this.hosts.values()].map(candidate => candidate.summary()))
    return await this.serialize(() => {
      if (!this.consent().enabled || host === undefined || this.hosts.get(ready.hostId) !== host) return Promise.resolve(this.state)
      this.publish(state => ({
        ...state,
        hosts: summaries,
        ...ready.hostId === LOCAL_DEVICE_HOST_ID ? { status: 'ready', statusDetail: detail } : {},
        devices: [...state.devices.filter(device => device.hostId !== ready.hostId), ...devices],
        hostStates: { ...state.hostStates, [ready.hostId]: detail === undefined ? { status: 'ready' } : { status: 'ready', detail } },
      }))
      return Promise.resolve(this.state)
    })
  }

  /**
   * Boot through the hub so its list and its streaming helper both see the
   * device come up. An AVD changes id when it boots (AVD name to emulator
   * serial), so the returned id is authoritative.
   */
  private async boot(ready: DeviceReadiness, device: DeviceSummary): Promise<string> {
    const result = await hubAction(ready.hubOrigin, '/api/devices/boot',
      { platform: device.platform, id: device.id, name: device.name }, 'boot', this.config.bootTimeoutMs)
    if (!result.ok) {
      const reason = bootFailureReason(result.error ?? '')
      const explanation = {
        disk_space: 'there is not enough free disk space on the Host.',
        timeout: 'the device did not become ready in time.',
        launch_failed: `the simulator or emulator could not start${result.error === undefined ? '.' : `: ${result.error}`}`,
      }[reason]
      throw new RemoteError('device/boot-failed', `${device.name} failed to boot: ${explanation}`, { deviceId: device.id, reason })
    }
    if (device.platform === 'ios') await this.attachIosStream(ready, device.id)
    return result.serial ?? result.id ?? device.id
  }

  /** Booting alone attaches no serve-sim helper; the grid start does both and is idempotent. */
  private async attachIosStream(ready: DeviceReadiness, udid: string): Promise<void> {
    const result = await hubAction(ready.hubOrigin, `${vendorPrefix('ios')}/grid/api/start`, { udid }, 'attach stream', this.config.bootTimeoutMs)
    if (!result.ok) {
      throw new RemoteError('device/operation-failed', `Device attach stream failed: ${result.error ?? 'the hub refused.'}`, { operation: 'attach stream' })
    }
  }

  private async shutdownDevice(hostId: DeviceHostId, deviceId: DeviceId, platform: DevicePlatform): Promise<void> {
    const ready = await this.readiness(hostId)
    const post = async (path: string, body: object): Promise<void> => {
      const result = await hubAction(ready.hubOrigin, path, body, 'shutdown', this.config.requestTimeoutMs)
      if (!result.ok) {
        throw new RemoteError('device/operation-failed', `Device shutdown failed: ${result.error ?? 'the hub refused.'}`, { operation: 'shutdown' })
      }
    }
    if (platform === 'ios') {
      // serve-sim's shutdown closes its capture session before `simctl
      // shutdown`, which the hub's generic route can leave cached across a
      // reboot. serve-sim fails for a simulator already off; that failure is
      // accepted only when the hub confirms the simulator is off.
      try {
        await post(`${vendorPrefix('ios')}/grid/api/shutdown`, { udid: deviceId })
      } catch (error) {
        const { devices } = await this.fetchDevices(ready)
        if (devices.find(device => device.id === deviceId)?.booted !== false) throw error
      }
    } else {
      await post('/api/devices/shutdown', { platform, id: deviceId })
    }
    this.publish(state => ({
      ...state,
      devices: state.devices.map(device => device.hostId === hostId && device.id === deviceId ? { ...device, booted: false } : device),
      sessions: state.sessions.filter(session => !(session.hostId === hostId && session.deviceId === deviceId)),
    }))
    // Discovery can stall while an emulator saves its snapshot; a failed
    // refresh must not turn an accepted shutdown into a failure.
    await this.refresh(ready).catch((error: unknown) => {
      this.ctx.logger.warn('device discovery unavailable after shutdown: %s', errorMessage(error))
    })
  }

  private async resolveDevice(hostId: DeviceHostId | undefined, deviceId: DeviceId): Promise<{ ready: DeviceReadiness; device: DeviceSummary }> {
    const host = this.resolveHost(hostId)
    const ready = await this.readiness(host.id)
    const device = this.findDevice(this.state, host.id, deviceId) ?? this.findDevice(await this.refresh(ready), host.id, deviceId)
    if (device === undefined) throw this.notFound(host.id, deviceId)
    return { ready, device }
  }
}

export default DeviceService
