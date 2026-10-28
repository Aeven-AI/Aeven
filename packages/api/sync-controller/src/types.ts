/** JSON-safe results of the `sync` Remote namespace. */

/** Where the caller's account vault stands on this Host. */
export type SyncViewState = 'unenrolled' | 'joining' | 'offline' | 'connecting' | 'online'

/** The caller's sync status on this Host. */
export interface SyncView {
  readonly state: SyncViewState
  /** Active devices in the vault, this one included; 0 while unenrolled. */
  readonly devices: number
  /** Local changes the relay has not acknowledged yet. */
  readonly pending: number
  /** While joining, the six-digit code once an enrolled device answered. */
  readonly joinCode?: string
  /** Whether this device is currently answering join requests. */
  readonly acceptingJoins: boolean
  /** Whether the account can be restored with a recovery passkey; false while unenrolled. */
  readonly recovery: boolean
  /** The recovery passkey step in progress or failed on this Host, if any. */
  readonly passkey?: SyncPasskeyView
}

/** What a recovery passkey step does. */
export type SyncPasskeyMode =
  /** Make a new passkey the account's recovery passkey. */
  | 'setup'
  /** Add this device to the account with its recovery passkey. */
  | 'unlock'

/** A recovery passkey step on this Host. */
export interface SyncPasskeyView {
  readonly mode: SyncPasskeyMode
  /** `waiting` until the passkey page returns a result; `failed` after it could not be used or the step timed out. */
  readonly state: 'waiting' | 'failed'
}

/** Where the user continues a recovery passkey step. */
export interface SyncPasskeyStart {
  /** The passkey page, to open in the system browser. */
  readonly url: string
}

/** One of the caller's devices. */
export interface SyncDeviceView {
  readonly id: string
  /** The name the device gave itself; empty until it wrote one. */
  readonly name: string
  /** Whether this is the device the caller is using. */
  readonly current: boolean
}

/** A join request waiting for the caller's decision on this device. */
export interface SyncJoinRequestView {
  readonly id: string
  /** The six-digit code the joining device also shows. */
  readonly code: string
}
