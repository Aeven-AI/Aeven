/**
 * One account's vault on this device: the account key, held by the relay or unwrapped from one of the user's
 * passkeys, open Yjs documents, and the exchange of sealed frames with the relay. Frames are applied in relay order;
 * the relay delivers each connection's frames in sequence order, which the per-sender counter check relies on.
 */
import * as Y from 'yjs'
import { Deque } from '@aeven/deque'
import {
  fromBase64Url, generateVaultKey, keyIdOf, derivedSecretOf, opaqueIdOf, openEnvelope, proveKey, sealEnvelope, toBase64Url,
  unwrapUnderPasskey, verifyKeyProof, wrapUnderPasskey,
  type DeviceId, type EnvelopeKind, type KeyId, type OpaqueId,
} from '@aeven/sync-vault'
import type { SyncDocument, SyncKeyMode, SyncPasskey, SyncProtection, SyncState, SyncStatus } from '@aeven/sync'
import type { SyncOffload } from './offload.ts'
import { publishFrameLimit, publishRequestBytes, type PublishFrame, type RelayConnection, RelayError } from './relay.ts'
import { prepareFrame } from './frames.ts'
import type { SyncStore } from './store.ts'

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
  /** Maximum complete publish request bytes, including base64url and JSON. */
  publishBytes: number
  /**
   * Logical names of documents fetched before the rest of the backlog when this device holds no state for them,
   * such as the conversation and workspace lists a client shows first.
   */
  firstDocuments: readonly string[]
}

/** The account key state `key.get` answers. */
type RelayKeyState =
  | { readonly mode: 'server'; readonly key: Uint8Array; readonly keyId: KeyId }
  | { readonly mode: 'passkey'; readonly keyId: KeyId; readonly passkeys: ReadonlyArray<{ readonly id: string; readonly wrapped: string }> }

const BASE64URL = /^[A-Za-z0-9_-]+$/

/**
 * Validate the relay's `key.get` answer.
 * @param answer - the answer fields.
 * @returns the key state.
 * @throws {Error} when the answer is malformed.
 */
function parseKeyState(answer: Record<string, unknown>): RelayKeyState {
  const { mode, keyId } = answer
  if (typeof keyId !== 'string' || !BASE64URL.test(keyId)) throw new Error('the relay named no key id')
  if (mode === 'server' || (mode === undefined && typeof answer.key === 'string')) {
    if (typeof answer.key !== 'string') throw new Error('the relay sent no key')
    const key = fromBase64Url(answer.key, 32)
    if (keyIdOf(key) !== keyId) throw new Error('the relay sent a key that does not match its id')
    return { mode: 'server', key, keyId: keyId as KeyId }
  }
  const { passkeys } = answer
  if (mode !== 'passkey' || !Array.isArray(passkeys) || passkeys.length === 0) throw new Error('the relay sent an unknown key state')
  for (const entry of passkeys as unknown[]) {
    const fields = entry as { id?: unknown; wrapped?: unknown } | null
    if (typeof fields?.id !== 'string' || typeof fields.wrapped !== 'string') throw new Error('the relay sent a malformed passkey')
  }
  return { mode: 'passkey', keyId: keyId as KeyId, passkeys: passkeys as Array<{ id: string; wrapped: string }> }
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
  /** The connection exchanging frames: set once this device holds the key the relay names. */
  private relay: RelayConnection | undefined
  /** The open connection, including one that waits for the user to unlock or confirm the key. */
  private connection: RelayConnection | undefined
  /** The key state the relay last answered. */
  private relayKey: RelayKeyState | undefined
  private protection: SyncProtection | undefined
  private error: 'upload' | 'download' | undefined
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
   * @param startedOver - called after the account's documents were dropped because its key changed.
   */
  constructor(
    private readonly store: SyncStore,
    private readonly tuning: VaultTuning,
    private readonly statusChanged: () => void,
    private readonly documentChanged: (id: OpaqueId) => void,
    private readonly warn: VaultWarn,
    private readonly offload: SyncOffload,
    private readonly startedOver: () => void,
  ) {
    this.device = store.deviceId()
    this.received = store.relayCursor()
    this.state = !store.enabled() ? 'disabled' : store.accountKey() === undefined ? 'starting' : 'offline'
    const mode = store.keyMode()
    if (mode !== undefined) {
      this.protection = { mode, locked: mode === 'passkey' && store.accountKey() === undefined, downgraded: false, passkeys: [] }
    }
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

  /**
   * Report whether this device holds the account key, so documents can open.
   * @returns whether the key is present.
   */
  ready(): boolean {
    return this.key() !== undefined
  }

  /**
   * Report whether the user lets this device sync the account.
   * @returns the stored preference.
   */
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
    if (!enabled) this.connection?.close()
    this.setState(!enabled ? 'disabled' : this.store.accountKey() === undefined ? 'starting' : 'offline')
  }

  /**
   * Read the current sync status.
   * @returns the state, device, and outbox counters.
   */
  status(): SyncStatus {
    const pending = this.store.pending()
    this.queued = pending === 0 ? 0 : Math.max(this.queued, pending)
    return {
      state: this.state, device: this.device, pending, queued: this.queued,
      ...this.catchingUp !== undefined || this.applying !== undefined ? { catchingUp: true } : {},
      ...this.error === undefined ? {} : { error: this.error },
      ...this.protection === undefined ? {} : { protection: this.protection },
    }
  }

  private setState(state: SyncState): void {
    if (this.state === state) return
    this.state = state
    this.changed()
  }

  /**
   * Read the account key state over a new connection. When this device holds the key the relay names it starts
   * sending queued frames and catches up in the background; otherwise it stays in `starting` until the user unlocks
   * the account with a passkey or confirms a key the relay took back.
   * @param relay - an open connection for the account.
   */
  async attach(relay: RelayConnection): Promise<void> {
    if (!this.store.enabled()) return
    this.connection = relay
    this.setState(this.ready() ? 'connecting' : 'starting')
    const state = parseKeyState(await relay.request('key.get'))
    if (this.connection !== relay) return
    this.relayKey = state
    if (state.mode === 'server') {
      // A relay that held no key while this device last saw a passkey hold it took the key back, whether another
      // device turned protection off or the relay did it on its own; the user decides before anything is sent.
      if (this.store.keyMode() === 'passkey') {
        this.protection = { mode: 'server', locked: false, downgraded: true, passkeys: [] }
        this.setState('starting')
        this.changed()
        return
      }
      this.protection = { mode: 'server', locked: false, downgraded: false, passkeys: [] }
      this.useKey(relay, state.key, 'server')
      return
    }
    this.store.setKeyMode('passkey')
    const passkeys = state.passkeys.map(({ id }) => id)
    const local = this.store.accountKey()
    if (local !== undefined && keyIdOf(local) === state.keyId) {
      this.protection = { mode: 'passkey', locked: false, downgraded: false, passkeys }
      this.goOnline(relay)
      return
    }
    // The key moved to one this device does not hold; nothing kept under the earlier one can reach the relay again.
    if (this.store.dropAccountKey()) this.restart()
    this.protection = { mode: 'passkey', locked: true, downgraded: false, passkeys }
    this.setState('starting')
    this.changed()
  }

  /** Hold `key` and exchange frames under it over `relay`. */
  private useKey(relay: RelayConnection | undefined, key: Uint8Array, mode: SyncKeyMode): void {
    if (this.store.setAccountKey(key, mode)) this.restart()
    if (relay === undefined || this.connection !== relay) {
      this.setState('offline')
      return
    }
    this.goOnline(relay)
  }

  private goOnline(relay: RelayConnection): void {
    this.relay = relay
    const catchingUp = this.catchUp(relay).then(() => {
      if (this.relay === relay && this.error === 'download') this.error = undefined
    }, (error: unknown) => {
      if (this.relay !== relay) return
      this.error = 'download'
      this.warn('sync: catching up with the relay failed', error)
      relay.close()
    }).finally(() => {
      if (this.catchingUp !== catchingUp) return
      this.catchingUp = undefined
      this.changed()
    })
    this.catchingUp = catchingUp
    this.setState('online')
    this.changed()
    void this.flush()
  }

  /** The store started over under another key: drop what was received or open under the earlier one. */
  private restart(): void {
    this.received = 0
    this.queued = 0
    this.inbound.clear()
    for (const open of this.docs.values()) open.doc.destroy()
    this.docs.clear()
    // Unthrottled: local-network links still announce and answer under the earlier key until the provider hears it.
    this.statusChanged()
    this.startedOver()
  }

  /**
   * Stop sending frames over the connection and wait for the publish in flight, so a key change requested next is
   * the last thing the relay sees under the earlier key.
   * @returns the open connection.
   */
  private async quiesce(): Promise<RelayConnection> {
    const relay = this.connection
    if (relay === undefined) throw new Error('changing the account key needs a connection to the relay')
    this.relay = undefined
    await this.flushing
    return relay
  }

  /**
   * Create a new account key held by a passkey and have the relay keep it only wrapped under that passkey.
   * @param passkey - the new passkey's credential id and PRF output.
   */
  async protect(passkey: SyncPasskey): Promise<void> {
    if (this.protection?.mode !== 'server' || this.protection.downgraded || !this.ready()) {
      throw new Error('only an account whose key the relay holds can move it to a passkey')
    }
    const relay = await this.quiesce()
    const key = generateVaultKey()
    try {
      await relay.request('key.protect', {
        keyId: keyIdOf(key),
        passkey: { id: passkey.credentialId, wrapped: wrapUnderPasskey(passkey.prf, passkey.credentialId, key) },
      })
    } catch (error) {
      if (this.connection === relay) this.goOnline(relay)
      throw error
    }
    this.protection = { mode: 'passkey', locked: false, downgraded: false, passkeys: [passkey.credentialId] }
    this.useKey(relay, key, 'passkey')
  }

  /**
   * Unwrap the account key with one of its passkeys.
   * @param passkey - the passkey's credential id and PRF output.
   * @throws {Error} when the passkey holds no copy of the key or its copy does not open.
   */
  unlock(passkey: SyncPasskey): void {
    const state = this.relayKey
    if (state?.mode !== 'passkey' || this.protection?.locked !== true) throw new Error('the account is not locked')
    const entry = state.passkeys.find(({ id }) => id === passkey.credentialId)
    if (entry === undefined) throw new Error('this passkey does not hold the account key')
    const key = unwrapUnderPasskey(passkey.prf, entry.id, state.keyId, entry.wrapped)
    this.protection = { ...this.protection, locked: false }
    this.useKey(this.connection, key, 'passkey')
  }

  /**
   * Wrap the account key under one more passkey.
   * @param passkey - the passkey's credential id and PRF output.
   */
  async addPasskey(passkey: SyncPasskey): Promise<void> {
    const key = this.unlockedPasskeyKey()
    const relay = this.requireConnection()
    const answer = await relay.request('passkey.add', {
      passkey: { id: passkey.credentialId, wrapped: wrapUnderPasskey(passkey.prf, passkey.credentialId, key) },
    })
    this.setPasskeys(answer)
  }

  /**
   * Drop one passkey's copy of the account key.
   * @param credentialId - the passkey's credential id.
   */
  async removePasskey(credentialId: string): Promise<void> {
    this.unlockedPasskeyKey()
    const answer = await this.requireConnection().request('passkey.remove', { id: credentialId })
    this.setPasskeys(answer)
  }

  /** Hand the account key back to the relay, which creates a new one. */
  async unprotect(): Promise<void> {
    this.unlockedPasskeyKey()
    const relay = await this.quiesce()
    let answer: Record<string, unknown>
    try {
      answer = await relay.request('key.unprotect')
    } catch (error) {
      if (this.connection === relay) this.goOnline(relay)
      throw error
    }
    const state = parseKeyState({ ...answer, mode: 'server' })
    if (state.mode !== 'server') throw new Error('the relay returned no key')
    this.relayKey = state
    this.protection = { mode: 'server', locked: false, downgraded: false, passkeys: [] }
    this.useKey(relay, state.key, 'server')
  }

  /** Sync under the key the relay took back from the account's passkeys. */
  acceptServerKey(): void {
    const state = this.relayKey
    if (state?.mode !== 'server' || this.protection?.downgraded !== true) throw new Error('the relay did not take the key back')
    this.protection = { mode: 'server', locked: false, downgraded: false, passkeys: [] }
    this.useKey(this.connection, state.key, 'server')
  }

  private unlockedPasskeyKey(): Uint8Array {
    const key = this.key()
    if (this.protection?.mode !== 'passkey' || this.protection.locked || key === undefined) {
      throw new Error('the account key is not held by a passkey on this device')
    }
    return key
  }

  private requireConnection(): RelayConnection {
    if (this.connection === undefined) throw new Error('changing the account passkeys needs a connection to the relay')
    return this.connection
  }

  private setPasskeys(answer: Record<string, unknown>): void {
    const { passkeys } = answer
    if (!Array.isArray(passkeys) || passkeys.some(id => typeof id !== 'string')) throw new Error('the relay returned malformed passkeys')
    if (this.protection !== undefined) this.protection = { ...this.protection, passkeys: passkeys as string[] }
    this.changed()
  }

  /**
   * Take the relay's backlog one page at a time: each page is requested only after the frames of the previous one
   * were applied, so a long history never sits in memory or on the event loop at once. The last page also
   * subscribes the connection to frames published from then on. A relay that ignores the page size pushes the
   * whole backlog and answers without `more`; its frames are applied the same way.
   * @param relay - the open connection.
   */
  private async catchUp(relay: RelayConnection): Promise<void> {
    await this.fetchFirst(relay)
    for (;;) {
      await this.applied()
      if (this.relay !== relay) return
      const answer = await relay.request('sync', { since: Math.max(this.received, this.store.relayCursor()), limit: this.tuning.pageFrames })
      if (answer.more !== true) break
    }
    await this.applied()
  }

  /**
   * Fetch the stored frames of the configured first documents this device holds no state for, and apply them
   * before the backlog. The relay cursor stays where it is: `sync` delivers the same frames again in order and the
   * replay check drops them. A relay without `docs.get` refuses the request, and catch-up proceeds as before.
   * @param relay - the open connection.
   */
  private async fetchFirst(relay: RelayConnection): Promise<void> {
    const ids = [...new Set(this.tuning.firstDocuments.map(name => this.documentId(name)))]
      .filter(id => this.store.docUpdateCount(id) === 0)
    if (ids.length === 0) return
    let after = 0
    for (;;) {
      let answer: Record<string, unknown>
      try {
        answer = await relay.request('docs.get', { ids, after })
      } catch (error) {
        if (error instanceof RelayError && error.code === 'bad-request') return
        throw error
      }
      if (this.relay !== relay) return
      const frames = (answer.frames as Array<{ seq: number; frame: string }>)
        .map(({ seq, frame }) => ({ seq, frame: new Uint8Array(Buffer.from(frame, 'base64url')) }))
      if (frames.length > 0) await this.applyFrames(frames, false)
      const last = frames.at(-1)
      if (answer.more !== true || last === undefined) return
      after = last.seq
    }
  }

  /** @returns when every received frame is applied. */
  private async applied(): Promise<void> {
    while (this.applying !== undefined) await this.applying
  }

  /** The relay connection closed. */
  detach(): void {
    this.relay = undefined
    this.connection = undefined
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
    this.applying ??= this.applyInbound().finally(() => {
      this.applying = undefined
      this.changed()
    })
    this.changed()
  }

  private async applyInbound(): Promise<void> {
    while (this.inbound.size > 0) {
      try {
        await this.applyBatch()
      } catch (error) {
        // Frames taken from the queue were not stored; reconnecting replays them from the stored cursor.
        this.error = 'download'
        this.changed()
        this.warn('sync: applying received frames failed; catching up again', error)
        this.inbound.clear()
        this.received = this.store.relayCursor()
        const relay = this.relay
        this.detach()
        relay?.close()
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
    await this.applyFrames(frames, true)
  }

  /**
   * Open received frames on the sync worker, store what they carry in one transaction, and update open documents.
   * @param frames - frames in relay sequence order.
   * @param advance - whether the frames are the relay's backlog in order, so the cursor moves past them.
   */
  private async applyFrames(frames: Array<{ seq: number; frame: Uint8Array }>, advance: boolean): Promise<void> {
    const key = this.key()
    if (key === undefined) return
    const opened = await this.offload.open(frames, key)
    const applied = new Map<OpaqueId, Uint8Array[]>()
    this.store.transaction(() => {
      for (const result of opened) {
        if ('error' in result) {
          this.warn(`sync: dropped relay frame ${String(result.seq)}`, new Error(result.error))
          continue
        }
        const { header } = result
        const apply = header.device !== this.device && (header.kind === 'update' || header.kind === 'snapshot')
        if (!apply || !this.store.isNewCounter(header.device, header.id, header.counter)) continue
        const payload = this.store.assemble(header, result.payload)
        if (payload === undefined || !this.store.acceptCounter(header.device, header.id, header.counter)) continue
        this.store.appendDocUpdate(header.id, payload)
        const updates = applied.get(header.id)
        if (updates === undefined) applied.set(header.id, [payload])
        else updates.push(payload)
      }
      if (advance) this.store.setRelayCursor((frames.at(-1) as { seq: number }).seq)
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
   * Derive a secret for one purpose from the account key.
   * @param label - the purpose.
   * @returns the secret, the same on every device that holds the key.
   */
  secret(label: string): string {
    return derivedSecretOf(this.requireKey(), label)
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
        // A key change already dropped and destroyed the document.
        if (this.docs.get(id) === handle) this.docs.delete(id)
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
    const frame = this.store.transaction(() => {
      const sealed = this.seal('stream', id, payload)
      this.store.enqueue(sealed)
      return sealed
    })
    this.sendLan(frame)
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
    const key = this.requireKey()
    const batches: Array<{ seq: number; payload: Uint8Array }> = []
    const partials = new Map<string, number>()
    let cursor = after
    for (;;) {
      const { frames, more } = await relay.request('stream.get', { id: this.documentId(name), after: cursor }) as { frames: Array<{ seq: number; frame: string }>; more: boolean }
      this.store.transaction(() => {
        for (const { seq, frame } of frames) {
          const opened = openEnvelope(new Uint8Array(Buffer.from(frame, 'base64url')), key)
          cursor = seq
          if (this.store.duplicateStreamPart(opened.header, seq)) continue
          const fragment = opened.header.fragment
          const transfer = `${opened.header.device}:${String(opened.header.counter)}:${fragment?.id ?? ''}`
          if (fragment !== undefined && !partials.has(transfer)) partials.set(transfer, seq)
          const payload = this.store.assemble(opened.header, opened.payload, seq)
          if (payload !== undefined) {
            const logical = `${opened.header.device}:${String(opened.header.counter)}:`
            for (const pending of partials.keys()) if (pending.startsWith(logical)) partials.delete(pending)
            batches.push({ seq, payload })
          }
        }
      })
      // A partial logical batch cannot advance the caller's cursor; read its remaining transport pages here.
      if ((partials.size === 0 && batches.length > 0) || !more || frames.length === 0) {
        const firstPartial = Math.min(...partials.values())
        return { batches: batches.filter(batch => batch.seq < firstPartial), more: more && frames.length > 0 }
      }
    }
  }

  private seal(kind: EnvelopeKind, id: OpaqueId, payload: Uint8Array): Uint8Array {
    return sealEnvelope({ kind, id, accountKey: this.requireKey(), device: this.device, counter: this.store.nextCounter(id), payload })
  }

  private localUpdate(id: OpaqueId, update: Uint8Array): void {
    const frame = this.store.transaction(() => {
      const sealed = this.seal('update', id, update)
      this.store.appendDocUpdate(id, update)
      this.store.enqueue(sealed)
      return sealed
    })
    this.sendLan(frame)
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

  private sendLan(frame: Uint8Array): void {
    if (this.lanSend === undefined) return
    for (const part of prepareFrame(frame, this.requireKey(), publishFrameLimit(this.tuning.publishBytes))) this.lanSend(part)
  }

  /**
   * Read the account's opaque local-network tag.
   * @returns the tag, identical on every device of the account.
   */
  lanTag(): string {
    return this.documentId(LAN_TAG)
  }

  /**
   * Read this device's id.
   * @returns the device id.
   */
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
    const { header } = opened
    if (header.device === this.device) return
    const payload = this.store.transaction(() => {
      const complete = this.store.assemble(header, opened.payload)
      if (complete !== undefined && header.kind === 'update') this.store.appendDocUpdate(header.id, complete)
      return complete
    })
    if (payload === undefined) return
    if (header.kind === 'stream') {
      for (const listener of this.streamWatchers.get(header.id) ?? []) listener(payload)
      return
    }
    if (header.kind !== 'update') return
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
        ? { snapshot: { accountKey: key, device: this.device, covers: this.store.relayCursor() } }
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
    }, (error: unknown) => {
      this.flushing = undefined
      this.error = 'upload'
      this.changed()
      this.warn('sync: preparing queued frames failed; they stay queued', error)
    })
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
      if (queued.length === 0 && this.error === 'upload') {
        this.error = undefined
        this.changed()
      }
      if (relay === undefined || queued.length === 0) return queued.length === 0
      const batch: Array<{ seq: number; last: boolean; item: PublishFrame }> = []
      let bytes = publishRequestBytes([])
      const publish = async (): Promise<boolean> => {
        if (batch.length === 0) return true
        let stored = 0
        let complete = false
        try {
          const answer = await relay.request('publish', { frames: batch.map(part => part.item) }) as {
            seqs: number[]
            refused?: { code: string; message: string }
          }
          stored = answer.seqs.length
          if (answer.refused !== undefined) throw new RelayError(answer.refused.code, answer.refused.message)
          complete = stored === batch.length
          if (!complete) throw new RelayError('server-error', 'sync relay did not acknowledge every published frame')
        } catch (error) {
          this.error = 'upload'
          this.changed()
          this.warn('sync: publishing frames failed; they stay queued', error)
          if (error instanceof RelayError && (error.code === 'server-error' || error.code === 'closed')) relay.close()
        }
        // A logical frame stays durable until every part is acknowledged; reconnects may resend a prefix.
        const last = batch.slice(0, stored).findLast(part => part.last)
        if (last !== undefined) {
          this.store.acknowledge(last.seq)
          this.changed()
        }
        batch.length = 0
        bytes = publishRequestBytes([])
        return complete
      }
      for (const next of queued) {
        const limit = publishFrameLimit(this.tuning.publishBytes)
        const frames = next.frame.length <= limit ? [next.frame] : await this.offload.prepare(next.frame, this.requireKey(), limit)
        for (const [index, frame] of frames.entries()) {
          const last = index === frames.length - 1
          const item: PublishFrame = { frame: toBase64Url(frame),
            ...last && next.covers !== undefined ? { covers: next.covers } : {},
          }
          const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8')
          if (batch.length > 0 && (batch.length >= this.tuning.publishFrames
            || bytes + 1 + itemBytes > this.tuning.publishBytes)) {
            if (!await publish()) return false
          }
          bytes += itemBytes + (batch.length > 0 ? 1 : 0)
          batch.push({ seq: next.seq, last, item })
        }
      }
      if (!await publish()) return false
    }
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
