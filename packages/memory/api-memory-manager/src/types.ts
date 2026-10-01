/** JSON-safe results of the `memoryManager` Remote namespace. */
import type { MemoryDomain, MemoryItemId } from '@aeven/memory/types'
import type { InvariantsView, InvariantChange } from '@aeven/memory-invariants/types'
import type { CapabilityProvenance, CapabilityRecord, CapabilityRunMetrics, CapabilityStatus, ExecutionVerdict } from '@aeven/capability/types'
import type { SessionId } from '@aeven/session/types'

export type { CapabilityRunMetrics, CapabilityStatus, ExecutionVerdict } from '@aeven/capability/types'
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

/** Execution counts of a capability's current revision. */
export interface ManagedCapabilityRuns {
  readonly total: number
  readonly succeeded: number
  readonly failed: number
  readonly lastRunAt?: number
}

/** What a capability changed: the work it was learned from against its recent successful runs. */
export interface ManagedCapabilityImpact {
  /** Cost of the work the capability was learned from. */
  readonly before: CapabilityRunMetrics
  /** Median cost of its most recent successful runs; absent until one succeeded. */
  readonly after?: CapabilityRunMetrics
  /** Successful runs the median covers. */
  readonly runs: number
}

/** One learned capability of the signed-in user, as listed. */
export interface ManagedCapability extends Omit<CapabilityRecord, 'provenance'> {
  readonly runs: ManagedCapabilityRuns
  /** Absent for a capability that was not learned from measured work. */
  readonly impact?: ManagedCapabilityImpact
}

/** One recorded execution, judged from its evidence. */
export interface ManagedCapabilityExecution {
  readonly id: string
  readonly revision: number
  readonly sessionId: string
  readonly endedAt: number
  readonly verdict: ExecutionVerdict
  readonly correction?: string
  readonly rating?: 'positive' | 'negative'
  readonly notes?: string
}

/** One learned capability with its procedure and history. */
export interface ManagedCapabilityDetail extends ManagedCapability {
  /** Markdown procedure. */
  readonly content: string
  readonly provenance: readonly CapabilityProvenance[]
  /** Executions, newest first. */
  readonly executions: readonly ManagedCapabilityExecution[]
}

/** Replacement text for one capability. */
export interface ManagedCapabilityEdit {
  readonly description: string
  readonly content: string
}

/** Status the user can set from the memory manager: withdraw a capability or put it back in use. */
export type ManagedCapabilityStatusChange = Extract<CapabilityStatus, 'retired' | 'learned'>
