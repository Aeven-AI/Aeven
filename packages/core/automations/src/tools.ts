/** Conversational management tools; future work changes pass through ordinary approval. */
import type { Agent } from '@aeven/agent'
import type { IdentityUsers } from '@aeven/identity-user'
import { brandString } from '@aeven/brand'
import type { ToolDefinition } from '@aeven/tools'
import { z } from 'zod'
import type Automations from './index.ts'
import type { AutomationId, AutomationRunId, BoardId } from './types.ts'
import { boardInputSchema, CONNECTOR_IDS, inputSchema, patchSchema, requiresSchema } from './domain.ts'

/** One schedule, the `schedule` of a schedule trigger. */
const scheduleField = { type: 'object', properties: {
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
  jitterMinutes: { type: 'integer', minimum: 1, maximum: 30, description: 'Optional, not for once: each run starts up to this many minutes after the scheduled time, for requests such as "around 7". For interval it must be smaller than everyMinutes.' },
}, required: ['kind', 'timeZone'], additionalProperties: false }
const taskFields = {
  name: { type: 'string', description: 'Short name describing the outcome.' },
  prompt: { type: 'string', description: 'Complete repeatable task, including requirements and how to verify its result.' },
  triggers: { type: 'array', description: 'Everything that wakes the bot. Use a schedule for timed work, an event to react to new email or GitHub activity instead of checking on a timer, calendar to run relative to calendar events such as "15 minutes before each meeting", and bot to let another bot hand it tasks.', items: { type: 'object', properties: {
    kind: { type: 'string', enum: ['schedule', 'webhook', 'event', 'bot', 'calendar'] },
    schedule: scheduleField,
    idempotency: { type: 'string', enum: ['sender', 'none'], description: 'For webhook: sender ignores a repeated Idempotency-Key header; none runs every request.' },
    source: { type: 'string', enum: ['mail', 'github'], description: 'For event.' },
    filter: { type: 'object', description: 'For event and calendar. mail: account (address), from, subject — text each must contain. github: events (names such as pull_request, issues, issue_comment, push), actions (payload action values such as opened, closed, published; set actions ["published"] for a release announcement so drafts and edits do not wake the bot), repository (owner/name). calendar: title (text the title contains), attendee (text an attendee address contains), hasExternalAttendee (an attendee outside the user\'s own domain), accepted (the user accepted or organizes it).', properties: {
      account: { type: 'string' }, from: { type: 'string' }, subject: { type: 'string' },
      events: { type: 'array', items: { type: 'string' } }, actions: { type: 'array', items: { type: 'string' } }, repository: { type: 'string' },
      title: { type: 'string' }, attendee: { type: 'string' }, hasExternalAttendee: { type: 'boolean' }, accepted: { type: 'boolean' },
    }, additionalProperties: false },
    calendar: { type: 'string', enum: ['google-calendar', 'outlook-calendar'], description: 'For calendar: read only this calendar. Omit to read every connected calendar.' },
    offsetMinutes: { type: 'integer', minimum: -1440, maximum: 1440, description: 'For calendar: minutes from the event\'s start, negative for before it, such as -15.' },
    from: { type: 'string', description: 'For bot: ID of the bot that may hand this bot tasks.' },
    mode: { type: 'string', enum: ['wait', 'dispatch'], description: 'For bot: wait wakes the sender again with this bot’s result; dispatch does not.' },
  }, required: ['kind'], additionalProperties: false } },
  connectors: { description: 'Connected accounts the bot may use, such as ["email"] or ["discord", "slack"]. Choose only what the task needs, so the bot cannot reach anything else. Omit to allow every connected account.', anyOf: [
    { type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string', enum: [...CONNECTOR_IDS] } },
  ] },
  overlap: { type: 'string', enum: ['skip', 'queue', 'parallel'], description: 'When it is woken while still running: skip (default, right for reports), queue (right for answering messages), or parallel.' },
  permission: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Read-only inspection or permission to create and edit files. Writes through the bot’s connectors need no further approval.' },
  requires: { type: 'array', items: { type: 'string', enum: ['files', 'browser', 'computer-use'] }, description: 'What the task needs from the user’s own computer: files for files or folders stored on it, browser for the user’s own browser and its signed-in sites, computer-use for operating its apps. Leave empty when the task needs only the web, connected accounts, and files it creates itself; it then also runs while the computer is off.' },
  runOn: { type: 'string', enum: ['auto', 'device'], description: 'device keeps every run on the user’s own computer; use it only when the user asks for that. auto, the default, lets the task run wherever it can.' },
}
const idSchema = z.string().min(1).transform(value => brandString<AutomationId>(value))
const updateSchema = patchSchema.extend({ id: idSchema })
/** Creation through a conversation always declares what the task needs from a computer. */
const createSchema = inputSchema.extend({ requires: requiresSchema })
const boardToolSchema = z.object({ action: z.enum(['save', 'remove']), id: z.string().min(1).optional() }).loose()
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
      name: 'automation_create', description: 'Create a built-in automation after human confirmation. Translate the user’s request into a self-contained task, the triggers that wake it, and the connected accounts it needs. Ask only for missing requirements. Future runs start fresh conversations with only those accounts and act on them without asking again, since this confirmation approves them. Any other action that needs approval asks the user in the run conversation; once the user approves it there, later runs perform it without asking until the approval expires or is revoked.',
      parameters: { type: 'object', properties: taskFields, required: ['name', 'prompt', 'triggers', 'permission', 'requires'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        return asOwner(() => service.create(createSchema.parse(args), agent))
      },
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
      name: 'automation_update', description: 'Adjust a task, its triggers, connected accounts, overlap, file permissions, or what the task needs from the user’s computer after confirmation, or pause an automation immediately. Omitted fields remain unchanged; triggers replaces the whole list. When a changed task needs something different from the computer, send the new requires list.',
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
    {
      name: 'automation_board', description: 'After confirmation, save a board: bots of this account that hand each other tasks, share a task list, and share a budget. A bot hands work to another only when that bot has a bot trigger naming it. Omit id to create a board; send action remove with an id to delete one.',
      parameters: { type: 'object', properties: {
        action: { type: 'string', enum: ['save', 'remove'] },
        id: { type: 'string', description: 'Existing board ID; omit to create one.' },
        name: { type: 'string' },
        members: { type: 'array', items: { type: 'string' }, description: 'Bot IDs.' },
        budget: { type: 'object', properties: {
          maxConcurrentRuns: { type: 'integer', minimum: 1, description: 'Most member runs at once.' },
          maxTokensPerDay: { type: 'integer', minimum: 1000, description: 'Most tokens the members spend per 24 hours.' },
        }, additionalProperties: false },
      }, required: ['action'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        const { action, id, ...board } = boardToolSchema.parse(args)
        const boardId = id === undefined ? undefined : brandString<BoardId>(id)
        if (action === 'remove') {
          if (boardId === undefined) throw new Error('Name the board to remove.')
          await asOwner(() => service.removeBoard(boardId))
          return { deleted: true }
        }
        return asOwner(() => service.saveBoard(boardInputSchema.parse(board), boardId))
      },
      presentCall: args => ({ card: 'generic', title: 'Save board', kind: 'other', rawInput: args }),
    },
  ]
  const disposers = tools.map(tool => agent.ctx.tools.register(tool))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
