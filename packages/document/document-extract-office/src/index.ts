/**
 * LibreOffice document reader for Pages, Keynote, Numbers, and legacy Office
 * formats, and the fallback when the built-in readers find no text. It uses an
 * installed LibreOffice when one is present; otherwise the reader prepares a
 * pinned, hash-verified build into the provider's data root from Settings.
 * @module @aeven/document-extract-office
 */

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/document-extract'
import type {
  DocumentExtractInput, DocumentExtractProviderId, DocumentPreparation, DocumentPreparationState, ExtractedDocument,
} from '@aeven/document-extract'
import type {} from '@aeven/subprocess'
import { PDF_FORMATS, SHEET_FORMATS, TEXT_FORMATS, convertDocument } from './convert.ts'
import type { RunProcess } from './runtime.ts'
import { ASSET_LOCK, downloadInstaller, hostAsset, installRuntime, locateOffice } from './runtime.ts'

/** Stable plugin name. */
export const name = 'document-extract-office'
/** Services this provider needs. */
export const inject = ['documentExtract', 'subprocess']

/** Office reader policy. */
export interface Config {
  /** Directory holding the downloaded installer and the private runtime. */
  dataRoot: string
  /** Explicit LibreOffice executable; omission searches the managed runtime and, when allowed, system installs. */
  sofficePath?: string
  /** Whether an existing system LibreOffice installation may be used. */
  useSystemInstall: boolean
  /** Wall-clock limit of one conversion. */
  timeoutMs: number
  /** Simultaneous conversions. */
  concurrency: number
  /** Grace period between terminate and kill of a conversion's process tree. */
  graceMs: number
  /** Retained bytes of each conversion's stdout and stderr. */
  maxLogBytes: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  dataRoot: z.string().required(),
  sofficePath: z.string(),
  useSystemInstall: z.boolean().default(true),
  timeoutMs: z.natural().min(1).default(120_000),
  concurrency: z.natural().min(1).max(4).default(1),
  graceMs: z.natural().min(1).default(2000),
  maxLogBytes: z.natural().min(1024).default(64 * 1024),
})

/** Provider id registered on `ctx.documentExtract`. */
export const PROVIDER_ID = 'office' as DocumentExtractProviderId

const MEDIA_TYPES: readonly string[] = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/x-iwork-pages-sffpages',
  'application/x-iwork-numbers-sffnumbers',
  'application/x-iwork-keynote-sffkey',
  'application/vnd.oasis.opendocument.graphics',
  'application/vnd.visio',
]

/** Counting semaphore bounding simultaneous conversions. */
class Limiter {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => { this.waiting.push(resolve) })
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.waiting.shift()?.()
    }
  }
}

/** Readiness and preparation of the LibreOffice runtime. */
class OfficePreparation implements DocumentPreparation {
  private state: DocumentPreparationState = { phase: 'unavailable', reason: 'Checking for LibreOffice' }
  private readonly listeners = new Set<() => void>()
  private task: { readonly controller: AbortController; readonly done: Promise<void> } | undefined
  /** Located executable once ready. */
  soffice: string | undefined

  constructor(private readonly config: Config, private readonly run: RunProcess) {}

  snapshot(): DocumentPreparationState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(state: DocumentPreparationState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }

  /** Inspect installed runtimes without downloading. */
  async inspect(): Promise<void> {
    const soffice = await locateOffice(this.config)
    if (soffice !== undefined) {
      this.soffice = soffice
      this.publish({ phase: 'ready' })
      return
    }
    const asset = hostAsset()
    this.publish(asset === undefined || this.config.sofficePath !== undefined
      ? { phase: 'unavailable', reason: this.config.sofficePath !== undefined
        ? `LibreOffice was not found at ${this.config.sofficePath}`
        : 'Install LibreOffice with your system package manager to read Pages, Keynote, and legacy Office files' }
      : { phase: 'unprepared', downloadBytes: asset.bytes })
  }

  prepare(): void {
    if (this.task !== undefined || this.state.phase === 'ready') return
    const asset = hostAsset()
    if (asset === undefined) return
    const controller = new AbortController()
    const done = (async () => {
      this.publish({ phase: 'preparing', receivedBytes: 0, totalBytes: asset.bytes })
      const downloads = join(this.config.dataRoot, 'downloads')
      try {
        await mkdir(this.config.dataRoot, { recursive: true })
        const installer = await downloadInstaller(asset, downloads, controller.signal, (receivedBytes) => {
          this.publish({ phase: 'preparing', receivedBytes, totalBytes: asset.bytes })
        })
        await installRuntime(installer, this.config.dataRoot, this.run, controller.signal)
        await rm(downloads, { recursive: true, force: true })
        const soffice = await locateOffice(this.config)
        if (soffice === undefined) throw new Error(`LibreOffice ${ASSET_LOCK.version} installed without a usable executable`)
        this.soffice = soffice
        this.publish({ phase: 'ready' })
      } catch (error) {
        this.publish(controller.signal.aborted
          ? { phase: 'unprepared', downloadBytes: asset.bytes }
          : { phase: 'failed', reason: error instanceof Error ? error.message : String(error) })
      } finally {
        this.task = undefined
      }
    })()
    this.task = { controller, done }
  }

  async cancel(): Promise<void> {
    const task = this.task
    if (task === undefined) return
    task.controller.abort(new Error('LibreOffice preparation cancelled'))
    await task.done
  }
}

/**
 * Register the LibreOffice reader.
 * @param ctx - plugin context carrying `documentExtract` and `subprocess`.
 * @param config - runtime location and conversion policy.
 */
export function apply(ctx: Context, config: Config): void {
  const run: RunProcess = async (spec) => {
    const handle = ctx.subprocess.spawn({
      argv: spec.argv,
      cwd: spec.cwd,
      graceMs: config.graceMs,
      signal: spec.signal,
      stdio: { stdin: 'ignore', stdout: { maxBytes: config.maxLogBytes }, stderr: { maxBytes: config.maxLogBytes } },
    })
    const outcome = await handle.done
    return { exitCode: outcome.exitCode, stderr: handle.collected.stderr?.readFrom(0).text ?? '' }
  }
  const preparation = new OfficePreparation(config, run)
  const limiter = new Limiter(config.concurrency)
  const extract = async (input: DocumentExtractInput, signal: AbortSignal): Promise<ExtractedDocument> => {
    const soffice = preparation.soffice
    if (soffice === undefined) throw new Error('LibreOffice is not prepared')
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
    const converted = await limiter.run(() => convertDocument(soffice, input, run, deadline))
    if (converted.kind === 'text') {
      return { text: converted.text, method: 'office', ...converted.pages === undefined ? {} : { pages: converted.pages } }
    }
    // Presentations and drawings come back as PDF; the registry's PDF reader extracts their text.
    const read = await ctx.documentExtract.extract({ data: converted.data, name: 'converted.pdf', mediaType: 'application/pdf' }, signal)
    return { text: read.text, method: 'office', ...read.pages === undefined ? {} : { pages: read.pages } }
  }
  ctx.effect(() => ctx.documentExtract.register({
    info: {
      id: PROVIDER_ID,
      label: 'LibreOffice',
      version: ASSET_LOCK.version,
      formats: { extensions: [...TEXT_FORMATS, ...SHEET_FORMATS, ...PDF_FORMATS], mediaTypes: MEDIA_TYPES },
      priority: 10,
    },
    preparation,
    extract,
  }), 'document-extract-office: provider')
  void preparation.inspect().catch((error: unknown) => {
    ctx.logger.warn(`document-extract-office: LibreOffice inspection failed: ${String(error)}`)
  })
  ctx.effect(() => () => { void preparation.cancel() }, 'document-extract-office: preparation')
}
