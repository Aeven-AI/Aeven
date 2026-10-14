/** One-shot completion for a Client interaction with waterfall delegation. */
export class PendingResult<T> {
  /** Result returned to the waiting waterfall listener. */
  readonly result: Promise<T>
  readonly #completion = Promise.withResolvers<T>()
  readonly #delegated = Symbol('pending interaction delegated')
  readonly #onAbort: () => void
  #settled = false

  /**
   * @param label - identity included in duplicate-settlement errors.
   * @param signal - cancellation projected from the Host.
   * @param abortMessage - reason used when cancellation supplies none.
   */
  constructor(private readonly label: string, private readonly signal: AbortSignal | undefined, abortMessage: string) {
    this.result = this.#completion.promise
    this.#onAbort = () => { this.abort(signal?.reason ?? new Error(abortMessage)) }
    signal?.addEventListener('abort', this.#onAbort, { once: true })
    if (signal?.aborted === true) this.#onAbort()
  }

  /** Whether the request has been answered, delegated, or aborted. */
  get settled(): boolean { return this.#settled }

  /** Delegate an unanswered request to the next waterfall listener. */
  delegate(): void { this.abort(this.#delegated) }

  /**
   * Recognize delegation from this interaction.
   * @param reason - rejection received from the result.
   * @returns whether delegation produced the rejection.
   */
  isDelegation(reason: unknown): boolean { return reason === this.#delegated }

  /**
   * Reject an unanswered interaction when its lifetime ends.
   * @param reason - rejection exposed to the waiting listener.
   */
  abort(reason: unknown): void {
    if (this.#settled) return
    this.finish(() => { this.#completion.reject(reason) })
  }

  /**
   * Resolve this interaction once.
   * @param value - the reader's answer.
   */
  protected resolve(value: T): void { this.finish(() => { this.#completion.resolve(value) }) }

  private finish(settle: () => void): void {
    if (this.#settled) throw new Error(`${this.label} is already settled`)
    this.#settled = true
    this.signal?.removeEventListener('abort', this.#onAbort)
    settle()
  }
}

/**
 * Await a registered interaction, delegating when its presentation withdraws.
 * @param pending - interaction presented to the reader.
 * @param register - registers the interaction and its withdrawal callback.
 * @param next - next waterfall listener.
 * @returns the answer produced here or by the delegated listener.
 */
export async function awaitPendingResult<T, P extends { result: Promise<T>; delegate(): void; isDelegation(reason: unknown): boolean }>(
  pending: P,
  register: (pending: P, withdraw: () => Promise<void>) => () => void,
  next: () => Promise<T>,
): Promise<T> {
  const completed = Promise.withResolvers<void>()
  const remove = register(pending, async () => {
    pending.delegate()
    await completed.promise
  })
  try {
    try { return await pending.result }
    catch (error) {
      if (pending.isDelegation(error)) return await next()
      throw error
    }
  } finally {
    remove()
    completed.resolve()
  }
}
