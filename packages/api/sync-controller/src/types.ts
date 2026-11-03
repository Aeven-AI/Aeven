/** JSON-safe results of the `sync` Remote namespace. */

/** Where the caller's account sync stands on this Host. */
export type SyncViewState = 'disabled' | 'starting' | 'offline' | 'connecting' | 'online'

/** Who holds the caller's account key. */
export interface SyncProtectionView {
  /** `server` while the Aeven relay holds the key, `passkey` once only the user's passkeys and devices do. */
  readonly mode: 'server' | 'passkey'
  /** The key is held by passkeys and this device has not unlocked it yet. */
  readonly locked: boolean
  /** The relay holds the key again although this device last saw a passkey hold it; syncing waits for the user. */
  readonly downgraded: boolean
  /** How many passkeys hold the key. */
  readonly passkeys: number
}

/** What a passkey step does with the passkey. */
export type SyncPasskeyPurpose =
  /** Create a passkey and move the account key onto it. */
  | 'protect'
  /** Create one more passkey that also holds the key. */
  | 'add'
  /** Unlock this device with one of the account's passkeys. */
  | 'unlock'

/** A passkey step this Host waits for, or one that did not finish. */
export interface SyncPasskeyView {
  readonly purpose: SyncPasskeyPurpose
  /**
   * `waiting` while the browser page runs, `failed` when the step timed out or its result did not work, and
   * `unsupported` when the browser or passkey provider cannot derive a key from the passkey.
   */
  readonly state: 'waiting' | 'failed' | 'unsupported'
}

/** The page a passkey step opens. */
export interface SyncPasskeyStart {
  /** The passkey page on the Aeven site, to open in the system browser. */
  readonly url: string
}

/** The caller's sync status on this Host. */
export interface SyncView {
  readonly state: SyncViewState
  /** True while relay history or received frames are being applied; absent when none are pending. */
  readonly catchingUp?: boolean
  /** The failed transfer; queued local changes remain stored until publication succeeds. */
  readonly error?: 'upload' | 'download'
  /** Local changes the relay has not acknowledged yet. */
  readonly pending: number
  /** Changes queued since the outbox was last empty; `queued - pending` of them are sent. */
  readonly queued: number
  /** Conversations discovered but not yet fully queued for upload. */
  readonly sessionsPending: number
  /** Conversations in the current publication pass, including those already queued. */
  readonly sessionsTotal: number
  /** Who holds the account key; absent until this device has read it from the relay. */
  readonly protection?: SyncProtectionView
  /** The passkey step in progress or the last one that did not finish. */
  readonly passkey?: SyncPasskeyView
}

/** One of the caller's devices. */
export interface SyncDeviceView {
  readonly id: string
  /** The name the device gave itself; empty until it wrote one. */
  readonly name: string
  /** Whether this is the device the caller is using. */
  readonly current: boolean
}
