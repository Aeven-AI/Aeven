/**
 * OCR reader for scanned PDFs. It claims PDFs after the built-in reader, so it
 * runs only when a PDF has no text layer: pages are rendered with pdf.js on a
 * prebuilt canvas and recognized with Tesseract (WebAssembly) in a worker
 * thread, using English language data bundled as an npm package.
 * @module @aeven/document-extract-ocr
 */

import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DocumentExtractionLimiter, runDocumentWorker } from '@aeven/document-extract/execution'
import type {} from '@aeven/document-extract'
import type { DocumentExtractInput, DocumentExtractProviderId, ExtractedDocument } from '@aeven/document-extract'
import type { OcrWorkerInit } from './protocol.ts'

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
  return runDocumentWorker(init, config, signal, import.meta.url, specifier => import.meta.resolve(specifier), 'OCR')
}

/**
 * Register the OCR reader.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - OCR policy.
 */
export function apply(ctx: Context, config: Config): void {
  const paths = { langPath: languageDirectory(), wasmPath: pdfjsDirectory('wasm'), fontPath: pdfjsDirectory('standard_fonts') }
  const limiter = new DocumentExtractionLimiter(config.concurrency)
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
