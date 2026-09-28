/** Vocabulary for learned capabilities: executable procedures an agent learned for one user. */

/**
 * Lifecycle status of a capability. Only the user makes a capability executable or retires it; evidence
 * from recorded executions moves an executable capability between the remaining statuses.
 * - `candidate`: remembered but not confirmed; recalled as an unconfirmed draft, never loaded as instructions.
 * - `learned`: confirmed by the user; published through the skill catalog.
 * - `trusted`: learned, and the current revision has enough successful, verified executions.
 * - `needs-validation`: the procedure changed after it was trusted; the next execution must verify it.
 * - `degraded`: the most recent executions of the current revision failed.
 * - `retired`: withdrawn by the user; kept with its history but not published.
 */
export type CapabilityStatus = 'candidate' | 'learned' | 'trusted' | 'needs-validation' | 'degraded' | 'retired'

/** Where an execution ran; a capability that never succeeded in an environment is validated there first. */
export interface CapabilityEnvironment {
  readonly platform: string
  readonly arch: string
  /** Major OS release, such as `25` for macOS 16 or `6` for Linux 6.x. */
  readonly release: string
}

/** The model's own account of one execution; a report, not an independent observation. */
export interface CapabilityReport {
  readonly outcome: 'succeeded' | 'failed'
  /** Whether the procedure's verification step ran and passed. */
  readonly validation: 'passed' | 'failed' | 'not-run'
  readonly notes?: string
}

/** One use of a capability in one turn, recorded from the session log when the turn ends. */
export interface CapabilityExecution {
  readonly kind: 'execution'
  readonly id: string
  readonly revision: number
  readonly sessionId: string
  readonly turn: number
  readonly startedAt: number
  readonly endedAt: number
  readonly model?: { readonly provider: string; readonly model: string }
  readonly environment: CapabilityEnvironment
  /** Tools called after the capability was loaded, with whether each failed. */
  readonly tools: readonly { readonly name: string; readonly failed: boolean }[]
  /** Model requests the provider retried during the turn. */
  readonly retries: number
  /** `TurnEndReason.kind` of the turn. */
  readonly endReason: string
  readonly tokens?: { readonly input: number; readonly output: number }
  readonly report?: CapabilityReport
}

/** Evidence about an execution that arrives after it was recorded. */
export type CapabilityAmendment =
  | { readonly kind: 'correction'; readonly executionId: string; readonly at: number; readonly text: string }
  | { readonly kind: 'rating'; readonly executionId: string; readonly at: number; readonly rating: 'positive' | 'negative'; readonly note?: string }

/** One line of a capability's execution log. */
export type CapabilityEvidenceEntry = CapabilityExecution | CapabilityAmendment

/** Judgment of one execution from all its evidence. */
export type ExecutionVerdict = 'verified' | 'succeeded' | 'failed' | 'unknown'

/** One execution with the verdict its evidence supports. */
export interface JudgedExecution {
  readonly execution: CapabilityExecution
  readonly verdict: ExecutionVerdict
  readonly correction?: string
  readonly rating?: 'positive' | 'negative'
}

/** How a capability came to exist. */
export type CapabilitySource = 'agent' | 'user'

/** One recorded change to a capability: when, what kind, and the session it came from. */
export interface CapabilityProvenance {
  /** Session the change came from; absent for evidence settlement and for changes the user made outside a session. */
  readonly sessionId?: string
  readonly at: number
  /** What happened: first save, content update, supporting file, or status change. */
  readonly action: 'save' | 'update' | 'file' | 'status' | 'evidence'
}

/** Durable metadata of one capability; the executable body lives in its `SKILL.md`. */
export interface CapabilityRecord {
  /** Kebab-case name, unique per owner; also the skill name it is published under. */
  readonly name: string
  /** One-line routing description: what the capability does and when to use it. */
  readonly description: string
  readonly status: CapabilityStatus
  /** Increments on every change to the body or supporting files. */
  readonly revision: number
  /** Revision that was current when the capability last became trusted. */
  readonly trustedRevision?: number
  readonly source: CapabilitySource
  readonly createdAt: number
  readonly updatedAt: number
  /** Supporting files relative to the capability directory, such as `scripts/build.sh`. */
  readonly files: readonly string[]
  readonly provenance: readonly CapabilityProvenance[]
}

/** A capability with its executable body. */
export interface Capability extends CapabilityRecord {
  /** Markdown procedure: when to use it, requirements, steps, validation, and recovery. */
  readonly content: string
  /** Absolute directory holding `SKILL.md` and supporting files. */
  readonly directory: string
}

/** New or replacement content for one capability. */
export interface CapabilityDraft {
  readonly name: string
  readonly description: string
  readonly content: string
}

/** One committed change to an owner's capabilities. */
export interface CapabilityChange {
  readonly owner: string
  readonly name: string
}
