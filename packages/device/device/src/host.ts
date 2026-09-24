/**
 * The device host seam: a machine with simulators or emulators on it.
 *
 * The device service talks only to this interface, so a remote host joins
 * beside the local one without touching discovery, the hub proxy, or the
 * model tools. Every ready host presents a loopback origin where
 * expo-device-hub answers; a host adds an agent-device daemon endpoint only
 * after the user grants agent access.
 *
 * @module @aeven/device/host
 */
import type { DeviceHostId, DeviceHostSummary, DevicePlatform, DevicePlatformAvailability } from './types.ts'

/** Result of one host command. `code` 127 reports a command that could not start. */
export interface DeviceCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

/** Options for one host command. */
export interface DeviceCommandOptions {
  /** Kill the command after this many ms. */
  readonly timeoutMs?: number
  /** Written to the command's stdin, then closed. */
  readonly stdin?: string
}

/** A host whose streaming hub answers. */
export interface DeviceHostReady {
  /** Node executable the host runs its tools with. */
  readonly nodePath: string
  /** Loopback origin of expo-device-hub, e.g. `http://127.0.0.1:3400`. */
  readonly hubOrigin: string
  /**
   * Run `xcrun`, `adb`, `emulator`, or a helper bundled with the hub where the
   * devices live. Never rejects: a command that cannot start reports code 127.
   */
  readonly run: (command: string, args: readonly string[], options?: DeviceCommandOptions) => Promise<DeviceCommandResult>
  /** Absolute paths of helper binaries vendored with the hub, when present. */
  readonly helpers: {
    /** serve-sim's accessibility-settings helper, spawned inside a simulator. */
    readonly axSettings: string | null
    /** serve-sim's CLI, which edits notification permissions. */
    readonly serveSimCli: string | null
  }
}

/** Where the model's agent-device commands reach this host's daemon. */
export interface AgentDeviceEndpoint {
  readonly baseUrl: string
  readonly token: string
  /** Host-local path of the agent-device entry script. */
  readonly entryPath: string
}

/** A ready host whose agent-device daemon also answers. */
export interface DeviceHostAgentReady extends DeviceHostReady {
  readonly agentDevice: AgentDeviceEndpoint
}

/** Install and start phases a host reports while it becomes ready. */
export type DeviceHostPhase = 'installing' | 'starting'

/** Receives a host's phase changes, with text for the pane. */
export type DeviceHostPhaseListener = (phase: DeviceHostPhase, detail?: string) => void

/** A machine the device service can list, stream, and drive devices on. */
export interface DeviceHost {
  readonly id: DeviceHostId
  /** Current inventory without installing or starting anything. */
  summary(): Promise<DeviceHostSummary>
  /** Whether one platform's toolchain is present. */
  platformAvailability(platform: DevicePlatform): Promise<DevicePlatformAvailability>
  /**
   * Install the hub on first use and start it. Concurrent callers share one
   * start; a ready host returns immediately.
   */
  ensureReady(onPhase: DeviceHostPhaseListener): Promise<DeviceHostReady>
  /** Also install and start agent-device; called only after agent access is granted. */
  ensureAgentReady(onPhase: DeviceHostPhaseListener): Promise<DeviceHostAgentReady>
  /** The running host, without starting anything. */
  current(): DeviceHostReady | undefined
  /** Stop agent-device only; the hub keeps streaming. */
  stopAgent(): Promise<void>
  /** Stop every helper. Devices keep running: the user owns those. */
  stop(): Promise<void>
}
