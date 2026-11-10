/** Client-safe desktop hand-off request and answer types. @module @aeven/tool-desktop-handoff/types */

import type { Scoped } from '@aeven/scope'
import type { Agent } from '@aeven/agent/types'

/** What the request needs from the user's own computer. */
export type DesktopHandoffReason = 'computer' | 'files' | 'terminal' | 'device' | 'models'

/** How an offer ended: the window showing the session opened the dialog, or no window answered. */
export type DesktopHandoffResult = 'shown' | 'no-window'

/** Client-safe payload declared for the desktop hand-off waterfall. */
export interface DesktopHandoffOfferEvent {
  /** What the request needs from the user's computer, which picks the dialog's explanation. */
  reason: DesktopHandoffReason
  /** Agent identity projected to the corresponding Client Context in transit. */
  agent?: Agent
  /** Cancellation lifetime of the pending offer. */
  signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Offer the reader of a session the Aeven desktop app. The client showing
     * that session opens the "Available in Aeven Desktop" dialog and answers;
     * a listener without that session calls `next()` to delegate.
     * Scope-filtered dispatch (`@aeven/scope`): agent-scoped listeners receive
     * only that agent.
     * @param request - what the request needs from the reader's computer.
     * @mode waterfall
     */
    'desktop-handoff/offer'(
      this: Scoped<Agent>,
      request: DesktopHandoffOfferEvent,
      next: () => Promise<DesktopHandoffResult>,
    ): Promise<DesktopHandoffResult>
  }
}
