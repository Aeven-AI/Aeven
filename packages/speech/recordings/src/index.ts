/**
 * Saved Recorder recordings, per account: each account's transcripts live in one JSON file under
 * `dataRoot`, mirrored into the account's synced `recordings` document so they appear on all of its
 * devices; the entry changed last wins, and a deletion leaves a tombstone. Audio is one file per
 * recording in the account's audio folder, which file sync shares with the account's other devices
 * when it runs. An account this Host does not sync (no signed-in user) keeps its recordings locally.
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import { brandString } from '@aeven/brand'
import type {} from '@aeven/file-sync'
import type { FileSyncFolderId } from '@aeven/file-sync'
import type { SyncDocument } from '@aeven/sync'
import type {} from '@aeven/sync'
import type { Config } from './config.ts'
import type { RecordingId, RecordingSummary, SavedRecording } from './types.ts'

export type { Config } from './config.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Saved Recorder recordings. */
    recordings: Recordings
  }
}

/** The owner of recordings made without a signed-in user; never synced. */
export const LOCAL_OWNER = 'local'

const DOCUMENT = 'recordings'
const MAP = 'recordings'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const AUDIO_EXTENSION = '.webm'

/** A deleted recording, kept so the deletion reaches the account's other devices. */
interface Tombstone {
  readonly id: RecordingId
  readonly deleted: true
  readonly changedAt: number
}

type Entry = SavedRecording | Tombstone

function isTombstone(entry: Entry): entry is Tombstone {
  return 'deleted' in entry
}

/**
 * Refuse an id that is not a recording id, before it names a file.
 * @param id - untrusted id.
 * @returns the id.
 */
export function recordingId(id: string): RecordingId {
  if (!ID.test(id)) throw new Error(`Invalid recording id: ${id}`)
  return brandString<RecordingId>(id)
}

/** Saved recordings for every account this Host serves. */
export class Recordings extends Service {
  /** Deployment configuration; see {@link Config}. */
  static Config: z<Partial<Config>, Config> = z.object({
    dataRoot: z.string().required(),
    maxAudioBytes: z.natural().default(512 * 1024 * 1024),
  })
  private readonly entries = new Map<string, Promise<Map<string, Entry>>>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly documents = new Map<string, Promise<SyncDocument | undefined>>()

  /**
   * @param ctx - Host context; `sync` and `fileSync` are read optionally.
   * @param config - validated storage configuration.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'recordings')
    if (!isAbsolute(config.dataRoot)) throw new Error(`recordings: dataRoot must be absolute: ${config.dataRoot}`)
    ctx.on('sync/status', (owner) => { void this.attach(owner) })
    ctx.on('sync/reset', (owner) => { void this.reset(owner) })
    ctx.effect(() => async () => {
      for (const opening of this.documents.values()) (await opening)?.close()
      this.documents.clear()
    }, 'recordings: synced documents')
  }

  /**
   * List an account's recordings, newest first.
   * @param owner - the account, or {@link LOCAL_OWNER}.
   * @returns their summaries.
   */
  async list(owner: string): Promise<RecordingSummary[]> {
    void this.attach(owner)
    const entries = await this.load(owner)
    const summaries: RecordingSummary[] = []
    for (const entry of entries.values()) {
      if (isTombstone(entry)) continue
      summaries.push({
        id: entry.id, title: entry.title, startedAt: entry.startedAt, durationMs: entry.durationMs,
        preview: entry.segments.map(segment => segment.text).join(' ').slice(0, 160),
        ...entry.audio === undefined ? {} : { audioBytes: entry.audio.bytes },
        audioHere: entry.audio !== undefined && await this.audioPresent(owner, entry.id),
      })
    }
    return summaries.sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * Read one recording.
   * @param owner - the account.
   * @param id - the recording.
   * @returns the recording, or undefined when the account has none by that id.
   */
  async get(owner: string, id: RecordingId): Promise<SavedRecording | undefined> {
    const entry = (await this.load(owner)).get(id)
    return entry === undefined || isTombstone(entry) ? undefined : entry
  }

  /**
   * Save or replace a recording; it must carry at least one transcribed phrase.
   * @param owner - the account.
   * @param recording - the recording; its `changedAt` is set here.
   * @returns the stored recording.
   */
  async save(owner: string, recording: Omit<SavedRecording, 'changedAt'>): Promise<SavedRecording> {
    recordingId(recording.id)
    if (!recording.segments.some(segment => segment.text.trim() !== '')) throw new Error('A recording is saved only with transcribed speech')
    const stored: SavedRecording = { ...recording, changedAt: Date.now() }
    await this.commit(owner, stored)
    return stored
  }

  /**
   * Rename a recording.
   * @param owner - the account.
   * @param id - the recording.
   * @param title - the new title.
   * @returns the renamed recording.
   */
  async rename(owner: string, id: RecordingId, title: string): Promise<SavedRecording> {
    const current = await this.get(owner, id)
    if (current === undefined) throw new Error(`No recording ${id}`)
    const stored: SavedRecording = { ...current, title: title.trim().slice(0, 200), changedAt: Date.now() }
    await this.commit(owner, stored)
    return stored
  }

  /**
   * Delete a recording and its audio on every device of the account.
   * @param owner - the account.
   * @param id - the recording.
   */
  async remove(owner: string, id: RecordingId): Promise<void> {
    await this.commit(owner, { id, deleted: true, changedAt: Date.now() })
    await rm(this.audioPath(owner, id), { force: true })
    await rm(`${this.audioPath(owner, id)}.part`, { force: true })
  }

  /**
   * Append one chunk of a recording's audio; chunk 0 starts the file over.
   * @param owner - the account.
   * @param id - the recording.
   * @param index - the chunk's position, from 0.
   * @param bytes - the chunk.
   */
  async appendAudio(owner: string, id: RecordingId, index: number, bytes: Uint8Array): Promise<void> {
    const part = `${this.audioPath(owner, id)}.part`
    await mkdir(this.audioDir(owner), { recursive: true })
    if (index === 0) await writeFile(part, bytes, { mode: 0o600 })
    else {
      const size = (await stat(part)).size
      if (size + bytes.byteLength > this.config.maxAudioBytes) throw new Error('Recording audio exceeds the configured limit')
      await appendFile(part, bytes)
    }
  }

  /**
   * Publish the uploaded audio file under the recording's name.
   * @param owner - the account.
   * @param id - the recording.
   * @returns the file's size.
   */
  async finishAudio(owner: string, id: RecordingId): Promise<number> {
    const part = `${this.audioPath(owner, id)}.part`
    const size = (await stat(part)).size
    await rename(part, this.audioPath(owner, id))
    return size
  }

  /**
   * Read part of a recording's audio.
   * @param owner - the account.
   * @param id - the recording.
   * @param offset - first byte.
   * @param length - most bytes to read.
   * @returns the bytes, empty past the end; undefined when this device does not hold the file.
   */
  async readAudio(owner: string, id: RecordingId, offset: number, length: number): Promise<Uint8Array | undefined> {
    let handle
    try { handle = await open(this.audioPath(owner, id), 'r') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  private dir(owner: string): string {
    const key = owner === LOCAL_OWNER ? LOCAL_OWNER : createHash('sha256').update(owner).digest('hex').slice(0, 32)
    return join(this.config.dataRoot, key)
  }

  private audioDir(owner: string): string { return join(this.dir(owner), 'audio') }

  private audioPath(owner: string, id: RecordingId): string { return join(this.audioDir(owner), `${recordingId(id)}${AUDIO_EXTENSION}`) }

  private async audioPresent(owner: string, id: RecordingId): Promise<boolean> {
    try { return (await stat(this.audioPath(owner, id))).isFile() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private load(owner: string): Promise<Map<string, Entry>> {
    let loading = this.entries.get(owner)
    if (loading === undefined) {
      loading = readFile(join(this.dir(owner), 'recordings.json'), 'utf8').then(
        text => new Map(Object.entries(JSON.parse(text) as Record<string, Entry>)),
        (error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map<string, Entry>()
          throw error
        },
      )
      this.entries.set(owner, loading)
    }
    return loading
  }

  /** Store an entry locally and publish it to the account's synced document. */
  private async commit(owner: string, entry: Entry): Promise<void> {
    const entries = await this.load(owner)
    entries.set(entry.id, entry)
    await this.persist(owner)
    const handle = await this.attach(owner)
    handle?.doc.getMap<Entry>(MAP).set(entry.id, entry)
  }

  /** Write an account's entries atomically, one write at a time. */
  private persist(owner: string): Promise<void> {
    const previous = this.writes.get(owner) ?? Promise.resolve()
    const next = previous.then(async () => {
      const entries = await this.load(owner)
      await mkdir(this.dir(owner), { recursive: true })
      const file = join(this.dir(owner), 'recordings.json')
      await writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    })
    this.writes.set(owner, next.catch(() => undefined))
    return next
  }

  /**
   * Open the account's synced document once sync serves the account, merge it with the local
   * entries (the newer `changedAt` wins on both sides), follow other devices' changes, and share the
   * audio folder with the account's devices.
   * @param owner - the account.
   * @returns the open document, or undefined while sync does not serve the account.
   */
  private attach(owner: string): Promise<SyncDocument | undefined> {
    if (owner === LOCAL_OWNER) return Promise.resolve(undefined)
    const existing = this.documents.get(owner)
    if (existing !== undefined) return existing
    const sync = this.ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === undefined || state === 'disabled' || state === 'starting') return Promise.resolve(undefined)
    const opening = sync.openDocument(owner, DOCUMENT).then(async (handle) => {
      const map = handle.doc.getMap<Entry>(MAP)
      const entries = await this.load(owner)
      let changed = false
      for (const [id, remote] of map.entries()) {
        const local = entries.get(id)
        if (local === undefined || remote.changedAt > local.changedAt) { entries.set(id, remote); changed = true }
      }
      handle.doc.transact(() => {
        for (const [id, local] of entries) {
          const remote = map.get(id)
          if (remote === undefined || local.changedAt > remote.changedAt) map.set(id, local)
        }
      })
      if (changed) await this.persist(owner)
      map.observe((event: YMapEvent<Entry>, transaction: Transaction) => {
        if (!transaction.local) void this.take(owner, map, event.keysChanged)
      })
      void this.share(owner)
      return handle
    }, (error: unknown) => {
      this.documents.delete(owner)
      this.ctx.logger('recordings').warn(`opening the synced recordings document failed: ${String(error)}`)
      return undefined
    })
    this.documents.set(owner, opening)
    return opening
  }

  /** Apply another device's changes: newer entries replace local ones, and a tombstone deletes the audio. */
  private async take(owner: string, map: YMap<Entry>, keys: Iterable<string>): Promise<void> {
    const entries = await this.load(owner)
    let changed = false
    for (const id of keys) {
      const remote = map.get(id)
      const local = entries.get(id)
      if (remote === undefined || (local !== undefined && local.changedAt >= remote.changedAt)) continue
      entries.set(id, remote)
      changed = true
      if (isTombstone(remote)) await rm(this.audioPath(owner, remote.id), { force: true })
    }
    if (changed) await this.persist(owner)
  }

  /** Share the account's audio folder with its other devices through file sync, when it runs. */
  private async share(owner: string): Promise<void> {
    const fileSync = this.ctx.get('fileSync')
    if (fileSync === undefined) return
    const id = brandString<FileSyncFolderId>(`recordings-${createHash('sha256').update(owner).digest('hex').slice(0, 20)}`)
    try {
      await mkdir(this.audioDir(owner), { recursive: true })
      await fileSync.share({ id, owner, path: this.audioDir(owner) })
    } catch (error) {
      this.ctx.logger('recordings').warn(`sharing the recordings audio folder failed: ${String(error)}`)
    }
  }

  private async reset(owner: string): Promise<void> {
    const opening = this.documents.get(owner)
    this.documents.delete(owner)
    ;(await opening)?.close()
  }
}

export default Recordings
