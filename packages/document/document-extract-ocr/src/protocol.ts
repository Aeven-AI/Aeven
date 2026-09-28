/** Messages between the OCR host and its worker thread. @module @aeven/document-extract-ocr/protocol */

import type { ExtractedDocument } from '@aeven/document-extract'

/** Payload passed as `workerData`. */
export interface OcrWorkerInit {
  readonly data: Uint8Array
  /** Directory of pdf.js WebAssembly image decoders, with a trailing separator. */
  readonly wasmPath: string
  /** Directory of pdf.js standard font data, with a trailing separator. */
  readonly fontPath: string
  /** Directory holding `<lang>.traineddata.gz`. */
  readonly langPath: string
  /** Tesseract language codes joined by `+`. */
  readonly languages: string
  /** Pages recognized at most, from the first. */
  readonly maxPages: number
  /** Render scale relative to 72 DPI. */
  readonly scale: number
}

/** The worker's single reply. */
export type OcrWorkerReply =
  | { readonly ok: true; readonly result: ExtractedDocument }
  | { readonly ok: false; readonly message: string }
