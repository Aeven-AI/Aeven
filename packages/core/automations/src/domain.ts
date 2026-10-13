/** Validation of persisted definitions, run snapshots, and management input. */
import { z } from 'zod'
import { brandString } from '@aeven/brand'
import { domainTable, defineDomain } from '@aeven/storage-domain'
import type { SessionId } from '@aeven/session'
import { ReasoningEffortId } from '@aeven/llm'
import type { AutomationDefinition, AutomationId, AutomationRun, AutomationRunId, AutomationRunnerId } from './types.ts'
import { assertValidSchedule } from './recurrence.ts'

const text = z.string().trim().min(1)
const instant = z.string().datetime({ offset: true })
/** Calendar recurrence validated independently of ambient process time zone. */
export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant, timeZone: text, until: instant.optional() }),
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(5), anchor: instant, timeZone: text, until: instant.optional() }),
  z.object({ kind: z.literal('daily'), time: text, timeZone: text, until: instant.optional() }),
  z.object({ kind: z.literal('weekly'), time: text, timeZone: text, weekdays: z.array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])).min(1), until: instant.optional() }),
]).superRefine((value, ctx) => {
  try { assertValidSchedule(value) } catch (error) { ctx.addIssue({ code: 'custom', message: String(error) }) }
})
/** Editable management fields, also validated at the RPC and durable boundaries. */
export const inputSchema = z.object({ name: text.max(160), prompt: text.max(32_000), schedule: scheduleSchema, permission: z.enum(['read-only', 'workspace-write']) }).strict()
/** Editable fields accepted by authenticated update requests. */
export const patchSchema = inputSchema.partial().extend({ status: z.enum(['active', 'paused']).optional() }).strict()
const definitionSchema: z.ZodType<AutomationDefinition> = inputSchema.extend({
  id: text.transform(value => brandString<AutomationId>(value)), owner: text.optional(), revision: z.number().int().positive(),
  status: z.enum(['active', 'paused']), agentPreset: text,
  grants: z.array(z.object({ toolName: text, scope: text, grantedAt: instant }).strict()),
  executionTarget: z.object({ kind: z.literal('local'), runnerId: text.transform(value => brandString<AutomationRunnerId>(value)) }).strict(),
  lastAdmittedAt: instant.nullable(),
  model: z.object({ provider: text, model: text, reasoningEffort: text.optional() }).transform(value => ({ provider: value.provider, model: value.model, ...value.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(value.reasoningEffort) } })), createdAt: instant, updatedAt: instant,
})
const runSchema: z.ZodType<AutomationRun> = z.object({
  id: text.transform(value => brandString<AutomationRunId>(value)), definition: definitionSchema,
  trigger: z.enum(['schedule', 'manual']), scheduledFor: instant,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']),
  sessionId: text.transform(value => brandString<SessionId>(value)).nullable(), startedAt: instant.nullable(), finishedAt: instant.nullable(),
  summary: z.string().nullable(), error: z.string().nullable(),
  admittedBy: text.transform(value => brandString<AutomationRunnerId>(value)),
  retryOfRunId: text.transform(value => brandString<AutomationRunId>(value)).nullable(),
  resolution: z.object({ kind: z.literal('retried'), at: instant, retryRunId: text.transform(value => brandString<AutomationRunId>(value)).nullable() }).strict().nullable(),
}).strict()
/** Storage authority for definitions and already-admitted occurrences. */
export const automationDomain = defineDomain({ name: 'automations', version: 3, tables: {
  definitions: domainTable<AutomationId, AutomationDefinition>(definitionSchema), runs: domainTable<AutomationRunId, AutomationRun>(runSchema),
  runners: domainTable<'local', { id: AutomationRunnerId }>(z.object({ id: text.transform(value => brandString<AutomationRunnerId>(value)) }).strict()),
} })
