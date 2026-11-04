/** Model-facing tools for the task board shared by one subagent tree. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@aeven/agent'
import { SessionId } from '@aeven/session'
import { TeamTaskId } from '@aeven/agent-team'
import { defineTool } from '@aeven/tools'
import type { InferValue, ValueSchemaSpec } from '@aeven/tools'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the task-board tool plugin. */
export const inject = ['agentTeams', 'tools']

/** The task-board tool plugin takes no configuration. */
export type Config = Record<never, never>

/** Loader schema for the task-board tool plugin. */
export const Config: z<Config> = z.object({})

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerId: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * task result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the calling Agent, whose subagent tree selects the board. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  if (agent === undefined) throw new Error(`${toolName} requires a calling agent`)
  return agent
}

/**
 * Register the four task-board tools.
 * @param ctx - context carrying the task-board and tool services.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'team_task_create',
    description: 'Create one unowned pending task on the task board shared by your whole agent tree: the root agent '
      + 'and every subagent under it. Use the board to split parallel work: give tasks disjoint write scopes and list the '
      + 'tasks that must complete first. Agents then claim ready tasks with team_task_update.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Concise task title.' },
      description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
      blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
      write_scopes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Workspace-relative file or directory prefixes this task expects to modify. Overlaps with other '
          + 'in-progress tasks are reported as warnings, never locked.',
      },
    },
    output: jsonOutput(TASK_VIEW_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'team_task_create')
      return await ctx.agentTeams.createTask(caller, {
        subject: args.subject,
        description: args.description,
        ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
        ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'team_task_list',
    description: 'List the shared tasks of your agent tree, including readiness, owner agent id, revision, blockers, '
      + 'and write-scope warnings.',
    parameters: {
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'Optional exact status filter.',
      },
      owner: { type: 'string', description: 'Optional exact ownerId filter; use unowned for tasks without an owner.' },
      ready: { type: 'boolean', description: 'Optional readiness filter.' },
      cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
      limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
    },
    output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
    execute(args, exec) {
      const cursor = args.cursor ?? 0
      const limit = args.limit ?? 50
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
      const caller = callingAgent(exec.agent, 'team_task_list')
      const filtered = ctx.agentTeams.listTasks(caller).filter(task =>
        (args.status === undefined || task.status === args.status)
        && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerId === undefined : task.ownerId === args.owner))
        && (args.ready === undefined || task.ready === args.ready))
      return Promise.resolve({
        tasks: filtered.slice(cursor, cursor + limit),
        ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'team_task_get',
    description: 'Read the complete latest value of one shared task before changing or executing it.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Shared task id.' },
    },
    output: jsonOutput(TASK_VIEW_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'team_task_get')
      return Promise.resolve(ctx.agentTeams.getTask(caller, TeamTaskId(args.task_id)))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'team_task_update',
    description: 'Change one shared task, using its latest revision from team_task_get or team_task_list; a stale '
      + 'revision is rejected. Claim a ready task, do the work, then complete it. The owner or the root agent may '
      + 'release, edit, set_dependencies, complete, reopen, or delete; only the root agent may reassign. Task changes '
      + 'never notify or start another agent; use send_message when an agent must act on one.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Shared task id.' },
      expected_revision: { type: 'integer', required: true, description: 'Current task revision; the change applies only if it still matches.' },
      action: {
        type: 'string',
        required: true,
        enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
        description: 'Task transition to apply.',
      },
      subject: { type: 'string', description: 'Replacement title for edit.' },
      description: { type: 'string', description: 'Replacement details for edit.' },
      blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
      write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement write scopes for edit.' },
      owner: { type: 'string', description: 'For reassign: the agent id, from list_agents, of the root agent or any continuable subagent; omit to unassign.' },
    },
    output: jsonOutput(TASK_VIEW_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'team_task_update')
      return await ctx.agentTeams.updateTask(caller, {
        taskId: TeamTaskId(args.task_id),
        expectedRevision: args.expected_revision,
        action: args.action,
        ...args.subject === undefined ? {} : { subject: args.subject },
        ...args.description === undefined ? {} : { description: args.description },
        ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
        ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        ...args.owner === undefined ? {} : { owner: SessionId(args.owner) },
      }, exec.signal)
    },
  }))
}
