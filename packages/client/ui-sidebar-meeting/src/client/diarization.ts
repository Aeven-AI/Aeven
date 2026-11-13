/** One self-healing mirror of the Host speaker diarizer's state, shared by every Recorder pane. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { DiarizationState } from '@aeven/api-speech-to-text/types'
import type { RemoteStream } from '@aeven/api-gateway/client'
import type {} from '@aeven/api-remotes/client'

/** First delay before reopening a stream that ended; doubles per consecutive attempt up to the cap. */
const REOPEN_DELAY_MS = 2_000
/** Longest delay between reopening attempts. */
const MAX_REOPEN_DELAY_MS = 30_000

/* jscpd:ignore-start -- the reopen-with-backoff loop of ui-voice-input's readiness mirror, for this capability's own stream and state. */
/**
 * Follow the diarizer's state for the plugin's lifetime, reopening the stream with backoff when it
 * ends and restarting it when the carrier reports a fresh Host.
 * @param ctx - mounted speech Remote owner.
 * @returns the shared state (null until the first observation) and its cleanup.
 */
export function observeDiarization(ctx: Context): { state: SnapshotStore<DiarizationState | null>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<DiarizationState | null>(null)
  const lifetime = new AbortController()
  let active: RemoteStream<DiarizationState> | undefined
  let attempt = 0
  let interrupt: (() => void) | undefined
  const isDisposed = (): boolean => lifetime.signal.aborted
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
      const stream = ctx.remote.$stream<DiarizationState>({
        name: 'Speaker diarization state', open: signal => ctx.remote.speech.followDiarization(signal),
        ended: accepted => new Error(accepted
          ? 'Speaker diarization stream ended without a terminal result'
          : 'Speaker diarization stream ended before its opening state'),
        carrierFailed: () => undefined,
      })
      active = stream
      try {
        for await (const item of stream) {
          state.set(item.value)
          item.accept()
          attempt = 0
        }
      } catch {
        // The stream ended or its carrier failed; the loop reopens it below after a backoff.
      }
      await stream.dispose()
      if (active === stream) active = undefined
      if (isDisposed()) return
      // A Host without a diarizer answers once and ends; there is nothing to reopen for.
      if (state.getSnapshot()?.phase === 'unavailable') return
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
      if (!isDisposed()) lifetime.abort(new Error('Speaker diarization state disposed'))
      reset()
      await active?.dispose()
      await observing
    },
  }
}
/* jscpd:ignore-end */
