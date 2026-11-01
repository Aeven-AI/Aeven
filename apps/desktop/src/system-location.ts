/**
 * The operating system's answer to whether this application may read the
 * device position.
 *
 * Chromium starts no location provider while the system holds no decision, and
 * Electron offers no API that asks the system for one. macOS therefore records
 * the application in `locationd` with no decision, raises no alert, and leaves
 * every read to time out. The shell asks the system itself — CoreLocation's
 * one-time authorization alert on macOS — and reports the answer, together with
 * the settings pane a denied application is switched back on in. Windows and
 * Linux keep their own switches, so there the system stays the owner of the
 * answer and the shell only offers that pane.
 */

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

/** Objective-C runtime, which dispatches the CoreLocation messages. */
const OBJC_RUNTIME = '/usr/lib/libobjc.A.dylib'

/** CoreLocation, loaded so its manager class exists in this process. */
const CORE_LOCATION_FRAMEWORK = '/System/Library/Frameworks/CoreLocation.framework/CoreLocation'

/** `CLAuthorizationStatus.kCLAuthorizationStatusNotDetermined`. */
const CORE_LOCATION_NOT_DETERMINED = 0

/** `CLAuthorizationStatus.kCLAuthorizationStatusAuthorizedAlways`. */
const CORE_LOCATION_AUTHORIZED_ALWAYS = 3

/** `CLAuthorizationStatus.kCLAuthorizationStatusAuthorizedWhenInUse`. */
const CORE_LOCATION_AUTHORIZED_WHEN_IN_USE = 4

/** How long macOS's alert is given to be answered before the request reports no decision. */
const AUTHORIZATION_ANSWER_TIMEOUT_MS = 30_000

/** Interval between authorization-status reads while the alert is open. */
const AUTHORIZATION_POLL_INTERVAL_MS = 250

/** Settings panes that carry the location switch, for the platforms that have one. */
const SYSTEM_LOCATION_SETTINGS: Readonly<Record<string, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocationServices',
  win32: 'ms-settings:privacy-location',
}

/** One koffi function, as the bindings call it. */
interface KoffiFunction {
  (...args: unknown[]): unknown
}

/** One loaded library, whose functions are declared by their C prototypes. */
interface KoffiLibrary {
  func(declaration: string): KoffiFunction
}

/** The koffi entry point, imported only on the platform that binds a framework. */
interface Koffi {
  load(path: string): KoffiLibrary
}

/** The one CoreLocation manager this process keeps. */
interface CoreLocationManager {
  /** @returns this application's `CLAuthorizationStatus`. */
  readonly status: () => number
  /** Raise macOS's authorization alert when the application has no decision. */
  readonly request: () => void
}

let coreLocationManager: Promise<CoreLocationManager> | undefined

/**
 * Bind CoreLocation's manager through the Objective-C runtime. One manager
 * serves the process: creating it is what registers the application with
 * `locationd`, and the alert belongs to that registration.
 * @returns the process's manager.
 */
async function loadCoreLocationManager(): Promise<CoreLocationManager> {
  coreLocationManager ??= (async () => {
    const koffi = (await import('koffi')).default as unknown as Koffi
    const runtime = koffi.load(OBJC_RUNTIME)
    koffi.load(CORE_LOCATION_FRAMEWORK)
    const classNamed = runtime.func('void *objc_getClass(const char *name)')
    const selectorNamed = runtime.func('void *sel_registerName(const char *name)')
    const sendMessage = runtime.func('void *objc_msgSend(void *receiver, void *selector)')
    const sendMessageInt = runtime.func('long objc_msgSend(void *receiver, void *selector)')
    const sendMessageVoid = runtime.func('void objc_msgSend(void *receiver, void *selector)')
    const managerClass = classNamed('CLLocationManager')
    const manager = sendMessage(sendMessage(managerClass, selectorNamed('alloc')), selectorNamed('init'))
    return {
      status: () => Number(sendMessageInt(manager, selectorNamed('authorizationStatus'))),
      request: () => { sendMessageVoid(manager, selectorNamed('requestWhenInUseAuthorization')) },
    }
  })()
  return coreLocationManager
}

/**
 * Read CoreLocation's authorization status as this module's permission.
 * @param status - a `CLAuthorizationStatus` value.
 * @returns the permission the status stands for; a value this module does not
 * know says nothing about a decision, so it reads as undecided.
 */
function coreLocationPermission(status: number): SystemLocationPermission {
  switch (status) {
    case CORE_LOCATION_AUTHORIZED_ALWAYS:
    case CORE_LOCATION_AUTHORIZED_WHEN_IN_USE:
      return 'granted'
    // 1 is `restricted` and 2 is `denied`; both forbid the position outright.
    case 1:
    case 2:
      return 'denied'
    default:
      return 'not-determined'
  }
}

/**
 * Wait for the system to publish an answer to the alert it raised.
 * @param manager - the process's manager.
 * @returns the authorization status the system settled on.
 */
async function waitForDecision(manager: CoreLocationManager): Promise<number> {
  const deadline = Date.now() + AUTHORIZATION_ANSWER_TIMEOUT_MS
  let status = manager.status()
  while (status === CORE_LOCATION_NOT_DETERMINED && Date.now() < deadline) {
    await new Promise<void>((resolve) => { setTimeout(resolve, AUTHORIZATION_POLL_INTERVAL_MS) })
    status = manager.status()
  }
  return status
}

/**
 * Ask macOS for its decision, raising its alert when the application has none.
 * @returns the permission macOS reports.
 */
async function macSystemLocation(): Promise<SystemLocationPermission> {
  const manager = await loadCoreLocationManager()
  const decided = manager.status()
  if (decided !== CORE_LOCATION_NOT_DETERMINED) return coreLocationPermission(decided)
  manager.request()
  return coreLocationPermission(await waitForDecision(manager))
}

/**
 * The settings pane that carries this platform's location switch.
 * @returns the address to open, or undefined when the platform has no such pane.
 */
export function systemLocationSettingsAddress(): string | undefined {
  return SYSTEM_LOCATION_SETTINGS[process.platform]
}

/**
 * Ask the operating system whether this application may read the device
 * position, raising its one-time alert where the system decides through one.
 * @returns the system's answer, and whether a denied one is changed in a
 * settings pane the shell can open.
 */
export async function authorizeSystemLocation(): Promise<SystemLocationState> {
  const settings = systemLocationSettingsAddress() !== undefined
  if (process.platform !== 'darwin') return { permission: 'system-managed', settings }
  return { permission: await macSystemLocation(), settings }
}
