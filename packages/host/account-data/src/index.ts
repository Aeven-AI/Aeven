/**
 * @aeven/host-account-data — the signed-in account's data rights on a Host.
 *
 * Export: `GET /api/account-data/export` streams a zip of everything this Host keeps for the caller's account,
 * followed by the copy the Aeven API holds. The response starts at once and the archive is written as it is read,
 * so the browser's download begins immediately and the Host never holds the archive in memory. Files are read when
 * the archive reaches them; large and already-compressed files are stored, small text is deflated at a fast level.
 *
 * Erase: an account deleted on the Aeven API is purged there after its grace period, leaving a tombstone that holds
 * only the SHA-256 of the user id — the digest this Host names each account's home directory by. The service asks the
 * API about every account it holds data for, at start and on an interval, and erases the local data of each purged
 * one, so every device and the hosted copy forget the account without being online at the moment of deletion.
 *
 * Data is reached through sources: each plugin that keeps per-account data registers one that can export and erase
 * an account. This package registers the sources for the data it can reach through public services — chats,
 * memories, and the account's home directory — and the Aeven API's copy.
 * @module @aeven/host-account-data
 */

import { open, readdir, rm, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import yazl from 'yazl'
import { ACCOUNTS_DIR_NAME, accountDirectoryName, accountHomePath, avnHomePath } from '@aeven/home-paths'
import type { FileAttachmentRef, ImageAttachmentRef } from '@aeven/attachment'
import type {} from '@aeven/client-connection'
import { credentialRef, type CredentialRef } from '@aeven/credentials'
import type {} from '@aeven/memory'
import type {} from '@aeven/session-persistence'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The signed-in account's data export and the erasure of purged accounts. */
    accountData: AccountData
  }
}

/** An export entry's content: text or bytes, now or later, or a stream of chunks. */
export type ExportContent = string | Uint8Array | Promise<string | Uint8Array> | AsyncIterable<string | Uint8Array>

/** Writes one account's files into the export archive; every path is relative to the archive root. */
export interface AccountExportWriter {
  /**
   * True while the export is only being sized: files and directories are measured, nothing is read, and a source
   * should skip work whose only output is a small `content` entry.
   */
  readonly dry: boolean
  /**
   * Add a file whose bytes are produced when the archive reaches it, so its source is read only then.
   * @param entry - the path inside the archive.
   * @param produce - returns the content, as text, bytes, or a stream of chunks. The archive keeps the function
   *   until it finishes, so it must not hold large data beyond its single call.
   * @returns resolves when the archive starts reading this entry; a source that reads ahead awaits it so it holds
   *   no more than one entry's content at a time.
   */
  content(entry: string, produce: () => ExportContent): Promise<void>
  /**
   * Add one file from disk, opened when the archive reaches it. A file that is gone by then is left out.
   * @param entry - the path inside the archive.
   * @param source - the absolute path on disk.
   */
  file(entry: string, source: string): Promise<void>
  /**
   * Add a directory tree from disk.
   * @param entry - the archive directory the tree goes under.
   * @param root - the absolute directory on disk; a missing directory adds nothing.
   * @param skip - leaves out entries by their path relative to `root`, with `/` separators.
   */
  directory(entry: string, root: string, skip?: (relativePath: string) => boolean): Promise<void>
}

/** One kind of per-account data a plugin keeps on this Host. */
export interface AccountDataSource {
  /** Stable name, used in logs and in the export's notes. */
  readonly name: string
  /**
   * The accounts this source holds data for, so purged ones are found; a source keyed by digests omits it.
   * @returns user ids.
   */
  readonly owners?: () => Promise<readonly string[]>
  /**
   * Add the account's data to the export.
   * @param owner - the account.
   * @param out - the archive writer.
   * @param signal - aborted when the download is cancelled.
   */
  readonly export: (owner: string, out: AccountExportWriter, signal: AbortSignal) => Promise<void>
  /**
   * Remove the account's data from this Host.
   * @param owner - the account.
   */
  readonly erase: (owner: string) => Promise<void>
}

/** Deployment configuration. */
export interface Config {
  /** Aeven API origin, such as `https://aeven.io/api`. */
  apiUrl: string
  /** Credential reference holding each signed-in user's Aeven access token. */
  credentialRef: string
  /** Delay after start before the first purged-account check. */
  checkDelayMs: number
  /** Interval between purged-account checks. */
  checkIntervalMs: number
  /** Largest text file the export deflates; larger files and other files are stored. 0 stores everything. */
  compressMaxBytes: number
  /** Deflate level for compressed entries, 1 (fastest) to 9. */
  compressionLevel: number
  /**
   * A device-wide folder that sessions without a folder of their own write into, such as the desktop's chats
   * folder, included in every account's export. It is shared by the device's accounts, so erasing never removes it.
   * Absent on a Host whose fallback folder holds other people's files.
   */
  chatFiles?: string
  /** Exports this Host streams at once, across accounts; a request beyond it is refused as busy. 0 is unlimited. */
  maxConcurrentExports: number
  /** Most bytes per second one export streams, bounding its disk and network use. 0 is unlimited. */
  maxBytesPerSecond: number
  /** Directory names left out of every exported tree: installable tooling, not the account's data. */
  skipDirectories: string[]
}

/** Route the export is served at, below the shared `/api` channel. */
export const EXPORT_ROUTE = '/api/account-data/export'

/** Route answering how far the caller's running export is. */
export const PROGRESS_ROUTE = '/api/account-data/export/progress'

/**
 * Bytes a chat adds to the export, attachments included, per byte of its compressed log on disk; measured on a real
 * account on 2026-11-17 (3.55 GB of chats and attachments from 399 MB of logs). Only the first estimate uses it:
 * once chats are written, their measured average replaces it.
 */
const CHAT_EXPANSION = 9

/** How far one running export is, in bytes read into the archive. */
interface ExportProgress {
  /** Bytes read into the archive so far. */
  read: number
  /** Bytes the non-chat sources were measured to add. */
  planned: number
  /** Chats the export writes. */
  chatsTotal: number
  /** Chats written so far. */
  chatsDone: number
  /** Bytes the written chats added, attachments included. */
  chatsRead: number
  /** Estimate for all chats before any is written. */
  chatsGuess: number
}

/** The most digests one tombstone lookup may carry, as the Aeven API accepts. */
const TOMBSTONE_BATCH = 200

/** Memory records read per page while exporting. */
const MEMORY_PAGE = 500

/** Extensions whose files compress well enough to be worth deflating. */
const TEXT_EXTENSIONS = new Set(['.json', '.jsonl', '.md', '.txt', '.csv', '.yaml', '.yml', '.html', '.xml', '.svg'])

/** One account digest, as account home directories are named. */
const DIGEST = /^[0-9a-f]{64}$/

/** What the export's README says. */
const README = `Your Æven data export

chats/            Every conversation this device holds, one JSON Lines log per chat, with index.json listing them.
memories/         What Æven remembers about you, one record per line.
account/          Your account as the Æven servers hold it: profile, plan, payments, usage and connected services.
settings/         Your skills, automations and connector settings on this device.
Aeven folder/     The files Æven made for you.
recordings/       Your recordings and their transcripts.

Passwords, access tokens and encryption keys are never included.
`

/**
 * The account's data on this Host, its streamed export, and the erasure of accounts the Aeven API purged.
 */
export class AccountData extends Service {
  static inject = ['connection']

  static Config: z<Partial<Config>, Config> = z.object({
    apiUrl: z.string().required(),
    credentialRef: z.string().default('AEVEN_TOKEN'),
    checkDelayMs: z.natural().default(60_000),
    checkIntervalMs: z.natural().min(60_000).default(6 * 60 * 60 * 1000),
    compressMaxBytes: z.natural().default(8 * 1024 * 1024),
    compressionLevel: z.natural().min(1).max(9).default(1),
    chatFiles: z.string(),
    maxConcurrentExports: z.natural().default(0),
    maxBytesPerSecond: z.natural().default(0),
    skipDirectories: z.array(z.string()).default(['node_modules', '.venv', 'venv', '__pycache__']),
  })

  private readonly sources: AccountDataSource[] = []
  private readonly ref: CredentialRef
  private readonly apiUrl: string
  private checking: Promise<void> | undefined
  /** Accounts with an export streaming now and how far each is; each account streams one at a time. */
  private readonly exporting = new Map<string, ExportProgress>()

  /**
   * @param ctx - Host context carrying the connection; sessions, memory, and credentials are read optionally.
   * @param config - validated {@link Config}.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'accountData')
    this.ref = credentialRef(config.credentialRef)
    this.apiUrl = config.apiUrl.replace(/\/+$/, '')
    ctx.effect(() => ctx.connection.fetch.register({
      path: EXPORT_ROUTE,
      methods: ['GET'],
      fetch: request => this.serveExport(request),
    }), 'account-data: export route')
    ctx.effect(() => ctx.connection.fetch.register({
      path: PROGRESS_ROUTE,
      methods: ['GET'],
      fetch: request => Promise.resolve(this.progressResponse(request)),
    }), 'account-data: export progress route')
    ctx.effect(() => this.register(this.chats()), 'account-data: chats source')
    ctx.effect(() => this.register(this.memories()), 'account-data: memories source')
    ctx.effect(() => this.register(this.home()), 'account-data: account home source')
    const chatFiles = config.chatFiles
    if (chatFiles !== undefined) {
      ctx.effect(() => this.register({
        name: 'chat files',
        export: async (_owner, out) => { await out.directory('Chat files', chatFiles) },
        erase: () => Promise.resolve(),
      }), 'account-data: chat files source')
    }
    ctx.effect(() => {
      let interval: ReturnType<typeof setInterval> | undefined
      const first = setTimeout(() => {
        void this.checkPurged()
        interval = setInterval(() => { void this.checkPurged() }, config.checkIntervalMs)
        interval.unref()
      }, config.checkDelayMs)
      first.unref()
      return () => {
        clearTimeout(first)
        if (interval !== undefined) clearInterval(interval)
      }
    }, 'account-data: purged-account check')
  }

  /**
   * Add a source of per-account data.
   * @param source - what the source keeps and how it exports and erases it.
   * @returns disposer removing the source.
   */
  register(source: AccountDataSource): () => void {
    this.sources.push(source)
    return () => {
      const index = this.sources.indexOf(source)
      if (index >= 0) this.sources.splice(index, 1)
    }
  }

  /**
   * Stream one account's export as a zip.
   * @param owner - the account.
   * @param signal - aborted when the reader cancels the download.
   * @param settled - called once when the archive has finished, failed, or been cancelled.
   * @returns the archive bytes, produced as they are read.
   */
  export(owner: string, signal: AbortSignal, settled: () => void = () => {}): ReadableStream<Uint8Array> {
    return this.archive(owner, signal, settled, newProgress())
  }

  /** {@link export}, counting into the record the progress route reads. */
  private archive(owner: string, signal: AbortSignal, settled: () => void, progress: ExportProgress): ReadableStream<Uint8Array> {
    const zip = new yazl.ZipFile()
    const notes: string[] = []
    const level = this.config.compressionLevel
    const compressMax = this.config.compressMaxBytes
    const skipped = new Set(this.config.skipDirectories)
    // The server copy is fetched beside the local walk and written last, so a slow network never delays the start.
    const server = this.serverCopy(owner, signal)
    const counted = (stream: Readable): Readable => stream.on('data', (chunk: Buffer) => { progress.read += chunk.byteLength })
    // Sizing runs beside the real walk: it measures every non-chat source without reading, so progress has a total.
    void this.plan(owner, signal, skipped).then((bytes) => { progress.planned = bytes }, () => undefined)
    const writer: AccountExportWriter = {
      dry: false,
      content: (entry, produce) => new Promise<void>((reached) => {
        zip.addReadStreamLazy(entry, compressMax > 0 ? { compress: true, compressionLevel: level } : { compress: false }, (done) => {
          reached()
          void streamOf(produce).then((stream) => { done(null, counted(stream)) }, (error: unknown) => {
            notes.push(`${entry}: ${message(error)}`)
            done(null, Readable.from([]))
          })
        })
      }),
      file: async (entry, source) => {
        const info = await stat(source).catch(() => undefined)
        if (info === undefined || !info.isFile()) return
        const text = compressMax > 0 && TEXT_EXTENSIONS.has(extensionOf(source)) && info.size <= compressMax
        // yazl refuses a compression level on a stored entry.
        const options = text ? { compress: true, compressionLevel: level, mtime: info.mtime } : { compress: false, mtime: info.mtime }
        zip.addReadStreamLazy(entry, options, (done) => {
          // Opened only now, so a large tree never holds more than one descriptor; a file removed since the walk
          // becomes an empty entry instead of breaking the archive.
          void open(source, 'r').then(
            (handle) => { done(null, counted(handle.createReadStream())) },
            () => { done(null, Readable.from([])) },
          )
        })
      },
      directory: async (entry, root, skip) => {
        for (const path of await walk(root, skipped)) {
          const rel = relative(root, path).split(sep).join('/')
          if (skip?.(rel) === true) continue
          await writer.file(`${entry}/${rel}`, path)
        }
      },
    }

    zip.addBuffer(Buffer.from(README), 'README.txt', { compress: true, compressionLevel: level })
    void (async () => {
      for (const source of [...this.sources]) {
        if (signal.aborted) break
        try {
          await source.export(owner, writer, signal)
        } catch (error) {
          notes.push(`${source.name}: ${message(error)}`)
        }
      }
      const copy = await server
      if (copy !== undefined) zip.addBuffer(Buffer.from(copy), 'account/account.json', { compress: true, compressionLevel: level })
      else notes.push('account: the Æven servers could not be reached; export again later for your account details')
      if (notes.length > 0) zip.addBuffer(Buffer.from(`${notes.join('\n')}\n`), 'export-notes.txt', { compress: true })
      zip.end()
    })()
    const output = zip.outputStream as Readable
    signal.addEventListener('abort', () => { output.destroy() }, { once: true })
    // Pulled one chunk per read rather than bridged with `Readable.toWeb`, which can enqueue every chunk the zip
    // emits: the archive then advances only as fast as the download drains, and the Host holds one chunk at a time.
    const chunks = output[Symbol.asyncIterator]() as AsyncIterator<Buffer>
    const rate = this.config.maxBytesPerSecond
    const started = Date.now()
    let sent = 0
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        let next: IteratorResult<Buffer>
        try {
          next = await chunks.next()
        } catch (error) {
          settled()
          throw error
        }
        if (next.done === true) {
          settled()
          controller.close()
          return
        }
        sent += next.value.byteLength
        // Over the configured rate, the next read waits until the bytes sent so far fit inside it.
        const ahead = rate > 0 ? sent / rate * 1000 - (Date.now() - started) : 0
        if (ahead > 0) await new Promise(resolve => setTimeout(resolve, ahead))
        controller.enqueue(new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength))
      },
      cancel: async () => {
        settled()
        output.destroy()
        await chunks.return?.()
      },
    }, { highWaterMark: 0 })
  }

  /**
   * Measure what the non-chat sources add to an export, without reading or archiving anything.
   * @param owner - the account.
   * @param signal - aborted when the download is cancelled.
   * @param skipped - directory names left out of every tree.
   * @returns the bytes their files hold.
   */
  private async plan(owner: string, signal: AbortSignal, skipped: ReadonlySet<string>): Promise<number> {
    let bytes = 0
    const measure = async (source: string): Promise<void> => {
      bytes += (await stat(source).catch(() => undefined))?.size ?? 0
    }
    const dry: AccountExportWriter = {
      dry: true,
      content: () => Promise.resolve(),
      file: async (_entry, source) => { await measure(source) },
      directory: async (_entry, root, skip) => {
        for (const path of await walk(root, skipped)) {
          if (signal.aborted) return
          if (skip?.(relative(root, path).split(sep).join('/')) === true) continue
          await measure(path)
        }
      },
    }
    for (const source of [...this.sources]) {
      // Chats are estimated by the chats source as it goes; sizing them here would decompress every log twice.
      if (signal.aborted || source.name === CHATS_SOURCE) continue
      await source.export(owner, dry, signal).catch(() => undefined)
    }
    return bytes
  }

  /** Answer how far the caller's running export is, as a fraction below 1, or 404 when none is running. */
  private progressResponse(request: Request): Response {
    const owner = this.ctx.connection.identify(request)?.id
    const progress = owner === undefined ? undefined : this.exporting.get(owner)
    if (progress === undefined) return new Response(null, { status: 404 })
    const chats = progress.chatsDone > 0
      ? progress.chatsRead / progress.chatsDone * progress.chatsTotal
      : progress.chatsGuess
    const expected = progress.planned + chats
    // Never full before the archive ends: the estimate can fall short, and the page fills the bar when it closes.
    const fraction = expected > 0 ? Math.min(0.99, progress.read / expected) : 0
    return Response.json({ fraction }, { headers: { 'cache-control': 'no-store' } })
  }

  /**
   * Remove every source's data for one account from this Host.
   * @param owner - the account.
   * @returns once each source has run; a failing source is logged and the rest still run.
   */
  async erase(owner: string): Promise<void> {
    for (const source of [...this.sources]) {
      try {
        await source.erase(owner)
      } catch (error) {
        this.ctx.logger('account-data').warn(`erasing ${source.name} failed: ${message(error)}`)
      }
    }
  }

  /**
   * Ask the Aeven API which accounts this Host holds data for were purged, and erase them.
   * @returns once the check and every erasure it started have finished; concurrent calls share one run.
   */
  checkPurged(): Promise<void> {
    this.checking ??= this.runCheck().finally(() => { this.checking = undefined })
    return this.checking
  }

  private async runCheck(): Promise<void> {
    const logger = this.ctx.logger('account-data')
    const byDigest = new Map<string, string | undefined>()
    for (const source of [...this.sources]) {
      const owners = await source.owners?.().catch(() => [] as readonly string[]) ?? []
      for (const owner of owners) byDigest.set(accountDirectoryName(owner), owner)
    }
    for (const name of await readdir(avnHomePath(ACCOUNTS_DIR_NAME)).catch(() => [] as string[])) {
      if (DIGEST.test(name) && !byDigest.has(name)) byDigest.set(name, undefined)
    }
    const digests = [...byDigest.keys()]
    for (let start = 0; start < digests.length; start += TOMBSTONE_BATCH) {
      let deleted: readonly string[]
      try {
        deleted = await this.purgedAmong(digests.slice(start, start + TOMBSTONE_BATCH))
      } catch (error) {
        // Unreachable API: nothing is known to be purged, and the next interval asks again.
        logger.debug(`purged-account check failed: ${message(error)}`)
        return
      }
      for (const digest of deleted) {
        const owner = byDigest.get(digest)
        logger.info(`erasing local data of purged account ${digest.slice(0, 12)}`)
        if (owner !== undefined) await this.erase(owner)
        await rm(avnHomePath(ACCOUNTS_DIR_NAME, digest), { recursive: true, force: true })
      }
    }
  }

  private async purgedAmong(accounts: readonly string[]): Promise<readonly string[]> {
    const response = await fetch(`${this.apiUrl}/api/account/deleted`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accounts }),
    })
    if (!response.ok) throw new Error(`the Aeven API answered ${String(response.status)}`)
    const body = await response.json() as { deleted?: unknown }
    return Array.isArray(body.deleted) ? body.deleted.filter((value): value is string => typeof value === 'string') : []
  }

  /** The Aeven API's copy of the account, as pretty JSON, or undefined when it cannot be read. */
  private async serverCopy(owner: string, signal: AbortSignal): Promise<string | undefined> {
    try {
      const token = (await this.ctx.get('credentials')?.resolve(this.ref, owner))?.value
      if (token === undefined) return undefined
      const response = await fetch(`${this.apiUrl}/api/account/export`, { headers: { authorization: `Bearer ${token}` }, signal })
      if (!response.ok) return undefined
      return JSON.stringify(await response.json(), null, 2)
    } catch {
      // A network failure or cancelled download: the export notes say the account copy is missing.
      return undefined
    }
  }

  private serveExport(request: Request): Promise<Response> {
    return Promise.resolve(this.exportResponse(request))
  }

  private exportResponse(request: Request): Response {
    const owner = this.ctx.connection.identify(request)?.id
    if (owner === undefined) return new Response('sign in to export your data', { status: 401 })
    const limit = this.config.maxConcurrentExports
    if (this.exporting.has(owner) || (limit > 0 && this.exporting.size >= limit)) {
      return new Response('an export is already running; try again in a few minutes', { status: 429, headers: { 'retry-after': '60' } })
    }
    const progress = newProgress()
    this.exporting.set(owner, progress)
    // The slot is held until the archive finishes, fails, or the download is cancelled.
    const release = (): void => { this.exporting.delete(owner) }
    request.signal.addEventListener('abort', release, { once: true })
    const day = new Date().toISOString().slice(0, 10)
    return new Response(this.archive(owner, request.signal, release, progress), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="aeven-export-${day}.zip"`,
        // `no-transform` keeps response compression off an archive that is already compressed.
        'cache-control': 'no-store, no-transform',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  /** Chats: every stored session log the account owns, decoded to JSON Lines. */
  private chats(): AccountDataSource {
    const owned = async (owner: string | undefined) => {
      const persistence = this.ctx.get('sessionPersistence')
      if (persistence === undefined) return []
      const snapshots = await persistence.listSnapshots()
      return snapshots.map(snapshot => snapshot.header).filter(header => owner === undefined || header.owner === owner)
    }
    return {
      name: CHATS_SOURCE,
      owners: async () => [...new Set((await owned(undefined)).flatMap(header => header.owner === undefined ? [] : [header.owner]))],
      export: async (owner, out, signal) => {
        const persistence = this.ctx.get('sessionPersistence')
        const headers = await owned(owner)
        if (persistence === undefined || headers.length === 0) return
        const progress = this.exporting.get(owner)
        if (progress !== undefined) {
          progress.chatsTotal = headers.length
          let onDisk = 0
          for (const header of headers) {
            const path = persistence.locate(header)?.path
            if (path !== undefined) onDisk += (await stat(path).catch(() => stat(`${path}.zstd`)).catch(() => undefined))?.size ?? 0
          }
          progress.chatsGuess = onDisk * CHAT_EXPANSION
        }
        void out.content('chats/index.json', () => JSON.stringify(headers.map(header => ({
          id: header.id,
          createdAt: new Date(header.createdAt).toISOString(),
          ...header.cwd === undefined ? {} : { folder: header.cwd },
          ...header.parentSession === undefined ? {} : { forkedFrom: header.parentSession },
          file: chatFile(header.id, header.createdAt),
        })), null, 2))
        if (!persistence.supportsRawArtifacts) return
        const attachments = this.ctx.get('attachments')
        const added = new Set<string>()
        for (const header of headers) {
          if (signal.aborted) return
          const log = (await persistence.readRaw(header.id, signal).catch(() => undefined))?.content ?? ''
          // The archive keeps every producer until it writes its directory, so the producer hands the log over once
          // and lets go of it; capturing it outright would keep every chat in memory to the end.
          let addedBytes = Buffer.byteLength(log)
          let held: string | undefined = log
          const reached = out.content(`chats/${chatFile(header.id, header.createdAt)}`, () => {
            const text = held ?? ''
            held = undefined
            return text
          })
          // The images and files attached in the chat, once each, read from the attachment store when reached.
          for (const ref of attachmentRefs(log)) {
            if (attachments === undefined || added.has(ref.attachmentId)) continue
            added.add(ref.attachmentId)
            const path = 'width' in ref ? attachments.imageHostPath(ref) : attachments.fileHostPath(ref)
            if (path === undefined) continue
            addedBytes += (await stat(path).catch(() => undefined))?.size ?? 0
            await out.file(`chats/attachments/${attachmentFile(ref)}`, path)
          }
          if (progress !== undefined) {
            progress.chatsDone += 1
            progress.chatsRead += addedBytes
          }
          // The next log is read once the archive has reached this one, so one chat is in memory at a time.
          await reached
        }
      },
      erase: async (owner) => {
        const persistence = this.ctx.get('sessionPersistence')
        if (persistence === undefined) return
        for (const header of await owned(owner)) {
          // A session still running here refuses; the account's sessions were all signed out at the deletion request,
          // so the next check erases it once it has stopped.
          await persistence.delete(header.id).catch(() => undefined)
        }
      },
    }
  }

  /** Memories: every record the memory provider holds for the account, read page by page as the archive reaches it. */
  private memories(): AccountDataSource {
    return {
      name: 'memories',
      export: (owner, out, signal) => {
        const memory = this.ctx.get('memory')
        if (memory === undefined) return Promise.resolve()
        void out.content('memories/memories.jsonl', async function* () {
          for (let offset = 0; ; offset += MEMORY_PAGE) {
            const page = await memory.list({ owner, limit: MEMORY_PAGE, offset, signal })
            for (const record of page.records) {
              yield `${JSON.stringify({
                time: new Date(record.time).toISOString(),
                domain: record.domain,
                summary: record.summary,
                you: record.userText,
                aeven: record.agentText,
                chat: record.sessionId,
                origin: record.origin,
                ...record.procedureStatus === undefined ? {} : { procedureStatus: record.procedureStatus },
              })}\n`
            }
            if (page.records.length < MEMORY_PAGE || offset + MEMORY_PAGE >= page.total) return
          }
        })
        return Promise.resolve()
      },
      // The provider keeps its store inside the account home, which the home source removes.
      erase: () => Promise.resolve(),
    }
  }

  /**
   * The account's home directory: skills, automations, and connector settings and message stores. Credentials — the
   * credential file, a Telegram session, WhatsApp's device keys — the sync replica, the memory store (exported as
   * records instead), connector caches, and lock files stay out of the export; erasing removes it all.
   */
  private home(): AccountDataSource {
    const skipped = (rel: string): boolean => rel === 'credentials.json'
      || rel.startsWith('sync/') || rel.startsWith('memory/')
      || /^connectors\/[^/]+\/(cache\/|session$|store\/whatsapp\.db)/.test(rel)
      || rel.endsWith('/.lock')
    return {
      name: 'account home',
      export: async (owner, out) => { await out.directory('settings', accountHomePath(owner), skipped) },
      erase: async (owner) => { await rm(accountHomePath(owner), { recursive: true, force: true }) },
    }
  }
}

export default AccountData

/**
 * Every regular file under a directory, depth first, sorted for a stable archive order.
 * @param root - absolute directory; a missing one has no files.
 * @param skipped - directory names whose trees are left out.
 * @returns absolute file paths.
 */
async function walk(root: string, skipped: ReadonlySet<string>): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory() && skipped.has(entry.name)) continue
    if (entry.isDirectory()) files.push(...await walk(path, skipped))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/** The stream an export entry's producer stands for. */
async function streamOf(produce: () => ExportContent): Promise<Readable> {
  const produced = produce()
  if (typeof produced === 'object' && Symbol.asyncIterator in produced) return Readable.from(produced)
  const value = await produced
  return Readable.from([typeof value === 'string' ? Buffer.from(value) : value])
}

/**
 * The attachment references a session log names: every object carrying an `attachmentId` and a `mediaType`.
 * @param log - the session's JSON Lines text.
 * @returns the references, in order of appearance.
 */
function attachmentRefs(log: string): Array<ImageAttachmentRef | FileAttachmentRef> {
  const refs: Array<ImageAttachmentRef | FileAttachmentRef> = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.attachmentId === 'string' && typeof record.mediaType === 'string') {
      refs.push(record as unknown as ImageAttachmentRef | FileAttachmentRef)
      return
    }
    for (const child of Object.values(record)) visit(child)
  }
  for (const line of log.split('\n')) {
    // Lines without an attachment are skipped before parsing, which is most of a long log.
    if (!line.includes('"attachmentId"')) continue
    try {
      visit(JSON.parse(line))
    } catch {
      // A torn final line of a log still being written names nothing reliably; the rest of the log still counts.
    }
  }
  return refs
}

/** An attachment's file name in the export: its id, then its own name or an extension from its media type. */
function attachmentFile(ref: ImageAttachmentRef | FileAttachmentRef): string {
  const name = ref.name?.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)
  if (name !== undefined && name !== '') return `${ref.attachmentId.slice(0, 12)}-${name}`
  const subtype = ref.mediaType.split('/')[1]?.split(/[+;]/)[0] ?? 'bin'
  return `${ref.attachmentId}.${subtype}`
}

/** The chats source's name; sizing leaves it to its own estimate. */
const CHATS_SOURCE = 'chats'

/** A fresh progress record for one export. */
function newProgress(): ExportProgress {
  return { read: 0, planned: 0, chatsTotal: 0, chatsDone: 0, chatsRead: 0, chatsGuess: 0 }
}

/** A chat's file name: its creation day first, so the folder sorts by date. */
function chatFile(id: string, createdAt: number): string {
  return `${new Date(createdAt).toISOString().slice(0, 10)}-${id}.jsonl`
}

/** A path's lowercase extension, with its dot. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot).toLowerCase()
}

/** An error's message, for logs and export notes. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
