/**
 * Command-directory cache keyed by session: one entry per served catalog —
 * every session is agent-backed, so `command.list({sessionId})` is the only
 * request fields. Each entry keeps the soft-hard invalidation behavior of the
 * original global cache and runs at most one pull at a time: refreshes that
 * arrive during a pull share it and cause one follow-up pull, so a burst of
 * invalidations costs at most two requests per session.
 */
import type { CommandDescriptor } from '@aeven/commands/types'
import type { SessionId } from '@aeven/session/types'

export type { CommandDescriptor } from '@aeven/commands/types'

/**
 * cold = never pulled; pending = pull in flight with nothing servable;
 * ready = snapshot serving (a soft-invalidate repull keeps this status);
 * failed = last winning pull rejected, snapshot dropped.
 */
export type DirectoryStatus = 'cold' | 'pending' | 'ready' | 'failed'

/** Injected pull (the service binds command.list off the root connection). */
export type FetchCommands = (sessionId: SessionId) => Promise<readonly CommandDescriptor[]>

/** One session key's cache cell. */
class Entry {
  state: DirectoryStatus = 'cold'
  commands: readonly CommandDescriptor[] = []
  lastError: unknown
  waiters: Array<() => void> = []
  /** The pull sequence in flight, shared by every refresh that arrives while it runs. */
  inflight: Promise<void> | undefined
  /** A refresh arrived during the current pull; its outcome is discarded and one follow-up pull runs. */
  stale = false

  /** Whether a refresh arrived during the pull that is flying; the caller re-reads this after each await. */
  isStale(): boolean { return this.stale }
}

/** The session-keyed directory cache. Plain class — the owning service wires events and RPC. */
export class CommandDirectory {
  private readonly entries = new Map<SessionId, Entry>()

  constructor(private readonly fetchCommands: FetchCommands) {}

  /**
   * Current cache status for one session.
   * @param sessionId - session key.
   * @returns the entry status (cold when never touched).
   */
  status(sessionId: SessionId): DirectoryStatus {
    return this.entries.get(sessionId)?.state ?? 'cold'
  }

  /**
   * Synchronous exact-name lookup over one session's hot snapshot.
   * @param sessionId - session key.
   * @param name - command name without the leading slash.
   * @returns the descriptor, or undefined when absent or the entry is not ready.
   */
  resolve(sessionId: SessionId, name: string): CommandDescriptor | undefined {
    const entry = this.entries.get(sessionId)
    if (entry === undefined || entry.state !== 'ready') return undefined
    return entry.commands.find(c => c.name === name)
  }

  /** Soft invalidation (commands-changed): background repull on every touched key; ready snapshots keep serving. */
  invalidateAll(): void {
    for (const key of this.entries.keys()) void this.refresh(key)
  }

  /**
   * Drop one Session's obsolete composition-specific snapshot and prewarm its replacement.
   * @param sessionId - Session whose effective command composition changed.
   */
  resetSession(sessionId: SessionId): void {
    const entry = this.entry(sessionId)
    entry.state = 'cold'
    entry.commands = []
    entry.lastError = undefined
    void this.refresh(sessionId)
  }

  /**
   * Hard reset on reconnect: every entry drops its snapshot (the agent world
   * may have changed shape across the generation) and prewarms.
   */
  resetConnected(): void {
    for (const [key, entry] of this.entries) {
      entry.state = 'cold'
      entry.commands = []
      void this.refresh(key)
    }
  }

  /**
   * Fire-and-forget prewarm of one session (the command source's scope-birth
   * warm hook lands here).
   * @param sessionId - session key.
   */
  warm(sessionId: SessionId): void {
    const entry = this.entry(sessionId)
    if (entry.state === 'cold' || entry.state === 'failed') void this.refresh(sessionId)
  }

  /**
   * Request a pull for one session. With no pull in flight one starts; during
   * a pull the request joins it and marks it stale, so its outcome is
   * discarded and exactly one follow-up pull publishes. A ready snapshot is
   * not demoted while pulls fly.
   * @param sessionId - session key.
   * @returns settled when the pull sequence covering this request has published.
   */
  refresh(sessionId: SessionId): Promise<void> {
    const entry = this.entry(sessionId)
    if (entry.state !== 'ready') entry.state = 'pending'
    if (entry.inflight !== undefined) {
      entry.stale = true
      return entry.inflight
    }
    const run = async (): Promise<void> => {
      try {
        do {
          entry.stale = false
          await this.pull(sessionId, entry)
        } while (entry.isStale())
      } finally {
        entry.inflight = undefined
      }
    }
    entry.inflight = run()
    return entry.inflight
  }

  /** One request; publishes its outcome unless a refresh arrived while it flew. */
  private async pull(sessionId: SessionId, entry: Entry): Promise<void> {
    try {
      const commands = await this.fetchCommands(sessionId)
      if (entry.stale) return
      entry.commands = commands
      entry.state = 'ready'
      entry.lastError = undefined
    } catch (error) {
      if (entry.stale) return
      entry.commands = []
      entry.state = 'failed'
      entry.lastError = error
    }
    notifyWaiters(entry)
  }

  /**
   * Strong-wait until one session's catalog is servable (the enter-
   * adjudication "directory must be reached" rule): ready returns at once;
   * cold/failed launch a fresh pull; pending joins the flying one. Rejects
   * when the awaited pull fails or the signal aborts.
   * @param sessionId - session key.
   * @param signal - attempt-scoped abort (the SubmitAttempt signal).
   * @returns the hot command snapshot.
   */
  async ensureReady(sessionId: SessionId, signal: AbortSignal): Promise<readonly CommandDescriptor[]> {
    const entry = this.entry(sessionId)
    while (true) {
      if (entry.state === 'ready') return entry.commands
      if (entry.state !== 'pending') void this.refresh(sessionId)
      await settled(entry, signal)
      if (entry.state === 'failed') {
        throw new Error(`command directory warmup failed: ${entry.lastError instanceof Error ? entry.lastError.message : String(entry.lastError)}`)
      }
      // Still pending (the awaited pull was superseded) → wait for the winner.
    }
  }

  private entry(sessionId: SessionId): Entry {
    let entry = this.entries.get(sessionId)
    if (entry === undefined) {
      entry = new Entry()
      this.entries.set(sessionId, entry)
    }
    return entry
  }
}

/** One settlement tick for one entry: resolves at the next winning publish, rejects on abort. */
function settled(entry: Entry, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const waiter = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = (): void => {
      entry.waiters = entry.waiters.filter(w => w !== waiter)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.waiters.push(waiter)
  })
}

function notifyWaiters(entry: Entry): void {
  const woken = entry.waiters
  entry.waiters = []
  for (const wake of woken) wake()
}

/** Normalize an abort into an Error rejection. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('command directory wait aborted')
}
