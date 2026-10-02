/**
 * Automatic model-list sync for the signed-in subscription providers. Each
 * pass asks every signed-in provider for its current model listing and
 * replaces the served list, so a model the vendor adds appears and a model it
 * drops disappears without user action.
 * @module @aeven/subscription-auth/model-sync
 */

/** One provider the sync keeps current. */
export interface SyncedProvider {
  /** Whether the provider holds a credential; a signed-out provider is skipped. */
  isSignedIn(): Promise<boolean>
  /**
   * Read the vendor's current listing and apply it. Implementations keep the
   * last good listing on failure and report the failure by rejecting.
   * @param signal - cancelled when the sync is disposed.
   */
  sync(signal: AbortSignal): Promise<void>
}

/** Options for {@link startModelSync}. */
export interface ModelSyncOptions {
  readonly providers: readonly SyncedProvider[]
  /** Interval between passes in milliseconds; `0` syncs only on demand. */
  readonly intervalMs: number
  /** Reports a provider's failed pass; the next pass retries. */
  readonly onError: (error: unknown) => void
}

/** A running model sync. */
export interface ModelSync {
  /** Start a pass now, or join the pass already running. */
  syncNow(): Promise<void>
  /** Stop the interval and cancel a running pass. */
  dispose(): void
}

/**
 * Start syncing. The first pass runs immediately.
 * @param options - the providers, the interval, and the error sink.
 * @returns the running sync.
 */
export function startModelSync(options: ModelSyncOptions): ModelSync {
  const controller = new AbortController()
  let running: Promise<void> | undefined
  const pass = async (): Promise<void> => {
    await Promise.all(options.providers.map(async (provider) => {
      try {
        if (controller.signal.aborted || !(await provider.isSignedIn())) return
        await provider.sync(controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) options.onError(error)
      }
    }))
  }
  const syncNow = (): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve()
    running ??= pass().finally(() => {
      running = undefined
    })
    return running
  }
  const timer = options.intervalMs > 0 ? setInterval(() => { void syncNow() }, options.intervalMs) : undefined
  timer?.unref()
  void syncNow()
  return {
    syncNow,
    dispose: () => {
      if (timer !== undefined) clearInterval(timer)
      controller.abort()
    },
  }
}
