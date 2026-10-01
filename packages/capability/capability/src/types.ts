/** Vocabulary for learned capabilities: executable procedures an agent learned for one user. */

/**
 * Lifecycle status of a capability. Evidence from recorded executions moves a capability between statuses;
 * nobody is asked. The user can retire, restore, edit, or delete any capability afterwards.
 * - `candidate`: learned from completed work and not yet validated; published with a note to check each step.
 * - `learned`: at least one execution of a candidate succeeded.
 * - `trusted`: learned, and the current revision has enough successful executions, at least one verified.
 * - `needs-validation`: the procedure changed after it was trusted; the next execution must verify it.
 * - `degraded`: the most recent executions of the current revision failed.
 * - `retired`: withdrawn by the user or by repeated failure as a candidate; kept with its history but not published.
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
  /** What happened: first save, content update, supporting file, status change, or a restore of a kept revision. */
  readonly action: 'save' | 'update' | 'file' | 'status' | 'evidence' | 'rollback'
  /** For a rollback, the revision whose body the new revision restored. */
  readonly restored?: number
}

/** One revision whose body is still kept on disk. */
export interface CapabilityVersion {
  readonly revision: number
  /** The description that revision carried; absent only when its kept frontmatter could not be read. */
  readonly description?: string
  readonly content: string
}

/** Cost of one piece of work, measured from the session log. */
export interface CapabilityRunMetrics {
  readonly durationMs: number
  readonly toolCalls: number
  readonly failedToolCalls: number
  readonly tokens?: { readonly input: number; readonly output: number }
}

/** The completed work a capability was learned from. */
export interface CapabilityOrigin {
  readonly sessionId: string
  readonly turn: number
  /** The user's request that the work answered. */
  readonly request: string
  /** Tools the work called, in order. */
  readonly tools: readonly string[]
  /** What the work cost before the capability existed: the baseline later executions are compared with. */
  readonly baseline: CapabilityRunMetrics
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
  /** The work it was learned from; absent when it was written without a completed turn to learn from. */
  readonly origin?: CapabilityOrigin
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
