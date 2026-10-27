/**
 * Service Definition for account sync (`ctx.sync`): every device signed in to one account holds the same
 * documents. Consumers open a document by logical name in an owner's vault and edit its Yjs state; the
 * provider persists it locally, encrypts every change end to end, and exchanges it with the account's other
 * devices.
 * @module @aeven/sync
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Doc } from 'yjs'
import type { DeviceId } from '@aeven/sync-vault'

/** Where one account's vault stands on this device. */
export type SyncState =
  /** This device holds no vault for the account. */
  | 'unenrolled'
  /** This device asked the account's enrolled devices to admit it and waits for approval. */
  | 'joining'
  /** Enrolled; no connection to the relay, such as while no client of the account holds a session. */
  | 'offline'
  /** Enrolled; connecting or catching up. */
  | 'connecting'
  /** Enrolled, connected, and caught up. */
  | 'online'

/** One account's sync status on this device. */
export interface SyncStatus {
  /** Current state. */
  state: SyncState
  /** This device's id in the account's vault, once enrolled. */
  device?: DeviceId
  /** Active devices in the vault, this one included; 0 while unenrolled. */
  devices: number
  /** Local changes not yet acknowledged by the relay. */
  pending: number
  /** While joining, the six-digit code once an enrolled device answered. */
  joinCode?: string
}

/** An open document. Changes made through {@link doc} replicate until {@link close}. */
export interface SyncDocument {
  /** The live Yjs document. Remote changes apply with the provider's own transaction origin. */
  readonly doc: Doc
  /** Stop observing; the document stays stored and keeps replicating while other handles are open. */
  close(): void
}

/** A join in progress on the device that asked to join. */
export interface SyncJoin {
  /** The six-digit code, once an enrolled device answered; the user compares it with the code that device shows. */
  readonly code: Promise<string>
  /** Settles once an enrolled device admitted this one; rejects when the join is cancelled. */
  readonly admitted: Promise<void>
  /** Abandon the join. */
  cancel(): void
}

/** A request to join that an enrolled device received and the user has not decided yet. */
export interface SyncJoinRequest {
  /** Request id, unique on this device. */
  id: string
  /** The six-digit code the joining device also shows. */
  code: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sync: Sync
  }

  interface Events {
    /**
     * An account's sync status changed.
     * @mode emit
     * @param owner - the account whose status changed.
     * @avnScopeScan unsupported
     */
    'sync/status'(owner: string): void
    /**
     * The join requests waiting for a decision on this device changed.
     * @mode emit
     * @param owner - the account.
     * @avnScopeScan unsupported
     */
    'sync/join-requests'(owner: string): void
    /**
     * Another device's change to a document was stored on this device; open the document by name to read it.
     * @mode emit
     * @param owner - the account.
     * @param id - the document's opaque id, as {@link Sync.documentId} returns it.
     * @avnScopeScan unsupported
     */
    'sync/document'(owner: string, id: string): void
  }
}

/** Account sync capability. */
export abstract class Sync extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sync')
  }

  /**
   * Read one account's status on this device.
   * @param owner - the account.
   * @returns the current status.
   */
  abstract status(owner: string): SyncStatus

  /**
   * Ask the relay whether the account already has a vault, so a device not enrolled yet knows whether to
   * create one or join it. Requires a signed-in session for the account.
   * @param owner - the account.
   * @returns whether a vault exists.
   */
  abstract vaultExists(owner: string): Promise<boolean>

  /**
   * Create the account's vault with this device as its first member. Fails when this device is already
   * enrolled or the relay already holds a vault for the account.
   * @param owner - the account.
   */
  abstract createVault(owner: string): Promise<void>

  /**
   * Ask the account's enrolled devices to admit this device. Requires a signed-in session for the account and
   * a vault this device is not enrolled in.
   * @param owner - the account.
   * @returns the join in progress.
   */
  abstract join(owner: string): Promise<SyncJoin>

  /**
   * Answer join requests from new devices while the user has this device's add-device screen open. Opening it
   * also asks a device that is already waiting to repeat its request.
   * @param owner - the account.
   * @returns a function that stops answering for this caller.
   */
  abstract acceptJoins(owner: string): () => void

  /**
   * List join requests waiting for the user on this enrolled device.
   * @param owner - the account.
   * @returns the pending requests.
   */
  abstract joinRequests(owner: string): readonly SyncJoinRequest[]

  /**
   * Admit the device behind a join request after the user confirmed both devices show the same code.
   * @param owner - the account.
   * @param id - the request id.
   */
  abstract approveJoin(owner: string, id: string): Promise<void>

  /**
   * Discard a join request.
   * @param owner - the account.
   * @param id - the request id.
   */
  abstract rejectJoin(owner: string, id: string): void

  /**
   * The opaque id of a logical document name, the id `sync/document` reports.
   * @param owner - an enrolled account.
   * @param name - the logical name.
   * @returns the opaque id.
   */
  abstract documentId(owner: string, name: string): string

  /**
   * Open a document in an enrolled account's vault, loading its local state first.
   * @param owner - the account.
   * @param name - logical name, such as `settings/account`; never sent to the relay.
   * @returns the open document.
   */
  abstract openDocument(owner: string, name: string): Promise<SyncDocument>

  /**
   * Publish a status change to `sync/status` listeners.
   * @param owner - the account whose status changed.
   */
  protected notifyStatus(owner: string): void {
    this.ctx.emit('sync/status', owner)
  }

  /**
   * Publish a change of pending join requests to `sync/join-requests` listeners.
   * @param owner - the account.
   */
  protected notifyJoinRequests(owner: string): void {
    this.ctx.emit('sync/join-requests', owner)
  }

  /**
   * Publish a stored remote document change to `sync/document` listeners.
   * @param owner - the account.
   * @param id - the document's opaque id.
   */
  protected notifyDocument(owner: string, id: string): void {
    this.ctx.emit('sync/document', owner, id)
  }
}

export default Sync
