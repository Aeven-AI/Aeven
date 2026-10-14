/** One reconnecting Host readiness mirror shared by every voice UI occurrence. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SpeechCatalog } from '@aeven/api-speech-to-text/types'
import type {} from '@aeven/api-remotes/client'

/** Complete provider state, with a separate transport failure that never rewrites Host readiness. */
export interface SpeechReadiness {
  readonly catalog: SpeechCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Subscribe once per Client plugin, independent of rendered pages and Sessions.
 * @param ctx - mounted speech Remote owner.
 * @returns shared readiness snapshot and joined observation cleanup.
 */
export function observeReadiness(ctx: Context): { state: SnapshotStore<SpeechReadiness>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<SpeechReadiness>({ catalog: null, connected: false, error: null })
  let disposed = false
  const isDisposed = (): boolean => disposed
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  const stream = ctx.remote.$stream<SpeechCatalog>({
    name: 'Speech readiness', open: signal => ctx.remote.speech.follow(signal),
    // A silent end is terminal: the socket failures `$stream` retries reach
    // `carrierFailed` on their own, and nothing reopens a stream the Host ended
    // without a terminal result.
    ended: accepted => new Error(accepted
      ? 'Speech readiness stream ended without a terminal result'
      : 'Speech readiness stream ended before its opening catalog'),
    carrierFailed: fail,
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        state.set({ catalog: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) fail(error) }
  })()
  return { state, dispose: async () => { disposed = true; await stream.dispose(); await observing } }
}
