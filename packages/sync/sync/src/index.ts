/**
 * Service Definition for account sync (`ctx.sync`): every device signed in to one account holds the same
 * documents. Consumers open a document by logical name in an owner's vault and edit its Yjs state; the
 * provider persists it locally, encrypts every change under the account key, and exchanges it with the
 * account's other devices.
 * @module @aeven/sync
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Doc } from 'yjs'
import type { DeviceId } from '@aeven/sync-vault'

/** Where one account's sync stands on this device. */
export type SyncState =
  /** The user turned sync off on this device. */
  | 'disabled'
  /** This device has not received the account key yet; documents cannot open until it connects once. */
  | 'starting'
  /** No connection to the relay; documents open and change locally and reach other devices later. */
  | 'offline'
  /** Connecting to the relay. */
  | 'connecting'
  /** Connected; the relay's backlog may still be arriving. */
  | 'online'

/** One account's sync status on this device. */
export interface SyncStatus {
  /** Current state. */
  state: SyncState
  /** This device's id; absent for an account this device has never synced. */
  device?: DeviceId
  /** Local changes not yet acknowledged by the relay. */
  pending: number
  /** Changes queued since the outbox was last empty; `queued - pending` of them reached the relay. */
  queued: number
}

/** An open document. Changes made through {@link doc} replicate until {@link close}. */
export interface SyncDocument {
  /** The live Yjs document. Remote changes apply with the provider's own transaction origin. */
  readonly doc: Doc
  /** Stop observing; the document stays stored and keeps replicating while other handles are open. */
  close(): void
}

/** A device of the account as Settings lists it. */
export interface SyncDevice {
  /** The device id. */
  readonly id: DeviceId
  /** The name the device gave itself, such as its host name; empty until it has written one. */
  readonly name: string
  /** Whether this is the device answering. */
  readonly current: boolean
}

/** One batch of a stream as the relay stored it. */
export interface SyncStreamBatch {
  /** The relay's sequence number; pass the last one as `after` to read on. */
  readonly seq: number
  /** The decrypted payload. */
  readonly payload: Uint8Array
}

/** The relay's decision on one device's exclusive work. */
export interface SyncLease {
  /** Whether this device holds the lease. */
  granted: boolean
  /** The device that currently holds it. */
  holder: DeviceId
  /** Expiry according to the relay's clock, in milliseconds since the Unix epoch. */
  expiresAt: number
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
   * Turn sync on or off for the account on this device. Syncing is on by default for every account signed in on
   * this Host; turning it off keeps the local copy and stops exchanging changes until it is turned on again.
   * @param owner - the account.
   * @param enabled - whether this device syncs the account.
   */
  abstract setEnabled(owner: string, enabled: boolean): void

  /**
   * List the devices of the account that have synced, by the names they gave themselves.
   * @param owner - an account whose documents this device can open.
   * @returns the devices, this one first.
   */
  abstract devices(owner: string): Promise<SyncDevice[]>

  /**
   * The opaque id of a logical document name, the id `sync/document` reports.
   * @param owner - an account whose documents this device can open.
   * @param name - the logical name.
   * @returns the opaque id.
   */
  abstract documentId(owner: string, name: string): string

  /**
   * Open a document of an account whose key this device holds, loading its local state first.
   * @param owner - the account.
   * @param name - logical name, such as `settings/account`; never sent to the relay.
   * @returns the open document.
   */
  abstract openDocument(owner: string, name: string): Promise<SyncDocument>

  /**
   * List the documents this device holds state for, so a Consumer that mirrors many documents opens only those.
   * @param owner - an account whose documents this device can open.
   * @returns the opaque ids, as {@link documentId} returns them.
   */
  abstract storedDocuments(owner: string): readonly string[]

  /**
   * Queue one batch for a stream this device writes. Batches reach the relay in the order they were queued,
   * after every document change queued before them.
   * @param owner - an account whose documents this device can open.
   * @param name - the stream's logical name.
   * @param payload - the batch.
   */
  abstract appendStream(owner: string, name: string, payload: Uint8Array): Promise<void>

  /**
   * Read a stream's batches from the relay, oldest first, one page at a time. Requires a connection.
   * @param owner - an account whose documents this device can open.
   * @param name - the stream's logical name.
   * @param after - the last relay sequence number already read; 0 reads from the start.
   * @returns the next page of batches and whether more follow.
   */
  abstract readStream(owner: string, name: string, after: number): Promise<{ batches: SyncStreamBatch[]; more: boolean }>

  /**
   * Count the account's devices this device is linked to directly, outside the relay.
   * @param _owner - an account whose documents this device can open.
   * @returns the number of directly linked devices; 0 when this provider has no direct path.
   */
  linked(_owner: string): Promise<number> {
    return Promise.resolve(0)
  }

  /**
   * Receive a stream's batches as another device of the account sends them, including over a local network while
   * the relay is unreachable. A provider without a direct path between devices yields nothing.
   * @param _owner - an account whose documents this device can open.
   * @param _name - the stream's logical name.
   * @param _listener - receives each batch payload once, in the order the writing device sent it.
   * @returns a disposer that stops the subscription.
   */
  watchStream(_owner: string, _name: string, _listener: (payload: Uint8Array) => void): () => void {
    return () => {}
  }

  /**
   * Publish the local outbox and receive the relay's committed backlog before transferring exclusive work.
   * @param _owner - account whose vault must be online.
   * @returns when the outbox is acknowledged and the received documents are current.
   */
  synchronize(_owner: string): Promise<void> {
    return Promise.reject(new Error('this sync provider cannot synchronize an ownership transfer'))
  }

  /**
   * Acquire or renew exclusive work on this device. Requires an online account; an unreachable relay
   * rejects the request. Callers must stop work before renewal fails or its requested duration elapses.
   * @param owner - the account.
   * @param name - logical work name, hidden from the relay.
   * @param ttlMs - requested lifetime, bounded by the relay's deployment policy.
   * @returns the current holder and whether this device acquired the lease.
   */
  abstract acquireLease(owner: string, name: string, ttlMs: number): Promise<SyncLease>

  /**
   * Release work held by this device; another device's lease is unaffected. Requires a connection.
   * @param owner - the account.
   * @param name - logical work name.
   */
  abstract releaseLease(owner: string, name: string): Promise<void>

  /**
   * Publish a status change to `sync/status` listeners.
   * @param owner - the account whose status changed.
   */
  protected notifyStatus(owner: string): void {
    this.ctx.emit('sync/status', owner)
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

export { LeaseHolder } from './lease.ts'
export type { LeaseHolderOptions, LeaseHolderTiming } from './lease.ts'
