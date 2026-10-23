/** Conversational management tools; future work changes pass through ordinary approval. */
import type { Agent } from '@aeven/agent'
import type { IdentityUsers } from '@aeven/identity-user'
import { brandString } from '@aeven/brand'
import type { ToolDefinition } from '@aeven/tools'
import { z } from 'zod'
import type Automations from './index.ts'
import type { AutomationId, AutomationRunId } from './types.ts'
import { inputSchema, patchSchema } from './domain.ts'

const taskFields = {
  name: { type: 'string', description: 'Short name describing the outcome.' },
  prompt: { type: 'string', description: 'Complete repeatable task, including requirements and how to verify its result.' },
  schedule: { type: 'object', properties: {
    kind: { type: 'string', enum: ['once', 'interval', 'hours', 'daily', 'weekly', 'monthly', 'nth-weekday', 'yearly', 'cron'] },
    timeZone: { type: 'string', description: 'Explicit IANA time zone.' },
    time: { type: 'string', description: 'Local HH:mm for hours, daily, weekly, monthly, nth-weekday, and yearly.' },
    at: { type: 'string', description: 'Future ISO timestamp for once.' },
    everyMinutes: { type: 'integer', minimum: 5, description: 'Elapsed minutes between runs, for interval.' },
    anchor: { type: 'string', description: 'ISO creation timestamp for intervals.' },
    everyHours: { type: 'integer', minimum: 1, maximum: 24, description: 'Hours between runs, counted from local midnight, for hours.' },
    atMinute: { type: 'integer', minimum: 0, maximum: 59, description: 'Minute past the hour, for hours.' },
    weekdays: { type: 'array', items: { type: 'string', enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] }, description: 'Selected weekdays, for weekly.' },
    days: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 31 }, description: 'Days of the month, for monthly; a month without the day is skipped.' },
    week: { type: 'integer', enum: [1, 2, 3, 4], description: 'Which weekday of the month, for nth-weekday.' },
    weekday: { type: 'string', enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'], description: 'Weekday of the month, for nth-weekday.' },
    month: { type: 'integer', minimum: 1, maximum: 12, description: 'Month of the year, for yearly.' },
    day: { type: 'integer', minimum: 1, maximum: 31, description: 'Day of that month, for yearly.' },
    expression: { type: 'string', description: 'Five-field cron expression (minute, hour, day of month, month, day of week) for cron.' },
    until: { type: 'string', description: 'Optional inclusive ISO end time. Omit for a recurring task without an end date.' },
  }, required: ['kind', 'timeZone'], additionalProperties: false },
  permission: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Read-only inspection or permission to create and edit files. External connector writes still require approval.' },
}
const idSchema = z.string().min(1).transform(value => brandString<AutomationId>(value))
const updateSchema = patchSchema.extend({ id: idSchema })
const runIdSchema = z.object({ id: z.string().min(1).transform(value => brandString<AutomationRunId>(value)) }).strict()

/** Register management on one root agent and remove all contributions on disposal.
 * @param service - durable automation authority.
 * @param agent - authenticated creating conversation.
 * @param identity - identity authority injected by the owning automation service.
 * @returns disposer for all management tools.
 */
export function registerAutomationTools(service: Automations, agent: Agent, identity: IdentityUsers): () => void {
  const asOwner = <T>(work: () => T): T =>
    identity.runAs(agent.session.header.owner === undefined ? undefined : { id: agent.session.header.owner }, work)
  const tools: ToolDefinition[] = [
    {
      name: 'automation_create', description: 'Create a built-in automation after human confirmation. Translate the user’s request into a self-contained task and explicit local schedule. Ask only for missing requirements. Future runs start fresh conversations with this account’s capabilities. An external action that needs approval asks the user in the run conversation; once the user approves it there, later runs perform it without asking.',
      parameters: { type: 'object', properties: taskFields, required: ['name', 'prompt', 'schedule', 'permission'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => { exec.signal.throwIfAborted(); return asOwner(() => service.create(inputSchema.parse(args), agent)) },
      presentCall: args => ({ card: 'generic', title: 'Create bot', kind: 'other', rawInput: args }),
    },
    {
      name: 'automation_list', description: 'List this account’s automations and recent run history. Use the stable IDs for subsequent changes.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (_args, exec) => { exec.signal.throwIfAborted(); return asOwner(() => service.list()) },
      presentCall: () => ({ card: 'generic', title: 'Bots', kind: 'read' }),
    },
    {
      name: 'automation_update', description: 'Adjust a task, schedule, or file permissions after confirmation, or pause an automation immediately. Omitted fields remain unchanged.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, ...taskFields, status: { type: 'string', enum: ['active', 'paused'] } }, required: ['id'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        const { id, ...patch } = updateSchema.parse(args)
        return asOwner(() => service.update(id, patch))
      },
      presentCall: args => ({ card: 'generic', title: 'Adjust bot', kind: 'other', rawInput: args }),
    },
    {
      name: 'automation_run_now', description: 'Run one existing automation now with its approved task and file permissions. Read its run history for the actual outcome.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        return asOwner(() => service.runNow(z.object({ id: idSchema }).strict().parse(args).id))
      },
      presentCall: () => ({ card: 'generic', title: 'Run bot', kind: 'other' }),
    },
    {
      name: 'automation_retry', description: 'After explicit human confirmation, retry an unresolved failed, skipped, or cancelled run in a fresh conversation using its original task. Inspect the earlier evidence first: external changes may already exist. Refused while the same automation has active work.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Earlier run ID, not the automation ID.' } }, required: ['id'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => { exec.signal.throwIfAborted(); return asOwner(() => service.retry(runIdSchema.parse(args).id)) },
      presentCall: args => ({ card: 'generic', title: 'Retry bot run', kind: 'other', rawInput: args }),
    },
  ]
  const disposers = tools.map(tool => agent.ctx.tools.register(tool))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
