/** Persistent schedules, execution records, and inbound trigger credentials. */
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
/** Local wall time `HH:mm` shared by the calendar recurrence kinds. */
export type LocalTime = string
/**
 * One-time, elapsed-time, calendar, or cron cadence.
 * Calendar kinds name wall times in `timeZone`, so a nonexistent spring-forward
 * wall time is skipped rather than shifted.
 */
export type AutomationSchedule = (
  | { readonly kind: 'once'; readonly at: string; readonly timeZone: string }
  | { readonly kind: 'interval'; readonly everyMinutes: number; readonly anchor: string; readonly timeZone: string }
  /** Every `everyHours` hours counted from local midnight, at `atMinute` past the hour. */
  | { readonly kind: 'hours'; readonly everyHours: number; readonly atMinute: number; readonly timeZone: string }
  | { readonly kind: 'daily'; readonly time: LocalTime; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly time: LocalTime; readonly weekdays: readonly Weekday[]; readonly timeZone: string }
  /** Days of the month; a month without the day is skipped. */
  | { readonly kind: 'monthly'; readonly time: LocalTime; readonly days: readonly number[]; readonly timeZone: string }
  /** The `week`-th named weekday of every month, counted from the first. */
  | { readonly kind: 'nth-weekday'; readonly time: LocalTime; readonly week: 1 | 2 | 3 | 4; readonly weekday: Weekday; readonly timeZone: string }
  | { readonly kind: 'yearly'; readonly time: LocalTime; readonly month: number; readonly day: number; readonly timeZone: string }
  /** Five-field cron expression: minute, hour, day of month, month, day of week. */
  | { readonly kind: 'cron'; readonly expression: string; readonly timeZone: string }
) & { readonly until?: string | undefined }
/** One scoped approval the owner gave in a run conversation; later runs of the same automation reuse it. */
export interface AutomationGrant {
  /** Tool whose operation the owner approved. */
  readonly toolName: string
  /** The requester's account-and-operation scope the approval covers. */
  readonly scope: string
  readonly grantedAt: string
}
/** How a run came to be admitted. */
export type AutomationTrigger = 'schedule' | 'manual' | 'webhook'
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
/**
 * Bearer credential an outside service presents to start a run.
 * The secret stays out of definitions, run snapshots, and every model-visible list.
 */
export interface AutomationWebhook {
  readonly secret: string
  /** Leading characters of `secret`, shown so an owner can recognize the key without reading it. */
  readonly keyId: string
  readonly createdAt: string
  readonly lastDeliveredAt: string | null
}
/** Durable occurrence admission and interval-wide execution result. */
export interface AutomationRun {
  readonly id: AutomationRunId
  readonly definition: AutomationDefinition
  readonly trigger: AutomationTrigger
  readonly scheduledFor: string
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  readonly sessionId: SessionId | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly summary: string | null
  readonly error: string | null
  readonly admittedBy: AutomationRunnerId
  readonly retryOfRunId: AutomationRunId | null
  /** Accepted inbound body of a webhook run; the run notice marks it untrusted data. */
  readonly payload?: string | null | undefined
  readonly resolution: { readonly kind: 'retried'; readonly at: string; readonly retryRunId: AutomationRunId | null } | null
}
/** Editable task values; execution ownership is resolved by the service. */
export interface AutomationInput {
  readonly name: string
  readonly prompt: string
  readonly schedule: AutomationSchedule
  readonly permission: 'read-only' | 'workspace-write'
}
