/** Shared concurrency and worker execution for document extraction providers. */

import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import type { ExtractedDocument } from './types.ts'

/** The single reply expected from a document extraction worker. */
export type DocumentWorkerReply =
  | { readonly ok: true; readonly result: ExtractedDocument }
  | { readonly ok: false; readonly message: string }

/** Counting semaphore bounding simultaneous workers. */
export class DocumentExtractionLimiter {
  private active = 0
  private readonly waiting: Array<() => void> = []

  /** @param limit - maximum simultaneous extraction tasks. */
  constructor(private readonly limit: number) {}

  /**
   * Run one extraction under the shared limit, returning its capacity when the task settles.
   * @param task - extraction started once capacity is available.
   * @returns the extraction result; releases capacity on success or failure.
   */
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
function workerSpawn(
  init: { readonly data: Uint8Array },
  maxHeapMb: number,
  moduleUrl: string,
  resolve: (specifier: string) => string,
): { entry: string | URL; options: WorkerOptions } {
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
  if (!moduleUrl.endsWith('.ts')) {
    return { entry: fileURLToPath(new URL('./worker.cjs', moduleUrl)), options: { ...base, env } }
  }
  if (process.env.TSX_TSCONFIG_PATH !== undefined) env.TSX_TSCONFIG_PATH = process.env.TSX_TSCONFIG_PATH
  const bootstrap = [
    `import { register as registerEsm } from ${JSON.stringify(resolve('tsx/esm/api'))}`,
    `import { register as registerCjs } from ${JSON.stringify(resolve('tsx/cjs/api'))}`,
    'registerCjs()',
    'registerEsm()',
    `await import(${JSON.stringify(new URL('./worker.ts', moduleUrl).href)})`,
  ].join('\n')
  return { entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), options: { ...base, env } }
}

/**
 * Run a provider worker; its single reply supplies extracted text or an error.
 * @param init - worker data containing a provider-owned copy of the input bytes.
 * @param config - worker timeout and heap limits.
 * @param signal - caller cancellation.
 * @param moduleUrl - provider entry URL used to locate its sibling worker.
 * @param resolve - provider-relative module resolution for the source bootstrap.
 * @param label - provider-specific failure prefix.
 * @returns extracted document from the worker's reply.
 */
export function runDocumentWorker(
  init: { readonly data: Uint8Array },
  config: { readonly timeoutMs: number; readonly maxWorkerHeapMb: number },
  signal: AbortSignal,
  moduleUrl: string,
  resolve: (specifier: string) => string,
  label: string,
): Promise<ExtractedDocument> {
  signal.throwIfAborted()
  const { entry, options } = workerSpawn(init, config.maxWorkerHeapMb, moduleUrl, resolve)
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
      finish(() => { reject(new Error(`${label} exceeded ${config.timeoutMs} ms`)) })
    }, config.timeoutMs)
    const onAbort = (): void => {
      finish(() => { reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`)) })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (reply: DocumentWorkerReply) => {
      finish(() => {
        if (reply.ok) resolve(reply.result)
        else reject(new Error(reply.message))
      })
    })
    worker.once('error', (error) => { finish(() => { reject(error) }) })
    worker.once('exit', (code) => {
      finish(() => { reject(new Error(`${label} worker exited with code ${code}`)) })
    })
  })
}

