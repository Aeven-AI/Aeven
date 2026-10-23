/** Browser terminal identities, metadata and screen-stream frames. */
import type { Branded } from '@aeven/brand'
import type { Agent } from '@aeven/agent/types'
import type { Scoped } from '@aeven/scope'
import type {} from '@aeven/typert-protocol'

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The terminal identity is missing or has begun process cleanup. */
    'terminal/unavailable': Record<string, never>
    /** Input or resize was refused without invalidating the output attachment. */
    'terminal/control-unavailable': { readonly reason: 'read-only' | 'not-running' }
    /** Retained screens and pending allocations consume the Session's terminal quota. */
    'terminal/limit-reached': { readonly limit: number }
  }
}

/** A terminal identity scoped to one Session and one Host lifetime. */
export type WebTerminalId = Branded<'WebTerminalId'>
/** An attachment allowed to write and resize one terminal. */
export type TerminalAttachmentId = Branded<'TerminalAttachmentId'>

/** Acknowledges one physical window hold without taking screen or input control. */
export interface TerminalRetentionFrame {
  readonly type: 'retained'
}

/** An executable shell verified in the subprocess provider's execution environment. */
export interface TerminalShell {
  readonly path: string
  readonly args: readonly string[]
  readonly name: string
}

/** Working directory and limits shared by new and restored terminals. */
export interface TerminalEnvironment {
  readonly cwd: string
  readonly maxInputBytes: number
  readonly maxCols: number
  readonly maxRows: number
  readonly scrollback: number
}

/** Host-owned terminal state; process exit never creates a replacement shell. */
export interface WebTerminalInfo {
  readonly id: WebTerminalId
  readonly title: string
  readonly shell: TerminalShell
  /** Initial working directory; shell directory changes do not update this field. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly state: 'running' | 'exited' | 'failed'
  readonly exitCode: number | null
  readonly error?: string
  readonly controllerId?: TerminalAttachmentId
}

/** Create is idempotent for an open identity; closed identities cannot be recreated. */
export interface TerminalCreateRequest {
  /** A path returned by shell discovery; absent selects the execution default. */
  readonly shellPath?: string
  readonly id: WebTerminalId
  readonly cols: number
  readonly rows: number
}

/** Every attachment begins with a complete bounded screen, then ordered output. */
export type TerminalFrame =
  | { readonly type: 'snapshot'; readonly sequence: number; readonly screen: string; readonly info: WebTerminalInfo }
  | { readonly type: 'output'; readonly sequence: number; readonly data: string }
  | { readonly type: 'state'; readonly info: WebTerminalInfo }

/** Client-safe payload of the request to show a terminal beside its Session. */
export interface TerminalShowRequestEvent {
  /** The Host terminal the new Terminal pill attaches to. */
  readonly terminalId: WebTerminalId
  /** Agent identity projected to the corresponding Client Context in transit. */
  agent?: Agent
  /** Cancellation lifetime of the pending request. */
  signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Show one terminal in a new Terminal pill beside its session. The client
     * displaying that session opens the pill and returns true; a listener
     * without that session calls `next()` to delegate. Scope-filtered dispatch
     * (`@aeven/scope`): agent-scoped listeners receive only that agent.
     * @param request - the terminal to show.
     * @mode waterfall
     */
    'terminal/show'(
      this: Scoped<Agent>,
      request: TerminalShowRequestEvent,
      next: () => Promise<boolean>,
    ): Promise<boolean>
  }
}
