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
}

/** A join request waiting for the caller's decision on this device. */
export interface SyncJoinRequestView {
  readonly id: string
  /** The six-digit code the joining device also shows. */
  readonly code: string
}
