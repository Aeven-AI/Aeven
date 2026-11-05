/**
 * One account's conversation history across its devices. No device owns a session. The relay stream
 * `sessions/<id>` is the session's history: a device appends batches under a claim, and every device folds the
 * relay's total order with one deterministic rule, so all devices agree on the same log without coordinating.
 *
 * A claim is one device's right to continue the log from a position it had fully seen. Its first batch starts at
 * that position (`first === base`); later batches continue it. The fold accepts a batch only when it starts at the
 * accepted head and either continues the current claim or starts a new one there. A batch from a device that fell
 * behind (it slept, or ran a turn while partitioned) therefore never lands: every device drops it, and the device
 * that wrote it rewrites its local log to the accepted history and submits the user's dropped prompts again, so
 * they are answered on the accepted history.
 *
 * Input never waits for a handover: a device that cannot run the next turn itself, because another device is
 * running one, writes the input to the synced `sessions/inbox`, and the device that takes the next turn applies it.
 * The relay lease only keeps two devices from running a turn at once; correctness comes from the fold.
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

/** One session as the index records it: metadata only; the stream is the history. */
interface IndexEntry {
  /** The session header as the creating device stored it. */
  header: SessionHeader
  /** Events inherited from the fork parent, for a seeded session. */
  inherited: number
  /** One past the last `seq` some device published; a hint that the stream has events to fold, never authority. */
  next: number
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
  /** Relay sequence number of the last stream batch folded. */
  cursor?: number
  /** One past the last accepted `seq` after folding up to {@link cursor}. */
  head?: number
  /** The claim the last accepted batch belonged to; absent for batches written before claims existed. */
  claim?: string
  /** A claim this device published and the fold has not yet superseded, with the position it started at. */
  mine?: { claim: string; base: number }
  /** Log revision this device last published, for history publication of sessions it created. */
  revision?: string
  /** One past the last stored `seq`, valid while the log has revision {@link local}. */
  next?: number
  /** Log revision {@link next} was counted at. */
  local?: string
}

/** One published batch. */
interface Batch {
  /** `seq` of the first event. */
  first: number
  events: SessionEvent[]
  /** The claim the batch belongs to; absent on batches published before claims existed. */
  claim?: string
  /** The position the claim started at; the claim's first batch has `first === base`. */
  base?: number
}

/** This device's right to continue a session's log. */
interface Claim {
  /** The claim id every batch of it carries. */
  id: string
  /** The accepted head it started at. */
  base: number
  /** One past the last `seq` published under it. */
  published: number
  /** The relay lease held while a turn runs here; absent while idle or without a relay. */
  holder?: LeaseHolder
}

/** The fold position of one session. */
interface Fold {
  cursor: number
  head: number
  claim?: string
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
  /**
   * Longest one session's publication may run before the attempt is reported and left to the next scan.
   * A publication that never settles would otherwise hold that session's publications forever.
   */
  publishTimeoutMs: number
  /** Queued frames above which publishing history waits for the account's outbox to drain; live turns never wait. */
  outboxLimit: number
  /** How long a forwarded input waits for the device it was typed on before any other device may run it. */
  inputGraceMs: number
  /** How long a cancel, queue change, or answer waits for a running turn before it is discarded. */
  inputExpiryMs: number
  /** How long a read of an attachment a synced conversation cites waits for another device to publish it. */
  attachmentWaitMs: number
  /** Pause between reads of an attachment's chunks that are not all on the relay yet, in milliseconds. */
  attachmentRetryMs: number
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
/** The account's inputs for sessions a turn runs on another device, until a device applies them. */
const INBOX = 'sessions/inbox'
/** The document each device names itself in, as the sync provider writes it. */
const DEVICES = 'devices'
/** Local execution settings and seed markers wait for conversation activity before publication. */
const INITIALIZATION_EVENTS: ReadonlySet<string> = new Set([
  'permission/preset', 'sandbox/mode', 'approval/policy', 'session/end-seed',
])
/** The live state of each session, as the device running its turn publishes it. */
const LIVE = 'sessions/live'
/** Inputs that only mean something to a running turn. */
const TURN_INPUTS: ReadonlySet<string> = new Set(['cancel', 'queue', 'interaction'])

/** One session's live state in the shared document. */
interface LiveEntry {
  /** The device that published it. */
  device: string
  /** The state, in the publishing Consumer's vocabulary. */
  live: unknown
  /** When the publishing device last confirmed it, in milliseconds since the Unix epoch. */
  at?: number
}

/** Receives the id of a session whose live state another device changed. */
export type SessionLiveChange = (sessionId: SessionId) => void

/** One forwarded input waiting for the device that runs its session's next turn. */
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

/** Applies an input another device forwarded; rejects when this device cannot apply it. */
export type SessionInputDelivery = (sessionId: SessionId, input: SessionHandoffInput) => Promise<void>
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

/** @returns when a conversation was last active, for ordering imports newest first. */
function recency(entry: IndexEntry): number {
  return entry.updatedAt ?? entry.header.createdAt
}

/** One past the `seq` of the last event, or `fallback` for no events. */
function after(events: readonly SessionEvent[], fallback: number): number {
  return events.reduce((_next, event) => event.seq + 1, fallback)
}

/** Whether an event is a prompt the user typed, the activity the conversation list orders by. */
function humanPrompt(event: SessionEvent): boolean {
  return event.type === 'user/message' && (event.data as unknown as { source?: { kind?: unknown } }).source?.kind === 'user'
}

/** Whether two events at one `seq` are the same event. */
function sameEvent(left: SessionEvent, right: SessionEvent): boolean {
  return left.type === right.type && left.time === right.time && JSON.stringify(left.data) === JSON.stringify(right.data)
}

/**
 * The prompts a user typed in some events, as `prompt` inputs, so a dropped turn's questions can be asked again.
 * @param events - dropped events.
 * @returns one input per user-authored message, in log order.
 */
function droppedPrompts(events: readonly SessionEvent[]): SessionHandoffInput[] {
  const inputs: SessionHandoffInput[] = []
  for (const event of events) {
    if ((event.type as string) !== 'user/message') continue
    const message = event.data as unknown as {
      content?: unknown
      source?: { kind?: unknown; rpcId?: unknown; clientTimeZone?: unknown; clientDisplayName?: unknown }
    }
    const source = message.source
    if (source?.kind !== 'user' || !Array.isArray(message.content)) continue
    inputs.push({
      operation: 'prompt',
      request: {
        requestId: typeof source.rpcId === 'string' ? source.rpcId : randomUUID(),
        mode: 'queue',
        content: message.content,
        ...typeof source.clientTimeZone === 'string' ? { clientTimeZone: source.clientTimeZone } : {},
        ...typeof source.clientDisplayName === 'string' ? { clientDisplayName: source.clientDisplayName } : {},
      },
    })
  }
  return inputs
}

/** One account's session mirror on this device. */
export class SessionMirror {
  private docs: { index: SyncDocument; inbox: SyncDocument; names: SyncDocument; live: SyncDocument } | undefined
  private starting: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private inputTimer: ReturnType<typeof setInterval> | undefined
  private liveTimer: ReturnType<typeof setInterval> | undefined
  private publishing: Promise<void> | undefined
  private readonly publicationProgress: SyncProgress = { sessionsPending: 0, sessionsTotal: 0 }
  private importing: Promise<void> | undefined
  private importAgain = false
  private closed = false

  /** Opaque read of {@link importAgain}, set by a concurrent schedule while a pass awaits. */
  private repeatImport(): boolean {
    return this.importAgain
  }
  /** Claims this device holds, by session. */
  private readonly claims = new Map<SessionId, Claim>()
  private readonly releases = new Map<string, Promise<void>>()
  /** Direct local-network subscriptions to sessions this device holds. */
  private readonly watchers = new Map<string, () => void>()
  private readonly running = new Set<SessionId>()
  private readonly ownership = new Map<SessionId, Promise<unknown>>()
  /** Fold positions read this process, by session. */
  private readonly folds = new Map<string, Fold>()
  /** Inbox keys this device tried to apply and could not; another device applies them. */
  private readonly declined = new Set<string>()
  /** The claim of the last batch applied from the local network, by session. */
  private readonly lanClaims = new Map<string, string | undefined>()

  private own<T>(id: SessionId, work: () => Promise<T>): Promise<T> {
    const operation = (this.ownership.get(id) ?? Promise.resolve()).then(work)
    this.ownership.set(id, operation.catch(() => {}))
    return operation
  }

  /**
   * Take the next turn of a session on this device. With a relay, this device takes the session's lease, folds the
   * stream to its end, and claims the accepted head. Without one it claims what it holds; the fold decides later.
   * @param sessionId - session to continue on this device.
   * @returns whether this device may admit input locally; false only while another device runs a turn.
   */
  claim(sessionId: SessionId): Promise<SessionClaim> {
    // A turn running here continues without waiting for an earlier operation on the session.
    // So does a claim whose lease is still held, such as the one the input that starts this turn just took.
    const current = this.claims.get(sessionId)
    if (current !== undefined && !this.isClosed() && current.holder?.refused() !== true
      && (this.running.has(sessionId) || current.holder?.held() === true)) {
      return Promise.resolve({ claimed: true })
    }
    return this.own(sessionId, async () => {
      await this.starting
      // The device another one took the session from disposes its own Agent, and that disposal waits for a turn
      // running here. A turn that waited for the release would keep it open for good, so it starts nowhere
      // instead; a rewrite asks its prompts again on the accepted history.
      if (this.releases.has(sessionId)) return { claimed: false }
      const me = this.device()
      if (me === undefined || this.isClosed()) return { claimed: false }
      const entry = this.docs?.index.doc.getMap<IndexEntry>('sessions').get(sessionId)
      if (entry !== undefined && entry.header.owner !== this.owner) throw new Error('session does not belong to this account')
      let holder: LeaseHolder | undefined
      if (this.sync.status(this.owner).state === 'online') {
        const timing = this.tuning.runnerLease
        if (timing === undefined) throw new Error('session runner lease timing is not configured')
        const lease: LeaseHolder = new LeaseHolder(this.sync, this.owner, streamName(sessionId), timing, {
          changed: (held) => {
            // The relay gave the lease to another device: a turn runs there now, so this device stops running one.
            if (!held && lease.refused() && this.claims.get(sessionId)?.holder === lease) {
              void this.releaseLocal(sessionId).catch((error: unknown) => {
                this.warn(`session sync: releasing a session failed: ${String(error)}`)
              })
            }
          },
        })
        await lease.renew()
        if (lease.refused()) {
          await lease.dispose()
          return { claimed: false }
        }
        // An unreachable relay leaves the lease unanswered; the claim proceeds without one and the fold decides.
        if (lease.held()) holder = lease
        else await lease.dispose()
      }
      try {
        if (entry !== undefined && holder !== undefined) {
          await this.fold(sessionId, entry).catch((error: unknown) => {
            this.warn(`session sync: reading ${sessionId} before a turn failed; continuing on the local log: ${String(error)}`)
          })
        }
        const stored = (await this.persistence.list()).find(header => header.id === sessionId)
        if (stored !== undefined && stored.owner !== this.owner) throw new Error('session does not belong to this account')
        const localNext = stored === undefined ? 0 : await this.next(sessionId, new Set([sessionId]))
        const fold = this.folds.get(sessionId)
        const previous = this.claims.get(sessionId)
        // A claim continues when nothing was accepted after it; otherwise a new one starts at the accepted head.
        const continues = previous !== undefined && (entry === undefined || fold === undefined
          || (fold.claim === previous.id && fold.head === previous.published) || previous.published === fold.head)
        const base = entry === undefined ? 0 : Math.min(localNext, fold?.head ?? localNext)
        const claim: Claim = continues
          ? { ...previous, ...holder === undefined ? {} : { holder } }
          : { id: randomUUID(), base, published: base, ...holder === undefined ? {} : { holder } }
        if (previous?.holder !== undefined && previous.holder !== holder) await previous.holder.dispose()
        this.claims.set(sessionId, claim)
        // Another device taking this session over reaches this one only on the local network, so it listens for it.
        this.watch(sessionId)
        if (stored?.replica === true) await this.persistence.setReplica(sessionId, false)
        this.localNext.delete(sessionId)
        return { claimed: true }
      } catch (error) {
        await holder?.dispose()
        throw error
      }
    })
  }

  /**
   * Report whether a locally running session has a running turn.
   * @param sessionId - session running locally.
   * @param running - whether it has a running turn.
   */
  holdRunner(sessionId: SessionId, running: boolean): Promise<void> {
    if (running) {
      this.running.add(sessionId)
      this.claims.get(sessionId)?.holder?.start()
      const entry = this.docs?.index.doc.getMap<IndexEntry>('sessions').get(sessionId)
      if (entry !== undefined && entry.running !== true) this.entries().set(sessionId, { ...entry, running: true })
      return Promise.resolve()
    }
    if (!this.running.delete(sessionId)) return Promise.resolve()
    return this.own(sessionId, async () => {
      if (this.running.has(sessionId)) return
      const claim = this.claims.get(sessionId)
      if (claim !== undefined) {
        await this.serialize(sessionId, () => this.publishSession(sessionId)).catch((error: unknown) => {
          this.warn(`session sync: publishing a finished turn failed: ${String(error)}`)
        })
        await this.sync.synchronize(this.owner).catch((error: unknown) => {
          // Without a relay the batches already took the local network; the fold settles them later.
          this.warn(`session sync: publishing before a release did not finish: ${String(error)}`)
        })
      }
      if (this.running.has(sessionId)) return
      const holder = claim?.holder
      if (claim !== undefined) delete claim.holder
      await holder?.dispose()
      const entry = this.entries().get(sessionId)
      if (entry !== undefined && entry.running === true) this.entries().set(sessionId, { ...entry, running: false })
      // The fold confirms the turn landed, or rewrites it and asks its prompts again.
      if (entry !== undefined && this.sync.status(this.owner).state === 'online') {
        await this.fold(sessionId, entry).catch((error: unknown) => {
          this.warn(`session sync: confirming a finished turn failed: ${String(error)}`)
        })
      }
      this.consumeInbox()
    })
  }

  /**
   * Stop continuing a session on this device: stop and drain its local agent, and keep its log as a copy that
   * follows the stream.
   * @param sessionId - the session.
   * @returns when the local agent stopped and the log is a copy.
   */
  private releaseLocal(sessionId: SessionId): Promise<void> {
    const existing = this.releases.get(sessionId)
    if (existing !== undefined) return existing
    this.watch(sessionId)
    const release = (async () => {
      const claim = this.claims.get(sessionId)
      this.claims.delete(sessionId)
      this.running.delete(sessionId)
      await this.released?.(sessionId)
      await claim?.holder?.dispose()
      if ((await this.persistence.list()).some(header => header.id === sessionId && header.replica !== true)) {
        await this.persistence.setReplica(sessionId, true)
      }
      this.localNext.delete(sessionId)
      this.appendedNext.delete(sessionId)
    })().finally(() => {
      if (this.releases.get(sessionId) === release) this.releases.delete(sessionId)
    })
    this.releases.set(sessionId, release)
    return release
  }

  private readonly localNext = new Map<string, number>()
  /** One past the last `seq` this process saw committed, per session. */
  private readonly appendedNext = new Map<string, number>()
  private readonly revisions = new Map<string, string>()

  /**
   * What this device recorded about a session across restarts.
   * @param id - the session.
   * @returns the record, empty when none is stored.
   */
  private recorded(id: string): SessionRecord {
    const stored = this.sync.localValue(this.owner, `${RECORD_PREFIX}${id}`)
    if (stored === undefined) return {}
    try {
      return JSON.parse(stored) as SessionRecord
    } catch {
      // A record this build cannot read costs one fold from the stream's start; nothing else depends on it.
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
  /** An inbox pass was requested while one ran. */
  private consumeAgain = false
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
   * @param tuning - scan interval, batch size, backfill window, and input timing.
   * @param warn - receives failures to publish or import.
   * @param attachments - this Host's attachment store, when one is mounted.
   * @param filing - this Host's workspace registry, when one is mounted.
   * @param deliver - applies inputs other devices forwarded; rejects when this device cannot apply one.
   * @param liveChange - receives sessions whose live state another device changed.
   * @param released - stops and drains a local agent before its log becomes a copy.
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
   * Fetch the attachments some imported events reference that are missing here and another device published. One
   * not published yet, because its events arrived before the index named it, is fetched once the index does.
   * @param events - the imported events.
   */
  private async importAttachments(events: unknown): Promise<void> {
    const store = this.attachments
    if (store === undefined) return
    const published = this.published()
    for (const id of attachmentIds(events)) {
      if (await store.hasObject(AttachmentId(id))) continue
      if (!published.has(id)) {
        this.awaitedAttachments.add(id)
        continue
      }
      await this.downloadAttachment(id)
    }
  }

  /** Attachments imported events reference that no device had published when the events arrived. */
  private readonly awaitedAttachments = new Set<string>()
  /** Attachment downloads in flight, so a route and an import never fetch the same object twice. */
  private readonly downloads = new Map<string, Promise<void>>()

  /**
   * Download one published attachment into this Host's store.
   * @param id - the attachment's content address.
   * @returns when the object is stored.
   */
  private downloadAttachment(id: string): Promise<void> {
    const store = this.attachments
    if (store === undefined) return Promise.resolve()
    const existing = this.downloads.get(id)
    if (existing !== undefined) return existing
    const download = (async () => {
      if (await store.hasObject(AttachmentId(id))) return
      // The index can name an attachment before every chunk is readable on the relay, such as when the index arrived
      // directly over a local network; the download waits for the chunks the index counts.
      const expected = this.published().get(id)?.chunks ?? 1
      const deadline = Date.now() + this.tuning.attachmentWaitMs
      const parts: Uint8Array[] = []
      let cursor = 0
      for (;;) {
        const { batches, more } = await this.sync.readStream(this.owner, attachmentStream(id), cursor)
        for (const batch of batches) {
          parts.push(batch.payload)
          cursor = batch.seq
        }
        if (more) continue
        if (parts.length >= expected) break
        if (Date.now() >= deadline || this.isClosed()) {
          throw new Error(`attachment ${id} has ${String(parts.length)} of ${String(expected)} chunks on the relay`)
        }
        await pause(this.tuning.attachmentRetryMs)
      }
      await store.importObject(AttachmentId(id), new Uint8Array(Buffer.concat(parts)))
      this.awaitedAttachments.delete(id)
    })().finally(() => { this.downloads.delete(id) })
    this.downloads.set(id, download)
    return download
  }

  /**
   * Download an attachment another device published, such as one a conversation on screen cites.
   * @param id - the attachment's content address.
   * @returns whether this Host holds the attachment now.
   */
  async fetchAttachment(id: string): Promise<boolean> {
    await this.starting
    const store = this.attachments
    if (store === undefined || this.docs === undefined) return false
    if (await store.hasObject(AttachmentId(id))) return true
    // A conversation's events can arrive before the index names an attachment they cite; the read waits for it.
    if (!this.published().has(id) && !await this.publication(id)) return false
    await this.downloadAttachment(id)
    return true
  }

  /**
   * Wait for the index to name an attachment as published.
   * @param id - the attachment's content address.
   * @returns whether it was published within {@link SessionSyncTuning.attachmentWaitMs}.
   */
  private publication(id: string): Promise<boolean> {
    const published = this.published()
    return new Promise<boolean>((resolve) => {
      const settle = (named: boolean): void => {
        clearTimeout(timer)
        published.unobserve(seen)
        resolve(named)
      }
      const seen = (): void => { if (published.has(id)) settle(true) }
      const timer = setTimeout(() => { settle(false) }, this.tuning.attachmentWaitMs)
      published.observe(seen)
    })
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

  private liveStates(): YMap<LiveEntry> {
    return this.started().live.doc.getMap<LiveEntry>('sessions')
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
   * The accepted head this device knows for a session: its fold position, or its stored log before any fold.
   * @param id - the session.
   * @param local - sessions stored here.
   * @param revisions - stored log revisions, by session.
   * @returns one past the last accepted `seq` known here.
   */
  private async knownHead(id: string, local: ReadonlySet<string>, revisions?: ReadonlyMap<string, string>): Promise<number> {
    const fold = this.folds.get(id)
    if (fold !== undefined) return Math.max(fold.head, this.localNext.get(id) ?? 0)
    const head = this.recorded(id).head
    return Math.max(head ?? 0, await this.next(id, local, revisions))
  }

  /**
   * Bring one conversation up to date when opened. A conversation this device already stores opens at once and
   * the stream folds in the background; one this device has never stored waits for its own events.
   * @param sessionId - shared conversation.
   * @param signal - cancellation while its publishing device uploads its first prefix.
   * @returns when the conversation can open from its local log.
   */
  async fetch(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    await this.starting
    signal?.throwIfAborted()
    let entry = this.entries().get(sessionId)
    if (entry === undefined) return
    if (entry.header.owner !== this.owner) throw new Error('session does not belong to this account')
    if (this.claims.has(sessionId) && this.running.has(sessionId)) return
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
    const stored = local.has(sessionId) || this.created.has(sessionId)
    if (stored && await this.knownHead(sessionId, local) >= opened.next) return
    const importing = this.fold(sessionId, opened).then(async () => {
      await this.file(sessionId, opened)
    })
    if (stored) {
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
   * Tell the model which of the account's devices runs this turn of a shared conversation, since its earlier turns
   * may have run on another device whose file paths do not exist here.
   * @param sessionId - the session.
   * @returns the runtime-context sentence, or empty for a conversation only this device holds.
   */
  deviceContext(sessionId: SessionId): string {
    const docs = this.docs
    const me = this.device()
    if (docs === undefined || me === undefined || !this.shared(sessionId)) return ''
    const name = docs.names.doc.getMap<{ name: string }>('names').get(me)?.name
    const system = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : process.platform
    const device = name === undefined || name === '' ? `a ${system} device` : `"${name}" (${system})`
    return `This conversation is shared across the user's devices, and this turn runs on ${device}. Earlier turns may have run on another device: file paths they used may not exist on this one.`
  }

  /**
   * The device running a turn of a session when it is another device of the account.
   * @param sessionId - the session.
   * @returns the device, or undefined when no other device runs a turn of it.
   */
  runnerOf(sessionId: SessionId): SessionRunner | undefined {
    const docs = this.docs
    if (docs === undefined) return undefined
    const state = docs.live.doc.getMap<LiveEntry>('sessions').get(sessionId)
    if (state === undefined || state.device === this.device()) return undefined
    // A device that stopped confirming its turn, such as one that fell asleep, no longer runs it.
    const ttl = this.tuning.runnerLease?.ttlMs ?? 0
    if (state.at !== undefined && state.at + ttl < Date.now()) return undefined
    const name = docs.names.doc.getMap<{ name: string }>('names').get(state.device)?.name ?? ''
    return { device: state.device, name }
  }

  /**
   * Publish the live state of a session whose turn runs here; a turn running on another device is left to it.
   * @param sessionId - the session.
   * @param live - the state, or undefined to clear it.
   */
  publishLive(sessionId: SessionId, live: unknown): void {
    const me = this.device()
    if (this.docs === undefined || me === undefined || this.runnerOf(sessionId) !== undefined) return
    const states = this.liveStates()
    if (live === undefined) {
      if (states.get(sessionId)?.device === me) states.delete(sessionId)
      return
    }
    states.set(sessionId, { device: me, live, at: Date.now() })
  }

  /**
   * The live state the device running a session's turn published for it.
   * @param sessionId - the session.
   * @returns the state, or undefined when no other device runs a turn of it.
   */
  liveOf(sessionId: SessionId): unknown {
    const runner = this.runnerOf(sessionId)
    const entry = this.docs?.live.doc.getMap<LiveEntry>('sessions').get(sessionId)
    return runner !== undefined && entry?.device === runner.device ? entry.live : undefined
  }

  /**
   * Hand one input to the account's devices; the device that runs the session's next turn applies it. The input
   * waits in the synced inbox while no device can take it, including while this device is offline.
   * @param sessionId - the session.
   * @param input - the input.
   */
  async forward(sessionId: SessionId, input: SessionHandoffInput): Promise<void> {
    await this.starting
    const me = this.device()
    if (me === undefined || this.docs === undefined) throw new Error('account sync has not started on this device')
    await this.publishAttachments(input.request).catch((error: unknown) => {
      // The input still travels; its attachments upload again with the events that reference them.
      this.warn(`session sync: publishing a forwarded input's attachments failed: ${String(error)}`)
    })
    this.enqueue(sessionId, input, me)
    this.consumeInbox()
  }

  private enqueue(sessionId: SessionId | string, input: SessionHandoffInput, from: string): void {
    const entry: InboxEntry = { session: sessionId, input, from, at: Date.now() }
    this.pending().set(`${String(entry.at).padStart(16, '0')}:${randomUUID()}`, entry)
  }

  /** Apply waiting inputs this device can take, oldest first; one pass at a time. */
  private consumeInbox(): void {
    if (this.docs === undefined || this.isClosed()) return
    this.consumeAgain = true
    this.consuming = this.consuming.then(async () => {
      while (this.consumeAgain && !this.isClosed()) {
        this.consumeAgain = false
        await this.consumePass().catch((error: unknown) => {
          this.warn(`session sync: applying forwarded input failed: ${String(error)}`)
        })
      }
    })
  }

  private async consumePass(): Promise<void> {
    const me = this.device()
    const deliver = this.deliver
    if (me === undefined || deliver === undefined) return
    const inputs = this.pending()
    const now = Date.now()
    const waiting = [...inputs.entries()].sort(([left], [right]) => left.localeCompare(right))
    for (const [key, entry] of waiting) {
      if (this.isClosed()) return
      if (!inputs.has(key) || this.declined.has(key)) continue
      const sessionId = entry.session as SessionId
      const runsHere = this.running.has(sessionId) && this.claims.has(sessionId)
      if (TURN_INPUTS.has(entry.input.operation)) {
        if (!runsHere) {
          // An input for a turn that no device runs any more has nothing left to change.
          if (this.runnerOf(sessionId) === undefined && entry.at + this.tuning.inputExpiryMs < now) inputs.delete(key)
          continue
        }
      } else if (!runsHere) {
        // The device the input was typed on gets the first chance to run it.
        if (entry.from !== me && entry.at + this.tuning.inputGraceMs > now) continue
        if (this.runnerOf(sessionId) !== undefined) continue
        const claimed = await this.claim(sessionId).catch((error: unknown) => {
          this.warn(`session sync: taking a session for forwarded input failed: ${String(error)}`)
          return { claimed: false }
        })
        if (!claimed.claimed || !inputs.has(key)) continue
      }
      inputs.delete(key)
      await this.importAttachments(entry.input.request).catch((error: unknown) => {
        this.warn(`session sync: fetching a forwarded input's attachments failed: ${String(error)}`)
      })
      try {
        await deliver(sessionId, entry.input)
      } catch (error) {
        // Another device of the account may be able to apply it, such as one signed in to the session's model.
        this.declined.add(key)
        inputs.set(key, entry)
        this.warn(`session sync: forwarded input for ${sessionId} was left for another device: ${String(error)}`)
      }
    }
  }

  /** Open the index, fold what other devices published, and start publishing this device's sessions. */
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
    const me = this.device()
    // A turn this device ran before it restarted is not running any more.
    for (const [id, state] of [...this.liveStates().entries()]) if (state.device === me) this.liveStates().delete(id)
    live.doc.getMap<LiveEntry>('sessions').observe((event: YMapEvent<LiveEntry>, transaction: Transaction) => {
      if (transaction.local) return
      for (const key of event.keysChanged) this.liveChange?.(key as SessionId)
      this.consumeInbox()
    })
    // A device that starts while another device runs a turn reads the state already published, not
    // only later changes, so the turn shows as running here from the first frame.
    for (const id of live.doc.getMap<LiveEntry>('sessions').keys()) this.liveChange?.(id as SessionId)
    this.entries().observe((_event: YMapEvent<IndexEntry>, transaction: Transaction) => {
      if (transaction.local) return
      this.catalogChanged?.()
      this.scheduleImport()
      this.progressChanged?.()
    })
    this.pending().observe((_event: YMapEvent<InboxEntry>, transaction: Transaction) => {
      if (!transaction.local) this.consumeInbox()
    })
    // An attachment whose events arrived before its publication is fetched as soon as the index names it.
    this.published().observe((event: YMapEvent<{ chunks: number }>, transaction: Transaction) => {
      if (transaction.local) return
      for (const id of event.keysChanged as Set<string>) {
        if (!this.awaitedAttachments.has(id)) continue
        void this.downloadAttachment(id).catch((error: unknown) => {
          this.warn(`session sync: fetching attachment ${id} failed: ${String(error)}`)
        })
      }
    })
    // Settling folds every stored conversation once, so it runs behind startup rather than holding opening and input.
    this.scheduleSettle()
    this.consumeInbox()
    this.scheduleImport()
    this.progressChanged?.()
    this.timer = setInterval(() => { void this.publish() }, this.tuning.publishMs)
    // Inputs wait on timing (the typing device's first chance, expiry), so the inbox is revisited while any wait.
    this.inputTimer = setInterval(() => { if (this.pending().size > 0) this.consumeInbox() }, this.tuning.inputGraceMs)
    // A running turn keeps confirming its live state, so a device that sleeps mid-turn stops reading as running.
    const renew = this.tuning.runnerLease?.renewMs
    if (renew !== undefined) {
      this.liveTimer = setInterval(() => {
        const states = this.liveStates()
        for (const id of this.running) {
          const state = states.get(id)
          if (state !== undefined && state.device === this.device()) states.set(id, { ...state, at: Date.now() })
        }
      }, renew)
    }
    void this.publish()
  }

  /** The account's connection came back: fold what was published meanwhile and settle what this device wrote. */
  reconnected(): void {
    this.scheduleSettle()
    this.scheduleImport()
    if (this.docs !== undefined) this.consumeInbox()
  }

  /** The running settle pass, if any. */
  private settling: Promise<void> | undefined
  /** A settle pass was requested while one ran. */
  private settleAgain = false

  /** Run {@link settleStored} once at a time; a request during a pass runs one more pass after it. */
  private scheduleSettle(): void {
    if (this.docs === undefined || this.isClosed()) return
    if (this.settling !== undefined) {
      this.settleAgain = true
      return
    }
    this.settling = (async () => {
      do {
        this.settleAgain = false
        await this.settleStored()
      } while (this.repeatSettle() && !this.isClosed())
    })().catch((error: unknown) => {
      this.warn(`session sync: settling stored sessions failed: ${String(error)}`)
    }).finally(() => { this.settling = undefined })
  }

  /** Opaque read of {@link settleAgain}, set by a concurrent request while a pass awaits. */
  private repeatSettle(): boolean {
    return this.settleAgain
  }

  /**
   * Turn every stored shared session that no turn here continues into a copy that follows the stream. A log that
   * holds events past the accepted head, such as a turn's last events when the device slept before publishing them,
   * publishes them first as a new claim; the fold keeps them only when no other device continued meanwhile.
   */
  private async settleStored(): Promise<void> {
    const me = this.device()
    if (me === undefined || this.isClosed()) return
    const online = this.sync.status(this.owner).state === 'online'
    const snapshots = await this.persistence.listSnapshots()
    const local = new Set(snapshots.map(({ header }) => header.id as string))
    const revisions = new Map(snapshots.map(({ header, revision }) => [header.id as string, String(revision)]))
    // The most recently active conversations settle first.
    const ordered = [...snapshots].sort((left, right) => {
      const l = this.entries().get(left.header.id)
      const r = this.entries().get(right.header.id)
      return (r === undefined ? 0 : recency(r)) - (l === undefined ? 0 : recency(l))
    })
    for (const { header } of ordered) {
      if (this.isClosed()) return
      if (header.owner !== this.owner) continue
      const id = header.id
      // A copy is settled once it is compared; one this device published to and never compared may have diverged.
      const unsettled = this.recorded(id).head === undefined && this.recorded(id).revision !== undefined
      if (header.replica === true && !unsettled) continue
      await pause(this.tuning.pauseMs)
      const entry = this.entries().get(id)
      if (entry === undefined || this.claims.has(id) || this.running.has(id)) continue
      await this.own(id, async () => {
        if (this.claims.has(id) || this.running.has(id)) return
        const localNext = await this.next(id, local, revisions)
        if (this.recorded(id).head === undefined) {
          // A log the old rules already prove consistent records its position without reading the stream again.
          const trusted = this.trustedStart(id, entry, localNext, header.replica === true)
          if (trusted !== undefined) this.record(id, { head: trusted.head, cursor: trusted.cursor })
        }
        const recorded = this.recorded(id)
        if (online && (recorded.head === undefined || localNext !== recorded.head || entry.next > localNext)) {
          await this.fold(id, entry).catch((error: unknown) => {
            this.warn(`session sync: reading ${id} while settling failed: ${String(error)}`)
          })
        }
        const head = this.folds.get(id)?.head ?? recorded.head ?? entry.next
        const stored = await this.next(id, local, revisions)
        if (stored > head) {
          // The unpublished tail travels as a claim at the accepted head; publication marks it for confirmation.
          this.claims.set(id, { id: randomUUID(), base: head, published: head })
          await this.serialize(id, () => this.publishSession(id)).catch((error: unknown) => {
            this.warn(`session sync: publishing ${id}'s unpublished events failed: ${String(error)}`)
          })
          this.claims.delete(id)
        }
        if (header.replica !== true) {
          await this.persistence.setReplica(id, true).catch((error: unknown) => {
            this.warn(`session sync: marking ${id} a copy failed: ${String(error)}`)
          })
        }
        this.watch(id)
      })
    }
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
    if (!local.has(id) && !this.created.has(id)) return 0
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
   * Subscribe once to the batches devices send directly on the local network.
   * @param id - a session this device holds.
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
   * Apply one batch a device sent directly, under the fold's rule against the local log. The relay's order
   * settles it: the next fold keeps it or rewrites it.
   * @param id - the session.
   * @param payload - the batch.
   * @returns when the batch is durable locally.
   */
  private ingestLan(id: string, payload: Uint8Array): Promise<void> {
    return this.own(id as SessionId, async () => {
      await this.starting
      await this.releases.get(id)
      if (this.isClosed() || this.running.has(id as SessionId)) return
      const batch = await readBatch(payload)
      await this.serialImport(id, async () => {
        const next = await this.next(id, new Set([id]))
        const events = batch.events.filter(event => event.seq >= next)
        if (events[0]?.seq !== next) return
        if (batch.claim !== undefined) {
          const current = this.lanClaims.get(id) ?? this.folds.get(id)?.claim
          if (batch.claim !== current && batch.first !== batch.base) return
          // A batch that starts before this log's end overlaps events already held; the relay settles the overlap.
          if (batch.first > next) return
        }
        if (this.claims.has(id as SessionId)) await this.releaseLocal(id as SessionId)
        await this.persistence.append(id as SessionId, events)
        await this.importAttachments(events)
        this.localNext.set(id, after(events, next))
        this.lanClaims.set(id, batch.claim)
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
    const ordered: [string, IndexEntry][] = []
    for (const [id, entry] of [...this.entries()].sort(([, left], [, right]) => recency(right) - recency(left))) {
      if (entry.header.owner !== this.owner) continue
      if (this.running.has(id as SessionId)) continue
      if (entry.next > await this.knownHead(id, local, revisions)) ordered.push([id, entry])
    }
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
        await this.fold(id, entry, revisions)
        if (local.has(id) || this.created.has(id)) await this.file(id, entry)
      } catch (error) {
        this.warn(`session sync: importing a session failed: ${String(error)}`)
      }
    }
    // A device whose turn this one no longer runs keeps its claim until the stream says another device's won; the
    // fold compares the two, so a claim the accepted history superseded ends here rather than at the next turn.
    const imported = new Set(ordered.map(([id]) => id))
    for (const id of [...this.claims.keys()]) {
      const entry = this.entries().get(id)
      if (entry === undefined || imported.has(id) || !local.has(id) || this.running.has(id)) continue
      await this.releases.get(id)
      await this.fold(id, entry, revisions).catch((error: unknown) => {
        this.warn(`session sync: confirming this device still writes ${id} failed: ${String(error)}`)
      })
    }
  }

  /** File a stored imported session into its workspace once that workspace is on this device too. */
  private async file(id: string, entry: IndexEntry): Promise<void> {
    const home = entry.workspace
    if (this.filing === undefined || home === undefined || this.filed.has(id)) return
    if (await this.filing.fileSession(id as SessionId, home, { ...entry.header, replica: true })) this.filed.add(id)
  }

  /** Run one change to a session's stored log after every earlier one, whether it came from the relay or the local network. */
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

  /**
   * The fold position to continue from. A record without a head predates claims; its stored log may have diverged
   * from the stream, so the fold starts over and {@link applyAccepted} compares every stored event.
   */
  private async foldStart(
    id: string,
    entry: IndexEntry,
    local: ReadonlySet<string>,
    replica: boolean,
    revisions?: ReadonlyMap<string, string>,
  ): Promise<Fold> {
    const known = this.folds.get(id)
    if (known !== undefined) return known
    const recorded = this.recorded(id)
    if (recorded.head !== undefined) {
      return {
        cursor: recorded.cursor ?? 0,
        head: recorded.head,
        ...recorded.claim === undefined ? {} : { claim: recorded.claim },
      }
    }
    if (local.has(id)) {
      const trusted = this.trustedStart(id, entry, await this.next(id, local, revisions), replica)
      if (trusted !== undefined) return trusted
    }
    return { cursor: 0, head: 0 }
  }

  /**
   * The fold position of a stored log whose record predates claims, when the old rules prove it consistent with the
   * stream: an imported copy only ever appended the stream's events up to its recorded cursor, and a log the index
   * still names this device the writer of, at exactly the published length, is the history itself. Any other log may
   * have diverged and is compared from the stream's start.
   * @param id - the session.
   * @param entry - its index entry.
   * @param localNext - one past the last stored `seq`.
   * @param replica - whether the stored log is an imported copy.
   * @returns the position to continue from, or undefined when the log must be compared.
   */
  private trustedStart(id: string, entry: IndexEntry, localNext: number, replica: boolean): Fold | undefined {
    const recorded = this.recorded(id)
    // A copy this device ever published to may hold its own events where the stream holds another device's.
    if (replica && recorded.cursor !== undefined && recorded.revision === undefined) return { cursor: recorded.cursor, head: localNext }
    // Entries published before claims name the writing device; this build no longer writes the field.
    const origin = (entry as IndexEntry & { origin?: string }).origin
    if (!replica && origin !== undefined && origin === this.device() && entry.next === localNext) return { cursor: 0, head: localNext }
    return undefined
  }

  /**
   * Fold a session's stream from this device's position to its end and make the stored log equal the accepted
   * history: append what it lacks, rewrite what differs, and stop a claim of this device that another claim
   * superseded.
   * @param id - the session.
   * @param entry - its index entry.
   * @param revisions - stored log revisions, by session.
   */
  private fold(id: string, entry: IndexEntry, revisions?: ReadonlyMap<string, string>): Promise<void> {
    return this.serialImport(id, async () => {
      const headers = await this.persistence.list()
      const local = new Set(headers.map(header => header.id as string))
      const replica = headers.find(header => header.id === id)?.replica === true
      const fold = { ...await this.foldStart(id, entry, local, replica, revisions) }
      // The stored log, read once per pass for comparing accepted events with what this device holds.
      const held: { events?: readonly SessionEvent[] } = {}
      let stored = false
      try {
        // A seeded artifact's inherited prefix must commit in one append, so it accumulates across the batches
        // that carry it instead of failing as a gap on every batch after the first.
        let pending: SessionEvent[] = []
        reading: for (;;) {
          await this.yieldToOpening(id)
          const { batches, more } = await this.sync.readStream(this.owner, streamName(id), fold.cursor)
          if (this.isClosed()) return
          for (const { seq, payload } of batches) {
            const batch = await readBatch(payload)
            const events = this.accept(batch, fold)
            fold.cursor = seq
            if (events === undefined) {
              const first = batch.events[0]?.seq
              // A batch that starts past the accepted head leaves a hole the relay never fills: report it.
              if (first !== undefined && first > fold.head) {
                throw new Error(`session ${id} is missing events ${String(fold.head)}–${String(first - 1)}`)
              }
              continue
            }
            pending.push(...events)
            // The buffered events are the accepted history so far, so the next batch continues from their end.
            fold.head = after(events, fold.head)
            if (batch.claim !== undefined) fold.claim = batch.claim
            if (fold.head < entry.inherited) continue
            const accepted = await this.applyAccepted(id, entry, pending, batch.claim, local, held, revisions)
            if (accepted === 'gap') {
              // The stored log is shorter than the recorded head: fold again from the stream's start.
              this.folds.delete(id)
              this.record(id, { head: undefined, cursor: undefined, claim: undefined })
              Object.assign(fold, { cursor: 0, head: 0, claim: undefined })
              pending = []
              continue reading
            }
            if (accepted === 'stored') stored = true
            pending = []
          }
          // A prefix still short of its inherited length records nothing, so the next pass reads its batches again.
          if (pending.length === 0) {
            this.folds.set(id, { ...fold })
            this.record(id, { cursor: fold.cursor, head: fold.head, claim: fold.claim })
          }
          if (!more || this.isClosed()) break
        }
        // A claim of this device the stream never accepted, and that no turn here still continues, is over.
        const mine = this.recorded(id).mine
        if (mine !== undefined && mine.claim !== fold.claim && !this.claims.has(id as SessionId)) this.record(id, { mine: undefined })
      } finally {
        // Listeners rebuild from the whole stored log, so they follow a pass rather than each of its batches.
        if (stored) this.imported?.(id as SessionId)
      }
    })
  }

  /**
   * The fold rule: the events a batch adds to the accepted history, or undefined when the history rejects it.
   * @param batch - the next batch in the relay's order.
   * @param fold - the accepted head and claim before it.
   * @returns the accepted events, starting at the head.
   */
  private accept(batch: Batch, fold: Fold): SessionEvent[] | undefined {
    if (batch.claim !== undefined && batch.claim !== fold.claim && batch.first !== batch.base) {
      // A new claim starts at the head the stream accepted, so a batch before its base belongs to no history.
      return undefined
    }
    // A claim can start behind the accepted head, repeating events the history already holds; those are dropped
    // and the batch continues from the head.
    const events = batch.events.filter(event => event.seq >= fold.head)
    return events[0]?.seq === fold.head ? events : undefined
  }

  /**
   * Make the stored log hold accepted events at their positions.
   * @param id - the session.
   * @param entry - its index entry.
   * @param events - accepted events, contiguous from the previous head.
   * @param claim - the claim they belong to.
   * @param local - sessions stored here.
   * @param held - the stored log as this pass last read it; cleared whenever the log changes.
   * @param revisions - stored log revisions, by session.
   * @param retry - whether a refused append reads the stored length again and retries once.
   * @returns `gap` when the stored log ends before the events start, `same` when it already holds them.
   */
  private async applyAccepted(
    id: string, entry: IndexEntry, events: readonly SessionEvent[], claim: string | undefined,
    local: ReadonlySet<string>, held: { events?: readonly SessionEvent[] }, revisions?: ReadonlyMap<string, string>, retry = true,
  ): Promise<'stored' | 'same' | 'gap'> {
    const first = events[0]?.seq ?? 0
    const exists = local.has(id) || this.created.has(id)
    const localNext = exists ? await this.next(id, local, revisions) : 0
    if (first > localNext) {
      if (exists || first > 0) return 'gap'
    }
    const sessionId = id as SessionId
    const own = this.claims.get(sessionId)
    // Another device continued the session: a claim of this device ends, and so does its local agent.
    if (own !== undefined && own.id !== claim) await this.releaseLocal(sessionId)
    let fresh = events
    if (first < localNext) {
      held.events ??= (await this.persistence.readFrom(sessionId, SessionLogOffset(0))).events
      const tail = held.events.slice(first)
      let same = 0
      while (same < tail.length && same < events.length && sameEvent(tail[same] as SessionEvent, events[same] as SessionEvent)) same++
      if (same < tail.length && same < events.length) {
        delete held.events
        await this.rewrite(sessionId, entry, first + same, events.slice(same), tail.slice(same))
        return 'stored'
      }
      fresh = events.slice(same)
    }
    if (fresh.length === 0) return 'same'
    delete held.events
    if (!exists) {
      // A seeded artifact materializes only once its complete inherited prefix can commit together.
      if (after(fresh, first) < entry.inherited) return 'stored'
      await this.persistence.create(
        { ...entry.header, replica: true },
        entry.header.isSeeded ? SessionLogOffset(entry.inherited) : undefined,
      )
      this.created.add(id)
      this.watch(id)
    }
    try {
      await this.persistence.append(sessionId, fresh)
    } catch (error) {
      // A refused append means the stored length this pass compared with was stale; it is read again once.
      if (!retry) throw error
      this.localNext.delete(id)
      delete held.events
      return await this.applyAccepted(id, entry, events, claim, local, held, undefined, false)
    }
    await this.importAttachments(fresh)
    this.localNext.set(id, after(fresh, localNext))
    return 'stored'
  }

  /**
   * Replace a stored log's tail with the accepted history. The tail this device wrote under a claim the history
   * rejected is dropped, and the prompts in it are asked again on the accepted history.
   * @param sessionId - the session.
   * @param entry - its index entry.
   * @param from - first position where the stored log differs.
   * @param accepted - accepted events from that position.
   * @param dropped - the stored events from that position.
   */
  private async rewrite(
    sessionId: SessionId, entry: IndexEntry, from: number, accepted: readonly SessionEvent[], dropped: readonly SessionEvent[],
  ): Promise<void> {
    const me = this.device()
    const mine = this.claims.get(sessionId) ?? this.recorded(sessionId).mine
    await this.releaseLocal(sessionId)
    const prefix = (await this.persistence.readFrom(sessionId, SessionLogOffset(0))).events.slice(0, from)
    await this.persistence.delete(sessionId)
    await this.persistence.create(
      { ...entry.header, replica: true },
      entry.header.isSeeded ? SessionLogOffset(entry.inherited) : undefined,
    )
    await this.persistence.append(sessionId, [...prefix, ...accepted])
    await this.importAttachments(accepted)
    this.localNext.set(sessionId, after(accepted, from))
    this.record(sessionId, { mine: undefined })
    this.warn(`session sync: ${sessionId} diverged at ${String(from)}; its log now follows the account's history`)
    // Only the device that wrote the dropped turn asks its prompts again, so each is asked once.
    if (me !== undefined && mine !== undefined && from >= mine.base) {
      const answered = new Set(accepted.flatMap((event) => {
        const rpcId = (event.data as unknown as { source?: { rpcId?: unknown } }).source?.rpcId
        return typeof rpcId === 'string' ? [rpcId] : []
      }))
      for (const input of droppedPrompts(dropped)) {
        if (answered.has((input.request as { requestId: string }).requestId)) continue
        this.enqueue(sessionId, input, me)
      }
      this.consumeInbox()
    }
  }

  /**
   * Read the discovered conversation uploads and eligible history downloads.
   * @returns counters that include sessions not yet read or queued.
   */
  progress(): Readonly<SyncProgress> {
    const progress = { ...this.publicationProgress }
    if (this.docs === undefined) return progress
    const homes = this.filing?.sessionHomes()
    for (const [id, entry] of this.entries()) {
      if (entry.header.owner !== this.owner || this.claims.has(id as SessionId)) continue
      const next = Math.max(this.localNext.get(id) ?? 0, this.folds.get(id)?.head ?? 0)
      const local = this.localNext.has(id) || this.created.has(id)
      if (!local && homes !== undefined && !homes.has(id as SessionId)) continue
      if (!local && this.tuning.backfillDays > 0 && entry.header.createdAt < Date.now() - this.tuning.backfillDays * DAY_MS) continue
      progress.sessionsTotal += 1
      if (entry.next > next) progress.sessionsPending += 1
    }
    return progress
  }

  /**
   * Publish new events of sessions this device continues, and sessions it created that no device published yet.
   * @returns when this scan ends.
   */
  publish(): Promise<void> {
    const me = this.device()
    if (me === undefined || this.isClosed()) return Promise.resolve()
    this.publishing ??= this.publishAll().finally(() => { this.publishing = undefined })
    return this.publishing
  }

  private async publishAll(): Promise<void> {
    try {
      const entries = this.entries()
      const snapshots = await this.persistence.listSnapshots()
      const homes = this.filing?.sessionHomes()
      const pending = snapshots.filter(({ header, revision }) => {
        const id = header.id as string
        const entry = entries.get(id)
        if (header.replica || header.owner !== this.owner) return false
        // A workspace move changes the index entry, not the log, so it is published without a new revision.
        if (entry !== undefined && homes !== undefined && entry.workspace !== homes.get(header.id)) return true
        // A shared session publishes only under a claim; one no device published yet publishes from its start.
        if (entry !== undefined && !this.claims.has(header.id)) return false
        if ((this.revisions.get(id) ?? this.recorded(id).revision) === String(revision)) return false
        const claim = this.claims.get(header.id)
        if (claim !== undefined && claim.published === this.appendedNext.get(id) && entry?.running === this.running.has(header.id)) {
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
        await pause(this.tuning.pauseMs)
        await this.serialize(id, () => this.publishSession(header.id, true))
        this.revisions.set(id, String(revision))
        this.record(id, { revision: String(revision) })
        this.publicationProgress.sessionsPending -= 1
        this.progressChanged?.()
      }
    } catch (error) {
      this.warn(`session sync: publishing sessions failed: ${String(error)}`)
    }
  }

  /** Run one publication of a session after every earlier one of the same session, and stop waiting for it. */
  private serialize(id: string, work: () => Promise<void>): Promise<void> {
    const run = (this.publications.get(id) ?? Promise.resolve()).then(() => this.bounded(id, work))
    // The caller reports the failure; the chain only orders publications.
    this.publications.set(id, run.catch(() => {}))
    return run
  }

  /**
   * Bound one publication so a call that never settles cannot hold a session's publications forever.
   * @param id - the session being published.
   * @param work - the publication.
   */
  private async bounded(id: string, work: () => Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`publishing session ${id} did not finish within ${String(this.tuning.publishTimeoutMs)} ms`))
      }, this.tuning.publishTimeoutMs)
    })
    try {
      await Promise.race([work(), expired])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Publish a session's newly committed events soon, rather than at the next scan, so the account's other
   * devices follow a running turn as it streams.
   * @param header - the header of the session whose events were committed.
   * @param events - the committed events; without them the scan reads the log to find what is new.
   */
  appended(header: SessionHeader, events: readonly SessionEvent[] = []): void {
    const id = header.id as string
    // The stored length the fold compares with follows every commit, including this device's own turns.
    const committed = events.at(-1)
    if (committed !== undefined && this.localNext.has(id)) this.localNext.set(id, committed.seq + 1)
    if (header.replica || header.owner !== this.owner || this.docs === undefined) return
    const last = events.at(-1)
    if (last !== undefined) this.appendedNext.set(id, last.seq + 1)
    if (this.live.has(id)) return
    this.live.set(id, setTimeout(() => {
      this.live.delete(id)
      if (this.device() === undefined || this.isClosed()) return
      if (this.entries().has(id) && !this.claims.has(header.id)) return
      this.serialize(id, () => this.publishSession(header.id)).catch((error: unknown) => {
        this.warn(`session sync: publishing a running session failed: ${String(error)}`)
      })
    }, this.tuning.liveMs))
  }

  /** Wait while the account's outbox holds more than {@link SessionSyncTuning.outboxLimit} frames. */
  private async outboxRoom(): Promise<void> {
    while (!this.isClosed() && this.sync.status(this.owner).pending > this.tuning.outboxLimit) await pause(this.tuning.publishMs)
  }

  /**
   * Publish a session's events after its claim's published position, and its metadata.
   * @param sessionId - the session.
   * @param history - whether this is history publication, which waits for room in the outbox between batches.
   */
  private async publishSession(sessionId: SessionId, history = false): Promise<void> {
    const me = this.device()
    if (me === undefined) return
    let entry = this.entries().get(sessionId)
    let claim = this.claims.get(sessionId)
    // A session no device published yet starts the history: this device's first claim begins at 0.
    if (claim === undefined && entry === undefined) {
      claim = { id: randomUUID(), base: 0, published: 0 }
      this.claims.set(sessionId, claim)
    }
    const from = claim?.published ?? entry?.next ?? 0
    const suffix = await this.persistence.readFrom(sessionId, SessionLogOffset(from))
    if (this.isClosed()) return
    const home = this.filing?.sessionHome(sessionId)
    if (claim === undefined || suffix.events.length === 0) {
      // Metadata only: running state, workspace, and titles and activity times an older entry lacks.
      const current = this.entries().get(sessionId)
      if (current === undefined) return
      const backfill = current.next > 0 && (current.title === undefined || current.updatedAt === undefined)
        ? (await this.persistence.readFrom(sessionId, SessionLogOffset(0))).events
        : undefined
      if (this.isClosed()) return
      const title = current.title ?? (backfill === undefined ? undefined : titleOf(backfill))
      const updatedAt = current.updatedAt ?? backfill?.filter(humanPrompt).at(-1)?.time
      if (current.running !== this.running.has(sessionId) || current.workspace !== home
        || current.title !== title || current.updatedAt !== updatedAt) {
        const { workspace: _previous, ...rest } = current
        this.entries().set(sessionId, {
          ...rest, running: this.running.has(sessionId),
          ...home === undefined ? {} : { workspace: home },
          ...title === undefined ? {} : { title },
          ...updatedAt === undefined ? {} : { updatedAt },
        })
      }
      return
    }
    if (!suffix.events.some(event => !INITIALIZATION_EVENTS.has(event.type))) {
      // Initialization events wait for conversation activity, so an unwritten draft never reaches the stream.
      if (entry === undefined) this.claims.delete(sessionId)
      return
    }
    const active = claim
    if (entry === undefined) {
      entry = { header: suffix.meta, next: 0, inherited: suffix.inheritedEventCount, ...home === undefined ? {} : { workspace: home } }
      this.entries().set(sessionId, entry)
    }
    this.record(sessionId, { mine: { claim: active.id, base: active.base } })
    let batch: SessionEvent[] = []
    let bytes = 0
    const prepared: Promise<Uint8Array>[] = []
    // Attachments travel before the events that reference them, so no device imports a reference it
    // cannot fetch yet. A failed upload costs the objects themselves, not the turn: the events still
    // publish, and the objects upload again once nothing marks them published.
    try {
      await this.publishAttachments(suffix.events)
    } catch (error) {
      this.warn(`session sync: publishing attachments of ${sessionId} failed: ${String(error)}`)
    }
    const queue = async (): Promise<void> => {
      const payloads = await Promise.all(prepared.splice(0))
      if (this.isClosed()) return
      for (const payload of payloads) {
        if (history) await this.outboxRoom()
        await this.sync.appendStream(this.owner, streamName(sessionId), payload)
      }
    }
    const flush = async (): Promise<void> => {
      const first = batch.at(0)
      if (first === undefined || this.isClosed()) return
      const payload: Batch = { first: first.seq, events: batch, claim: active.id, base: active.base }
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
    if (this.isClosed()) return
    active.published = after(suffix.events, from)
    const previous = this.entries().get(sessionId)
    const title = titleOf(suffix.events) ?? previous?.title
    this.entries().set(sessionId, {
      header: suffix.meta,
      running: this.running.has(sessionId),
      ...title === undefined ? {} : { title },
      updatedAt: suffix.events.filter(humanPrompt).at(-1)?.time
        ?? previous?.updatedAt ?? suffix.meta.createdAt,
      inherited: suffix.inheritedEventCount,
      next: Math.max(previous?.next ?? 0, active.published),
      ...home === undefined ? {} : { workspace: home },
    })
  }

  /** Stop scheduling, wait for active imports and publications, and close the index. */
  async dispose(): Promise<void> {
    this.closed = true
    this.offLateFiling?.()
    for (const resume of this.openingDone.splice(0)) resume()
    for (const timer of [this.timer, this.inputTimer, this.liveTimer]) if (timer !== undefined) clearInterval(timer)
    for (const off of this.watchers.values()) off()
    this.watchers.clear()
    for (const timer of this.live.values()) clearTimeout(timer)
    this.live.clear()
    await Promise.all([
      this.publishing, this.importing, this.consuming, this.settling, ...this.downloads.values(), ...this.publications.values(),
      ...this.ownership.values(), ...this.releases.values(), ...this.imports.values(),
    ])
    await Promise.all([...this.claims.values()].map(claim => claim.holder?.dispose() ?? Promise.resolve()))
    for (const handle of Object.values(this.docs ?? {})) handle.close()
  }
}

