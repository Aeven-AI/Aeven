/**
 * The client's view of the Host's device service: one reconnecting `watch`
 * subscription shared by every device pane, and the commands the panes send.
 *
 * The subscription opens with the first pane and closes with the last, so a
 * client that never shows a device pane holds no device stream.
 */
import type { ClientRemote } from '@aeven/api-remotes/client'
import type {
  DeviceActionRequest, DeviceCloseRequest, DeviceConfigureRequest, DeviceDetail, DeviceHostId, DeviceOpenRequest,
  DevicePlatform, DeviceServiceState, DeviceSession, DeviceTarget,
} from '@aeven/device/types'
import type { RemoteResult } from '@aeven/typert-protocol'
import type { SessionId } from '@aeven/session/types'

/** The state before the first snapshot arrives. */
const INITIAL: DeviceServiceState = {
  hosts: [],
  status: 'idle',
  hostStates: {},
  devices: [],
  sessions: [],
  booting: [],
  onboardingCompleted: true,
  agentAccessEnabled: false,
  hubBasePath: '/device-hub',
  revision: -1,
}

/** A device command's outcome: its value, or the Host's message. */
export type DeviceCommandResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

/** Observable device state plus the pane's commands. */
export class DeviceClient {
  private state: DeviceServiceState = INITIAL
  private loaded = false
  private failure: string | undefined
  private readonly listeners = new Set<() => void>()
  private stream: { dispose(): Promise<void> } | undefined

  /** @param remote - the Client Remote carrying the `device` namespace. */
  constructor(private readonly remote: ClientRemote) {}

  /** The latest state; stable between changes. */
  readonly getSnapshot = (): DeviceServiceState => this.state

  /** Why the state stream stopped, until {@link retry} reopens it. */
  readonly getFailure = (): string | undefined => this.failure

  /** Reopen a failed state stream. */
  retry(): void {
    if (this.failure === undefined || this.listeners.size === 0) return
    this.failure = undefined
    this.openStream()
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** Whether the first snapshot has arrived. */
  isLoaded(): boolean {
    return this.loaded
  }

  /**
   * Observe state changes; the first observer opens the Host stream and the last closes it.
   * @param listener - called after each change.
   * @returns disposer removing the observer.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.stream === undefined) this.openStream()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.stream !== undefined) {
        void this.stream.dispose()
        this.stream = undefined
      }
    }
  }

  private openStream(): void {
    const remote = this.remote
    const stream = remote.$stream<DeviceServiceState>({
      name: 'Device state',
      open: signal => remote.device.watch(signal),
      ended: () => new Error('The device state stream ended.'),
    })
    this.stream = stream
    void (async () => {
      for await (const item of stream) {
        if (this.stream !== stream) return
        item.accept()
        this.state = item.value
        this.loaded = true
        this.emit()
      }
    })().catch((error: unknown) => {
      // A stream disposed by its last subscriber also rejects; only the live one reports.
      if (this.stream !== stream) return
      this.stream = undefined
      this.failure = error instanceof Error ? error.message : String(error)
      this.emit()
    })
  }

  /** Refresh every host's devices. */
  list(): Promise<DeviceCommandResult<DeviceServiceState>> {
    return settle(this.remote.device.list())
  }

  /**
   * Change the consent switches.
   * @param request - the switches to change.
   */
  configure(request: DeviceConfigureRequest): Promise<DeviceCommandResult<DeviceServiceState>> {
    return settle(this.remote.device.configure(request))
  }

  /**
   * Retry a failed host.
   * @param hostId - the host.
   */
  retryHost(hostId: DeviceHostId): Promise<DeviceCommandResult<DeviceServiceState>> {
    return settle(this.remote.device.retryHost(hostId))
  }

  /**
   * Open a device for a session, booting it when needed.
   * @param sessionId - the session.
   * @param request - the device.
   */
  open(sessionId: SessionId, request: DeviceOpenRequest): Promise<DeviceCommandResult<DeviceSession>> {
    return settle(this.remote.device.open(sessionId, request))
  }

  /**
   * Close a session's device, optionally powering it off.
   * @param sessionId - the session.
   * @param request - the device and whether to shut it down.
   */
  close(sessionId: SessionId, request: DeviceCloseRequest): Promise<DeviceCommandResult<void>> {
    return settle(this.remote.device.close(sessionId, request))
  }

  /**
   * Power a device off.
   * @param target - the device.
   * @param platform - its platform.
   */
  shutdown(target: DeviceTarget, platform: DevicePlatform): Promise<DeviceCommandResult<void>> {
    return settle(this.remote.device.shutdown(target, platform))
  }

  /**
   * Read a device's settings and foreground app.
   * @param target - the device.
   */
  detail(target: DeviceTarget): Promise<DeviceCommandResult<DeviceDetail>> {
    return settle(this.remote.device.detail(target))
  }

  /**
   * Run one action and read the device back.
   * @param request - the device and action.
   */
  action(request: DeviceActionRequest): Promise<DeviceCommandResult<DeviceDetail>> {
    return settle(this.remote.device.action(request))
  }
}

async function settle<T>(pending: Promise<RemoteResult<T>>): Promise<DeviceCommandResult<T>> {
  try {
    const result = await pending
    return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
