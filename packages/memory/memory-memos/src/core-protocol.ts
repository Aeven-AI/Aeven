/** Messages between the Host and a MemOS core worker; every field is structured-cloneable. */
import type { ResolvedHome } from '@deepseek-ai/memos-local-plugin/core/config/paths.js'
import type { EmbedRole, EmbeddingConfig } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'
import type { HostLlmCompleteInput } from '@deepseek-ai/memos-local-plugin/core/llm/host-bridge.js'

/** What a worker needs to open one account's core; the Host keeps the bridge, the embedder, and the gate. */
export interface CoreOpenSpec {
  readonly agent: string
  readonly namespace: { readonly agentKind: string; readonly profileId: string; readonly profileLabel: string }
  readonly home: ResolvedHome
  /** The MemOS configuration object `bootstrapMemoryCore` takes. */
  readonly config: unknown
  /** Whether MemOS LLM calls go to the Host's bridge. */
  readonly hostLlm: boolean
  /** Whether embedding requests go to the Host's embedding queue instead of a model loaded in the worker. */
  readonly hostEmbeddings: boolean
  readonly autoRecovery: boolean
}

/** An error as it crosses the thread boundary. */
export interface WireError {
  readonly name: string
  readonly message: string
  readonly code?: string
  readonly details?: Record<string, unknown>
}

/** Host to worker. */
export type ToWorker =
  | { readonly type: 'open'; readonly id: number; readonly owner: string; readonly spec: CoreOpenSpec }
  | {
    readonly type: 'call'
    readonly id: number
    readonly owner: string
    readonly method: string
    readonly args: readonly unknown[]
    /** Positions in `args` whose object carried an `AbortSignal` under `signal`; the worker supplies its own. */
    readonly signals: readonly number[]
    /** Host context the call's LLM requests run in; `0` for none. */
    readonly context: number
  }
  | { readonly type: 'abort'; readonly id: number }
  | { readonly type: 'close'; readonly id: number; readonly owner: string }
  /** The Host's answer to an `llm` or `embed` request. */
  | { readonly type: 'reply'; readonly id: number; readonly value?: unknown; readonly error?: WireError }

/** Worker to Host. */
export type FromWorker =
  | { readonly type: 'result'; readonly id: number; readonly value?: unknown; readonly error?: WireError }
  | { readonly type: 'llm'; readonly id: number; readonly context: number; readonly input: Omit<HostLlmCompleteInput, 'signal'> }
  | { readonly type: 'embed'; readonly id: number; readonly owner: string; readonly texts: readonly string[]; readonly role: EmbedRole; readonly config: EmbeddingConfig; readonly deadlineAt?: number }
  /** The worker gave up on its `llm` or `embed` request `id`. */
  | { readonly type: 'cancel'; readonly id: number }
  /** A synchronous maintenance-gate question; the Host answers through the shared gate cell. */
  | { readonly type: 'gate'; readonly owner: string }

/** Gate cell values: the worker writes `ASKED` before it waits, the Host writes the verdict and notifies. */
export const GATE = { ASKED: 0, DENIED: 1, GRANTED: 2 } as const

/**
 * Describe an error for the other thread.
 * @param error - the thrown value.
 * @returns its name, message, and MemOS code and details when it has them.
 */
export function wireError(error: unknown): WireError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) }
  const { code, details } = error as { code?: unknown; details?: unknown }
  return {
    name: error.name,
    message: error.message,
    ...typeof code === 'string' ? { code } : {},
    ...typeof details === 'object' && details !== null && cloneable(details) ? { details: details as Record<string, unknown> } : {},
  }
}

function cloneable(value: object): boolean {
  try {
    structuredClone(value)
    return true
  } catch {
    // A DataCloneError: the details hold a function or another value no thread boundary carries.
    return false
  }
}
