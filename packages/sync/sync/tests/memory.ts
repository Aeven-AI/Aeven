/**
 * In-memory account sync for Consumer tests: devices on one network share documents and streams the way the
 * provider would, without keys or a relay. Each device keeps its own copy of every document it opened; a
 * change reaches the other devices' copies as a remote transaction and fires their `documentChanged`. An
 * offline device queues its changes until it comes back.
 */
import * as Y from 'yjs'
import type { DeviceId } from '@aeven/sync-vault'
import type { Sync, SyncDocument, SyncLease, SyncState, SyncStatus, SyncStreamBatch } from '../src/index.ts'

const REMOTE = Symbol('memory-sync-remote')

/** A shared network of devices of one account. */
export class MemorySyncNetwork {
  readonly devices: MemorySyncDevice[] = []
  readonly streams = new Map<string, SyncStreamBatch[]>()
  readonly leases = new Map<string, { holder: string; expiresAt: number }>()
  /** Clock leases expire by. */
  now: () => number = Date.now
  private seq = 0

  /**
   * Add a device to the network.
   * @param state - its starting state.
   * @returns the device.
   */
  device(state: SyncState = 'online'): MemorySyncDevice {
    const device = new MemorySyncDevice(this, `device-${String(this.devices.length + 1)}`, state)
    this.devices.push(device)
    return device
  }

  /** @returns the next relay sequence number. */
  nextSeq(): number {
    return ++this.seq
  }

  /**
   * Deliver a document update to every other online device.
   * @param from - the device that made it.
   * @param name - the document.
   * @param update - the Yjs update.
   */
  broadcast(from: MemorySyncDevice, name: string, update: Uint8Array): void {
    for (const device of this.devices) if (device !== from) device.receive(name, update)
  }
}

/** One device; pass `asSync()` where a Consumer expects `ctx.sync`. */
export class MemorySyncDevice {
  /** Called with the opaque id of a document another device changed. */
  documentChanged: ((id: string) => void) | undefined
  private readonly docs = new Map<string, Y.Doc>()
  private readonly outbox: Array<{ name: string; update: Uint8Array }> = []
  private readonly inbox: Array<{ name: string; update: Uint8Array }> = []

  /**
   * @param network - the shared network.
   * @param id - the device id.
   * @param state - the starting state.
   */
  constructor(private readonly network: MemorySyncNetwork, readonly id: string, public state: SyncState) {}

  private docOf(name: string): Y.Doc {
    let doc = this.docs.get(name)
    if (doc === undefined) {
      doc = new Y.Doc()
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === REMOTE) return
        if (this.state === 'online') this.network.broadcast(this, name, update)
        else this.outbox.push({ name, update })
      })
      this.docs.set(name, doc)
      // Like the relay's backlog, a document opened late starts from what online devices already hold.
      if (this.state === 'online') {
        for (const other of this.network.devices) {
          const held = other.state === 'online' ? other.docs.get(name) : undefined
          if (other !== this && held !== undefined) Y.applyUpdate(doc, Y.encodeStateAsUpdate(held), REMOTE)
        }
      }
    }
    return doc
  }

  /**
   * Apply another device's update, or hold it while offline.
   * @param name - the document.
   * @param update - the update.
   */
  receive(name: string, update: Uint8Array): void {
    if (this.state !== 'online') {
      this.inbox.push({ name, update })
      return
    }
    Y.applyUpdate(this.docOf(name), update, REMOTE)
    this.documentChanged?.(`id:${name}`)
  }

  /**
   * Change connectivity; coming online exchanges everything held meanwhile.
   * @param state - the new state.
   */
  setState(state: SyncState): void {
    this.state = state
    if (state !== 'online') return
    for (const { name, update } of this.outbox.splice(0)) this.network.broadcast(this, name, update)
    for (const { name, update } of this.inbox.splice(0)) this.receive(name, update)
  }

  /** @returns this device as the `ctx.sync` surface Consumers use. */
  asSync(): Sync {
    const surface = {
      status: (): SyncStatus => {
        const status: SyncStatus = { state: this.state, devices: this.network.devices.length, pending: this.outbox.length, recovery: false }
        return this.state === 'unenrolled' ? status : { ...status, device: this.id as DeviceId }
      },
      synchronize: (): Promise<void> => this.state === 'online' ? Promise.resolve() : Promise.reject(new Error('offline')),
      documentId: (_owner: string, name: string): string => `id:${name}`,
      openDocument: (_owner: string, name: string): Promise<SyncDocument> => Promise.resolve({ doc: this.docOf(name), close: () => {} }),
      appendStream: (_owner: string, name: string, payload: Uint8Array): Promise<void> => {
        const batches = this.network.streams.get(name) ?? []
        batches.push({ seq: this.network.nextSeq(), payload })
        this.network.streams.set(name, batches)
        return Promise.resolve()
      },
      acquireLease: (_owner: string, name: string, ttlMs: number): Promise<SyncLease> => {
        if (this.state !== 'online') return Promise.reject(new Error('exclusive sync work needs a connection'))
        const held = this.network.leases.get(name)
        const now = this.network.now()
        if (held !== undefined && held.holder !== this.id && held.expiresAt > now) {
          return Promise.resolve({ granted: false, holder: held.holder as DeviceId, expiresAt: held.expiresAt })
        }
        this.network.leases.set(name, { holder: this.id, expiresAt: now + ttlMs })
        return Promise.resolve({ granted: true, holder: this.id as DeviceId, expiresAt: now + ttlMs })
      },
      releaseLease: (_owner: string, name: string): Promise<void> => {
        if (this.state !== 'online') return Promise.reject(new Error('exclusive sync work needs a connection'))
        if (this.network.leases.get(name)?.holder === this.id) this.network.leases.delete(name)
        return Promise.resolve()
      },
      readStream: (_owner: string, name: string, after: number): Promise<{ batches: SyncStreamBatch[]; more: boolean }> => {
        if (this.state !== 'online') return Promise.reject(new Error('reading a stream needs a connection to the relay'))
        const pending = (this.network.streams.get(name) ?? []).filter(batch => batch.seq > after)
        return Promise.resolve({ batches: pending.slice(0, 2), more: pending.length > 2 })
      },
    }
    return surface as unknown as Sync
  }
}
