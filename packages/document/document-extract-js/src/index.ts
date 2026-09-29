/**
 * In-process document reader: PDF, Office Open XML, OpenDocument, Numbers,
 * RTF, EPUB, HTML, and text formats read by JavaScript and WebAssembly
 * libraries, each document in its own worker thread with heap and time
 * limits. Nothing here needs a native binary, so the provider ships inside
 * the Desktop seed unchanged.
 * @module @aeven/document-extract-js
 */

import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/document-extract'
import type { DocumentExtractInput, DocumentExtractProviderId, ExtractedDocument } from '@aeven/document-extract'
import { JS_FORMATS } from './formats.ts'
import type { ExtractWorkerInit, ExtractWorkerReply } from './protocol.ts'

export { htmlToText, rtfToText } from './extractors.ts'

/** Stable plugin name. */
export const name = 'document-extract-js'
/** The registry this provider contributes to. */
export const inject = ['documentExtract']

/** Worker resource policy. */
export interface Config {
  /** Wall-clock limit for one document before its worker is terminated. */
  timeoutMs: number
  /** Old-generation heap limit of one extraction worker, in MiB. */
  maxWorkerHeapMb: number
  /** Simultaneous extraction workers. */
  concurrency: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  timeoutMs: z.natural().min(1).default(60_000),
  maxWorkerHeapMb: z.natural().min(32).default(512),
  concurrency: z.natural().min(1).max(8).default(2),
})

/** Provider id registered on `ctx.documentExtract`. */
export const PROVIDER_ID = 'js' as DocumentExtractProviderId

/** Recorded with stored text; bump when a reader's output changes. */
const EXTRACTOR_VERSION = '1'

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

/**
 * Resolve the built worker bundle, or an unbuilt bootstrap that installs tsx
 * inside the worker before importing the TypeScript entry. Both shapes start
 * with an empty `execArgv` and an environment holding only the temp path and,
 * unbuilt, the tsconfig pin.
 */
function workerSpawn(init: ExtractWorkerInit, maxHeapMb: number): { entry: string | URL; options: WorkerOptions } {
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

/** Run one extraction in a fresh worker that is terminated on timeout, cancellation, or completion. */
function runWorker(input: DocumentExtractInput, config: Config, signal: AbortSignal): Promise<ExtractedDocument> {
  signal.throwIfAborted()
  // The worker takes ownership of a copy so the caller's buffer stays usable.
  const init: ExtractWorkerInit = { data: input.data.slice(), extension: input.extension }
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
      finish(() => { reject(new Error(`document extraction exceeded ${config.timeoutMs} ms`)) })
    }, config.timeoutMs)
    const onAbort = (): void => {
      finish(() => { reject(signal.reason instanceof Error ? signal.reason : new Error('document extraction cancelled')) })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (reply: ExtractWorkerReply) => {
      finish(() => {
        if (reply.ok) resolve(reply.result)
        else reject(new Error(reply.message))
      })
    })
    worker.once('error', (error) => { finish(() => { reject(error) }) })
    worker.once('exit', (code) => {
      finish(() => { reject(new Error(`document extraction worker exited with code ${code}`)) })
    })
  })
}

/**
 * Register the JavaScript reader.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - worker resource policy.
 */
export function apply(ctx: Context, config: Config): void {
  const limiter = new Limiter(config.concurrency)
  ctx.effect(() => ctx.documentExtract.register({
    info: {
      id: PROVIDER_ID,
      version: EXTRACTOR_VERSION,
      formats: JS_FORMATS,
      priority: 0,
    },
    extract: (input, signal) => limiter.run(() => runWorker(input, config, signal)),
  }), 'document-extract-js: provider')
}
