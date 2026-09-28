/** JSON-safe results of the `memoryManager` Remote namespace. */
import type { MemoryDomain, MemoryItemId } from '@aeven/memory/types'
import type { CapabilityProvenance, CapabilityRecord, CapabilityStatus, ExecutionVerdict } from '@aeven/capability/types'
import type { SessionId } from '@aeven/session/types'

export type { CapabilityStatus, ExecutionVerdict } from '@aeven/capability/types'
export type { MemoryDomain, MemoryItemId } from '@aeven/memory/types'

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

/** Execution counts of a capability's current revision. */
export interface ManagedCapabilityRuns {
  readonly total: number
  readonly succeeded: number
  readonly failed: number
  readonly lastRunAt?: number
}

/** One learned capability of the signed-in user, as listed. */
export interface ManagedCapability extends Omit<CapabilityRecord, 'provenance'> {
  readonly runs: ManagedCapabilityRuns
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
