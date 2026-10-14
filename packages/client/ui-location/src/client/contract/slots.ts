/** Location consent composer contracts. */
import { PendingResult } from '@aeven/client-store'
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
export class PendingLocation extends PendingResult<LocationAnswer> {
  /** Domain discriminator used by Session pending-interaction consumers. */
  // oxlint-disable-next-line typescript/prefer-as-const -- the Cordis inspector catalog reads the declared literal type
  readonly kind: 'location' = 'location'
  /** Opaque render identity and one-shot remount axis. */
  readonly key: string
  /**
   * @param sessionId - Agent/Session identity owning the scoped request.
   * @param purpose - why the model asks, shown to the reader.
   * @param signal - cancellation projected from the Host waterfall.
   */
  constructor(readonly sessionId: SessionId, readonly purpose: string, signal: AbortSignal | undefined) {
    super('pending location', signal, 'location request was aborted')
    nextLocationKey += 1
    this.key = `location:${String(nextLocationKey)}`

  }

  /**
   * Resolve the Host waterfall with the reader's choice. A request that already
   * settled, because its turn was cancelled, ignores a late choice.
   * @param answer - what the reader chose.
   */
  answer(answer: LocationAnswer): void {
    if (this.settled) return
    this.resolve(answer)
  }


}

/** Full props of the location composer takeover. */
export type LocationComposerProps =
  PropsRuntime<'conversation.composer'>
  & { matched: PendingLocation }
  & PropsLocale<'location'>
