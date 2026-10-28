/**
 * One account's conversation history across its devices. Each session is written by the device that created
 * it: that device publishes the session's events as compressed batches on the `sessions/<id>` stream and
 * records the session in the synced `sessions/index` document. Every other device imports the events through
 * session persistence with their original `seq`, so the imported log replays exactly; importing never runs a
 * model or a tool.
 */
import { randomUUID } from 'node:crypto'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import type { Map as YMap, YMapEvent, Transaction } from 'yjs'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@aeven/session'
import type { SessionPersistence } from '@aeven/session-persistence'
import { LeaseHolder, type Sync, type SyncDocument, type LeaseHolderTiming } from '@aeven/sync'
import { AttachmentId, type AttachmentStore } from '@aeven/attachment'
import type { SessionClaim, SessionHandoffInput, SessionRunner, SharedSession } from '@aeven/session-handoff'

/** One session as the index records it. */
interface IndexEntry {
  /** The session header as the creating device stored it. */
  header: SessionHeader
  /** Events inherited from the fork parent, for a seeded session. */
  inherited: number
  /** One past the last published event's `seq`. */
  next: number
  /** The device that writes this session. */
  origin: string
  /** The workspace the session belongs to, in the terms every device of the account shares. */
  workspace?: string
  title?: string
  updatedAt?: number
  running?: boolean
}

/** Where sessions are filed on this device; the workspace registry provides it. */
export interface SessionFiling {
  /**
   * @param sessionId - a session.
   * @returns the shared name of the workspace holding it, if any.
   */
  sessionHome(sessionId: SessionId): string | undefined
  /**
   * @param sessionId - a stored session.
   * @param home - the shared workspace name.
   * @returns whether the session is filed there now.
   */
  fileSession(sessionId: SessionId, home: string, header?: SessionHeader): Promise<boolean>
}

/** One published batch. */
interface Batch {
  /** `seq` of the first event. */
  first: number
  events: SessionEvent[]
}

/** Tuning the plugin configures. */
export interface SessionSyncTuning {
  /** Session runner lease lifetime and renewal interval. */
  runnerLease?: LeaseHolderTiming
  /** Interval between scans for changed local sessions, in milliseconds. */
  publishMs: number
  /** Uncompressed JSON bytes per published batch before a new batch starts. */
  batchBytes: number
  /** Wait after a session's events commit before they are published, so a streaming reply travels in small batches. */
  liveMs: number
  /** Sessions created up to this many days before this device first publishes are published too. */
  backfillDays: number
}

const INDEX = 'sessions/index'
/** The account's inputs for sessions another device writes, until that device applies them. */
const INBOX = 'sessions/inbox'
/** The document each device names itself in, as the sync provider writes it. */
const DEVICES = 'devices'
/** The live state of each session, as the device writing it publishes it. */
const LIVE = 'sessions/live'

/** One session's live state in the shared document. */
interface LiveEntry {
  /** The device that published it. */
  device: string
  /** The state, in the publishing Consumer's vocabulary. */
  live: unknown
}

/** Receives the id of a session whose live state another device changed. */
export type SessionLiveChange = (sessionId: SessionId) => void

/** One forwarded input waiting for the device that writes its session. */
interface InboxEntry {
  /** The session. */
  session: string
  /** The input, in the forwarding Consumer's vocabulary. */
  input: SessionHandoffInput
  /** The device that forwarded it. */
  from: string
  /** When it was forwarded, in milliseconds since the Unix epoch; inputs apply in this order. */
  at: number
}

/** Receives an input another device forwarded for a session this device writes. */
export type SessionInputDelivery = (sessionId: SessionId, input: SessionHandoffInput) => void
const DAY_MS = 86_400_000

const streamName = (id: string): string => `sessions/${id}`
const attachmentStream = (id: string): string => `attachments/${id}`
const ATTACHMENT_ID = /sha256:[a-f0-9]{64}/g

/** Content addresses of the attachments some events or an input reference: images, files, and files' extracted text. */
function attachmentIds(value: unknown): Set<string> {
  return new Set(JSON.stringify(value).match(ATTACHMENT_ID))
}

/** One past the `seq` of the last event, or `fallback` for no events. */
function after(events: readonly SessionEvent[], fallback: number): number {
  return events.reduce((_next, event) => event.seq + 1, fallback)
}

/** One account's session mirror on this device. */
export class SessionMirror {
  private docs: { index: SyncDocument; inbox: SyncDocument; names: SyncDocument; live: SyncDocument } | undefined
  private starting: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private publishing: Promise<void> | undefined
  private importing: Promise<void> | undefined
  private importAgain = false
  private closed = false

  /** Opaque read of {@link importAgain}, set by a concurrent schedule while a pass awaits. */
  private repeatImport(): boolean {
    return this.importAgain
  }
  private readonly runners = new Map<SessionId, LeaseHolder>()
  private readonly releases = new Map<string, Promise<void>>()
  /** Direct local-network subscriptions to sessions this device reads but does not write. */
  private readonly watchers = new Map<string, () => void>()
  private readonly running = new Set<SessionId>()
  private readonly ownership = new Map<SessionId, Promise<unknown>>()

  private own<T>(id: SessionId, work: () => Promise<T>): Promise<T> {
    const operation = (this.ownership.get(id) ?? Promise.resolve()).then(work)
    this.ownership.set(id, operation.catch(() => {}))
    return operation
  }

  /**
   * Acquire the session lease, catch up its entire committed tail, and promote its local log.
   * @param sessionId - session to continue on this device.
   * @returns whether this device may admit input locally.
   */
  claim(sessionId: SessionId): Promise<SessionClaim> {
    return this.own(sessionId, async () => {
      await this.starting
      await this.releases.get(sessionId)
      const me = this.device()
      const entry = this.docs?.index.doc.getMap<IndexEntry>('sessions').get(sessionId)
      if (me === undefined || this.isClosed()) return { claimed: false }
      if (entry === undefined && this.sync.status(this.owner).state !== 'online') return { claimed: true }
      if (entry !== undefined && entry.header.owner !== this.owner) throw new Error('session does not belong to this account')
      const existing = this.runners.get(sessionId)
      if (existing?.held()) return { claimed: true }
      if (this.sync.status(this.owner).state !== 'online') return await this.takeOver(sessionId, entry)
      const timing = this.tuning.runnerLease
      if (timing === undefined) throw new Error('session runner lease timing is not configured')
      const holder = new LeaseHolder(this.sync, this.owner, streamName(sessionId), timing, {
        changed: (held) => {
          if (!held) void this.releaseLocal(sessionId).catch((error: unknown) => {
            this.warn(`session sync: releasing a runner failed: ${String(error)}`)
          })
        },
      })
      await holder.renew()
      if (!holder.held()) return { claimed: false }
      this.runners.set(sessionId, holder)
      try {
        if (entry === undefined) {
          return { claimed: true }
        }
        await this.sync.synchronize(this.owner)
        // A pending import finishes before promotion; the lease prevents another runner advancing the tail.
        await this.fetch(sessionId)
        const current = this.entries().get(sessionId)
        if (current === undefined) throw new Error('session disappeared during handover')
        if (current.origin !== me && current.running === true) {
          this.runners.delete(sessionId)
          await holder.dispose()
          return { claimed: false }
        }
        const suffix = await this.persistence.readFrom(sessionId, SessionLogOffset(0))
        let next = after(suffix.events, 0)
        if (next < current.next) {
          await this.importSession(sessionId, current, next, true)
          next = after((await this.persistence.readFrom(sessionId, SessionLogOffset(0))).events, 0)
        }
        if (next !== current.next || !holder.held()) throw new Error('session is not caught up for handover')
        if (current.origin !== me || suffix.meta.replica) {
          await this.persistence.setReplica(sessionId, false)
          this.entries().set(sessionId, { ...current, origin: me })
          await this.sync.synchronize(this.owner)
          this.consumeInbox()
        }
        return { claimed: true }
      } catch (error) {
        this.runners.delete(sessionId)
        await holder.dispose()
        throw error
      }
    })
  }

  /**
   * Continue a session on this device while the relay is unreachable. The account's devices exchange the log
   * directly on a local network, so a device that holds the whole committed log and finds no turn running on the
   * device that wrote it takes the session over; the writing device releases when the index stops naming it.
   * @param sessionId - the session to continue here.
   * @param entry - its shared index entry, when this device already knows the session.
   * @returns whether this device may admit input locally.
   */
  private async takeOver(sessionId: SessionId, entry: IndexEntry | undefined): Promise<SessionClaim> {
    const me = this.device()
    if (me === undefined || entry === undefined || entry.origin === me) return { claimed: false }
    if (entry.running === true) return { claimed: false }
    // Writing here without a direct link would produce events no other device can receive.
    if (await this.sync.linked(this.owner) === 0) return { claimed: false }
    const stored = (await this.persistence.list()).some(header => header.id === sessionId && header.owner === this.owner)
    if (!stored) return { claimed: false }
    if (await this.next(sessionId as string, new Set([sessionId as string])) !== entry.next) return { claimed: false }
    this.entries().set(sessionId, { ...entry, origin: me })
    await this.persistence.setReplica(sessionId, false)
    return { claimed: true }
  }

  /**
   * @param sessionId - session running locally.
   * @param running - whether it has a running turn.
   */
  holdRunner(sessionId: SessionId, running: boolean): Promise<void> {
    if (running) {
      this.running.add(sessionId)
      this.runners.get(sessionId)?.start()
      const entry = this.docs?.index.doc.getMap<IndexEntry>('sessions').get(sessionId)
      if (entry !== undefined && entry.origin === this.device() && entry.running !== true) {
        this.entries().set(sessionId, { ...entry, running: true })
      }
      return Promise.resolve()
    }
    if (!this.running.delete(sessionId)) return Promise.resolve()
    return this.own(sessionId, async () => {
      if (this.running.has(sessionId)) return
      const holder = this.runners.get(sessionId)
      if (holder === undefined) return
      const header = (await this.persistence.readFrom(sessionId, SessionLogOffset(0))).meta
      const me = this.device()
      if (me === undefined) throw new Error('session runner device disappeared')
      await this.serialize(sessionId, () => this.publishSession(header, me))
      await this.sync.synchronize(this.owner).catch((error: unknown) => {
        // Without a relay the batches already took the local network; the release still hands the session on.
        this.warn(`session sync: publishing before a release did not finish: ${String(error)}`)
      })
      if (this.running.has(sessionId)) return
      this.runners.delete(sessionId)
      await holder.dispose()
    })
  }

  private releaseLocal(sessionId: SessionId): Promise<void> {
    const existing = this.releases.get(sessionId)
    if (existing !== undefined) return existing
    const release = (async () => {
      const holder = this.runners.get(sessionId)
      this.runners.delete(sessionId)
      await this.released?.(sessionId)
      await holder?.dispose()
      await this.persistence.setReplica(sessionId, true)
      this.revisions.delete(sessionId)
      this.localNext.delete(sessionId)
    })().finally(() => {
      if (this.releases.get(sessionId) === release) this.releases.delete(sessionId)
    })
    this.releases.set(sessionId, release)
    return release
  }

  private readonly revisions = new Map<string, string>()
  private readonly localNext = new Map<string, number>()
  private readonly cursors = new Map<string, number>()
  private readonly imports = new Map<string, Promise<void>>()
  private readonly created = new Set<string>()
  /** Imported sessions already filed into their workspace on this device. */
  private readonly filed = new Set<string>()
  /** Inbox passes, one at a time, so forwarded inputs apply in order. */
  private consuming: Promise<void> = Promise.resolve()
  /** Each session's publications, one at a time, so a scan and a live publication never send the same events twice. */
  private readonly publications = new Map<string, Promise<void>>()
  /** Sessions whose committed events wait for their live publication. */
  private readonly live = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * @param owner - the account.
   * @param sync - the account sync service.
   * @param persistence - this Host's session persistence.
   * @param tuning - scan interval, batch size, and backfill window.
   * @param warn - receives failures to publish or import.
   * @param attachments - this Host's attachment store, when one is mounted.
   * @param filing - this Host's workspace registry, when one is mounted.
   * @param deliver - receives inputs other devices forwarded for sessions this device writes.
   * @param liveChange - receives sessions whose live state another device changed.
   * @param released - stops and drains a local agent before its log becomes a replica.
   * @param catalogChanged - publishes received metadata before histories are downloaded.
   */
  constructor(
    private readonly owner: string,
    private readonly sync: Sync,
    private readonly persistence: SessionPersistence,
    private readonly tuning: SessionSyncTuning,
    private readonly warn: (message: string) => void,
    private readonly attachments?: AttachmentStore,
    private readonly filing?: SessionFiling,
    private readonly deliver?: SessionInputDelivery,
    private readonly liveChange?: SessionLiveChange,
    private readonly released?: (sessionId: SessionId) => Promise<void>,
    private readonly catalogChanged?: () => void,
  ) {}

  /** Content addresses of attachments the account's devices published, by id. */
  private published(): YMap<{ chunks: number }> {
    return this.started().index.doc.getMap<{ chunks: number }>('attachments')
  }

  /**
   * Publish the attachments some events reference that this device holds and no device published yet.
   * @param events - the events being published.
   */
  private async publishAttachments(events: unknown): Promise<void> {
    const store = this.attachments
    if (store === undefined) return
    const published = this.published()
    for (const id of attachmentIds(events)) {
      if (published.has(id) || !await store.hasObject(AttachmentId(id))) continue
      const data = await store.readObject(AttachmentId(id))
      let chunks = 0
      for (let offset = 0; offset < data.byteLength || chunks === 0; offset += this.tuning.batchBytes) {
        await this.sync.appendStream(this.owner, attachmentStream(id), data.subarray(offset, offset + this.tuning.batchBytes))
        chunks++
      }
      published.set(id, { chunks })
    }
  }

  /**
   * Fetch the attachments some imported events reference that are missing here and another device published.
   * @param events - the imported events.
   */
  private async importAttachments(events: unknown): Promise<void> {
    const store = this.attachments
    if (store === undefined) return
    const published = this.published()
    for (const id of attachmentIds(events)) {
      if (!published.has(id) || await store.hasObject(AttachmentId(id))) continue
      const parts: Uint8Array[] = []
      let cursor = 0
      for (;;) {
        const { batches, more } = await this.sync.readStream(this.owner, attachmentStream(id), cursor)
        for (const batch of batches) {
          parts.push(batch.payload)
          cursor = batch.seq
        }
        if (!more) break
      }
      await store.importObject(AttachmentId(id), new Uint8Array(Buffer.concat(parts)))
    }
  }

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  private started(): { index: SyncDocument; inbox: SyncDocument; names: SyncDocument; live: SyncDocument } {
    if (this.docs === undefined) throw new Error('the session mirror has not started')
    return this.docs
  }

  private entries(): YMap<IndexEntry> {
    return this.started().index.doc.getMap<IndexEntry>('sessions')
  }

  private device(): string | undefined {
    return this.sync.status(this.owner).device
  }

  private pending(): YMap<InboxEntry> {
    return this.started().inbox.doc.getMap<InboxEntry>('inputs')
  }

  /** @returns conversation metadata available without importing log bodies. */
  catalog(): readonly SharedSession[] {
    if (this.docs === undefined) return []
    return [...this.entries().values()].filter(entry => entry.header.owner === this.owner).map(entry => ({
      header: { ...entry.header, replica: true }, next: entry.next,
      updatedAt: entry.updatedAt ?? entry.header.createdAt,
      ...entry.title === undefined ? {} : { title: entry.title },
    }))
  }

  /**
   * Import one conversation when opened, including an older body skipped by background backfill.
   * @param sessionId - shared conversation.
   * @param signal - cancellation while its publishing device uploads its first prefix.
   * @returns when its published prefix is durable locally.
   */
  async fetch(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    await this.starting
    signal?.throwIfAborted()
    let entry = this.entries().get(sessionId)
    if (entry === undefined || entry.origin === this.device()) return
    if (entry.header.owner !== this.owner) throw new Error('session does not belong to this account')
    if (entry.next === 0) {
      await new Promise<void>((resolve, reject) => {
        const entries = this.entries()
        const done = (): void => {
          entries.unobserve(changed)
          signal?.removeEventListener('abort', aborted)
        }
        const changed = (): void => {
          if ((entries.get(sessionId)?.next ?? 0) === 0) return
          done()
          resolve()
        }
        const aborted = (): void => { done(); reject(new Error('history opening cancelled', { cause: signal?.reason })) }
        entries.observe(changed)
        signal?.addEventListener('abort', aborted, { once: true })
        if (signal?.aborted) aborted()
        else changed()
      })
      entry = this.entries().get(sessionId)
      if (entry === undefined) throw new Error('session disappeared while opening history')
    }
    await this.importing
    const local = new Set((await this.persistence.list()).map(header => header.id as string))
    await this.importOne(sessionId, entry, local)
    if ((this.localNext.get(sessionId) ?? 0) < entry.next) throw new Error('session is missing published events')
    await this.file(sessionId, entry)
    signal?.throwIfAborted()
  }

  /**
   * @param sessionId - conversation identity.
   * @returns whether its workspace membership is shared across devices.
   */
  shared(sessionId: SessionId): boolean {
    return this.docs?.index.doc.getMap<IndexEntry>('sessions').has(sessionId) ?? false
  }

  /**
   * The device writing a session when it is another device of the account.
   * @param sessionId - the session.
   * @returns the writing device, or undefined when this device writes it or no device published it.
   */
  runnerOf(sessionId: SessionId): SessionRunner | undefined {
    const docs = this.docs
    if (docs === undefined) return undefined
    const origin = docs.index.doc.getMap<IndexEntry>('sessions').get(sessionId)?.origin
    if (origin === undefined || origin === this.device()) return undefined
    const name = docs.names.doc.getMap<{ name: string }>('names').get(origin)?.name ?? ''
    return { device: origin, name }
  }

  /**
   * Publish the live state of a session this device writes; a session another device writes is left to it.
   * @param sessionId - the session.
   * @param live - the state, or undefined to clear it.
   */
  publishLive(sessionId: SessionId, live: unknown): void {
    const me = this.device()
    if (this.docs === undefined || me === undefined || this.runnerOf(sessionId) !== undefined) return
    const states = this.docs.live.doc.getMap<LiveEntry>('sessions')
    if (live === undefined) {
      states.delete(sessionId)
      return
    }
    states.set(sessionId, { device: me, live })
  }

  /**
   * The live state the device writing a session published.
   * @param sessionId - the session.
   * @returns the state, or undefined when that device published none.
   */
  liveOf(sessionId: SessionId): unknown {
    const runner = this.runnerOf(sessionId)
    const entry = this.docs?.live.doc.getMap<LiveEntry>('sessions').get(sessionId)
    return runner !== undefined && entry?.device === runner.device ? entry.live : undefined
  }

  /**
   * Forward one input to the device writing a session, after publishing the attachments it references so that
   * device can read them.
   * @param sessionId - the session.
   * @param input - the input.
   */
  async forward(sessionId: SessionId, input: SessionHandoffInput): Promise<void> {
    const me = this.device()
    if (me === undefined || (this.runnerOf(sessionId) === undefined
      && (this.sync.status(this.owner).state === 'online' || !this.entries().has(sessionId)))) {
      throw new Error(`session ${sessionId} is not written by another device of the account`)
    }
    await this.publishAttachments(input.request)
    const entry: InboxEntry = { session: sessionId, input, from: me, at: Date.now() }
    this.pending().set(`${String(entry.at).padStart(16, '0')}:${randomUUID()}`, entry)
  }

  /**
   * Apply the waiting inputs of sessions this device writes, oldest first, and remove them from the inbox. An
   * input's attachments are fetched before it applies, since the forwarding device stored them.
   */
  private consumeInbox(): void {
    this.consuming = this.consuming.then(async () => {
      const me = this.device()
      const deliver = this.deliver
      if (me === undefined || this.isClosed() || deliver === undefined || this.sync.status(this.owner).state !== 'online') return
      const inputs = this.pending()
      const mine = [...inputs.entries()]
        .filter(([, entry]) => this.entries().get(entry.session)?.origin === me)
        .sort(([left], [right]) => left.localeCompare(right))
      for (const [key, entry] of mine) {
        if (!(await this.claim(entry.session as SessionId)).claimed) continue
        inputs.delete(key)
        await this.importAttachments(entry.input.request).catch((error: unknown) => {
          this.warn(`session sync: fetching a forwarded input's attachments failed: ${String(error)}`)
        })
        deliver(entry.session as SessionId, entry.input)
      }
    })
  }

  /** Open the index, import what other devices published, and start publishing this device's sessions. */
  start(): Promise<void> {
    this.starting ??= this.startCore()
    return this.starting
  }

  private async startCore(): Promise<void> {
    const index = await this.sync.openDocument(this.owner, INDEX)
    const inbox = await this.sync.openDocument(this.owner, INBOX)
    const names = await this.sync.openDocument(this.owner, DEVICES)
    const live = await this.sync.openDocument(this.owner, LIVE)
    if (this.isClosed()) {
      for (const handle of [index, inbox, names, live]) handle.close()
      return
    }
    this.docs = { index, inbox, names, live }
    this.catalogChanged?.()
    live.doc.getMap<LiveEntry>('sessions').observe((event: YMapEvent<LiveEntry>, transaction: Transaction) => {
      if (transaction.local) return
      for (const key of event.keysChanged) this.liveChange?.(key as SessionId)
    })
    this.entries().observe((event: YMapEvent<IndexEntry>, transaction: Transaction) => {
      if (transaction.local) return
      for (const [id, change] of event.changes.keys) {
        if ((change.oldValue as IndexEntry | undefined)?.origin !== this.device()
          || this.entries().get(id)?.origin === this.device()) continue
        const release = this.releaseLocal(id as SessionId)
        void release.catch((error: unknown) => { this.warn(`session sync: releasing a session failed: ${String(error)}`) })
      }
      this.catalogChanged?.()
      this.scheduleImport()
      // A session that became this device's to write may have input waiting.
      this.consumeInbox()
    })
    this.pending().observe((_event: YMapEvent<InboxEntry>, transaction: Transaction) => {
      if (!transaction.local) this.consumeInbox()
    })
    this.consumeInbox()
    this.scheduleImport()
    this.timer = setInterval(() => { void this.publish() }, this.tuning.publishMs)
    void this.publish()
  }

  /** The account's connection came back: fetch what may have been published meanwhile. */
  reconnected(): void {
    this.scheduleImport()
    if (this.docs !== undefined) this.consumeInbox()
  }

  private scheduleImport(): void {
    if (this.docs === undefined || this.isClosed()) return
    if (this.importing !== undefined) {
      this.importAgain = true
      return
    }
    this.importing = (async () => {
      do {
        this.importAgain = false
        await this.importAll()
      } while (this.repeatImport() && !this.isClosed())
    })().finally(() => {
      this.importing = undefined
      // A change that arrived after the loop's last check but before this point still needs its pass.
      if (this.repeatImport() && !this.isClosed()) this.scheduleImport()
    })
  }

  private async next(id: string, local: ReadonlySet<string>): Promise<number> {
    const cached = this.localNext.get(id)
    if (cached !== undefined) return cached
    if (!local.has(id)) return 0
    const { events } = await this.persistence.readFrom(id as SessionId, SessionLogOffset(0))
    const next = after(events, 0)
    this.localNext.set(id, next)
    return next
  }

  /**
   * Subscribe once to the batches the writing device sends directly on the local network.
   * @param id - a session this device holds and another device writes.
   */
  private watch(id: string): void {
    if (this.watchers.has(id)) return
    this.watchers.set(id, this.sync.watchStream(this.owner, streamName(id), (payload) => {
      void this.ingestLan(id, payload).catch((error: unknown) => {
        this.warn(`session sync: importing a batch from the local network failed: ${String(error)}`)
      })
    }))
  }

  /**
   * Import one batch the writing device sent directly. Only a batch that continues this device's log is applied;
   * the relay's copy carries the sequence numbers that order the rest, so anything else waits for it.
   * @param id - the session another device writes.
   * @param payload - the batch.
   * @returns when the batch is durable locally.
   */
  private ingestLan(id: string, payload: Uint8Array): Promise<void> {
    return this.own(id as SessionId, async () => {
      await this.starting
      await this.releases.get(id)
      if (this.isClosed() || this.entries().get(id)?.origin === this.device()) return
      const batch = JSON.parse(brotliDecompressSync(payload).toString('utf8')) as Batch
      const next = await this.next(id, new Set([id]))
      const events = batch.events.filter(event => event.seq >= next)
      if (events[0]?.seq !== next) return
      await this.persistence.append(id as SessionId, events)
      await this.importAttachments(events)
      this.localNext.set(id, after(events, next))
    })
  }

  private async importAll(): Promise<void> {
    const me = this.device()
    if (me === undefined || this.isClosed()) return
    const local = new Set((await this.persistence.list()).map(header => header.id as string))
    for (const [id, entry] of this.entries()) {
      if (this.isClosed()) return
      if (entry.origin === me || entry.header.owner !== this.owner) continue
      if (local.has(id) || this.created.has(id)) this.watch(id)
      await this.file(id, entry)
      if (entry.header.createdAt < Date.now() - this.tuning.backfillDays * DAY_MS && !local.has(id)) continue
      try {
        await this.releases.get(id)
        await this.importOne(id, entry, local)
        if (local.has(id) || this.created.has(id)) await this.file(id, entry)
      } catch (error) {
        this.warn(`session sync: importing a session failed: ${String(error)}`)
      }
    }
  }

  /** File a stored imported session into its workspace once that workspace is on this device too. */
  private async file(id: string, entry: IndexEntry): Promise<void> {
    const home = entry.workspace
    if (this.filing === undefined || home === undefined || this.filed.has(id)) return
    if (await this.filing.fileSession(id as SessionId, home, { ...entry.header, replica: true })) this.filed.add(id)
  }

  private importOne(id: string, entry: IndexEntry, local: ReadonlySet<string>): Promise<void> {
    const work = (this.imports.get(id) ?? Promise.resolve()).then(async () => {
      const next = await this.next(id, local)
      if (entry.next > next) await this.importSession(id, entry, next, local.has(id) || this.created.has(id))
    })
    this.imports.set(id, work.catch(() => {}))
    return work
  }

  private async importSession(id: string, entry: IndexEntry, from: number, exists: boolean): Promise<void> {
    let next = from
    let created = exists || this.created.has(id)
    let pending: SessionEvent[] = []
    let cursor = this.cursors.get(id) ?? 0
    let committedCursor = cursor
    for (;;) {
      const { batches, more } = await this.sync.readStream(this.owner, streamName(id), cursor)
      if (this.isClosed()) return
      for (const { seq, payload } of batches) {
        cursor = seq
        const batch = JSON.parse(brotliDecompressSync(payload).toString('utf8')) as Batch
        const events = batch.events.filter(event => event.seq >= next)
        const first = events.at(0)
        if (first === undefined) continue
        if (first.seq !== next) throw new Error(`session ${id} is missing events ${String(next)}–${String(first.seq - 1)}`)
        pending.push(...events)
        next = after(events, next)
        // A seeded artifact materializes only once its complete inherited prefix can commit together.
        if (next < entry.inherited) continue
        if (!created) {
          await this.persistence.create(
            { ...entry.header, replica: true },
            entry.header.isSeeded ? SessionLogOffset(entry.inherited) : undefined,
          )
          this.created.add(id)
          created = true
        }
        await this.persistence.append(id as SessionId, pending)
        await this.importAttachments(pending)
        pending = []
        this.localNext.set(id, next)
        committedCursor = cursor
      }
      this.cursors.set(id, committedCursor)
      if (!more || this.isClosed()) return
    }
  }

  /**
   * Publish new events of sessions this device writes.
   * @returns when this scan ends.
   */
  publish(): Promise<void> {
    const me = this.device()
    if (me === undefined || this.isClosed()) return Promise.resolve()
    this.publishing ??= this.publishAll(me).finally(() => { this.publishing = undefined })
    return this.publishing
  }

  private async publishAll(me: string): Promise<void> {
    try {
      const entries = this.entries()
      const snapshots = await this.persistence.listSnapshots()
      // Announce every identity before transferring bodies; recent conversations publish first.
      for (const { header } of snapshots) {
        if (header.owner !== this.owner || header.replica || entries.has(header.id)) continue
        const home = this.filing?.sessionHome(header.id)
        entries.set(header.id, { header, next: 0, inherited: 0, origin: me,
          ...home === undefined ? {} : { workspace: home },
        })
      }
      snapshots.sort((left, right) => right.header.createdAt - left.header.createdAt)
      for (const { header, revision } of snapshots) {
        if (this.isClosed()) return
        const id = header.id as string
        const entry = entries.get(id)
        if (header.replica || header.owner !== this.owner || (entry !== undefined && entry.origin !== me)) continue
        if (this.revisions.get(id) === String(revision)) continue
        await this.serialize(id, () => this.publishSession(header, me))
        this.revisions.set(id, String(revision))
      }
    } catch (error) {
      this.warn(`session sync: publishing sessions failed: ${String(error)}`)
    }
  }

  /** Run one publication of a session after every earlier one of the same session. */
  private serialize(id: string, work: () => Promise<void>): Promise<void> {
    const run = (this.publications.get(id) ?? Promise.resolve()).then(work)
    // The caller reports the failure; the chain only orders publications.
    this.publications.set(id, run.catch(() => {}))
    return run
  }

  /**
   * Publish a session's newly committed events soon, rather than at the next scan, so the account's other
   * devices follow a running turn as it streams.
   * @param header - the header of the session whose events were committed.
   */
  appended(header: SessionHeader): void {
    const id = header.id as string
    if (header.replica || header.owner !== this.owner || this.docs === undefined || this.live.has(id)) return
    this.live.set(id, setTimeout(() => {
      this.live.delete(id)
      const me = this.device()
      const entry = this.entries().get(id)
      if (me === undefined || this.isClosed() || (entry !== undefined && entry.origin !== me)) return
      this.serialize(id, () => this.publishSession(header, me)).catch((error: unknown) => {
        this.warn(`session sync: publishing a running session failed: ${String(error)}`)
      })
    }, this.tuning.liveMs))
  }

  private async publishSession(header: SessionHeader, me: string): Promise<void> {
    const entry = this.entries().get(header.id)
    if (entry !== undefined && entry.origin !== me) return
    const from = this.entries().get(header.id)?.next ?? 0
    const suffix = await this.persistence.readFrom(header.id, SessionLogOffset(from))
    if (this.isClosed()) return
    if (suffix.events.length === 0) {
      const current = this.entries().get(header.id)
      if (current !== undefined && current.running !== this.running.has(header.id)) {
        this.entries().set(header.id, { ...current, running: this.running.has(header.id) })
      }
      return
    }
    let batch: SessionEvent[] = []
    let bytes = 0
    const flush = async (): Promise<void> => {
      const first = batch.at(0)
      if (first === undefined || this.isClosed()) return
      const payload: Batch = { first: first.seq, events: batch }
      await this.sync.appendStream(this.owner, streamName(header.id), new Uint8Array(brotliCompressSync(JSON.stringify(payload))))
      batch = []
      bytes = 0
    }
    for (const event of suffix.events) {
      const size = Buffer.byteLength(JSON.stringify(event), 'utf8')
      if (bytes + size > this.tuning.batchBytes) await flush()
      batch.push(event)
      bytes += size
    }
    await flush()
    if (this.isClosed() || (this.entries().get(header.id)?.origin ?? me) !== me) return
    await this.publishAttachments(suffix.events)
    const home = this.filing?.sessionHome(header.id)
    const previous = this.entries().get(header.id)
    const lastTitle = [...suffix.events].reverse().find(event => (event.type as string) === 'session/title')
    const title = lastTitle === undefined ? previous?.title : (lastTitle.data as unknown as { title: string }).title
    this.entries().set(header.id, {
      header: suffix.meta,
      running: this.running.has(header.id),
      ...title === undefined ? {} : { title },
      updatedAt: suffix.events.filter(event => event.type === 'user/message').at(-1)?.time
        ?? previous?.updatedAt ?? header.createdAt,
      inherited: suffix.inheritedEventCount,
      next: after(suffix.events, from),
      origin: me,
      ...home === undefined ? {} : { workspace: home },
    })
  }

  /** Stop scheduling, wait for active imports and publications, and close the index. */
  async dispose(): Promise<void> {
    this.closed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    for (const off of this.watchers.values()) off()
    this.watchers.clear()
    for (const timer of this.live.values()) clearTimeout(timer)
    this.live.clear()
    await Promise.all([
      this.publishing, this.importing, this.consuming, ...this.publications.values(),
      ...this.ownership.values(), ...this.releases.values(), ...this.imports.values(),
    ])
    await Promise.all([...this.runners.values()].map(holder => holder.dispose()))
    for (const handle of Object.values(this.docs ?? {})) handle.close()
  }
}
