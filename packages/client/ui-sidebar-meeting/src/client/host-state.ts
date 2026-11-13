/** Self-healing mirrors of Host speech states, each shared by every Recorder pane. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { RemoteStream } from '@aeven/api-gateway/client'
import type {} from '@aeven/api-remotes/client'

/** First delay before reopening a stream that ended; doubles per consecutive attempt up to the cap. */
const REOPEN_DELAY_MS = 2_000
/** Longest delay between reopening attempts. */
const MAX_REOPEN_DELAY_MS = 30_000

/** One Host state stream to follow. */
export interface HostStateStream<T> {
  /** Diagnostic name of the stream. */
  readonly name: string
  /** Open one generation of the stream. */
  readonly open: (signal: AbortSignal) => AsyncIterable<T>
  /** Whether a value ends observation for good, so an ended stream is not reopened; absent reopens always. */
  readonly final?: (value: T) => boolean
}

/* jscpd:ignore-start -- the reopen-with-backoff loop of ui-voice-input's readiness mirror, for this plugin's own streams. */
/**
 * Follow a Host state for the plugin's lifetime, reopening the stream with backoff when it ends and
 * restarting it when the carrier reports a fresh Host.
 * @param ctx - mounted speech Remote owner.
 * @param stream - the stream to follow.
 * @returns the shared state (null until the first observation) and its cleanup.
 */
export function observeHostState<T>(
  ctx: Context, stream: HostStateStream<T>,
): { state: SnapshotStore<T | null>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<T | null>(null)
  const lifetime = new AbortController()
  let active: RemoteStream<T> | undefined
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
      const generation = ctx.remote.$stream<T>({
        name: stream.name, open: stream.open,
        ended: accepted => new Error(accepted
          ? `${stream.name} stream ended without a terminal result`
          : `${stream.name} stream ended before its opening state`),
        carrierFailed: () => undefined,
      })
      active = generation
      try {
        for await (const item of generation) {
          state.set(item.value)
          item.accept()
          attempt = 0
        }
      } catch {
        // The stream ended or its carrier failed; the loop reopens it below after a backoff.
      }
      await generation.dispose()
      if (active === generation) active = undefined
      if (isDisposed()) return
      const last = state.getSnapshot()
      if (last !== null && stream.final?.(last) === true) return
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
      if (!isDisposed()) lifetime.abort(new Error(`${stream.name} state disposed`))
      reset()
      await active?.dispose()
      await observing
    },
  }
}
/* jscpd:ignore-end */
