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

/** One past the `seq` of the last event, or `fallback` for no events. */
function after(events: readonly SessionEvent[], fallback: number): number {
  return events.reduce((_next, event) => event.seq + 1, fallback)
}

/** One account's session mirror on this device. */
export class SessionMirror {
  private index: SyncDocument | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private publishing = false
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

  /**
   * @param owner - the account.
   * @param sync - the account sync service.
   * @param persistence - this Host's session persistence.
   * @param tuning - scan interval, batch size, and backfill window.
   * @param warn - receives failures to publish or import.
   */
  constructor(
    private readonly owner: string,
    private readonly sync: Sync,
    private readonly persistence: SessionPersistence,
    private readonly tuning: SessionSyncTuning,
    private readonly warn: (message: string) => void,
  ) {}

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  private entries(): YMap<IndexEntry> {
    if (this.index === undefined) throw new Error('the session mirror has not started')
    return this.index.doc.getMap<IndexEntry>('sessions')
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
      } catch (error) {
        this.warn(`session sync: importing a session failed: ${String(error)}`)
      }
    }
  }

  private async importSession(id: string, entry: IndexEntry, from: number, exists: boolean): Promise<void> {
    let next = from
    let created = exists
    let cursor = this.cursors.get(id) ?? 0
    for (;;) {
      const { batches, more } = await this.sync.readStream(this.owner, streamName(id), cursor)
      for (const { seq, payload } of batches) {
        cursor = seq
        const batch = JSON.parse(brotliDecompressSync(payload).toString('utf8')) as Batch
        const events = batch.events.filter(event => event.seq >= next)
        const first = events.at(0)
        if (first === undefined) continue
        if (first.seq !== next) throw new Error(`session ${id} is missing events ${String(next)}–${String(first.seq - 1)}`)
        if (!created) {
          await this.persistence.create(entry.header, entry.header.isSeeded ? SessionLogOffset(entry.inherited) : undefined)
          created = true
        }
        await this.persistence.append(id as SessionId, events)
        next = after(events, next)
        this.localNext.set(id, next)
      }
      this.cursors.set(id, cursor)
      if (!more || this.isClosed()) return
    }
  }

  /**
   * Publish new events of sessions this device writes.
   * @returns when this scan ends.
   */
  async publish(): Promise<void> {
    const me = this.device()
    if (this.publishing || me === undefined || this.isClosed()) return
    this.publishing = true
    try {
      const entries = this.entries()
      const oldest = Date.now() - this.tuning.backfillDays * DAY_MS
      for (const { header, revision } of await this.persistence.listSnapshots()) {
        if (this.isClosed()) return
        const id = header.id as string
        const entry = entries.get(id)
        if (header.owner !== this.owner || (entry !== undefined && entry.origin !== me)) continue
        if (entry === undefined && header.createdAt < oldest) continue
        if (this.revisions.get(id) === String(revision)) continue
        await this.publishSession(header, entry?.next ?? 0, me)
        this.revisions.set(id, String(revision))
      }
    } catch (error) {
      this.warn(`session sync: publishing sessions failed: ${String(error)}`)
    } finally {
      this.publishing = false
    }
  }

  private async publishSession(header: SessionHeader, from: number, me: string): Promise<void> {
    const suffix = await this.persistence.readFrom(header.id, SessionLogOffset(from))
    if (suffix.events.length === 0) return
    let batch: SessionEvent[] = []
    let bytes = 0
    const flush = async (): Promise<void> => {
      const first = batch.at(0)
      if (first === undefined) return
      const payload: Batch = { first: first.seq, events: batch }
      await this.sync.appendStream(this.owner, streamName(header.id), new Uint8Array(brotliCompressSync(JSON.stringify(payload))))
      batch = []
      bytes = 0
    }
    for (const event of suffix.events) {
      const size = JSON.stringify(event).length
      if (bytes + size > this.tuning.batchBytes) await flush()
      batch.push(event)
      bytes += size
    }
    await flush()
    this.entries().set(header.id, {
      header: suffix.meta,
      inherited: suffix.inheritedEventCount,
      next: after(suffix.events, from),
      origin: me,
    })
  }

  /** Stop publishing and close the index. */
  dispose(): void {
    this.closed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.index?.close()
  }
}
