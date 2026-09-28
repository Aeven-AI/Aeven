/** One reconnecting mirror of Host document-reader readiness. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@aeven/api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { DocumentReaderCatalog } from '@aeven/api-document-extract/types'
import type {} from '@aeven/api-remotes/client'

/** Latest Host readiness with a separate transport failure. */
export interface DocumentReadiness {
  readonly catalog: DocumentReaderCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Follow reader readiness for the plugin's lifetime.
 * @param ctx - context carrying the `documents` Remote.
 * @returns the shared snapshot and joined cleanup.
 */
export function observeDocumentReaders(ctx: Context): { state: SnapshotStore<DocumentReadiness>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<DocumentReadiness>({ catalog: null, connected: false, error: null })
  let disposed = false
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  const stream = ctx.remote.$stream<DocumentReaderCatalog>({
    name: 'Document reader readiness', open: signal => ctx.remote.documents.follow(signal),
    ended: () => new RemoteStreamCarrierError('Document reader readiness stream ended'), carrierFailed: fail,
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        state.set({ catalog: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) {
      if (!disposed) fail(error)
    }
  })()
  return { state, dispose: async () => { disposed = true; await stream.dispose(); await observing } }
}
