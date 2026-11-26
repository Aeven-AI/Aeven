/**
 * Draw a PDF's first page in a worker thread, so a large or complex PDF never holds the Host's event loop.
 * @module @aeven/host-artifact-previews/pdf
 */
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import type { PdfWorkerInit, PdfWorkerReply } from './pdf-protocol.ts'

/** A pdf.js data directory with the trailing separator pdf.js expects. */
function pdfjsDirectory(name: 'wasm' | 'standard_fonts'): string {
  const manifest = createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  return `${join(dirname(manifest), name)}${sep}`
}

/**
 * The worker's entry: the built CommonJS file beside the bundle, or the TypeScript source through tsx when the
 * plugin itself runs from source.
 * @param init - the worker's input.
 * @param maxHeapMb - the worker's heap ceiling.
 * @returns the entry and its options.
 */
function spawn(init: PdfWorkerInit, maxHeapMb: number): { entry: string | URL; options: WorkerOptions } {
  const env: NodeJS.ProcessEnv = {}
  if (process.platform === 'win32') {
    env.TMP = tmpdir()
    env.TEMP = tmpdir()
  }
  const options: WorkerOptions = {
    workerData: init,
    transferList: [init.data.buffer as ArrayBuffer],
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
    env,
  }
  if (!import.meta.url.endsWith('.ts')) return { entry: fileURLToPath(new URL('./pdf-worker.cjs', import.meta.url)), options }
  if (process.env.TSX_TSCONFIG_PATH !== undefined) env.TSX_TSCONFIG_PATH = process.env.TSX_TSCONFIG_PATH
  const bootstrap = [
    `import { register as registerEsm } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}`,
    `import { register as registerCjs } from ${JSON.stringify(import.meta.resolve('tsx/cjs/api'))}`,
    'registerCjs()',
    'registerEsm()',
    `await import(${JSON.stringify(new URL('./pdf-worker.ts', import.meta.url).href)})`,
  ].join('\n')
  return { entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), options }
}

/**
 * Draw a PDF's first page as a card picture.
 * @param data - the PDF's bytes; transferred to the worker, so the caller must not use them afterwards.
 * @param picture - the card's size and WebP quality.
 * @param limits - the worker's time budget and heap ceiling.
 * @param signal - aborts the drawing and ends the worker.
 * @returns the WebP picture.
 */
export function drawPdf(
  data: Uint8Array,
  picture: { readonly width: number; readonly height: number; readonly quality: number },
  limits: { readonly timeoutMs: number; readonly maxHeapMb: number },
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const init: PdfWorkerInit = { data, ...picture, fontPath: pdfjsDirectory('standard_fonts'), wasmPath: pdfjsDirectory('wasm') }
  const { entry, options } = spawn(init, limits.maxHeapMb)
  return new Promise<Uint8Array>((resolve, reject) => {
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
    const timer = setTimeout(() => { finish(() => { reject(new Error(`PDF preview exceeded ${String(limits.timeoutMs)} ms`)) }) }, limits.timeoutMs)
    const onAbort = (): void => { finish(() => { reject(signal.reason instanceof Error ? signal.reason : new Error('PDF preview cancelled')) }) }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (reply: PdfWorkerReply) => {
      finish(() => { if (reply.ok) resolve(reply.image); else reject(new Error(reply.message)) })
    })
    worker.once('error', (error) => { finish(() => { reject(error) }) })
    worker.once('exit', (code) => { finish(() => { reject(new Error(`PDF preview worker exited with code ${String(code)}`)) }) })
  })
}
