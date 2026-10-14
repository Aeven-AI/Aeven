/**
 * In-process document reader: PDF, Office Open XML, OpenDocument, Pages,
 * Keynote, Numbers, RTF, EPUB, HTML, and text formats read by JavaScript
 * and WebAssembly libraries, each document in its own worker thread with
 * heap and time limits. Nothing here needs a native binary, so the provider
 * ships inside the Desktop seed unchanged.
 * @module @aeven/document-extract-js
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DocumentExtractionLimiter, runDocumentWorker } from '@aeven/document-extract/execution'
import type {} from '@aeven/document-extract'
import type { DocumentExtractInput, DocumentExtractProviderId, ExtractedDocument } from '@aeven/document-extract'
import { JS_FORMATS } from './formats.ts'
import type { ExtractWorkerInit } from './protocol.ts'

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

function runWorker(input: DocumentExtractInput, config: Config, signal: AbortSignal): Promise<ExtractedDocument> {
  signal.throwIfAborted()
  // The worker takes ownership of a copy so the caller's buffer stays usable.
  const init: ExtractWorkerInit = { data: input.data.slice(), extension: input.extension }
  return runDocumentWorker(init, config, signal, import.meta.url, specifier => import.meta.resolve(specifier), 'document extraction')
}

/**
 * Register the JavaScript reader.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - worker resource policy.
 */
export function apply(ctx: Context, config: Config): void {
  const limiter = new DocumentExtractionLimiter(config.concurrency)
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
