/** Validation of persisted definitions, run snapshots, and management input. */
import { z } from 'zod'
import { brandString } from '@aeven/brand'
import { domainTable, defineDomain } from '@aeven/storage-domain'
import type { SessionId } from '@aeven/session'
import { ReasoningEffortId } from '@aeven/llm'
import type { AutomationBoard, AutomationDefinition, AutomationId, AutomationRun, AutomationRunId, AutomationRunnerId, AutomationWebhook, BoardId, Handoff, HandoffId, HostDevice } from './types.ts'
import { assertValidSchedule } from './recurrence.ts'

const text = z.string().trim().min(1)
const instant = z.iso.datetime({ offset: true })
const weekday = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
/** Whole minutes each recurring occurrence may be delayed by, at most thirty. */
const jitterMinutes = z.number().int().min(1).max(30).optional()
/** Calendar recurrence validated independently of ambient process time zone. */
export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant, timeZone: text, until: instant.optional() }),
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(5), anchor: instant, timeZone: text, until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('hours'), everyHours: z.number().int().min(1).max(24), atMinute: z.number().int().min(0).max(59), timeZone: text, until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('daily'), time: text, timeZone: text, until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('weekly'), time: text, timeZone: text, weekdays: z.array(weekday).min(1), until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('monthly'), time: text, timeZone: text, days: z.array(z.number().int().min(1).max(31)).min(1), until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('nth-weekday'), time: text, timeZone: text, week: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), weekday, until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('yearly'), time: text, timeZone: text, month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31), until: instant.optional(), jitterMinutes }),
  z.object({ kind: z.literal('cron'), expression: text.max(240), timeZone: text, until: instant.optional(), jitterMinutes }),
]).superRefine((value, ctx) => {
  try { assertValidSchedule(value) } catch (error) { ctx.addIssue({ code: 'custom', message: String(error) }) }
})
const capability = z.enum(['files', 'browser', 'computer-use'])
/** Declared device capabilities, stored without repeats in a fixed order. */
export const requiresSchema = z.array(capability).max(8).transform(value => capability.options.filter(option => value.includes(option)))
const runOn = z.enum(['auto', 'cloud', 'device'])
const automationId = text.transform(value => brandString<AutomationId>(value))
/** Connector ids a bot may be bound to. */
export const CONNECTOR_IDS = [
  'email', 'gmail', 'google-drive', 'google-calendar', 'github', 'notion', 'vercel', 'atlassian', 'monday', 'stripe', 'slack', 'discord', 'telegram', 'whatsapp',
  'microsoft-365', 'outlook', 'outlook-calendar', 'onedrive', 'sharepoint', 'teams', 'mcp',
] as const
/** A connector binding: `all`, or a list stored without repeats in a fixed order. */
export const connectorsSchema = z.union([
  z.literal('all'),
  z.array(z.enum(CONNECTOR_IDS)).max(CONNECTOR_IDS.length).transform(value => CONNECTOR_IDS.filter(id => value.includes(id))),
])
const overlap = z.enum(['skip', 'queue', 'parallel'])
const filterText = text.max(320).optional()
/** One trigger; the event sources are those this package delivers. */
export const triggerSchema = z.union([
  z.object({ kind: z.literal('schedule'), schedule: scheduleSchema }).strict(),
  z.object({ kind: z.literal('webhook'), idempotency: z.enum(['sender', 'none']) }).strict(),
  z.object({ kind: z.literal('event'), source: z.literal('mail'), filter: z.object({ account: filterText, from: filterText, subject: filterText }).strict().default({}) }).strict(),
  z.object({ kind: z.literal('event'), source: z.literal('github'), filter: z.object({ events: z.array(text.max(80)).max(32).optional(), actions: z.array(text.max(80)).max(32).optional(), repository: filterText }).strict().default({}) }).strict(),
  z.object({
    kind: z.literal('bot'),
    // A trigger stored before joins named one sender.
    from: z.union([automationId.transform(id => [id]), z.array(automationId).min(1).max(8)]),
    join: z.enum(['all', 'any']).default('all'), mode: z.enum(['wait', 'dispatch']),
    joinTimeoutMinutes: z.number().int().min(1).max(1_440).default(60),
  }).strict(),
  z.object({
    kind: z.literal('calendar'), calendar: z.enum(['google-calendar', 'outlook-calendar']).optional(),
    filter: z.object({
      title: filterText, attendee: filterText, hasExternalAttendee: z.boolean().optional(), accepted: z.boolean().optional(),
    }).strict().default({}),
    offsetMinutes: z.number().int().min(-1_440).max(1_440),
  }).strict(),
])
/** Trigger list of one bot: at most one webhook trigger, and no bot that hands itself work. */
export const triggersSchema = z.array(triggerSchema).max(16).superRefine((value, ctx) => {
  if (value.filter(trigger => trigger.kind === 'webhook').length > 1) ctx.addIssue({ code: 'custom', message: 'A bot has at most one webhook trigger.' })
  const sources = value.flatMap(trigger => trigger.kind === 'bot' ? trigger.from : [])
  if (new Set(sources).size !== sources.length) ctx.addIssue({ code: 'custom', message: 'Name each bot that may hand this bot work once.' })
})
/** Editable management fields, also validated at the RPC and durable boundaries. */
export const inputSchema = z.object({
  name: text.max(160), prompt: text.max(32_000), triggers: triggersSchema, permission: z.enum(['read-only', 'workspace-write']),
  connectors: connectorsSchema.optional(), overlap: overlap.optional(),
  requires: requiresSchema.optional(), runOn: runOn.optional(), desktop: text.optional(),
}).strict()
/** Editable fields accepted by authenticated update requests. */
export const patchSchema = inputSchema.partial().extend({ status: z.enum(['active', 'paused']).optional() }).strict()
const grantSchema = z.object({ toolName: text, scope: text, grantedAt: instant, expiresAt: instant.optional() }).strict()
/**
 * Read a definition stored before bots had a trigger list, connectors, and an overlap policy: its one schedule
 * becomes its first trigger, its admission watermark that trigger's, and it keeps every connector and skips overlap.
 */
function currentDefinition(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || 'triggers' in value) return value
  const { schedule, lastAdmittedAt, ...rest } = value as { schedule?: unknown; lastAdmittedAt?: unknown }
  return {
    ...rest, triggers: schedule === undefined ? [] : [{ kind: 'schedule', schedule }], connectors: 'all', overlap: 'skip',
    lastAdmittedAt: typeof lastAdmittedAt === 'string' ? { 0: lastAdmittedAt } : {},
  }
}
/** Validate a stored or account-synced definition, reading one stored before the trigger list into the current shape. */
export const definitionSchema = z.preprocess(currentDefinition, inputSchema.extend({
  id: automationId, owner: text.optional(), revision: z.number().int().positive(),
  status: z.enum(['active', 'paused']), agentPreset: text,
  pausedBy: z.object({ runId: text.transform(value => brandString<AutomationRunId>(value)), scheduledFor: instant }).strict().optional(),
  connectors: connectorsSchema, overlap,
  // A definition stored before owners could choose keeps running wherever it can.
  runOn: runOn.default('auto'),
  desktop: text.transform(value => brandString<HostDevice>(value)).optional(),
  grants: z.array(grantSchema),
  executionTarget: z.object({ kind: z.literal('local'), runnerId: text.transform(value => brandString<AutomationRunnerId>(value)) }).strict(),
  lastAdmittedAt: z.record(z.string(), instant),
  model: z.object({ provider: text, model: text, reasoningEffort: text.optional() }).transform(value => ({
    provider: value.provider,
    model: value.model,
    ...value.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(value.reasoningEffort) },
  })),
  createdAt: instant, updatedAt: instant,
})) as unknown as z.ZodType<AutomationDefinition>
const boardId = text.transform(value => brandString<BoardId>(value))
const handoffId = text.transform(value => brandString<HandoffId>(value))
const runId = text.transform(value => brandString<AutomationRunId>(value))
/** A board's shared ceilings. */
export const budgetSchema = z.object({
  maxConcurrentRuns: z.number().int().min(1).max(64).optional(),
  maxTokensPerDay: z.number().int().min(1_000).optional(),
}).strict()
/** Editable board fields. */
export const boardInputSchema = z.object({
  name: text.max(160), members: z.array(automationId).min(1).max(32), budget: budgetSchema.optional(),
}).strict()
/** Validate a stored or account-synced board. */
export const boardSchema: z.ZodType<AutomationBoard> = z.object({
  id: boardId, owner: text.optional(), name: text.max(160), members: z.array(automationId).max(32), budget: budgetSchema,
  createdAt: instant, updatedAt: instant,
}).strict()
/** Validate a stored or account-synced handoff. */
export const handoffSchema: z.ZodType<Handoff> = z.object({
  id: handoffId, owner: text.optional(), board: boardId.nullable(),
  from: automationId, fromName: text, fromRun: runId, chain: runId.optional(), to: automationId, toName: text,
  edge: z.number().int().min(0).nullable(), mode: z.enum(['wait', 'dispatch']), replyTo: handoffId.nullable(),
  task: text.max(32_000),
  status: z.enum(['open', 'claimed', 'done', 'failed', 'released', 'refused']),
  run: runId.nullable(), result: z.string().nullable(), reason: z.string().nullable(), tokens: z.number().int().min(0).nullable(),
  createdAt: instant, updatedAt: instant,
}).strict()
/** Validate a stored or account-synced run snapshot. */
export const runSchema: z.ZodType<AutomationRun> = z.object({
  id: text.transform(value => brandString<AutomationRunId>(value)), definition: definitionSchema,
  trigger: z.enum(['schedule', 'manual', 'webhook', 'event', 'bot', 'calendar']), scheduledFor: instant,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']),
  sessionId: text.transform(value => brandString<SessionId>(value)).nullable(),
  startedAt: instant.nullable(), finishedAt: instant.nullable(),
  summary: z.string().nullable(), error: z.string().nullable(),
  admittedBy: text.transform(value => brandString<AutomationRunnerId>(value)),
  retryOfRunId: text.transform(value => brandString<AutomationRunId>(value)).nullable(),
  triggerIndex: z.number().int().min(0).nullable().optional(),
  payload: z.string().nullable().optional(),
  event: z.object({ source: z.enum(['mail', 'github', 'calendar']), id: text, summary: z.string() }).strict().nullable().optional(),
  handoff: z.object({
    id: handoffId, from: automationId, fromName: text, fromRun: runId, chain: runId.optional(), edge: z.number().int().min(0).nullable(),
    mode: z.enum(['wait', 'dispatch']), replyTo: handoffId.nullable(), board: boardId.nullable(), task: text,
  }).strict().nullable().optional(),
  join: z.object({
    chain: runId,
    inputs: z.array(z.object({
      id: handoffId, from: automationId, fromName: text,
      status: z.enum(['open', 'claimed', 'done', 'failed', 'released', 'refused']), task: text, reason: z.string().nullable(),
    }).strict()).max(8),
  }).strict().nullable().optional(),
  usage: z.object({
    inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0), totalTokens: z.number().int().min(0),
  }).strict().nullable().optional(),
  quiet: z.boolean().optional(),
  resolution: z.object({ kind: z.literal('retried'), at: instant, retryRunId: text.transform(value => brandString<AutomationRunId>(value)).nullable() }).strict().nullable(),
}).strict()
/** Storage authority for definitions and already-admitted occurrences. */
export const automationDomain = defineDomain({ name: 'automations', version: 3, tables: {
  definitions: domainTable<AutomationId, AutomationDefinition>(definitionSchema),
  runs: domainTable<AutomationRunId, AutomationRun>(runSchema),
  runners: domainTable<'local', { id: AutomationRunnerId }>(z.object({ id: text.transform(value => brandString<AutomationRunnerId>(value)) }).strict()),
  boards: domainTable<BoardId, AutomationBoard>(boardSchema),
  handoffs: domainTable<HandoffId, Handoff>(handoffSchema),
  /** Per mail account of an owner, the message ids the event poller has already seen, newest first. */
  cursors: domainTable<string, { seen: string[] }>(z.object({ seen: z.array(z.string()).max(1_000) }).strict()),
} })
/**
 * Bearer secrets for inbound triggers, kept out of the definition domain so no
 * definition projection, run snapshot, or model-visible list can carry them.
 */
export const webhookDomain = defineDomain({ name: 'automation_webhooks', version: 1, tables: {
  webhooks: domainTable<AutomationId, AutomationWebhook>(z.object({
    secret: text, keyId: text, createdAt: instant, lastDeliveredAt: instant.nullable(),
  }).strict()),
} })
