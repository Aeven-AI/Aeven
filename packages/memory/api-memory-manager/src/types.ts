/** JSON-safe results of the `memoryManager` Remote namespace. */
import type { MemoryDomain, MemoryItemId } from '@aeven/memory/types'
import type { InvariantsView, InvariantChange } from '@aeven/memory-invariants/types'
import type { SessionId } from '@aeven/session/types'

export type { MemoryDomain, MemoryItemId } from '@aeven/memory/types'
export type { Invariant, InvariantChange, InvariantId, InvariantReason, InvariantsView } from '@aeven/memory-invariants/types'

/** One memory of the signed-in user. */
export interface ManagedMemory {
  readonly id: MemoryItemId
  readonly domain: MemoryDomain
  readonly time: number
  /** Distilled fact; empty until the provider finished distilling the exchange. */
  readonly summary: string
  readonly userText: string
  readonly sessionId: SessionId
  /** Working directory of the session the memory came from, when that session is still known. */
  readonly workspace?: string
}

/** One page of the signed-in user's memories. */
export type ManagedMemoryPage =
  | { readonly available: false }
  | { readonly available: true; readonly memories: readonly ManagedMemory[]; readonly total: number }

/** Page request for {@link ManagedMemoryPage}. */
export interface ManagedMemoryQuery {
  /** Text filter; absent lists everything. */
  readonly query?: string
  /** Domains to list; absent lists every domain. `offset` and `total` count only the listed domains. */
  readonly domains?: readonly MemoryDomain[]
  readonly limit: number
  readonly offset: number
}

/**
 * The caller's standing facts with the budget they render under, or the fact that this Host serves none.
 * A statement here enters every request of its owner, which is why the management surface states the cost.
 */
export type ManagedInvariantsPage =
  | { readonly available: false }
  | ({ readonly available: true } & InvariantsView)

/** Outcome of promoting, replacing, or removing one statement, with the caller's state after the attempt. */
export type ManagedInvariantChange =
  | { readonly available: false }
  | ({ readonly available: true } & InvariantChange)

/** One learned procedure of the signed-in user, as listed. */
export interface ManagedProcedure {
  readonly id: MemoryItemId
  /** Kebab-case name of the kind of task. */
  readonly name: string
  /** One line: what the procedure does and when to use it. */
  readonly description: string
  readonly domain: MemoryDomain
  /** When the procedure was last learned, merged, or saved. */
  readonly time: number
  /** Session whose work the procedure was last learned from or saved in. */
  readonly sessionId: SessionId
  /** Working directory of that session, when it is still known. */
  readonly workspace?: string
}

/** One learned procedure with its text. */
export interface ManagedProcedureDetail extends ManagedProcedure {
  /** The condensed procedure memory recall delivers. */
  readonly summary: string
  /** The full Markdown procedure. */
  readonly content: string
}

/** The signed-in user's learned procedures, newest first. */
export type ManagedProceduresPage =
  | { readonly available: false }
  | { readonly available: true; readonly procedures: readonly ManagedProcedure[] }
