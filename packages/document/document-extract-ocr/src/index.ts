/**
 * OCR reader for scanned PDFs. It claims PDFs after the built-in reader, so it
 * runs only when a PDF has no text layer: pages are rendered with pdf.js on a
 * prebuilt canvas and recognized with Tesseract (WebAssembly) in a worker
 * thread, using English language data bundled as an npm package.
 * @module @aeven/document-extract-ocr
 */

import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/document-extract'
import type { DocumentExtractInput, DocumentExtractProviderId, ExtractedDocument } from '@aeven/document-extract'
import type { OcrWorkerInit, OcrWorkerReply } from './protocol.ts'

/** Stable plugin name. */
export const name = 'document-extract-ocr'
/** The registry this provider contributes to. */
export const inject = ['documentExtract']

/** OCR policy. */
export interface Config {
  /** Pages recognized at most, from the first. */
  maxPages: number
  /** Render scale relative to 72 DPI; 2 renders at 144 DPI. */
  scale: number
  /** Wall-clock limit for one document before its worker is terminated. */
  timeoutMs: number
  /** Old-generation heap limit of one OCR worker, in MiB. */
  maxWorkerHeapMb: number
  /** Simultaneous OCR workers. */
  concurrency: number
  /** Tesseract recognizers one document's pages are spread across. */
  recognizers: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  maxPages: z.natural().min(1).default(30),
  scale: z.number().min(0.5).max(4).default(2),
  timeoutMs: z.natural().min(1).default(300_000),
  maxWorkerHeapMb: z.natural().min(64).default(1024),
  concurrency: z.natural().min(1).max(4).default(1),
  // A deck of scanned slides takes over ten seconds a page on one recognizer,
  // which puts a 27-page file past the time limit; four keep it well inside.
  recognizers: z.natural().min(1).max(8).default(4),
})

/** Provider id registered on `ctx.documentExtract`. */
export const PROVIDER_ID = 'ocr' as DocumentExtractProviderId

/** Recorded with stored text; bump when recognition output changes. */
const EXTRACTOR_VERSION = '1'

/** Bundled Tesseract English data directory. */
function languageDirectory(): string {
  const manifest = createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json')
  return join(dirname(manifest), '4.0.0_best_int')
}

/** A pdf.js data directory with the trailing separator pdf.js expects. */
function pdfjsDirectory(name: 'wasm' | 'standard_fonts'): string {
  const manifest = createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  return `${join(dirname(manifest), name)}${sep}`
}

/** Counting semaphore bounding simultaneous workers. */
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

/** Built worker bundle, or an unbuilt bootstrap installing tsx before the TypeScript entry. */
function workerSpawn(init: OcrWorkerInit, maxHeapMb: number): { entry: string | URL; options: WorkerOptions } {
  const env: NodeJS.ProcessEnv = {}
  if (process.platform === 'win32') {
    env.TMP = tmpdir()
    env.TEMP = tmpdir()
  }
  const base: WorkerOptions = {
    workerData: init,
    transferList: [init.data.buffer as ArrayBuffer],
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
  }
  if (!import.meta.url.endsWith('.ts')) {
    return { entry: fileURLToPath(new URL('./worker.cjs', import.meta.url)), options: { ...base, env } }
  }
  if (process.env.TSX_TSCONFIG_PATH !== undefined) env.TSX_TSCONFIG_PATH = process.env.TSX_TSCONFIG_PATH
  const bootstrap = [
    `import { register as registerEsm } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}`,
    `import { register as registerCjs } from ${JSON.stringify(import.meta.resolve('tsx/cjs/api'))}`,
    'registerCjs()',
    'registerEsm()',
    `await import(${JSON.stringify(new URL('./worker.ts', import.meta.url).href)})`,
  ].join('\n')
  return { entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), options: { ...base, env } }
}

function runWorker(
  input: DocumentExtractInput,
  config: Config,
  paths: { readonly langPath: string; readonly wasmPath: string; readonly fontPath: string },
  signal: AbortSignal,
): Promise<ExtractedDocument> {
  signal.throwIfAborted()
  const init: OcrWorkerInit = {
    data: input.data.slice(),
    langPath: paths.langPath,
    wasmPath: paths.wasmPath,
    fontPath: paths.fontPath,
    languages: 'eng',
    maxPages: config.maxPages,
    scale: config.scale,
    recognizers: config.recognizers,
  }
  const { entry, options } = workerSpawn(init, config.maxWorkerHeapMb)
  return new Promise<ExtractedDocument>((resolve, reject) => {
    const worker = new Worker(entry, options)
    let settled = false
    const finish = (outcome: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      void worker.terminate()
      outcome()
    }
    const timer = setTimeout(() => {
      finish(() => { reject(new Error(`OCR exceeded ${config.timeoutMs} ms`)) })
    }, config.timeoutMs)
    const onAbort = (): void => {
      finish(() => { reject(signal.reason instanceof Error ? signal.reason : new Error('OCR cancelled')) })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (reply: OcrWorkerReply) => {
      finish(() => {
        if (reply.ok) resolve(reply.result)
        else reject(new Error(reply.message))
      })
    })
    worker.once('error', (error) => { finish(() => { reject(error) }) })
    worker.once('exit', (code) => {
      finish(() => { reject(new Error(`OCR worker exited with code ${code}`)) })
    })
  })
}

/**
 * Register the OCR reader.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - OCR policy.
 */
export function apply(ctx: Context, config: Config): void {
  const paths = { langPath: languageDirectory(), wasmPath: pdfjsDirectory('wasm'), fontPath: pdfjsDirectory('standard_fonts') }
  const limiter = new Limiter(config.concurrency)
  ctx.effect(() => ctx.documentExtract.register({
    info: {
      id: PROVIDER_ID,
      version: EXTRACTOR_VERSION,
      formats: { extensions: ['pdf'], mediaTypes: ['application/pdf'] },
      priority: 20,
    },
    extract: (input, signal) => limiter.run(() => runWorker(input, config, paths, signal)),
  }), 'document-extract-ocr: provider')
}
