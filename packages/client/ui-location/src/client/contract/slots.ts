/** Location consent composer contracts. */
import type { SessionId } from '@aeven/session/types'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { LocationAnswer } from '@aeven/tool-location/types'
import type { LocationKey } from '../locales.ts'

declare module '@aeven/client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** Pending location request. */
    location: PendingLocation
  }
}

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Location consent copy. */
    location: LocationKey
  }
}

let nextLocationKey = 0

/** One answerable Client presentation of a pending `location/request` waterfall. */
export class PendingLocation {
  /** Domain discriminator used by Session pending-interaction consumers. */
  readonly kind = 'location' as const
  /** Opaque render identity and one-shot remount axis. */
  readonly key: string
  /** Result returned by the Remote Event listener to the Host waterfall. */
  readonly result: Promise<LocationAnswer>

  readonly #resolve: (answer: LocationAnswer) => void
  readonly #reject: (reason: unknown) => void
  readonly #signal: AbortSignal | undefined
  readonly #onAbort: () => void
  readonly #delegated = Symbol('pending location delegated')
  #settled = false

  /**
   * @param sessionId - Agent/Session identity owning the scoped request.
   * @param purpose - why the model asks, shown to the reader.
   * @param signal - cancellation projected from the Host waterfall.
   */
  constructor(readonly sessionId: SessionId, readonly purpose: string, signal: AbortSignal | undefined) {
    nextLocationKey += 1
    this.key = `location:${String(nextLocationKey)}`
    const completion = Promise.withResolvers<LocationAnswer>()
    this.result = completion.promise
    this.#resolve = completion.resolve
    this.#reject = completion.reject
    this.#signal = signal
    this.#onAbort = () => { this.abort(signal?.reason ?? new Error('location request was aborted')) }
    if (signal === undefined) return
    signal.addEventListener('abort', this.#onAbort, { once: true })
    if (signal.aborted) this.#onAbort()
  }

  /** Whether the request has been answered, delegated, or aborted. */
  get settled(): boolean {
    return this.#settled
  }

  /**
   * Resolve the Host waterfall with the reader's choice. A request that already
   * settled, because its turn was cancelled, ignores a late choice.
   * @param answer - what the reader chose.
   */
  answer(answer: LocationAnswer): void {
    if (this.#settled) return
    this.finish(() => { this.#resolve(answer) })
  }

  /** Delegate an unanswered request to the next waterfall listener. */
  delegate(): void {
    if (this.#settled) return
    this.finish(() => { this.#reject(this.#delegated) })
  }

  /**
   * Test whether a rejection requests waterfall delegation.
   * @param reason - rejection received from {@link PendingLocation.result}.
   * @returns whether {@link PendingLocation.delegate} produced it.
   */
  isDelegation(reason: unknown): boolean {
    return reason === this.#delegated
  }

  /**
   * End an unanswered presentation when its transport, scope, or plugin lifetime ends.
   * @param reason - rejection exposed to the waiting Remote Event listener.
   */
  abort(reason: unknown): void {
    if (this.#settled) return
    this.finish(() => { this.#reject(reason) })
  }

  private finish(settle: () => void): void {
    this.#settled = true
    this.#signal?.removeEventListener('abort', this.#onAbort)
    settle()
  }
}

/** Full props of the location composer takeover. */
export type LocationComposerProps =
  PropsRuntime<'conversation.composer'>
  & { matched: PendingLocation }
  & PropsLocale<'location'>
