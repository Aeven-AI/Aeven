/** Client-safe location request and answer types. @module @aeven/tool-location/types */

import type { Scoped } from '@aeven/scope'
import type { Agent } from '@aeven/agent/types'

/** What the reader chose, or why no location could be read. */
export type LocationAnswer =
  /** A position read from the reader's device after they allowed it. */
  | {
    readonly kind: 'device'
    readonly latitude: number
    readonly longitude: number
    /** Radius of the 95% confidence circle, in meters. */
    readonly accuracyMeters: number
    /** When the device took the reading, in epoch milliseconds. */
    readonly timestamp: number
  }
  /** A place the reader typed instead of sharing their device location. */
  | { readonly kind: 'manual'; readonly place: string }
  /** The reader chose not to share a location. */
  | { readonly kind: 'declined' }
  /** The reader allowed it, but no position could be read. */
  | { readonly kind: 'unavailable'; readonly reason: string }

/** Client-safe payload declared for the location waterfall. */
export interface LocationRequestEvent {
  /** Why the model needs the location, shown to the reader before they choose. */
  purpose: string
  /** Agent identity projected to the corresponding Client Context in transit. */
  agent?: Agent
  /** Cancellation lifetime of the pending request. */
  signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask the reader of a session for their location. The client showing that
     * session asks the reader and returns their choice; a listener that cannot
     * ask calls `next()` to delegate. Scope-filtered dispatch (`@aeven/scope`):
     * agent-scoped listeners receive only that agent.
     * @param request - pending location request.
     * @mode waterfall
     */
    'location/request'(
      this: Scoped<Agent>,
      request: LocationRequestEvent,
      next: () => Promise<LocationAnswer>,
    ): Promise<LocationAnswer>
  }
}
