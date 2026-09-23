/** Client-safe browser automation request and event types. @module @aeven/tool-browser/types */

import type { Scoped } from '@aeven/scope'
import type { Agent } from '@aeven/agent/types'
import type { JsonValue } from '@aeven/util-values'

/** One browser action a `browser_*` tool asks the session's browser to perform. */
export type BrowserAutomationOperation =
  | 'status' | 'navigate' | 'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'evaluate'

/** Client-safe payload declared for the browser automation waterfall. */
export interface BrowserAutomationRequestEvent {
  /** The action to perform. */
  operation: BrowserAutomationOperation
  /** The tool's validated arguments. */
  input: { [key: string]: JsonValue }
  /** Agent identity projected to the corresponding Client Context in transit. */
  agent?: Agent
  /** Cancellation lifetime of the pending request. */
  signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Perform one action in the browser beside a session. The client holding
     * that session's browser returns the action's result; a listener without
     * one calls `next()` to delegate. Scope-filtered dispatch (`@aeven/scope`):
     * agent-scoped listeners receive only that agent.
     * @param request - pending browser action.
     * @mode waterfall
     */
    'browser/automation'(
      this: Scoped<Agent>,
      request: BrowserAutomationRequestEvent,
      next: () => Promise<JsonValue>,
    ): Promise<JsonValue>
  }
}
