/** Persistent schedules and account-owned execution records. */
import type { Branded } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import type { ModelSelection } from '@aeven/agent'

/** Identifies a persistent automation. */
export type AutomationId = Branded<'AutomationId'>
/** Identifies one admitted execution. */
export type AutomationRunId = Branded<'AutomationRunId'>
/** Identifies the Host installation that admits local work. */
export type AutomationRunnerId = Branded<'AutomationRunnerId'>
/** ISO weekday names used by calendar recurrence. */
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
/** One-time, elapsed-time, or local-calendar cadence. */
export type AutomationSchedule = (
  | { readonly kind: 'once'; readonly at: string; readonly timeZone: string }
  | { readonly kind: 'interval'; readonly everyMinutes: number; readonly anchor: string; readonly timeZone: string }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly weekdays: readonly Weekday[]; readonly timeZone: string }
) & { readonly until?: string | undefined }
/** One scoped approval the owner gave in a run conversation; later runs of the same automation reuse it. */
export interface AutomationGrant {
  /** Tool whose operation the owner approved. */
  readonly toolName: string
  /** The requester's account-and-operation scope the approval covers. */
  readonly scope: string
  readonly grantedAt: string
}
/** User-approved task and execution settings. */
export interface AutomationDefinition {
  readonly id: AutomationId
  readonly owner?: string | undefined
  readonly revision: number
  readonly name: string
  readonly prompt: string
  readonly schedule: AutomationSchedule
  readonly status: 'active' | 'paused'
  readonly agentPreset: string
  readonly model: ModelSelection
  readonly permission: 'read-only' | 'workspace-write'
  /** Approvals answered without asking again in every later run. */
  readonly grants: readonly AutomationGrant[]
  readonly executionTarget: { readonly kind: 'local'; readonly runnerId: AutomationRunnerId }
  readonly lastAdmittedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
/** Durable occurrence admission and interval-wide execution result. */
export interface AutomationRun {
  readonly id: AutomationRunId
  readonly definition: AutomationDefinition
  readonly trigger: 'schedule' | 'manual'
  readonly scheduledFor: string
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  readonly sessionId: SessionId | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly summary: string | null
  readonly error: string | null
  readonly admittedBy: AutomationRunnerId
  readonly retryOfRunId: AutomationRunId | null
  readonly resolution: { readonly kind: 'retried'; readonly at: string; readonly retryRunId: AutomationRunId | null } | null
}
/** Editable task values; execution ownership is resolved by the service. */
export interface AutomationInput {
  readonly name: string
  readonly prompt: string
  readonly schedule: AutomationSchedule
  readonly permission: 'read-only' | 'workspace-write'
}
