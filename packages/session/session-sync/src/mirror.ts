/**
 * One account's conversation history across its devices. Each session is written by the device that created
 * it: that device publishes the session's events as compressed batches on the `sessions/<id>` stream and
 * records the session in the synced `sessions/index` document. Every other device imports the events through
 * session persistence with their original `seq`, so the imported log replays exactly; importing never runs a
 * model or a tool.
 */
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import type { Map as YMap, YMapEvent, Transaction } from 'yjs'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@aeven/session'
import type { SessionPersistence } from '@aeven/session-persistence'
import type { Sync, SyncDocument } from '@aeven/sync'
import { AttachmentId, type AttachmentStore } from '@aeven/attachment'

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
  fileSession(sessionId: SessionId, home: string): Promise<boolean>
}

/** One published batch. */
interface Batch {
  /** `seq` of the first event. */
  first: number
  events: SessionEvent[]
}

/** Tuning the plugin configures. */
export interface SessionSyncTuning {
  /** Interval between scans for changed local sessions, in milliseconds. */
  publishMs: number
  /** Uncompressed JSON bytes per published batch before a new batch starts. */
  batchBytes: number
  /** Sessions created up to this many days before this device first publishes are published too. */
  backfillDays: number
}

const INDEX = 'sessions/index'
const DAY_MS = 86_400_000

const streamName = (id: string): string => `sessions/${id}`
const attachmentStream = (id: string): string => `attachments/${id}`
const ATTACHMENT_ID = /sha256:[a-f0-9]{64}/g

/** Content addresses of the attachments some events reference: images, files, and files' extracted text. */
function attachmentIds(events: readonly SessionEvent[]): Set<string> {
  return new Set(JSON.stringify(events).match(ATTACHMENT_ID))
}

/** One past the `seq` of the last event, or `fallback` for no events. */
function after(events: readonly SessionEvent[], fallback: number): number {
  return events.reduce((_next, event) => event.seq + 1, fallback)
}

/** One account's session mirror on this device. */
export class SessionMirror {
  private index: SyncDocument | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private publishing: Promise<void> | undefined
  private importing: Promise<void> | undefined
  private importAgain = false
  private closed = false

  /** Opaque read of {@link importAgain}, set by a concurrent schedule while a pass awaits. */
  private repeatImport(): boolean {
    return this.importAgain
  }
  private readonly revisions = new Map<string, string>()
  private readonly localNext = new Map<string, number>()
  private readonly cursors = new Map<string, number>()
  private readonly created = new Set<string>()
  /** Imported sessions already filed into their workspace on this device. */
  private readonly filed = new Set<string>()

  /**
   * @param owner - the account.
   * @param sync - the account sync service.
   * @param persistence - this Host's session persistence.
   * @param tuning - scan interval, batch size, and backfill window.
   * @param warn - receives failures to publish or import.
   * @param attachments - this Host's attachment store, when one is mounted.
   * @param filing - this Host's workspace registry, when one is mounted.
   */
  constructor(
    private readonly owner: string,
    private readonly sync: Sync,
    private readonly persistence: SessionPersistence,
    private readonly tuning: SessionSyncTuning,
    private readonly warn: (message: string) => void,
    private readonly attachments?: AttachmentStore,
    private readonly filing?: SessionFiling,
  ) {}

  /** Content addresses of attachments the account's devices published, by id. */
  private published(): YMap<{ chunks: number }> {
    return this.started().doc.getMap<{ chunks: number }>('attachments')
  }

  /**
   * Publish the attachments some events reference that this device holds and no device published yet.
   * @param events - the events being published.
   */
  private async publishAttachments(events: readonly SessionEvent[]): Promise<void> {
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
  private async importAttachments(events: readonly SessionEvent[]): Promise<void> {
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

  private started(): SyncDocument {
    if (this.index === undefined) throw new Error('the session mirror has not started')
    return this.index
  }

  private entries(): YMap<IndexEntry> {
    return this.started().doc.getMap<IndexEntry>('sessions')
  }

  private device(): string | undefined {
    return this.sync.status(this.owner).device
  }

  /** Open the index, import what other devices published, and start publishing this device's sessions. */
  async start(): Promise<void> {
    this.index = await this.sync.openDocument(this.owner, INDEX)
    if (this.isClosed()) {
      this.index.close()
      return
    }
    this.entries().observe((_event: YMapEvent<IndexEntry>, transaction: Transaction) => {
      if (!transaction.local) this.scheduleImport()
    })
    this.scheduleImport()
    this.timer = setInterval(() => { void this.publish() }, this.tuning.publishMs)
    void this.publish()
  }

  /** The account's connection came back: fetch what may have been published meanwhile. */
  reconnected(): void {
    this.scheduleImport()
  }

  private scheduleImport(): void {
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

  private async importAll(): Promise<void> {
    const me = this.device()
    if (me === undefined || this.isClosed()) return
    const local = new Set((await this.persistence.list()).map(header => header.id as string))
    for (const [id, entry] of this.entries()) {
      if (this.isClosed()) return
      if (entry.origin === me || entry.header.owner !== this.owner) continue
      try {
        const next = await this.next(id, local)
        if (entry.next > next) await this.importSession(id, entry, next, local.has(id))
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
    if (await this.filing.fileSession(id as SessionId, home)) this.filed.add(id)
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
      const oldest = Date.now() - this.tuning.backfillDays * DAY_MS
      for (const { header, revision } of await this.persistence.listSnapshots()) {
        if (this.isClosed()) return
        const id = header.id as string
        const entry = entries.get(id)
        if (header.replica || header.owner !== this.owner || (entry !== undefined && entry.origin !== me)) continue
        if (entry === undefined && header.createdAt < oldest) continue
        if (this.revisions.get(id) === String(revision)) continue
        await this.publishSession(header, entry?.next ?? 0, me)
        this.revisions.set(id, String(revision))
      }
    } catch (error) {
      this.warn(`session sync: publishing sessions failed: ${String(error)}`)
    }
  }

  private async publishSession(header: SessionHeader, from: number, me: string): Promise<void> {
    const suffix = await this.persistence.readFrom(header.id, SessionLogOffset(from))
    if (this.isClosed() || suffix.events.length === 0) return
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
    if (this.isClosed()) return
    await this.publishAttachments(suffix.events)
    const home = this.filing?.sessionHome(header.id)
    this.entries().set(header.id, {
      header: suffix.meta,
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
    await Promise.all([this.publishing, this.importing])
    this.index?.close()
  }
}
