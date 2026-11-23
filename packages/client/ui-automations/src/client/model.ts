/** Bot management projection the Host returns, and the operations the bot pages are bound to. */
import type { ConnectionGenerationState } from '@aeven/client-connection/client'
import type { UiWorkspace } from '@aeven/client-ui-workspace/client'

/** Locale key of each thing a bot can need from the owner's computer. */
export const NEED_LABELS = { 'files': 'needFiles', 'browser': 'needBrowser', 'computer-use': 'needComputerUse' } as const

/** One thing a bot can need from the owner's computer. */
export type Need = keyof typeof NEED_LABELS

/** One stored recurrence, discriminated the way the Host stores and returns it. */
export type TaskSchedule = TaskRecurrence & {
  /** Each run starts up to this many minutes after its scheduled time. */
  jitterMinutes?: number | undefined
}
/** One stored recurrence without its jitter. */
export type TaskRecurrence =
  | { kind: 'once'; timeZone: string; at: string; until?: string | undefined }
  | { kind: 'interval'; timeZone: string; everyMinutes: number; anchor: string; until?: string | undefined }
  | { kind: 'hours'; timeZone: string; everyHours: number; atMinute: number; until?: string | undefined }
  | { kind: 'daily'; timeZone: string; time: string; until?: string | undefined }
  | { kind: 'weekly'; timeZone: string; time: string; weekdays: string[]; until?: string | undefined }
  | { kind: 'monthly'; timeZone: string; time: string; days: number[]; until?: string | undefined }
  | { kind: 'nth-weekday'; timeZone: string; time: string; week: 1 | 2 | 3 | 4; weekday: string; until?: string | undefined }
  | { kind: 'yearly'; timeZone: string; time: string; month: number; day: number; until?: string | undefined }
  | { kind: 'cron'; timeZone: string; expression: string; until?: string | undefined }

/** One thing that wakes a bot, as the Host stores it. */
export type TaskTrigger =
  | { kind: 'schedule'; schedule: TaskSchedule }
  | { kind: 'webhook'; idempotency: 'sender' | 'none' }
  | { kind: 'event'; source: 'mail'; filter: { account?: string; from?: string; subject?: string } }
  | { kind: 'event'; source: 'github'; filter: { events?: string[]; actions?: string[]; repository?: string } }
  | { kind: 'bot'; from: string[]; join: 'all' | 'any'; mode: 'wait' | 'dispatch'; joinTimeoutMinutes: number }
  | {
    kind: 'calendar'
    calendar?: 'google-calendar' | 'outlook-calendar' | undefined
    filter: { title?: string; attendee?: string; hasExternalAttendee?: boolean; accepted?: boolean }
    offsetMinutes: number
  }
/** One saved approval; it answers until `expiresAt`, or always without one. */
export interface TaskGrant {
  toolName: string
  scope: string
  grantedAt: string
  expiresAt?: string | undefined
}
/** Account-owned automation projection, including authoritative recurrence and latest outcome. */
export interface Task {
  id: string
  name: string
  prompt: string
  permission: 'read-only' | 'workspace-write'
  status: 'active' | 'paused'
  /** The run that paused its own bot, while the bot stays paused. */
  pausedBy?: { runId: string; scheduledFor: string } | undefined
  triggers: TaskTrigger[]
  /** `all`, or the connector ids its runs may call. */
  connectors: 'all' | string[]
  overlap: 'skip' | 'queue' | 'parallel'
  grants: TaskGrant[]
  /** Earliest next occurrence of its schedule triggers. */
  nextRunAt: string | null
  lastRun: Run | null
  /** Whether an inbound credential exists, for its webhook or GitHub trigger; the key itself never arrives in this list. */
  webhook: boolean
  /** What the task needs from the owner's computer; absent on a bot stored before that was declared. */
  requires?: Need[] | undefined
  /** `cloud` or `device` when the owner chose where every run happens; `device` with `desktop` names one desktop. */
  runOn: 'auto' | 'cloud' | 'device'
  /** Vault device id of the one desktop the owner placed the bot on. */
  desktop?: string | undefined
  /** Where the Host places the bot, and whether a Host of the account can run it. */
  placement: { runsOn: 'cloud' | 'device' | 'any'; available: boolean }
}
/** Durable execution record; its conversation holds the actual result. */
export interface Run {
  id: string
  definition: Pick<Task, 'id' | 'name' | 'prompt'>
  scheduledFor: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  sessionId: string | null
  error: string | null
  resolution: { kind: 'retried'; at: string; retryRunId: string | null } | null
  /** Tokens the run spent, once it settled. */
  usage?: { totalTokens: number } | null | undefined
  /** The run had nothing new to report; the bot's last result skips it. */
  quiet?: boolean | undefined
}
/** Bots of the account that hand each other tasks and share a budget. */
export interface Board {
  id: string
  name: string
  members: string[]
  budget: { maxConcurrentRuns?: number | undefined; maxTokensPerDay?: number | undefined }
}
/** One task one bot handed another, and how it settled. */
export interface HandoffRecord {
  id: string
  board: string | null
  fromName: string
  toName: string
  status: 'open' | 'claimed' | 'done' | 'failed' | 'released' | 'refused'
  task: string
  reason: string | null
  tokens: number | null
  replyTo: string | null
  /** The run that started the handoff's chain; absent on a handoff stored before chains were recorded. */
  chain?: string | undefined
  createdAt: string
}
/** Host-advertised time triggers and the owned management projection. */
export interface AutomationList {
  definitions: Task[]
  runs: Run[]
  /** Absent from a Host without boards. */
  boards?: Board[] | undefined
  handoffs?: HandoffRecord[] | undefined
  capabilities: { host: 'cloud' | 'device'; triggers: TaskSchedule['kind'][]; webhook: boolean }
  /** Where the account's bots can be placed; absent from a Host that does not list them. */
  hosts?: { cloud: boolean; desktops: Desktop[] } | undefined
}
/** One desktop of the account a bot can be placed on. */
export interface Desktop {
  device: string
  /** The name it gave itself; empty until it wrote one. */
  name: string
  present: boolean
  /** When its relay connection was last seen open, in milliseconds since the Unix epoch. */
  seenAt?: number | undefined
  /** Whether it is the computer this page talks to. */
  self: boolean
  /** What its Host offers bots; absent while it runs a build that cannot run bots placed on it. */
  provides?: Need[] | undefined
}
/** Inbound trigger address and key, read on demand so the list never carries the secret. */
export interface WebhookCredential {
  path: string
  keyId: string
  secret: string
}
/** Connector providers the signed-in account has connected and the deployment can sign in to. */
export interface ServiceState {
  connected: ReadonlySet<string>
  configured: ReadonlySet<string>
}

/** One bot page: the overview, one bot, or the runs across bots. */
export type AutomationView = 'overview' | 'bot' | 'runs'

/** Authenticated commands, navigation, and connection availability bound by the entry registration. */
export interface AutomationPanelInjected {
  list: () => Promise<AutomationList>
  call: (operation: string, payload: unknown) => Promise<unknown>
  /** Connection generation, and the open start address, from which the bot page reads its bot's id. */
  hooks: { generation: ConnectionGenerationState; address: UiWorkspace['startAddress'] }
  /** Open a run's conversation in place. */
  openRun: (sessionId: string) => void
  /** The page this registration's address shows. */
  view: AutomationView
  /** Navigate to the address of a page other than one bot's. */
  showView: (view: Exclude<AutomationView, 'bot'>) => void
  /** Navigate to one bot's page. */
  showBot: (id: string) => void
  /** Connector state, or null when this composition has no account integrations. */
  services: () => Promise<ServiceState | null>
  /** Open Settings at one connector's page, or at the connector list. */
  openConnector: (provider?: string) => void
}
