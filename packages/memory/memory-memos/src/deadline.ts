/** Hard deadline for foreground memory work whose provider may ignore cancellation. */

/** Rejection raised when a foreground memory operation outlives its deadline. */
export class MemoryDeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryDeadlineError'
  }
}

/**
 * The reason an aborted signal settles with, as an Error.
 * @param signal - the signal whose abort settles the deadline.
 * @returns the signal's own Error reason, or an Error carrying a non-Error reason.
 */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error('memory work aborted', { cause: reason })
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
    throw abortReason(signal)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cutoff = new Promise<never>((_resolve, reject) => {
    onAbort = () => { reject(abortReason(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { reject(new MemoryDeadlineError(timeoutMessage)) }, Math.max(0, deadlineAt - Date.now()))
  })
  try {
    return await Promise.race([operation, cutoff])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
