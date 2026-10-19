/**
 * Shared timeout arithmetic, signal fusion, and classification. The library
 * only notifies through abort signals; each capability still owns the mechanism
 * that stops its work and translates timeout reasons into public outcomes.
 * @module @aeven/timeout
 */

/**
 * Internal abort reason carrying a capability-owned code and elapsed deadline.
 * Providers translate it through {@link timeoutOf} before returning to callers.
 */
export class TimeoutReason extends Error {
  override name = 'TimeoutReason'

  /**
   * @param code Capability-owned timeout code (e.g. `BASH_TIMEOUT`).
   * @param timeoutMs The deadline that elapsed, in milliseconds.
   */
  constructor(readonly code: string, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`)
  }
}

/** Largest delay Node schedules without clamping it to one millisecond. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

function assertTimerDelay(timeoutMs: number, name: string): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Validate a caller's optional timeout hint, use the backend default, then cap
 * it. Supplied values must be positive and finite; zero is not a public
 * disable-timeout sentinel.
 *
 * @param requested The caller's optional hint; validated when present.
 * @param def The backend default applied when `requested` is absent.
 * @param max The backend upper bound the result is capped to.
 * @param name Field name used in the thrown message (so the caller sees which input was
 *   bad).
 * @returns The effective timeout in milliseconds: `min(requested ?? def, max)`.
 */
export function clampTimeout(
  requested: number | undefined,
  def: number,
  max: number,
  name = 'timeoutMs',
): number {
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return Math.min(requested ?? def, max)
}

/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
export interface Deadline {
  /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
  readonly signal: AbortSignal
  /** Clear the timer and stop forwarding upstream cancellation. Safe to call once; `using` calls it at scope exit. */
  [Symbol.dispose](): void
}

/**
 * A {@link Deadline} whose ownership can be released before it fires.
 * Releasing is how a capability hands still-running work to a new owner (the
 * bash executor returning a background handle): neither the elapsed timer nor
 * an upstream abort reaches {@link Deadline.signal} afterward, so the work keeps
 * running until its new owner stops it.
 */
export interface ReleasableDeadline extends Deadline {
  /**
   * Stop the timer and stop forwarding upstream cancellation. The signal keeps
   * whatever state it already reached; later upstream aborts do not reach it.
   * Idempotent, and equivalent to {@link Deadline[Symbol.dispose]}.
   */
  release(): void
}

/** Rearmable timeout around one outstanding async-iterator demand. */
export interface IdleWatchdog {
  /** Stable signal aborted by upstream cancellation or this watchdog's timeout. */
  readonly signal: AbortSignal
  /**
   * Await one iterator demand while the idle timer is armed. The deadline
   * settles the demand even when the awaited work ignores its abort signal.
   * @param iterator - iterator whose next value represents provider progress.
   * @returns the iterator's next result.
   * @throws The {@link TimeoutReason} of this watchdog when the idle interval
   *   elapses first. Only that deadline settles the demand: an upstream
   *   cancellation reaches the iterator through {@link IdleWatchdog.signal} and
   *   never shortens the wait. The abandoned demand stays the caller's to release
   *   through that signal; an async generator queues its own return behind it, so
   *   callers must not await it. Disposal clears the timer without settling an
   *   outstanding demand.
   */
  next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>>
  /** Rearm an outstanding demand after transport activity that yields no iterator value; otherwise a no-op. */
  pulse(): void
  /** Clear an armed timer; safe to call once at the owning stream's exit. */
  [Symbol.dispose](): void
}

/**
 * Fuse upstream cancellation with an identifiable timeout. `timeoutMs <= 0` is
 * the internal no-timer sentinel; the returned disposer clears an armed timer.
 * The signal only notifies, so callers must stop their own work.
 *
 * @param upstream The caller's cancellation signal, if any, fused into the result.
 * @param timeoutMs Deadline in milliseconds; `<= 0` means "no timeout" (arm no timer).
 * @param code Capability-owned code stamped onto the timeout's {@link TimeoutReason}.
 * @returns The fused {@link Deadline} (signal + timer cleanup).
 */
export function deadline(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): Deadline {
  const fused = releasableDeadline(upstream, timeoutMs, code)
  return { signal: fused.signal, [Symbol.dispose]() { fused.release() } }
}

/**
 * Fuse upstream cancellation with an identifiable timeout whose ownership can be
 * released later. The first source to abort decides the signal's reason, so
 * `timeoutOf()` reads a {@link TimeoutReason} only when this deadline's own
 * timeout won and an upstream cancellation otherwise; a released deadline is
 * never aborted by either source.
 *
 * @param upstream The caller's cancellation signal, if any, forwarded until release.
 * @param timeoutMs Deadline in milliseconds; `<= 0` means "no timeout" (arm no timer).
 * @param code Capability-owned code stamped onto the timeout's {@link TimeoutReason}.
 * @returns The fused {@link ReleasableDeadline}.
 */
export function releasableDeadline(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): ReleasableDeadline {
  if (timeoutMs > 0) assertTimerDelay(timeoutMs, 'deadline timeoutMs')

  const fused = new AbortController()
  // Forwarding the reason by hand (rather than AbortSignal.any) is what makes
  // release possible: AbortSignal.any cannot detach a source once fused.
  const forward = (): void => { fused.abort((upstream as AbortSignal).reason) }
  if (upstream?.aborted === true) {
    forward()
  } else {
    upstream?.addEventListener('abort', forward, { once: true })
  }
  const timer = timeoutMs > 0
    ? setTimeout(() => { fused.abort(new TimeoutReason(code, timeoutMs)) }, timeoutMs)
    : undefined

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    if (timer !== undefined) clearTimeout(timer)
    upstream?.removeEventListener('abort', forward)
  }
  return { signal: fused.signal, release, [Symbol.dispose]: release }
}

/**
 * Create a rearmable idle watchdog for an async iterator. The timer exists only
 * while {@link IdleWatchdog.next} is outstanding, so consumer think time does
 * not count as provider idle time. The returned signal is stable for the whole
 * call and only notifies; the iterator must observe it to release the resources
 * of a demand the deadline abandoned.
 *
 * @param upstream - caller cancellation fused into the stable signal.
 * @param timeoutMs - positive finite idle interval in milliseconds.
 * @param code - capability-owned code carried by the timeout reason.
 * @returns a stable signal, guarded next operation, and timer disposer.
 */
export function idleWatchdog(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): IdleWatchdog {
  assertTimerDelay(timeoutMs, 'idleWatchdog timeoutMs')
  const timeout = new AbortController()
  const signal = upstream === undefined
    ? timeout.signal
    : AbortSignal.any([upstream, timeout.signal])
  // The deadline owns the outstanding demand. A transport can leave a read it
  // aborted pending forever (undici drops the error when the abort lands on an
  // in-flight body read), so waiting for the iterator to observe the signal
  // would leave the caller waiting past its own deadline.
  const reason = new TimeoutReason(code, timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  let outstanding = false
  let disposed = false

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timeout.abort(reason)
    }, timeoutMs)
  }

  return {
    signal,
    async next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
      if (disposed) throw new Error('idleWatchdog is disposed')
      if (outstanding) throw new Error('idleWatchdog next is already outstanding')
      outstanding = true
      arm()
      const expired = Promise.withResolvers<never>()
      const onAbort = (): void => { expired.reject(reason) }
      timeout.signal.addEventListener('abort', onAbort, { once: true })
      try {
        // Both reactions end with this demand: a deadline promise kept for the
        // watchdog's lifetime would retain every value the settled races produced.
        return await Promise.race([
          iterator.next().finally(() => { timeout.signal.removeEventListener('abort', onAbort) }),
          expired.promise,
        ])
      } finally {
        timeout.signal.removeEventListener('abort', onAbort)
        clearTimeout(timer)
        timer = undefined
        outstanding = false
      }
    },
    pulse(): void {
      if (disposed || !outstanding) return
      arm()
    },
    [Symbol.dispose](): void {
      if (disposed) return
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * Recover a timeout reason from a reason-bearing object. Supplying `code`
 * distinguishes this deadline from a nested upstream deadline; a foreign code
 * follows the ordinary cancellation path.
 *
 * @param x An {@link AbortSignal} or any `{ reason }` carrier (e.g. a caught abort error).
 * @param code When provided, only a {@link TimeoutReason} with this exact `code` matches.
 * @returns The matching {@link TimeoutReason}, else `undefined`.
 */
export function timeoutOf(x: AbortSignal | { reason?: unknown }, code?: string): TimeoutReason | undefined {
  // AbortSignal.reason is typed `any`; pin it to `unknown` so no `any` leaks and
  // the instanceof narrows cleanly for both a signal and a bare reason carrier.
  const reason: unknown = x.reason
  if (!(reason instanceof TimeoutReason)) return undefined
  return code === undefined || reason.code === code ? reason : undefined
}
