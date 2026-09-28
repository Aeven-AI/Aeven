/**
 * Worker-thread entry: reads one document and posts one reply.
 * @module @aeven/document-extract-js/worker
 */

import { parentPort, workerData } from 'node:worker_threads'
import { extractDocument } from './extractors.ts'
import type { ExtractWorkerInit, ExtractWorkerReply } from './protocol.ts'

const init = workerData as ExtractWorkerInit
const port = parentPort
if (port === null) throw new Error('document-extract-js worker requires a parent port')

void extractDocument(init.data, init.extension).then(
  (result) => { port.postMessage({ ok: true, result } satisfies ExtractWorkerReply) },
  (error: unknown) => {
    port.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies ExtractWorkerReply)
  },
)
