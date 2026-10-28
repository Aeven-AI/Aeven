/** JSON-safe results of the `sync` Remote namespace. */

/** Where the caller's account sync stands on this Host. */
export type SyncViewState = 'disabled' | 'starting' | 'offline' | 'connecting' | 'online'

/** The caller's sync status on this Host. */
export interface SyncView {
  readonly state: SyncViewState
  /** Local changes the relay has not acknowledged yet. */
  readonly pending: number
  /** Changes queued since the outbox was last empty; `queued - pending` of them are sent. */
  readonly queued: number
}

/** One of the caller's devices. */
export interface SyncDeviceView {
  readonly id: string
  /** The name the device gave itself; empty until it wrote one. */
  readonly name: string
  /** Whether this is the device the caller is using. */
  readonly current: boolean
}
