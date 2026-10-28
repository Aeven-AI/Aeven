/**
 * One account's conversation history across its devices. Each session is written by the device that created
 * it: that device publishes the session's events as compressed batches on the `sessions/<id>` stream and
 * records the session in the synced `sessions/index` document. Every other device imports the events through
 * session persistence with their original `seq`, so the imported log replays exactly; importing never runs a
 * model or a tool.
 */
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { brotliCompress, brotliDecompress, constants } from 'node:zlib'
import type { Map as YMap, YMapEvent, Transaction } from 'yjs'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@aeven/session'
import type { SessionPersistence } from '@aeven/session-persistence'
import { LeaseHolder, type Sync, type SyncDocument, type SyncProgress, type LeaseHolderTiming } from '@aeven/sync'
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
  /** @returns each filed session's shared workspace name, built in one pass. */
  sessionHomes(): ReadonlyMap<SessionId, string>
  /**
   * @param sessionId - a stored session.
   * @param home - the shared workspace name.
   * @returns whether the session is filed there now.
   */
  fileSession(sessionId: SessionId, home: string, header?: SessionHeader): Promise<boolean>
  /**
   * Observe sessions {@link fileSession} could not file earlier joining their workspace once it arrived.
   * @param listener - called after such sessions were filed.
   * @returns the disposer.
   */
  onLateFiling(listener: () => void): () => void
}

/**
 * @param events - session events in log order.
 * @returns the title the last `session/title` event set, if any.
 */
function titleOf(events: readonly SessionEvent[]): string | undefined {
  const last = events.findLast(event => (event.type as string) === 'session/title')
  return last === undefined ? undefined : (last.data as unknown as { title: string }).title
}

/** Key prefix of the device-local {@link SessionRecord} values. */
const RECORD_PREFIX = 'session-sync/'

/** What this device keeps about one session across restarts; it never syncs. */
interface SessionRecord {
  /** Log revision whose committed events this device last published, for a session it writes. */
  revision?: string
  /** Stream position this device imported up to, for a session another device writes. */
  cursor?: number
  /** One past the last stored `seq` of a session another device writes, valid while its log has revision {@link local}. */
  next?: number
  /** Log revision {@link next} was counted at. */
  local?: string
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
  /** Maximum history batches compressed concurrently; one conversation log is loaded at a time. */
  publishConcurrency: number
  /** Brotli quality for outgoing history, from 0 through 11. */
  compressionQuality: number
  /** Wait after a session's events commit before they are published, so a streaming reply travels in small batches. */
  liveMs: number
  /**
   * Background import skips sessions this device does not store and that were created more than this many days
   * ago; they import when opened. `0` imports every session.
   */
  backfillDays: number
  /** Pause between two sessions of a background import or publication scan, in milliseconds. */
  pauseMs: number
  /** Queued frames above which publishing history waits for the account's outbox to drain; live turns never wait. */
  outboxLimit: number
}

const compress = promisify(brotliCompress)
const decompress = promisify(brotliDecompress)

/** Yield the event loop with a real timer, so background history work never starves a turn or a request. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** @returns a decompressed batch; the thread pool decompresses it off the event loop. */
async function readBatch(payload: Uint8Array): Promise<Batch> {
  return JSON.parse((await decompress(payload)).toString('utf8')) as Batch
}

const INDEX = 'sessions/index'
/** The account's inputs for sessions another device writes, until that device applies them. */
const INBOX = 'sessions/inbox'
/** The document each device names itself in, as the sync provider writes it. */
const DEVICES = 'devices'
/** Local execution settings and seed markers wait for conversation activity before publication. */
const INITIALIZATION_EVENTS: ReadonlySet<string> = new Set([
  'permission/preset', 'sandbox/mode', 'approval/policy', 'session/end-seed',
])
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
  if (!Array.isArray(value)) return new Set(JSON.stringify(value).match(ATTACHMENT_ID))
  const ids = new Set<string>()
  for (const item of value) for (const id of attachmentIds(item)) ids.add(id)
  return ids
}

/** One past the `seq` of the last event, or `fallback` for no events. */
/** @returns when a conversation was last active, for ordering imports newest first. */
function recency(entry: IndexEntry): number {
  return entry.updatedAt ?? entry.header.createdAt
}

function after(events: readonly SessionEvent[], fallback: number): number {
  return events.reduce((_next, event) => event.seq + 1, fallback)
}

/** One account's session mirror on this device. */
export class SessionMirror {
  private docs: { index: SyncDocument; inbox: SyncDocument; names: SyncDocument; live: SyncDocument } | undefined
  private starting: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private publishing: Promise<void> | undefined
  private readonly publicationProgress: SyncProgress = { sessionsPending: 0, sessionsTotal: 0 }
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
    // A runner this device holds continues without waiting for an earlier operation on the session, such as the
    // release that publishes the previous turn. It keeps running while the relay is unreachable: other devices
    // see the index mark the session running and do not claim it, so only a lease granted elsewhere stops it.
    const runner = this.runners.get(sessionId)
    if (runner !== undefined && !runner.refused() && !this.isClosed()) return Promise.resolve({ claimed: true })
    return this.own(sessionId, async () => {
      await this.starting
      await this.releases.get(sessionId)
      const me = this.device()
      const entry = this.docs?.index.doc.getMap<IndexEntry>('sessions').get(sessionId)
      if (me === undefined || this.isClosed()) return { claimed: false }
      if (entry !== undefined && entry.header.owner !== this.owner) throw new Error('session does not belong to this account')
      const existing = this.runners.get(sessionId)
      if (existing !== undefined && !existing.refused()) return { claimed: true }
      // A session this device writes needs no handover, so a turn never waits for the account's backlog.
      const mine = entry === undefined || entry.origin === me
      const online = this.sync.status(this.owner).state === 'online'
      if (mine && !online) return { claimed: true }
      if (!online) return await this.takeOver(sessionId, entry)
      const timing = this.tuning.runnerLease
      if (timing === undefined) throw new Error('session runner lease timing is not configured')
      const holder: LeaseHolder = new LeaseHolder(this.sync, this.owner, streamName(sessionId), timing, {
        // A lease that lapsed because the relay was unreachable keeps the turn running; see the runner check above.
        changed: (held) => {
          if (!held && holder.refused()) void this.releaseLocal(sessionId).catch((error: unknown) => {
            this.warn(`session sync: releasing a runner failed: ${String(error)}`)
          })
        },
      })
      await holder.renew()
      if (!holder.held()) return { claimed: false }
      this.runners.set(sessionId, holder)
      try {
        if (mine) return { claimed: true }
        await this.sync.synchronize(this.owner)
        // A pending import finishes before promotion; the lease prevents another runner advancing the tail.
        await this.fetch(sessionId)
        await this.imports.get(sessionId)
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
          const from = next
          await this.serialImport(sessionId, () => this.importSession(sessionId, current, from, true))
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
   * Report whether a locally running session has a running turn.
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
      // A session claimed over the local network holds no lease, so its release still has to clear the index flag
      // that tells the account's other devices a turn runs here; only the lease disposal depends on having one.
      const holder = this.runners.get(sessionId)
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
      await holder?.dispose()
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
      this.appendedNext.delete(sessionId)
      this.record(sessionId, { revision: undefined })
    })().finally(() => {
      if (this.releases.get(sessionId) === release) this.releases.delete(sessionId)
    })
    this.releases.set(sessionId, release)
    return release
  }

  private readonly revisions = new Map<string, string>()
  private readonly localNext = new Map<string, number>()
  private readonly cursors = new Map<string, number>()
  /** One past the last `seq` this process saw committed, per session this device writes. */
  private readonly appendedNext = new Map<string, number>()

  /**
   * What this device recorded about a session across restarts: the log revision it last published and the stream
   * position it imported up to.
   * @param id - the session.
   * @returns the record, empty when none is stored.
   */
  private recorded(id: string): SessionRecord {
    const stored = this.sync.localValue(this.owner, `${RECORD_PREFIX}${id}`)
    if (stored === undefined) return {}
    try {
      return JSON.parse(stored) as SessionRecord
    } catch {
      // A record this build cannot read only costs one full publication or stream read; nothing depends on it.
      return {}
    }
  }

  /**
   * Update what this device records about a session across restarts.
   * @param id - the session.
   * @param change - the fields to replace; an undefined field is removed.
   */
  private record(id: string, change: { readonly [K in keyof SessionRecord]?: SessionRecord[K] | undefined }): void {
    // JSON drops the undefined fields, which removes them from the record.
    this.sync.setLocalValue(this.owner, `${RECORD_PREFIX}${id}`, JSON.stringify({ ...this.recorded(id), ...change }))
  }
  private readonly imports = new Map<string, Promise<void>>()
  private readonly created = new Set<string>()
  /** Imported sessions already filed into their workspace on this device. */
  private readonly filed = new Set<string>()
  /** Inbox passes, one at a time, so forwarded inputs apply in order. */
  private consuming: Promise<void> = Promise.resolve()
  /** Each session's publications, one at a time, so a scan and a live publication never send the same events twice. */
  private readonly publications = new Map<string, Promise<void>>()
  /** Stops observing late workspace filing. */
  private offLateFiling: (() => void) | undefined
  /** Conversations a caller is waiting to open. */
  private readonly opening = new Set<string>()
  /** Background imports waiting for {@link opening} to empty. */
  private readonly openingDone: (() => void)[] = []
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
   * @param progressChanged - reports discovery or completion of conversation uploads and downloads.
   * @param imported - receives a session once an import pass stored new events for it.
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
    private readonly progressChanged?: () => void,
    private readonly imported?: (sessionId: SessionId) => void,
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

  /**
   * List the conversations this account mirrors without importing their logs.
   * @returns the conversation metadata.
   */
  catalog(): readonly SharedSession[] {
    if (this.docs === undefined) return []
    // A conversation is listed once it sits in a workspace here, never outside one while its workspace is on its way.
    const homes = this.filing?.sessionHomes()
    return [...this.entries().values()].filter(entry => entry.header.owner === this.owner
      && (homes === undefined || homes.has(entry.header.id)))
      .map(entry => ({
        header: { ...entry.header, replica: true }, next: entry.next,
        updatedAt: entry.updatedAt ?? entry.header.createdAt,
        ...entry.title === undefined ? {} : { title: entry.title },
      }))
  }

  /**
   * Import one conversation when opened, including an older body skipped by background backfill. A conversation
   * this device already stores opens at once and its remaining events append in the background; only one this
   * device has never stored waits, for its own events and never for the import of other conversations.
   * @param sessionId - shared conversation.
   * @param signal - cancellation while its publishing device uploads its first prefix.
   * @returns when the conversation can open from its local log.
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
    const local = new Set((await this.persistence.list()).map(header => header.id as string))
    const opened = entry
    const importing = this.importOne(sessionId, opened, local).then(async () => {
      if ((this.localNext.get(sessionId) ?? 0) < opened.next) throw new Error('session is missing published events')
      await this.file(sessionId, opened)
    })
    if (local.has(sessionId) || this.created.has(sessionId)) {
      importing.catch((error: unknown) => { this.warn(`session sync: importing an opened session failed: ${String(error)}`) })
      return
    }
    // Background import of other conversations waits while this one downloads.
    this.opening.add(sessionId)
    try {
      await importing
    } finally {
      this.opening.delete(sessionId)
      if (this.opening.size === 0) for (const resume of this.openingDone.splice(0)) resume()
    }
    signal?.throwIfAborted()
  }

  /**
   * Wait while conversations other than `id` are being opened, so the one on screen gets the connection first.
   * @param id - the conversation about to import.
   */
  private async yieldToOpening(id: string): Promise<void> {
    while (this.opening.size > 0 && !this.opening.has(id) && !this.isClosed()) {
      await new Promise<void>((resolve) => { this.openingDone.push(resolve) })
    }
  }

  /**
   * Report whether a conversation's workspace membership is shared across devices.
   * @param sessionId - conversation identity.
   * @returns whether the membership is shared.
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
    this.offLateFiling = this.filing?.onLateFiling(() => {
      this.catalogChanged?.()
      this.scheduleImport()
      this.progressChanged?.()
    })
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
      this.progressChanged?.()
      // A session that became this device's to write may have input waiting.
      this.consumeInbox()
    })
    this.pending().observe((_event: YMapEvent<InboxEntry>, transaction: Transaction) => {
      if (!transaction.local) this.consumeInbox()
    })
    this.consumeInbox()
    this.scheduleImport()
    this.progressChanged?.()
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
    })().catch((error: unknown) => {
      // Importing runs in the background, so a failed pass is reported here instead of becoming an unhandled rejection.
      this.warn(`session sync: importing sessions failed: ${String(error)}`)
    }).finally(() => {
      this.importing = undefined
      // A change that arrived after the loop's last check but before this point still needs its pass.
      if (this.repeatImport() && !this.isClosed()) this.scheduleImport()
    })
  }

  private async next(id: string, local: ReadonlySet<string>, revisions?: ReadonlyMap<string, string>): Promise<number> {
    const cached = this.localNext.get(id)
    if (cached !== undefined) return cached
    if (!local.has(id)) return 0
    // A log unchanged since its count was recorded is not read again, so a restart reads only what changed.
    const revision = revisions?.get(id)
    const recorded = revision === undefined ? undefined : this.recorded(id)
    if (recorded?.next !== undefined && recorded.local === revision) {
      this.localNext.set(id, recorded.next)
      return recorded.next
    }
    const { events } = await this.persistence.readFrom(id as SessionId, SessionLogOffset(0))
    const next = after(events, 0)
    this.localNext.set(id, next)
    if (revision !== undefined) this.record(id, { next, local: revision })
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
      const batch = await readBatch(payload)
      await this.serialImport(id, async () => {
        const next = await this.next(id, new Set([id]))
        const events = batch.events.filter(event => event.seq >= next)
        if (events[0]?.seq !== next) return
        await this.persistence.append(id as SessionId, events)
        await this.importAttachments(events)
        this.localNext.set(id, after(events, next))
        this.imported?.(id as SessionId)
      })
    })
  }

  private async importAll(): Promise<void> {
    const me = this.device()
    if (me === undefined || this.isClosed()) return
    const snapshots = await this.persistence.listSnapshots()
    const local = new Set(snapshots.map(({ header }) => header.id as string))
    const revisions = new Map(snapshots.map(({ header, revision }) => [header.id as string, String(revision)]))
    // The most recently active conversations arrive first; older history follows.
    const ordered = [...this.entries()].sort(([, left], [, right]) => recency(right) - recency(left))
      .filter(([, entry]) => entry.origin !== me && entry.header.owner === this.owner)
    // Every conversation joins its workspace before any body downloads, so the list shows the account's structure first.
    const unfiled = this.filed.size
    // Filing puts a conversation first in its workspace, so the oldest goes first and the most recent ends on top.
    for (const [id, entry] of [...ordered].reverse()) {
      if (this.isClosed()) return
      await this.file(id, entry).catch((error: unknown) => {
        this.warn(`session sync: filing a session into its workspace failed: ${String(error)}`)
      })
    }
    if (this.filed.size !== unfiled) this.catalogChanged?.()
    // A session filed later in this pass schedules another pass through the late-filing observer.
    const homes = this.filing?.sessionHomes()
    for (const [id, entry] of ordered) {
      if (this.isClosed()) return
      await pause(this.tuning.pauseMs)
      if (local.has(id) || this.created.has(id)) this.watch(id)
      // A body imports once its workspace holds it here; opening the conversation imports it regardless.
      if (homes !== undefined && !homes.has(id as SessionId) && !local.has(id)) continue
      if (this.tuning.backfillDays > 0 && entry.header.createdAt < Date.now() - this.tuning.backfillDays * DAY_MS
        && !local.has(id)) continue
      try {
        await this.releases.get(id)
        await this.importOne(id, entry, local, revisions)
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

  private importOne(id: string, entry: IndexEntry, local: ReadonlySet<string>, revisions?: ReadonlyMap<string, string>): Promise<void> {
    return this.serialImport(id, async () => {
      const next = await this.next(id, local, revisions)
      if (entry.next > next) await this.importSession(id, entry, next, local.has(id) || this.created.has(id))
    })
  }

  /** Run one append to an imported session after every earlier one, whether it came from the relay or the local network. */
  private serialImport(id: string, work: () => Promise<void>): Promise<void> {
    const run = (this.imports.get(id) ?? Promise.resolve()).then(async () => {
      const pending = this.progress().sessionsPending
      try {
        await work()
      } finally {
        if (this.progress().sessionsPending !== pending) this.progressChanged?.()
      }
    })
    this.imports.set(id, run.catch(() => {}))
    return run
  }

  private async importSession(id: string, entry: IndexEntry, from: number, exists: boolean): Promise<void> {
    let next = from
    let created = exists || this.created.has(id)
    let pending: SessionEvent[] = []
    // A restart resumes the stream where the last import of a stored log stopped instead of reading it from the start.
    let resumed = !this.cursors.has(id) && from > 0
    let cursor = this.cursors.get(id) ?? (resumed ? this.recorded(id).cursor ?? 0 : 0)
    let committedCursor = cursor
    let stored = false
    try {
      reading: for (;;) {
        await this.yieldToOpening(id)
        const { batches, more } = await this.sync.readStream(this.owner, streamName(id), cursor)
        if (this.isClosed()) return
        for (const { seq, payload } of batches) {
          cursor = seq
          const batch = await readBatch(payload)
          const events = batch.events.filter(event => event.seq >= next)
          const first = events.at(0)
          if (first === undefined) continue
          if (first.seq !== next && resumed && pending.length === 0) {
            // The recorded position is past what the local log holds, so the stream is read again from its start.
            resumed = false
            cursor = 0
            committedCursor = 0
            continue reading
          }
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
            this.watch(id)
          }
          await this.persistence.append(id as SessionId, pending)
          await this.importAttachments(pending)
          pending = []
          this.localNext.set(id, next)
          committedCursor = cursor
          stored = true
        }
        if (this.cursors.get(id) !== committedCursor) {
          this.cursors.set(id, committedCursor)
          this.record(id, { cursor: committedCursor })
        }
        if (!more || this.isClosed()) return
      }
    } finally {
      // Listeners rebuild from the whole stored log, so they follow a pass rather than each of its batches.
      if (stored) this.imported?.(id as SessionId)
    }
  }

  /**
   * Read the discovered conversation uploads and eligible history downloads.
   * @returns counters that include sessions not yet read or queued.
   */
  progress(): Readonly<SyncProgress> {
    const progress = { ...this.publicationProgress }
    if (this.docs === undefined) return progress
    const me = this.device()
    const homes = this.filing?.sessionHomes()
    for (const [id, entry] of this.entries()) {
      if (entry.origin === me || entry.header.owner !== this.owner) continue
      const next = this.localNext.get(id)
      const local = next !== undefined || this.created.has(id)
      if (!local && homes !== undefined && !homes.has(id as SessionId)) continue
      if (!local && this.tuning.backfillDays > 0 && entry.header.createdAt < Date.now() - this.tuning.backfillDays * DAY_MS) continue
      progress.sessionsTotal += 1
      if (entry.next > (next ?? 0)) progress.sessionsPending += 1
    }
    return progress
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
      const homes = this.filing?.sessionHomes()
      const pending = snapshots.filter(({ header, revision }) => {
        const id = header.id as string
        const entry = entries.get(id)
        if (header.replica || header.owner !== this.owner || (entry !== undefined && entry.origin !== me)) return false
        // A workspace move changes the index entry, not the log, so it is published without a new revision.
        const moved = entry !== undefined && homes !== undefined && entry.workspace !== homes.get(header.id as SessionId)
        if (moved) return true
        if ((this.revisions.get(id) ?? this.recorded(id).revision) === String(revision)) return false
        // A live publication already carried every committed event; only its revision is left to record.
        if (entry !== undefined && entry.next === this.appendedNext.get(id) && entry.running === this.running.has(header.id)) {
          this.revisions.set(id, String(revision))
          this.record(id, { revision: String(revision) })
          return false
        }
        return true
      })
      if (pending.length > 0) {
        this.publicationProgress.sessionsPending = pending.length
        this.publicationProgress.sessionsTotal = pending.length
        this.progressChanged?.()
      }
      pending.sort((left, right) => right.header.createdAt - left.header.createdAt)
      for (const { header, revision } of pending) {
        if (this.isClosed()) return
        const id = header.id as string
        const entry = entries.get(id)
        if (entry !== undefined && entry.origin !== me) continue
        await pause(this.tuning.pauseMs)
        await this.serialize(id, () => this.publishSession(header, me, true))
        this.revisions.set(id, String(revision))
        this.record(id, { revision: String(revision) })
        this.publicationProgress.sessionsPending -= 1
        this.progressChanged?.()
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
   * @param events - the committed events; without them the scan reads the log to find what is new.
   */
  appended(header: SessionHeader, events: readonly SessionEvent[] = []): void {
    const id = header.id as string
    if (header.replica || header.owner !== this.owner || this.docs === undefined) return
    const last = events.at(-1)
    if (last !== undefined) this.appendedNext.set(id, last.seq + 1)
    if (this.live.has(id)) return
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

  /** Wait while the account's outbox holds more than {@link SessionSyncTuning.outboxLimit} frames. */
  private async outboxRoom(): Promise<void> {
    while (!this.isClosed() && this.sync.status(this.owner).pending > this.tuning.outboxLimit) await pause(this.tuning.publishMs)
  }

  /**
   * Publish a session's events after its index entry's `next`.
   * @param header - the session.
   * @param me - this device.
   * @param history - whether this is history publication, which waits for room in the outbox between batches.
   */
  private async publishSession(header: SessionHeader, me: string, history = false): Promise<void> {
    const entry = this.entries().get(header.id)
    if (entry !== undefined && entry.origin !== me) return
    const from = this.entries().get(header.id)?.next ?? 0
    const suffix = await this.persistence.readFrom(header.id, SessionLogOffset(from))
    if (this.isClosed()) return
    if (suffix.events.length === 0) {
      const current = this.entries().get(header.id)
      const home = this.filing?.sessionHome(header.id)
      // An entry published before titles and activity times were recorded takes them from the whole log once.
      const backfill = current !== undefined && current.next > 0 && (current.title === undefined || current.updatedAt === undefined)
        ? (await this.persistence.readFrom(header.id, SessionLogOffset(0))).events
        : undefined
      if (this.isClosed()) return
      const title = current?.title ?? (backfill === undefined ? undefined : titleOf(backfill))
      const updatedAt = current?.updatedAt ?? backfill?.filter(event => event.type === 'user/message').at(-1)?.time
      if (current !== undefined && (current.running !== this.running.has(header.id) || current.workspace !== home
        || current.title !== title || current.updatedAt !== updatedAt)) {
        const { workspace: _previous, ...rest } = current
        this.entries().set(header.id, {
          ...rest, running: this.running.has(header.id),
          ...home === undefined ? {} : { workspace: home },
          ...title === undefined ? {} : { title },
          ...updatedAt === undefined ? {} : { updatedAt },
        })
      }
      return
    }
    if (!suffix.events.some(event => !INITIALIZATION_EVENTS.has(event.type))) return
    if (entry === undefined) {
      const home = this.filing?.sessionHome(header.id)
      this.entries().set(header.id, { header, next: 0, inherited: suffix.inheritedEventCount, origin: me,
        ...home === undefined ? {} : { workspace: home },
      })
    }
    let batch: SessionEvent[] = []
    let bytes = 0
    const prepared: Promise<Uint8Array>[] = []
    const queue = async (): Promise<void> => {
      const payloads = await Promise.all(prepared.splice(0))
      if (this.isClosed()) return
      for (const payload of payloads) {
        if (history) await this.outboxRoom()
        await this.sync.appendStream(this.owner, streamName(header.id), payload)
      }
    }
    const flush = async (): Promise<void> => {
      const first = batch.at(0)
      if (first === undefined || this.isClosed()) return
      const payload: Batch = { first: first.seq, events: batch }
      prepared.push(compress(JSON.stringify(payload), {
        params: { [constants.BROTLI_PARAM_QUALITY]: this.tuning.compressionQuality },
      }).then(data => new Uint8Array(data)))
      batch = []
      bytes = 0
      if (!history || prepared.length >= this.tuning.publishConcurrency) await queue()
    }
    for (const event of suffix.events) {
      const size = Buffer.byteLength(JSON.stringify(event), 'utf8')
      if (bytes + size > this.tuning.batchBytes) await flush()
      batch.push(event)
      bytes += size
    }
    await flush()
    await queue()
    if (this.isClosed() || (this.entries().get(header.id)?.origin ?? me) !== me) return
    await this.publishAttachments(suffix.events)
    const home = this.filing?.sessionHome(header.id)
    const previous = this.entries().get(header.id)
    const title = titleOf(suffix.events) ?? previous?.title
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
    this.offLateFiling?.()
    for (const resume of this.openingDone.splice(0)) resume()
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
