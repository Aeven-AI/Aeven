/**
 * The operating system's location decision, which the Electron shell asks for.
 *
 * Chromium starts no location provider while the system holds no decision, and
 * no browser API asks the system for one, so a desktop read that begins first
 * only times out: macOS raises no alert on its own. The shell raises that alert,
 * and the shell alone can send the reader to the pane that carries the switch.
 * A page in a browser has no shell to ask and keeps the browser's own prompt.
 */
import { readDevicePosition, type DeviceRead } from './device-position.ts'

/** What the operating system reports about this application's location access. */
export type SystemLocationPermission =
  /** The system allows this application to read the device position. */
  | 'granted'
  /** The reader, a guardian, or a policy forbids this application the position. */
  | 'denied'
  /** The system has asked nothing yet, so it holds no decision. */
  | 'not-determined'
  /** The platform answers for the whole machine and has no per-application switch to read. */
  | 'system-managed'

/** The system's answer, and where a denied one is changed. */
export interface SystemLocationState {
  readonly permission: SystemLocationPermission
  /** Whether this platform has a settings pane that carries the location switch. */
  readonly settings: boolean
}

/** One read attempt: the system's answer first, then the position it allows. */
export interface LocationAttempt {
  /** The position, why there is none, or the system's refusal. */
  readonly outcome: DeviceRead | { readonly kind: 'denied' }
  /** Whether the shell can open the settings pane that carries the location switch. */
  readonly settings: boolean
}

/** The desktop shell's location operations, exposed by its preload. */
interface DesktopLocationBridge {
  authorize(): Promise<SystemLocationState>
  openSettings(): Promise<void>
}

/**
 * The shell's location bridge, present only in the desktop application.
 * @returns the bridge, or undefined in a browser page.
 */
function desktopLocationBridge(): DesktopLocationBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { avnDesktop?: { location?: DesktopLocationBridge } }).avnDesktop?.location
}

/**
 * Read the position, asking the operating system for its decision first: an
 * alert the reader has not answered yet leaves no provider running, so a read
 * started before it can only report a timeout.
 * @returns the attempt's outcome and whether settings can carry a denied switch.
 */
export async function readLocationWithPermission(): Promise<LocationAttempt> {
  const bridge = desktopLocationBridge()
  if (bridge === undefined) return { outcome: await readDevicePosition(), settings: false }
  let system: SystemLocationState
  try {
    system = await bridge.authorize()
  } catch {
    // A shell that cannot raise the system's alert — an older preload, a binding
    // that did not load — still leaves the read this page can perform.
    return { outcome: await readDevicePosition(), settings: false }
  }
  if (system.permission === 'denied') return { outcome: { kind: 'denied' }, settings: system.settings }
  return { outcome: await readDevicePosition(), settings: system.settings }
}

/**
 * Open the settings pane that carries this platform's location switch.
 * @returns whether a pane was opened; a browser page has none.
 */
export async function openSystemLocationSettings(): Promise<boolean> {
  const bridge = desktopLocationBridge()
  if (bridge === undefined) return false
  try {
    await bridge.openSettings()
    return true
  } catch {
    // A shell whose system pane did not open leaves the reader where they were.
    return false
  }
}
