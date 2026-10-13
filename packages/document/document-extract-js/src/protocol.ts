/** Messages between the extraction host and its worker thread. @module @aeven/document-extract-js/protocol */

import type { ExtractedDocument } from '@aeven/document-extract'

/** Payload passed as `workerData`. */
export interface ExtractWorkerInit {
  readonly data: Uint8Array
  readonly extension: string
}

/** The worker's single reply. */
export type ExtractWorkerReply =
  | { readonly ok: true; readonly result: ExtractedDocument }
  | { readonly ok: false; readonly message: string }
