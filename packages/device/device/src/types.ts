/**
 * Client-safe device vocabulary: hosts, devices, per-session device sessions,
 * the state snapshot the sidebar renders, settings and actions.
 *
 * Devices live on a host. Only the local host (the machine the Host runs on)
 * exists today; the host id is carried everywhere so a remote host can join
 * without changing what clients receive.
 *
 * @module @aeven/device/types
 */
import type { Branded } from '@aeven/brand'
import type { SessionId } from '@aeven/session/types'
import type {} from '@aeven/typert-protocol'

/** The two simulator families a host can run. */
export type DevicePlatform = 'ios' | 'android'

/** A machine with simulators or emulators on it. */
export type DeviceHostId = Branded<'DeviceHostId'>

/** Simulator udid or adb serial; an AVD name while that emulator is not running. */
export type DeviceId = Branded<'DeviceId'>

/** One simulator or emulator a host reports. */
export interface DeviceSummary {
  readonly hostId: DeviceHostId
  readonly id: DeviceId
  readonly platform: DevicePlatform
  readonly name: string
  /** OS label such as "iOS 18.0" or "Android 15.0". */
  readonly version: string
  readonly booted: boolean
  readonly physical: boolean
}

/**
 * Whether a host can run one platform right now. A platform missing its
 * toolchain is reported with the reason rather than hidden, so the pane and
 * the model can explain an absent platform instead of showing an empty list.
 */
export interface DevicePlatformAvailability {
  readonly platform: DevicePlatform
  readonly available: boolean
  readonly reason?: string
}

/** A host as clients list it. */
export interface DeviceHostSummary {
  readonly id: DeviceHostId
  readonly kind: 'local'
  readonly label: string
  readonly platforms: readonly DevicePlatformAvailability[]
  /** Whether the streaming hub's pinned version is installed. */
  readonly hubInstalled: boolean
  /** Whether the agent driver's pinned version is installed. */
  readonly agentInstalled: boolean
}

/**
 * Lifecycle of a host's helper processes. Tools install on first use, so a
 * fresh machine spends a while in `installing` before any device can stream.
 */
export type DeviceHostStatus = 'disabled' | 'idle' | 'installing' | 'starting' | 'ready' | 'failed'

/** One host's lifecycle and the text that explains it. */
export interface DeviceHostState {
  readonly status: DeviceHostStatus
  readonly detail?: string
}

/**
 * A device a session is looking at. One per (session, host, device); the same
 * device may be open in several sessions, since its stream is shared.
 */
export interface DeviceSession {
  readonly sessionId: SessionId
  readonly hostId: DeviceHostId
  readonly deviceId: DeviceId
  readonly platform: DevicePlatform
  /** ISO timestamp of the open. */
  readonly openedAt: string
}

/** A device being booted for a session, shown while the boot runs. */
export interface DeviceBooting extends DeviceSummary {
  readonly sessionId: SessionId
}

/** Everything the device pane renders, published on every change. */
export interface DeviceServiceState {
  readonly hosts: readonly DeviceHostSummary[]
  /** The whole service: `disabled` until the user enables device support. */
  readonly status: DeviceHostStatus
  /** Why the service is in its status; absent once the reason clears. */
  readonly statusDetail?: string | undefined
  readonly hostStates: Readonly<Record<string, DeviceHostState>>
  readonly devices: readonly DeviceSummary[]
  readonly sessions: readonly DeviceSession[]
  readonly booting: readonly DeviceBooting[]
  readonly onboardingCompleted: boolean
  readonly agentAccessEnabled: boolean
  /** Origin-relative path the client prefixes to hub routes. */
  readonly hubBasePath: string
  /** Increments on every published change. */
  readonly revision: number
}

/** The consent switches the setup flow and the pane change. */
export interface DeviceConfigureRequest {
  readonly enabled?: boolean
  readonly agentAccessEnabled?: boolean
  readonly onboardingCompleted?: boolean
}

/** Open one device for a session, booting it unless `boot` is false. */
export interface DeviceOpenRequest {
  readonly hostId?: DeviceHostId
  readonly deviceId: DeviceId
  readonly platform: DevicePlatform
  readonly boot?: boolean
}

/** Close a session's device sessions; omit `deviceId` to close them all. */
export interface DeviceCloseRequest {
  readonly hostId?: DeviceHostId
  readonly deviceId?: DeviceId
  /** Also power the simulator or emulator off. */
  readonly shutdown?: boolean
}

/** Addresses one device. */
export interface DeviceTarget {
  readonly hostId?: DeviceHostId
  readonly deviceId: DeviceId
}

/** Light or dark system appearance. */
export type DeviceAppearance = 'light' | 'dark'

/**
 * iOS content-size categories span twelve steps and Android `font_scale` is
 * continuous; four shared steps cover what people reach for.
 */
export type DeviceTextSize = 'small' | 'default' | 'large' | 'extra-large'

/** iOS display color filters. */
export type DeviceColorFilter = 'none' | 'grayscale' | 'red-green' | 'green-red' | 'blue-yellow'

/** Screen orientation, in the order a rotate control cycles. */
export type DeviceOrientation = 'portrait' | 'landscape_left' | 'portrait_upside_down' | 'landscape_right'

/** Settings a toggle action flips; each platform supports a subset. */
export type DeviceToggleSetting =
  | 'reduceMotion' | 'increaseContrast' | 'reduceTransparency' | 'showBorders' | 'voiceOver' | 'networkEnabled'

/** Current values read from the device; an absent field is unsupported or unread. */
export interface DeviceSettings {
  readonly appearance?: DeviceAppearance
  readonly textSize?: DeviceTextSize
  readonly reduceMotion?: boolean
  readonly increaseContrast?: boolean
  readonly reduceTransparency?: boolean
  readonly showBorders?: boolean
  readonly voiceOver?: boolean
  readonly liquidGlass?: 'clear' | 'tinted'
  readonly colorFilter?: DeviceColorFilter
  readonly networkEnabled?: boolean
}

/** The app in the foreground, when the platform reports it. */
export interface DeviceForegroundApp {
  readonly id: string
  readonly name?: string
}

/** A device's settings and foreground app at one moment. */
export interface DeviceDetail {
  readonly hostId: DeviceHostId
  readonly deviceId: DeviceId
  readonly settings: DeviceSettings
  readonly foregroundApp: DeviceForegroundApp | null
  /** ISO timestamp of the read. */
  readonly readAt: string
}

/** App permissions the permission action can decide. */
export type DevicePermission =
  | 'camera' | 'microphone' | 'photos' | 'contacts' | 'calendar' | 'reminders'
  | 'location' | 'notifications' | 'motion' | 'media-library' | 'faceid'

/** One setting change or one-shot action, without its device address. */
export type DeviceActionBody =
  | { readonly type: 'setAppearance'; readonly value: DeviceAppearance }
  | { readonly type: 'setTextSize'; readonly value: DeviceTextSize }
  | { readonly type: 'setToggle'; readonly setting: DeviceToggleSetting; readonly value: boolean }
  | { readonly type: 'setLiquidGlass'; readonly value: 'clear' | 'tinted' }
  | { readonly type: 'setColorFilter'; readonly value: DeviceColorFilter }
  | { readonly type: 'setOrientation'; readonly value: DeviceOrientation }
  | { readonly type: 'setLocation'; readonly latitude: number; readonly longitude: number }
  | { readonly type: 'clearLocation' }
  | {
    readonly type: 'setPermission'
    readonly appId: string
    readonly permission: DevicePermission
    readonly decision: 'grant' | 'revoke' | 'reset'
  }
  | { readonly type: 'openUrl'; readonly url: string }
  | { readonly type: 'launchApp'; readonly appId: string }
  | { readonly type: 'terminateApp'; readonly appId: string }
  | { readonly type: 'sendPush'; readonly appId: string; readonly payload: string }

/** An action addressed to one device. */
export type DeviceActionRequest = DeviceTarget & DeviceActionBody

/** The action tag vocabulary. */
export type DeviceActionType = DeviceActionBody['type']

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Device support is off until the user enables it in the device pane. */
    'device/disabled': Record<string, never>
    /** A host is unknown, failed to start its helpers, or changed mid-request. */
    'device/host-unavailable': { readonly hostId: string }
    /** A host lacks one platform's toolchain. */
    'device/platform-unavailable': { readonly hostId: string; readonly platform: DevicePlatform }
    /** No such device on the host. */
    'device/not-found': { readonly hostId: string; readonly deviceId: string }
    /** A simulator or emulator did not boot. */
    'device/boot-failed': { readonly deviceId: string; readonly reason: 'disk_space' | 'timeout' | 'launch_failed' }
    /** A host command or hub request failed. */
    'device/operation-failed': { readonly operation: string }
    /** The action is unsupported on the platform, or a helper it needs is missing. */
    'device/action-unavailable': { readonly operation: string; readonly platform: DevicePlatform; readonly reason: 'unsupported' | 'helper_missing' }
  }
}
