/** Persistent bot definitions, triggers, boards, handoffs, execution records, and inbound trigger credentials. */
import type { Branded } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import type { ModelSelection } from '@aeven/agent'
import type { SyncStatus } from '@aeven/sync'

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
 * wall time is skipped rather than shifted. `jitterMinutes`, accepted on every kind but `once`, delays each
 * occurrence by whole minutes in `[0, jitterMinutes)` derived from the bot and the occurrence, so every Host fires it
 * at the same instant.
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
) & { readonly until?: string | undefined; readonly jitterMinutes?: number | undefined }
/** One scoped approval the owner gave in a run conversation; later runs of the same automation reuse it. */
export interface AutomationGrant {
  /** Tool whose operation the owner approved. */
  readonly toolName: string
  /** The requester's account-and-operation scope the approval covers. */
  readonly scope: string
  readonly grantedAt: string
  /** Instant after which the grant no longer answers and the next run asks again; absent never expires. */
  readonly expiresAt?: string | undefined
}
/** Identifies one account-level board shared by bots. */
export type BoardId = Branded<'BoardId'>
/** Identifies one handoff between two bots. */
export type HandoffId = Branded<'HandoffId'>
/**
 * Connector ids a bot may be bound to: the providers of the owner's connected accounts, with `email` for the
 * IMAP/POP3 mail connector and `mcp` for a custom MCP server connection.
 */
export type ConnectorId =
  | 'email' | 'gmail' | 'google-drive' | 'google-calendar' | 'github' | 'notion' | 'vercel' | 'atlassian' | 'monday' | 'stripe' | 'salesforce' | 'shopify' | 'slack' | 'discord' | 'telegram' | 'whatsapp'
  | 'microsoft-365' | 'outlook' | 'outlook-calendar' | 'onedrive' | 'sharepoint' | 'teams' | 'mcp'
/** `all` lets a run use every connector its owner has connected; a list lets it use only those. */
export type ConnectorBinding = 'all' | readonly ConnectorId[]
/**
 * What an occurrence does while another run of the same bot is queued or running: `skip` records it as skipped,
 * `queue` holds it until the earlier runs settle, and `parallel` starts it at once.
 */
export type OverlapPolicy = 'skip' | 'queue' | 'parallel'
/** Which new emails wake a bot; every present field must match, compared case-insensitively. */
export interface MailEventFilter {
  /** Address of the owner's mail account; absent watches every account. */
  readonly account?: string | undefined
  /** Text the sender must contain. */
  readonly from?: string | undefined
  /** Text the subject must contain. */
  readonly subject?: string | undefined
}
/** Which GitHub deliveries wake a bot; every present field must match. */
export interface GitHubEventFilter {
  /** `X-GitHub-Event` names such as `pull_request`; absent accepts every event. */
  readonly events?: readonly string[] | undefined
  /**
   * Payload `action` values such as `published` for `release`; absent or empty accepts every action, and a delivery
   * without an `action` field matches only then.
   */
  readonly actions?: readonly string[] | undefined
  /** `owner/name` of the repository; absent accepts every repository. */
  readonly repository?: string | undefined
}
/**
 * Which calendar events wake a bot; every present field must match. Text compares case-insensitively.
 */
export interface CalendarEventFilter {
  /** Text the event's title must contain. */
  readonly title?: string | undefined
  /** Text one attendee's address must contain. */
  readonly attendee?: string | undefined
  /** Whether an attendee's address domain differs from every address domain of the owner's own on the event. */
  readonly hasExternalAttendee?: boolean | undefined
  /** Whether the owner accepted or organizes the event. */
  readonly accepted?: boolean | undefined
}
/** Calendar connectors a calendar trigger can read. */
export type CalendarProvider = 'google-calendar' | 'outlook-calendar'
/** One timed event of an owner's connected calendar, as a calendar source reports it. */
export interface CalendarEvent {
  /** The provider's id of this event or of this instance of a recurring event. */
  readonly id: string
  readonly provider: CalendarProvider
  readonly title: string
  /** ISO start instant. */
  readonly start: string
  /** ISO end instant. */
  readonly end: string
  /** Address of the event in the provider's web app, when it has one. */
  readonly link?: string | undefined
  /** Attendees and organizer, `self` marking the owner's own address. */
  readonly attendees: readonly { readonly address: string; readonly self: boolean }[]
  /** Whether the owner accepted or organizes it. */
  readonly accepted: boolean
}
/** A provider of an owner's calendar events, registered with the automations service's `registerCalendarSource`. */
export interface CalendarSource {
  /**
   * Read the timed events of one owner's connected calendars that start inside a window.
   * @param owner - the account.
   * @param from - inclusive ISO start of the window.
   * @param to - exclusive ISO end of the window.
   * @param signal - aborts the reads when the Host stops.
   * @returns the events, cancelled and all-day events left out; a calendar that cannot be read is left out too.
   */
  events(owner: string, from: string, to: string, signal: AbortSignal): Promise<readonly CalendarEvent[]>
}
/** One thing that can wake a bot. Each admitted run names the trigger that admitted it by its index. */
export type BotTrigger =
  | { readonly kind: 'schedule'; readonly schedule: AutomationSchedule }
  /** `sender` deduplicates requests by their `Idempotency-Key` header; `none` admits every request. */
  | { readonly kind: 'webhook'; readonly idempotency: 'sender' | 'none' }
  | { readonly kind: 'event'; readonly source: 'mail'; readonly filter: MailEventFilter }
  | { readonly kind: 'event'; readonly source: 'github'; readonly filter: GitHubEventFilter }
  /**
   * Other bots of the same owner may hand this bot tasks. `wait` wakes each sender again with this bot's result once
   * the run settles; `dispatch` does not. With several senders, the handoffs of one chain join: `all` runs the bot
   * once every sender of the chain has settled, with every result, and `any` runs it on the first result and records
   * later ones without a run. A join still incomplete `joinTimeoutMinutes` after its first input settles the missing
   * senders as timed out.
   */
  | {
    readonly kind: 'bot'
    readonly from: readonly AutomationId[]
    readonly join: 'all' | 'any'
    readonly mode: 'wait' | 'dispatch'
    readonly joinTimeoutMinutes: number
  }
  /**
   * Each matching event of the owner's connected calendars, or only of `calendar`, wakes the bot `offsetMinutes`
   * after its start, before it when negative. The occurrence follows the event while it moves, and an event admits
   * one run per trigger.
   */
  | { readonly kind: 'calendar'; readonly calendar?: CalendarProvider | undefined; readonly filter: CalendarEventFilter; readonly offsetMinutes: number }
/** Token accounting of one run, summed over its model calls. */
export interface RunUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  /** Uncached input, cached input, and output together. */
  readonly totalTokens: number
}
/** A ceiling shared by every member of a board; each field is optional and absent means unbounded. */
export interface BoardBudget {
  /** Most member runs queued or running at once on one Host. */
  readonly maxConcurrentRuns?: number | undefined
  /** Most tokens the members' runs may spend over the last twenty-four hours. */
  readonly maxTokensPerDay?: number | undefined
}
/** Bots of one account that share handoffs, a task list, and a budget. */
export interface AutomationBoard {
  readonly id: BoardId
  readonly owner?: string | undefined
  readonly name: string
  readonly members: readonly AutomationId[]
  readonly budget: BoardBudget
  readonly createdAt: string
  readonly updatedAt: string
}
/**
 * One task one bot handed another. Any Host that may run the receiving bot admits it; the run's result settles it.
 * `reply` marks the result a `wait` edge carries back to the sender.
 */
export interface Handoff {
  readonly id: HandoffId
  readonly owner?: string | undefined
  /** The board both bots belonged to when it was handed over, if any. */
  readonly board: BoardId | null
  readonly from: AutomationId
  readonly fromName: string
  readonly fromRun: AutomationRunId
  /**
   * The run that started the chain this handoff belongs to: a run no handoff started is its own chain, and a run a
   * handoff started belongs to that handoff's chain. Absent on a handoff stored before chains were recorded, whose
   * chain is its sending run.
   */
  readonly chain?: AutomationRunId | undefined
  readonly to: AutomationId
  readonly toName: string
  /** Index of the receiving bot's `bot` trigger that allowed it; absent on a reply. */
  readonly edge: number | null
  readonly mode: 'wait' | 'dispatch'
  /** The handoff this one answers with its result. */
  readonly replyTo: HandoffId | null
  readonly task: string
  /**
   * `open` waits for a Host to admit it, `claimed` has a run, `done` and `failed` settled with that run, `released`
   * lost its receiver, and `refused` was turned down at admission with the reason. A sender of a joining edge that
   * settled without handing work on, or that the join timed out waiting for, is recorded as a `failed` input with
   * the reason and no run.
   */
  readonly status: 'open' | 'claimed' | 'done' | 'failed' | 'released' | 'refused'
  readonly run: AutomationRunId | null
  readonly result: string | null
  readonly reason: string | null
  readonly tokens: number | null
  readonly createdAt: string
  readonly updatedAt: string
}
/** Something a task needs from one of its owner's own computers; everything else is available on every Host. */
export type DeviceCapability = 'files' | 'browser' | 'computer-use'
/**
 * Where the owner lets a task run: `auto` wherever its requirements allow, `cloud` only on Aeven Cloud, `device` only
 * on their own computers, or on the one desktop a definition's `desktop` names.
 */
export type RunOn = 'auto' | 'cloud' | 'device'
/** A device's id in its account's sync vault. */
export type HostDevice = NonNullable<SyncStatus['device']>
/** What one Host of an account is and offers, as the account's other Hosts read it. */
export interface HostProfile {
  /** `cloud` for a Host on Aeven's infrastructure, `device` for one on the owner's computer. */
  readonly kind: 'cloud' | 'device'
  /** The device capabilities runs on this Host can use. */
  readonly provides: readonly DeviceCapability[]
  /** The Host's device id in the account's vault; absent on a Host registered by a build that did not record it. */
  readonly device?: HostDevice | undefined
}
/** One desktop of an account a bot can be placed on, as the bots page lists it. */
export interface AutomationDesktop {
  readonly device: HostDevice
  /** The name it gave itself; empty until it wrote one. */
  readonly name: string
  /** Whether its relay connection is open now. */
  readonly present: boolean
  /** When its relay connection was last seen open, in milliseconds since the Unix epoch; absent when never. */
  readonly seenAt?: number | undefined
  /** Whether it is the Host answering the list. */
  readonly self: boolean
  /** The device capabilities its Host offers bots; absent while it has not registered a Host that can run bots. */
  readonly provides?: readonly DeviceCapability[] | undefined
}
/**
 * Where a definition runs, derived from its requirements, its owner's choice, and the account's Hosts.
 * `any` is a definition whose requirements were never declared: every Host of the account may run it.
 */
export interface AutomationPlacement {
  readonly runsOn: 'cloud' | 'device' | 'any'
  /** Whether a Host the account has registered, the answering one included, can run the definition. */
  readonly available: boolean
}
/** How a run came to be admitted. */
export type AutomationTrigger = 'schedule' | 'manual' | 'webhook' | 'event' | 'bot' | 'calendar'
/** User-approved task and execution settings. */
export interface AutomationDefinition {
  readonly id: AutomationId
  readonly owner?: string | undefined
  readonly revision: number
  readonly name: string
  readonly prompt: string
  /** Everything that wakes the bot; an empty list leaves only manual runs. */
  readonly triggers: readonly BotTrigger[]
  /** The connectors a run may call; owner-confirmed with the task. */
  readonly connectors: ConnectorBinding
  readonly overlap: OverlapPolicy
  readonly status: 'active' | 'paused'
  /** The run that paused its own bot, while the bot stays paused; the owner's resume or pause clears it. */
  readonly pausedBy?: { readonly runId: AutomationRunId; readonly scheduledFor: string } | undefined
  readonly agentPreset: string
  readonly model: ModelSelection
  readonly permission: 'read-only' | 'workspace-write'
  /** Approvals answered without asking again in every later run. */
  readonly grants: readonly AutomationGrant[]
  /** Device capabilities the task needs; absent on a definition stored before requirements were declared. */
  readonly requires?: readonly DeviceCapability[] | undefined
  readonly runOn: RunOn
  /** With `runOn: device`, the one desktop that runs the task; absent lets every desktop that provides `requires` run it. */
  readonly desktop?: HostDevice | undefined
  readonly executionTarget: { readonly kind: 'local'; readonly runnerId: AutomationRunnerId }
  /** Latest admitted instant of each schedule trigger, keyed by the trigger's index; the account's Hosts share it. */
  readonly lastAdmittedAt: Readonly<Record<string, string>>
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
  /** Index of the definition trigger that admitted the run; null for a manual run or a retry. */
  readonly triggerIndex?: number | null | undefined
  /** Accepted inbound body of a webhook run, or the event an event run reacts to; the run notice marks it untrusted data. */
  readonly payload?: string | null | undefined
  /** The event an event run reacts to: its source and the source's own id, which deduplicates redelivery. */
  readonly event?: { readonly source: 'mail' | 'github' | 'calendar'; readonly id: string; readonly summary: string } | null | undefined
  /** The handoff a bot-triggered run carries out; for a joined run, its first input that carries work. */
  readonly handoff?: Pick<Handoff, 'id' | 'from' | 'fromName' | 'fromRun' | 'chain' | 'edge' | 'mode' | 'replyTo' | 'board' | 'task'> | null | undefined
  /** Every input of a joined run, one per sender, with the failed ones and their reasons. */
  readonly join?: {
    readonly chain: AutomationRunId
    readonly inputs: readonly Pick<Handoff, 'id' | 'from' | 'fromName' | 'status' | 'task' | 'reason'>[]
  } | null | undefined
  /** Tokens the run spent; absent until it settles. */
  readonly usage?: RunUsage | null | undefined
  /**
   * The run reported nothing new: it settled `succeeded`, called `bot_no_update`, and asked for no approval it was
   * refused and changed no file. A quiet run leaves the bot's last result as it was.
   */
  readonly quiet?: boolean | undefined
  readonly resolution: { readonly kind: 'retried'; readonly at: string; readonly retryRunId: AutomationRunId | null } | null
}
/** Editable task values; execution ownership is resolved by the service. */
export interface AutomationInput {
  readonly name: string
  readonly prompt: string
  readonly triggers: readonly BotTrigger[]
  /** `all` when omitted at creation. */
  readonly connectors?: ConnectorBinding | undefined
  /** `skip` when omitted at creation. */
  readonly overlap?: OverlapPolicy | undefined
  readonly permission: 'read-only' | 'workspace-write'
  readonly requires?: readonly DeviceCapability[] | undefined
  /** `auto` when omitted at creation. */
  readonly runOn?: RunOn | undefined
  /** The vault device id of the one desktop that runs the task; accepted only with `runOn: device`. */
  readonly desktop?: string | undefined
}
/** Editable board values; membership names bots of the same owner. */
export interface BoardInput {
  readonly name: string
  readonly members: readonly AutomationId[]
  readonly budget?: BoardBudget | undefined
}
