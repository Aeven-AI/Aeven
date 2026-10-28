/**
 * One account's vault on this device: the account key the relay hands to signed-in devices, open Yjs documents,
 * and the exchange of sealed frames with the relay. Frames are applied in relay order; the relay delivers each
 * connection's frames in sequence order, which the per-sender counter check relies on.
 */
import * as Y from 'yjs'
import { Deque } from '@aeven/deque'
import {
  fromBase64Url, opaqueIdOf, openEnvelope, proveKey, sealEnvelope, toBase64Url, verifyKeyProof,
  type DeviceId, type EnvelopeKind, type OpaqueId,
} from '@aeven/sync-vault'
import type { SyncDocument, SyncState, SyncStatus } from '@aeven/sync'
import type { SyncOffload } from './offload.ts'
import { RelayError, type RelayConnection } from './relay.ts'
import type { SyncStore } from './store.ts'

/** Relay error codes that no retry can change. */
const PERMANENT_REFUSALS: ReadonlySet<string> = new Set(['too-large', 'bad-frame'])

/** Logical name whose opaque id is the account's local-network tag. */
const LAN_TAG = 'lan/account'

/** Transaction origin of updates that arrived from other devices or local storage. */
const REMOTE = Symbol('sync-remote')

/** Thresholds the provider configures. */
export interface VaultTuning {
  /** Stored updates per document before they are merged into one. */
  compactAfter: number
  /** Frames per document since its last snapshot before this device queues a new one. */
  snapshotAfter: number
  /** Received frames opened and stored per batch; opening runs on the sync worker, storing in one transaction. */
  applyFrames: number
  /** Pause between two slices while received frames wait, in milliseconds; it bounds the share of CPU and disk catch-up takes. */
  applyPauseMs: number
  /** Frames one catch-up page asks the relay for; the next page waits until the received ones are applied. */
  pageFrames: number
  /** Shortest interval between two status notifications, in milliseconds. */
  statusMs: number
  /** Most queued frames one publish request carries. */
  publishFrames: number
  /** Most frame bytes one publish request carries; a larger single frame travels alone. */
  publishBytes: number
}

/** Settles after a real timer, so I/O, HTTP, and the agent loop run before the next slice. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

interface OpenDoc {
  doc: Y.Doc
  handles: number
}

/** Diagnostics sink for frames that are dropped rather than applied. */
export type VaultWarn = (message: string, error: unknown) => void

/** One account's vault on this device. */
export class AccountVault {
  private readonly device: DeviceId
  private relay: RelayConnection | undefined
  private state: SyncState
  private flushing: Promise<void> | undefined
  private lanSend: ((frame: Uint8Array) => void) | undefined
  private readonly streamWatchers = new Map<OpaqueId, Set<(payload: Uint8Array) => void>>()
  private readonly docs = new Map<OpaqueId, OpenDoc>()
  /** Frames the relay delivered that wait to be applied, in sequence order. */
  private readonly inbound = new Deque<{ seq: number; frame: Uint8Array }>()
  /** The highest sequence number received, applied or still waiting; the next page starts after it. */
  private received = 0
  private applying: Promise<void> | undefined
  private statusTimer: ReturnType<typeof setTimeout> | undefined
  private statusAt = 0
  /** The background catch-up of the current connection. */
  private catchingUp: Promise<void> | undefined
  /** The most changes waiting since the outbox was last empty. */
  private queued = 0
  /** Each document's compaction and snapshot, one at a time. */
  private readonly maintenance = new Map<OpaqueId, Promise<void>>()

  /**
   * @param store - the account's local store.
   * @param tuning - compaction and snapshot thresholds.
   * @param statusChanged - called whenever {@link status} may have changed.
   * @param documentChanged - called after another device's change to a document was stored.
   * @param warn - receives dropped-frame diagnostics.
   * @param offload - the provider's sync worker for opening frames and compacting documents.
   */
  constructor(
    private readonly store: SyncStore,
    private readonly tuning: VaultTuning,
    private readonly statusChanged: () => void,
    private readonly documentChanged: (id: OpaqueId) => void,
    private readonly warn: VaultWarn,
    private readonly offload: SyncOffload,
  ) {
    this.device = store.deviceId()
    this.received = store.relayCursor()
    this.state = !store.enabled() ? 'disabled' : store.accountKey() === undefined ? 'starting' : 'offline'
  }

  /**
   * Report a possible status change at most every {@link VaultTuning.statusMs}: the first change at once and the
   * last one of a burst, such as an acknowledgement per published frame, after the interval.
   */
  private changed(): void {
    if (this.statusTimer !== undefined) return
    const wait = this.statusAt + this.tuning.statusMs - Date.now()
    if (wait <= 0) {
      this.statusAt = Date.now()
      this.statusChanged()
      return
    }
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined
      this.statusAt = Date.now()
      this.statusChanged()
    }, wait)
  }

  private key(): Uint8Array | undefined {
    return this.store.enabled() ? this.store.accountKey() : undefined
  }

  private requireKey(): Uint8Array {
    const key = this.key()
    if (key === undefined) throw new Error('this device does not sync the account')
    return key
  }

  /** @returns whether this device syncs the account and holds its key, so documents can open. */
  ready(): boolean {
    return this.key() !== undefined
  }

  /** @returns whether the user lets this device sync the account. */
  enabled(): boolean {
    return this.store.enabled()
  }

  /**
   * Turn syncing on or off for this device. Turning it off keeps the local copy; turning it on again resumes
   * from where the device stopped.
   * @param enabled - whether this device syncs the account.
   */
  setEnabled(enabled: boolean): void {
    this.store.setEnabled(enabled)
    if (!enabled) this.relay?.close()
    this.setState(!enabled ? 'disabled' : this.store.accountKey() === undefined ? 'starting' : 'offline')
  }

  /** @returns the current status. */
  status(): SyncStatus {
    const pending = this.store.pending()
    this.queued = pending === 0 ? 0 : Math.max(this.queued, pending)
    return { state: this.state, device: this.device, pending, queued: this.queued }
  }

  private setState(state: SyncState): void {
    if (this.state === state) return
    this.state = state
    this.changed()
  }

  /**
   * Take the account key over a new connection, start sending queued frames, and catch up in the background.
   * @param relay - an open connection for the account.
   */
  async attach(relay: RelayConnection): Promise<void> {
    if (!this.store.enabled()) return
    this.relay = relay
    this.setState('connecting')
    const { key } = await relay.request('key.get') as { key: string }
    if (this.relay !== relay) return
    if (this.store.setAccountKey(fromBase64Url(key, 32))) {
      this.received = 0
      this.warn('sync: the relay started the account over with a new key; this device publishes its data again', undefined)
    }
    // The device is online once connected; queued frames go out and the relay's backlog arrives in the background.
    this.setState('online')
    void this.flush()
    this.catchingUp = this.catchUp(relay).catch((error: unknown) => {
      // The connection loop reconnects after a dropped connection; the next attach resumes from the stored cursor.
      if (this.relay === relay) this.warn('sync: catching up with the relay failed', error)
    })
  }

  /**
   * Take the relay's backlog one page at a time: each page is requested only after the frames of the previous one
   * were applied, so a long history never sits in memory or on the event loop at once. The last page also
   * subscribes the connection to frames published from then on. A relay that ignores the page size pushes the
   * whole backlog and answers without `more`; its frames are applied the same way.
   * @param relay - the open connection.
   */
  private async catchUp(relay: RelayConnection): Promise<void> {
    for (;;) {
      await this.applied()
      if (this.relay !== relay) return
      const answer = await relay.request('sync', { since: Math.max(this.received, this.store.relayCursor()), limit: this.tuning.pageFrames })
      if (answer.more !== true) break
    }
    await this.applied()
  }

  /** @returns when every received frame is applied. */
  private async applied(): Promise<void> {
    while (this.applying !== undefined) await this.applying
  }

  /** The relay connection closed. */
  detach(): void {
    this.relay = undefined
    if (this.store.enabled()) this.setState(this.store.accountKey() === undefined ? 'starting' : 'offline')
  }

  /**
   * Take one frame the relay delivered. It is applied in the background, in sequence order, so the socket
   * callback stays short however many frames a catch-up delivers.
   * @param seq - its relay sequence number.
   * @param frame - the sealed frame.
   */
  receiveFrame(seq: number, frame: Uint8Array): void {
    if (!this.ready()) return
    // A replayed frame fails its counter check when applied; the highest number only resumes catch-up.
    this.received = Math.max(this.received, seq)
    this.inbound.pushBack({ seq, frame })
    this.applying ??= this.applyInbound().finally(() => { this.applying = undefined })
  }

  private async applyInbound(): Promise<void> {
    while (this.inbound.size > 0) {
      try {
        await this.applyBatch()
      } catch (error) {
        // Frames taken from the queue were not stored; reconnecting replays them from the stored cursor.
        this.warn('sync: applying received frames failed; catching up again', error)
        this.inbound.clear()
        this.received = this.store.relayCursor()
        this.relay?.close()
        return
      }
      // A single live frame applies at once; a backlog leaves the CPU and the disk to the rest of the Host between batches.
      if (this.inbound.size > 0) await pause(this.tuning.applyPauseMs)
    }
  }

  /** Open one batch of received frames on the sync worker and store what it opened in one transaction. */
  private async applyBatch(): Promise<void> {
    const key = this.key()
    if (key === undefined) {
      this.inbound.clear()
      return
    }
    const frames: Array<{ seq: number; frame: Uint8Array }> = []
    for (let next = this.inbound.popFront(); next !== undefined; next = this.inbound.popFront()) {
      frames.push(next)
      if (frames.length >= this.tuning.applyFrames) break
    }
    const opened = await this.offload.open(frames, key)
    const applied = new Map<OpaqueId, Uint8Array[]>()
    this.store.transaction(() => {
      for (const result of opened) {
        if ('error' in result) {
          this.warn(`sync: dropped relay frame ${String(result.seq)}`, new Error(result.error))
          continue
        }
        const { header, payload } = result
        const apply = header.device !== this.device && (header.kind === 'update' || header.kind === 'snapshot')
        if (!apply || !this.store.acceptCounter(header.device, header.id, header.counter)) continue
        this.store.appendDocUpdate(header.id, payload)
        applied.set(header.id, [...applied.get(header.id) ?? [], payload])
      }
      this.store.setRelayCursor((frames.at(-1) as { seq: number }).seq)
    })
    for (const [id, updates] of applied) {
      const open = this.docs.get(id)
      if (open !== undefined) for (const update of updates) Y.applyUpdate(open.doc, update, REMOTE)
      this.afterAppend(id, updates.length)
      this.documentChanged(id)
    }
  }

  /**
   * The opaque id of a logical document name.
   * @param name - the logical name.
   * @returns the id the relay and `sync/document` use.
   */
  documentId(name: string): OpaqueId {
    return opaqueIdOf(this.requireKey(), name)
  }

  /**
   * Open a document by logical name.
   * @param name - the logical name.
   * @returns a handle on the live document.
   */
  openDocument(name: string): SyncDocument {
    const id = this.documentId(name)
    let open = this.docs.get(id)
    if (open === undefined) {
      const doc = new Y.Doc()
      for (const update of this.store.docUpdates(id)) Y.applyUpdate(doc, update, REMOTE)
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== REMOTE) this.localUpdate(id, update)
      })
      open = { doc, handles: 0 }
      this.docs.set(id, open)
    }
    open.handles += 1
    const handle = open
    let closed = false
    return {
      doc: handle.doc,
      close: () => {
        if (closed) return
        closed = true
        handle.handles -= 1
        if (handle.handles > 0) return
        this.docs.delete(id)
        handle.doc.destroy()
      },
    }
  }

  /**
   * Queue one stream batch behind every frame already queued.
   * @param name - the stream's logical name.
   * @param payload - the batch.
   */
  appendStream(name: string, payload: Uint8Array): void {
    const id = this.documentId(name)
    const frame = this.seal('stream', id, payload)
    this.store.enqueue(frame)
    this.lanSend?.(frame)
    this.changed()
    void this.flush()
  }

  /**
   * Receive the batches another device of the account sends directly on the local network.
   * @param name - the stream's logical name.
   * @param listener - receives each batch payload once, in the order the writing device sent it.
   * @returns a disposer that stops the subscription.
   */
  watchStream(name: string, listener: (payload: Uint8Array) => void): () => void {
    const id = this.documentId(name)
    const listeners = this.streamWatchers.get(id) ?? new Set()
    this.streamWatchers.set(id, listeners)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.streamWatchers.delete(id)
    }
  }

  /**
   * Fetch and open a page of a stream's batches.
   * @param name - the stream's logical name.
   * @param after - the last relay sequence number already read.
   * @returns the opened batches and whether more follow.
   */
  async readStream(name: string, after: number): Promise<{ batches: Array<{ seq: number; payload: Uint8Array }>; more: boolean }> {
    const relay = this.relay
    if (relay === undefined) throw new Error('reading a stream needs a connection to the relay')
    const { frames, more } = await relay.request('stream.get', { id: this.documentId(name), after }) as { frames: Array<{ seq: number; frame: string }>; more: boolean }
    const key = this.requireKey()
    const batches = frames.map(({ seq, frame }) => ({ seq, payload: openEnvelope(new Uint8Array(Buffer.from(frame, 'base64url')), key).payload }))
    return { batches, more }
  }

  private seal(kind: EnvelopeKind, id: OpaqueId, payload: Uint8Array): Uint8Array {
    return sealEnvelope({ kind, id, accountKey: this.requireKey(), device: this.device, counter: this.store.nextCounter(id), payload })
  }

  private localUpdate(id: OpaqueId, update: Uint8Array): void {
    const frame = this.seal('update', id, update)
    this.store.transaction(() => {
      this.store.appendDocUpdate(id, update)
      this.store.enqueue(frame)
    })
    this.lanSend?.(frame)
    this.afterAppend(id)
    this.changed()
    void this.flush()
  }

  /**
   * Also send every local update frame to the account's devices linked on the local network.
   * @param send - delivers a frame to the linked devices; undefined stops sending.
   */
  setLanSender(send: ((frame: Uint8Array) => void) | undefined): void {
    this.lanSend = send
  }

  /** @returns the account's opaque local-network tag, the same on every device of the account. */
  lanTag(): string {
    return this.documentId(LAN_TAG)
  }

  /** @returns this device's id. */
  deviceId(): DeviceId {
    return this.device
  }

  /**
   * Prove holding the account key over local-network handshake bytes.
   * @param data - the bytes.
   * @returns the proof.
   */
  signLan(data: Uint8Array): Uint8Array {
    return proveKey(this.requireKey(), data)
  }

  /**
   * Check a local-network handshake proof.
   * @param _device - the claimed device; any device holding the account key belongs to the account.
   * @param data - the proven bytes.
   * @param proof - the proof.
   * @returns whether the proof was made with the account key.
   */
  verifyLan(_device: string, data: Uint8Array, proof: Uint8Array): boolean {
    const key = this.key()
    return key !== undefined && verifyKeyProof(key, data, proof)
  }

  /**
   * Apply an update frame a device linked on the local network sent. It is stored like a relay frame but
   * leaves the sender's counter alone, so the relay's copy of the same frame still passes the counter check.
   * @param frame - the sealed frame.
   */
  receiveLanFrame(frame: Uint8Array): void {
    const key = this.key()
    if (key === undefined) return
    let opened: ReturnType<typeof openEnvelope>
    try {
      opened = openEnvelope(frame, key)
    } catch (error) {
      this.warn('sync: dropped a frame from a device on the local network', error)
      return
    }
    const { header, payload } = opened
    if (header.device === this.device) return
    if (header.kind === 'stream') {
      for (const listener of this.streamWatchers.get(header.id) ?? []) listener(payload)
      return
    }
    if (header.kind !== 'update') return
    this.store.appendDocUpdate(header.id, payload)
    const open = this.docs.get(header.id)
    if (open !== undefined) Y.applyUpdate(open.doc, payload, REMOTE)
    this.documentChanged(header.id)
  }

  /**
   * Compact a document's stored updates and queue a snapshot once enough frames arrived. Both read the stored
   * updates only when their threshold is crossed and merge them on the sync worker; a document's maintenance runs
   * one pass at a time.
   * @param id - the document.
   * @param added - how many updates were just stored.
   */
  private afterAppend(id: OpaqueId, added = 1): void {
    const snapshotDue = this.store.countSinceSnapshot(id, added) > this.tuning.snapshotAfter
    if (!snapshotDue && this.store.docUpdateCount(id) <= this.tuning.compactAfter) return
    const run = (this.maintenance.get(id) ?? Promise.resolve()).then(() => this.maintain(id, snapshotDue))
    const settled = run.catch((error: unknown) => { this.warn(`sync: compacting document ${id} failed`, error) })
    this.maintenance.set(id, settled)
    void settled.then(() => { if (this.maintenance.get(id) === settled) this.maintenance.delete(id) })
  }

  private async maintain(id: OpaqueId, snapshotDue: boolean): Promise<void> {
    const key = this.key()
    if (key === undefined) return
    await this.offload.maintain({
      path: this.store.path,
      doc: id,
      compact: this.store.docUpdateCount(id) > this.tuning.compactAfter,
      ...snapshotDue
        ? { snapshot: { accountKey: key, device: this.device, counter: this.store.nextCounter(id), covers: this.store.relayCursor() } }
        : {},
    })
    if (snapshotDue) void this.flush()
  }

  /**
   * Send queued frames in order until the outbox is empty or the connection drops.
   * @returns when this flush pass ends.
   */
  flush(): Promise<void> {
    this.flushing ??= this.drain().then((emptied) => {
      this.flushing = undefined
      // A frame queued after the pass found the outbox empty, but before this point, still needs sending.
      if (emptied && this.relay !== undefined && this.store.pending() > 0) void this.flush()
    }, () => { this.flushing = undefined })
    return this.flushing
  }

  /**
   * Send the outbox in batches, each one request the relay stores in order.
   * @returns whether the pass ended with an empty outbox rather than a missing or failing relay.
   */
  private async drain(): Promise<boolean> {
    for (;;) {
      const relay = this.relay
      const queued = this.store.outbox(this.tuning.publishFrames)
      if (relay === undefined || queued.length === 0) return queued.length === 0
      const batch: typeof queued = []
      let bytes = 0
      for (const next of queued) {
        if (batch.length > 0 && bytes + next.frame.length > this.tuning.publishBytes) break
        batch.push(next)
        bytes += next.frame.length
      }
      let stored: number
      try {
        const answer = await relay.request('publish', {
          frames: batch.map(next => ({ frame: toBase64Url(next.frame), ...next.covers === undefined ? {} : { covers: next.covers } })),
        }) as { seqs: number[]; refused?: { code: string; message: string } }
        stored = answer.seqs.length
        if (answer.refused !== undefined) throw new RelayError(answer.refused.code, answer.refused.message)
      } catch (error) {
        stored ??= 0
        // A frame the relay refuses outright would block every frame behind it; it is dropped instead.
        if (error instanceof RelayError && PERMANENT_REFUSALS.has(error.code)) {
          this.warn(`sync: the relay refused a frame (${error.code}); dropping it`, error)
          stored += 1
        } else {
          this.warn('sync: publishing frames failed; they stay queued', error)
          this.acknowledge(batch, stored)
          return false
        }
      }
      this.acknowledge(batch, stored)
    }
  }

  private acknowledge(batch: ReadonlyArray<{ seq: number }>, count: number): void {
    const last = batch[count - 1]
    if (last === undefined) return
    this.store.acknowledge(last.seq)
    this.changed()
  }

  /** Wait for durable publication and a complete relay backlog before transferring a session writer. */
  async synchronize(): Promise<void> {
    const relay = this.relay
    if (relay === undefined || this.state !== 'online') throw new Error('session handover needs an online vault')
    await this.flush()
    if (this.store.pending() > 0 || this.relay !== relay) throw new Error('session handover has unpublished changes')
    await this.catchingUp
    await this.catchUp(relay)
    if (this.relay !== relay) throw new Error('session handover lost its connection')
  }

  /** Destroy open documents and wait for the active outbox pass to stop. */
  async dispose(): Promise<void> {
    if (this.statusTimer !== undefined) clearTimeout(this.statusTimer)
    this.statusTimer = undefined
    this.detach()
    // Frames not applied yet stay on the relay after the stored cursor and arrive again on the next connection.
    this.inbound.clear()
    await this.applying
    await this.catchingUp
    await Promise.all(this.maintenance.values())
    for (const open of this.docs.values()) open.doc.destroy()
    this.docs.clear()
    await this.flushing
  }
}
