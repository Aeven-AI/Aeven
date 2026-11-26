/**
 * Messages between the preview plugin and its PDF worker.
 * @module @aeven/host-artifact-previews/pdf-protocol
 */

/** What the worker draws. */
export interface PdfWorkerInit {
  /** The PDF's bytes, transferred to the worker. */
  readonly data: Uint8Array
  /** Card picture width in pixels; the first page is scaled to it. */
  readonly width: number
  /** Card picture height in pixels; the page is cut from its top. */
  readonly height: number
  /** WebP quality, 1 to 100. */
  readonly quality: number
  /** pdf.js standard font data directory, with a trailing separator. */
  readonly fontPath: string
  /** pdf.js WebAssembly directory, with a trailing separator. */
  readonly wasmPath: string
}

/** The worker's answer. */
export type PdfWorkerReply =
  | { readonly ok: true; readonly image: Uint8Array }
  | { readonly ok: false; readonly message: string }
