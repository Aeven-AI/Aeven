/** One self-healing Host readiness mirror shared by every voice UI occurrence. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SpeechCatalog } from '@aeven/api-speech-to-text/types'
import type { RemoteStream } from '@aeven/api-gateway/client'
import type {} from '@aeven/api-remotes/client'

/** Complete provider state, with a separate transport failure that never rewrites Host readiness. */
export interface SpeechReadiness {
  readonly catalog: SpeechCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/** First delay before reopening a stream that ended; doubles per consecutive attempt up to the cap. */
const REOPEN_DELAY_MS = 2_000
/** Longest delay between reopening attempts, so a returning Host is reached promptly. */
const MAX_REOPEN_DELAY_MS = 30_000

/**
 * Subscribe once per Client plugin, independent of rendered pages and Sessions.
 *
 * A stream the Host ends, or one that loses its carrier for good, would otherwise leave the
 * composer unable to record until the page reloads: the mirror reopens it with backoff and
 * restarts the current generation whenever the carrier reports a fresh Host.
 * @param ctx - mounted speech Remote owner.
 * @returns shared readiness snapshot and joined observation cleanup.
 */
export function observeReadiness(ctx: Context): { state: SnapshotStore<SpeechReadiness>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<SpeechReadiness>({ catalog: null, connected: false, error: null })
  const lifetime = new AbortController()
  let active: RemoteStream<SpeechCatalog> | undefined
  let attempt = 0
  let interrupt: (() => void) | undefined
  const isDisposed = (): boolean => lifetime.signal.aborted
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  /** Wait between reopening attempts; disposal ends the wait early. */
  const pause = (delay: number): Promise<void> => new Promise((resolve) => {
    const timer = setTimeout(done, delay)
    function done(): void {
      clearTimeout(timer)
      lifetime.signal.removeEventListener('abort', done)
      interrupt = undefined
      resolve()
    }
    interrupt = done
    lifetime.signal.addEventListener('abort', done, { once: true })
  })
  const observe = async (): Promise<void> => {
    while (!isDisposed()) {
      const stream = ctx.remote.$stream<SpeechCatalog>({
        name: 'Speech readiness', open: signal => ctx.remote.speech.follow(signal),
        // Either end is terminal for this generation: the loop reopens a fresh one instead of
        // treating the closed stream as a usable observation.
        ended: accepted => new Error(accepted
          ? 'Speech readiness stream ended without a terminal result'
          : 'Speech readiness stream ended before its opening catalog'),
        carrierFailed: fail,
      })
      active = stream
      try {
        for await (const item of stream) {
          state.set({ catalog: item.value, connected: true, error: null })
          item.accept()
          attempt = 0
        }
      } catch (error) { if (!isDisposed()) fail(error) }
      await stream.dispose()
      if (active === stream) active = undefined
      if (isDisposed()) return
      await pause(Math.min(REOPEN_DELAY_MS * 2 ** attempt++, MAX_REOPEN_DELAY_MS))
    }
  }
  const observing = observe()
  const reset = ctx.on('connection/reset', () => {
    attempt = 0
    interrupt?.()
    active?.restart()
  })
  return {
    state,
    dispose: async () => {
      if (!isDisposed()) lifetime.abort(new Error('Speech readiness disposed'))
      reset()
      await active?.dispose()
      await observing
    },
  }
}
