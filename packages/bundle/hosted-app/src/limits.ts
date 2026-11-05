/** Bounds hosted model streams and admits waiting accounts in round-robin order. */

interface Waiting {
  readonly resolve: (release: () => void) => void
  readonly reject: (error: Error) => void
  detach(): void
}

/** Deployment limits for active streams and their waiting requests. */
export interface RequestLimits {
  /** Streams one account may hold at once; a request over it waits behind that account's own queue. */
  readonly perAccount: number
  /** Streams the whole Host may hold at once, across every account and operator work. */
  readonly total: number
  /** Waiting requests one account may have; a further request is refused rather than queued. */
  readonly queuedPerAccount: number
  /** Waiting requests the Host may hold across every account; a further request is refused rather than queued. */
  readonly queuedTotal: number
}

/** The rejection reason a request cancelled by its caller settles with. */
function cancelled(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : 'Hosted request cancelled')
}

/** One deployment's account-aware request admission queue. */
export class AccountRequests {
  private readonly active = new Map<string | undefined, number>()
  private readonly waiting = new Map<string | undefined, Waiting[]>()
  private running = 0
  private queued = 0
  private closed = false

  /** @param limits - Validated hosted deployment limits. */
  constructor(private readonly limits: RequestLimits) {}

  /**
   * Reserve a model stream slot, waiting while the account or Host is occupied.
   * @param owner - account initiating the call; undefined identifies operator background work.
   * @param signal - cancellation while waiting.
   * @returns an idempotent release callback; rejects on cancellation, saturation, or shutdown.
   */
  acquire(owner: string | undefined, signal?: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error('Hosted request admission is shutting down'))
    if (signal?.aborted === true) return Promise.reject(cancelled(signal.reason))
    const available = this.running < this.limits.total && (this.active.get(owner) ?? 0) < this.limits.perAccount
    if (!available && (this.queued >= this.limits.queuedTotal || (this.waiting.get(owner)?.length ?? 0) >= this.limits.queuedPerAccount)) {
      return Promise.reject(new Error('Too many pending hosted requests; wait for an active request to finish'))
    }
    return new Promise((resolve, reject) => {
      const request: Waiting = { resolve, reject, detach: () => {} }
      const abort = (): void => {
        const queue = this.waiting.get(owner)
        const index = queue?.indexOf(request) ?? -1
        if (index < 0 || queue === undefined) return
        queue.splice(index, 1)
        if (queue.length === 0) this.waiting.delete(owner)
        this.queued--
        request.detach()
        reject(cancelled(signal?.reason))
        this.pump()
      }
      request.detach = () => { signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      const queue = this.waiting.get(owner) ?? []
      queue.push(request)
      this.waiting.set(owner, queue)
      this.queued++
      this.pump()
    })
  }

  private pump(): void {
    if (this.closed) return
    while (this.running < this.limits.total) {
      const next = [...this.waiting].find(([owner]) => (this.active.get(owner) ?? 0) < this.limits.perAccount)
      if (next === undefined) return
      const [owner, queue] = next
      const request = queue.shift()
      if (request === undefined) continue
      this.waiting.delete(owner)
      if (queue.length > 0) this.waiting.set(owner, queue)
      this.queued--
      request.detach()
      this.running++
      this.active.set(owner, (this.active.get(owner) ?? 0) + 1)
      let released = false
      request.resolve(() => {
        if (released) return
        released = true
        this.running--
        const count = (this.active.get(owner) ?? 1) - 1
        if (count === 0) this.active.delete(owner)
        else this.active.set(owner, count)
        this.pump()
      })
    }
  }

  /** Refuse new requests and reject queued requests; active streams release through their owners. */
  close(): void {
    this.closed = true
    for (const queue of this.waiting.values()) {
      for (const request of queue) {
        request.detach()
        request.reject(new Error('Hosted request admission is shutting down'))
      }
    }
    this.waiting.clear()
    this.queued = 0
  }
}
