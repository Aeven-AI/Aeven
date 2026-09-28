/** Hard deadline for foreground memory work whose provider may ignore cancellation. */

/** Rejection raised when a foreground memory operation outlives its deadline. */
export class MemoryDeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryDeadlineError'
  }
}

/**
 * Settle with the operation, or reject at the deadline or on abort, whichever comes first.
 * A late operation outcome stays observed by `Promise.race`, so it cannot surface as an unhandled rejection.
 * @param operation - foreground work already in flight.
 * @param deadlineAt - absolute epoch milliseconds.
 * @param signal - caller cancellation.
 * @param timeoutMessage - message of the {@link MemoryDeadlineError}.
 * @returns the operation's result.
 */
export async function withDeadline<T>(operation: Promise<T>, deadlineAt: number, signal: AbortSignal, timeoutMessage: string): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => undefined)
    throw signal.reason
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cutoff = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => reject(new MemoryDeadlineError(timeoutMessage)), Math.max(0, deadlineAt - Date.now()))
  })
  try {
    return await Promise.race([operation, cutoff])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
