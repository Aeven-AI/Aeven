/**
 * Model-facing whole-list replacement. Each call appends a `todo/write` snapshot to the calling
 * agent's session; replay is last-write-wins, and UIs render from session events. The same folded
 * list is contributed to the model as runtime context, so an agent reads its own standing plan
 * back instead of reconstructing it from its own tool-call arguments. A non-agent caller has no
 * owning list and is rejected. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-todo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TodoItem } from './types.ts'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: brings the scoped `ctx.systemPrompt` service declaration and the
// `AssembleContext.agent` augmentation (the runtime-context read below) into
// this program.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
// The `todos` projection-key declaration lives in src/types.ts (its one home);
// this re-export projects the type face onto the package root AND keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

export const name = 'tool-todo'
export const inject = ['tools', 'sessionProjections']

/** The valid {@link TodoItem} statuses, as a runtime set for input narrowing. */
const STATUSES = ['pending', 'in_progress', 'completed'] as const

/** Model-facing todo tool configuration. */
export interface Config {
  /**
   * Required deployment choice for whether several todos may be `in_progress` at once. True suits
   * agents that run work concurrently — subagents, background commands, workflow fan-out — and the
   * description then instructs the model to mark every actively worked task. False restores the
   * single-active discipline: the description asks for exactly one, and a call marking more is
   * rejected.
   */
  allowParallelInProgress: boolean
}

/** Schemastery configuration for the todo tool consumer. */
export const Config: z<Config> = z.object({
  allowParallelInProgress: z.boolean().required(),
})

const DESCRIPTION_HEAD =
  'Record and update a structured task list for the current work. Send the ENTIRE '
  + 'list every call — it REPLACES the previous list (there are no partial updates, '
  + 'no per-item edits). Use it to plan multi-step work and show progress: add one '
  + 'todo per concrete step before you start. '

const DESCRIPTION_PARALLEL =
  'Mark every todo being actively worked '
  + 'on `in_progress` — several at once when work genuinely runs in parallel (e.g. '
  + 'concurrent subagents or background commands), one for sequential work; while '
  + 'work remains, at least one task should be `in_progress`. '

const DESCRIPTION_SINGLE =
  'Keep AT MOST ONE todo `in_progress` at a '
  + 'time; while work remains, exactly one active task should be `in_progress`. '

const DESCRIPTION_TAIL =
  'Mark a todo '
  + '`completed` the moment it is done (do not batch completions), and allow no '
  + '`in_progress` item only once all work is complete. Skip the list for trivial '
  + 'single-step tasks. Statuses: `pending` (not started), `in_progress` (being '
  + 'worked on now), `completed` (finished).'

/**
 * The model-facing description for one activation. The active-status clause is the only part that
 * varies, because it is the only instruction the parallel policy changes.
 * @param allowParallel - whether several todos may be `in_progress` at once.
 * @returns the composed tool description.
 */
function describe(allowParallel: boolean): string {
  return DESCRIPTION_HEAD
    + (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE)
    + DESCRIPTION_TAIL
}

/**
 * Validate the value constraints the ParameterSchemaSpec can't express and build the canonical {@link
 * TodoItem}[]: trimmed non-empty unique content, and at most one `in_progress` item unless the
 * deployment allows parallel work. The registry has already enforced the status enum and rejected
 * unknown item keys (`additionalProperties: false` — the logged snapshot must equal what the model
 * believes it wrote, so a nested/extended item shape fails loud at the schema boundary instead of
 * silently flattening); the cast below records that guarantee.
 * @param raw - the model-supplied list, already schema-checked.
 * @param allowParallel - whether several items may be `in_progress` at once.
 * @returns the canonical list.
 */
function toTodoList(raw: { content: string; status: string }[], allowParallel: boolean): TodoItem[] {
  const todos: TodoItem[] = []
  const seen = new Set<string>()
  let active = 0
  for (const item of raw) {
    const content = item.content.trim()
    if (content.length === 0) {
      throw new Error('invalid todo: `content` must be a non-empty string')
    }
    if (seen.has(content)) {
      throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`)
    }
    seen.add(content)
    if (item.status === 'in_progress') active++
    todos.push({ content, status: item.status as TodoItem['status'] })
  }
  if (!allowParallel && active > 1) {
    throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`)
  }
  return todos
}

/** Wire payload schema of the `todos` projection (whole list or pre-first-write null). */
const todosProjectionSchema: ZodType<TodoItem[] | null> = zod.union([
  zod.array(zod.object({
    content: zod.string(),
    status: zod.union([zod.literal('pending'), zod.literal('in_progress'), zod.literal('completed')]),
  })),
  zod.null(),
])

/**
 * Render one standing plan as model-visible runtime context. Empty text contributes nothing, so an
 * absent or empty list costs no tokens and reveals no state.
 * @param todos - the folded `todoPlan` projection, or null before the first write.
 * @returns the rendered plan, or `''` when there is nothing to show.
 */
function renderTodosContext(todos: TodoItem[] | null): string {
  if (todos === null || todos.length === 0) return ''
  const completed = todos.filter(todo => todo.status === 'completed').length
  const lines = todos.map(todo => `- [${todo.status}] ${todo.content}`)
  return `Your current todo list (${completed}/${todos.length} completed) — keep it in sync `
    + 'with todo_write as this work progresses, marking each task `completed` the moment it is '
    + 'done:\n'
    + lines.join('\n')
}

/** Folded staleness reading for one session: the fold driving the `todoStale` unit below. */
const todoStaleSchema = zod.object({
  stepsSinceWrite: zod.number(),
  remindedAt: zod.number().nullable(),
})

/** Folded staleness reading: steps since the last write, and the step count at the last reminder. */
type TodoStale = zod.infer<typeof todoStaleSchema>

/** Committed steps without a `todo_write` before the first staleness reminder. */
const STALE_FIRST_STEPS = 8

/** Committed steps between further reminders while the plan stays stale. */
const STALE_REPEAT_STEPS = 32

/**
 * Render the staleness reminder. The read-back above makes a plan readable; this makes a stale one
 * salient. Measured on a real session, an agent held its own plan in runtime context for 96
 * consecutive steps and never wrote again, because a snapshot the model has already read reads as
 * background — so the nudge restates the plan where a fresh message lands.
 * @param todos - the folded `todoPlan`, already known non-empty and unfinished.
 * @param steps - committed steps since the last `todo/write`.
 * @returns the reminder text.
 */
function renderStaleReminder(todos: TodoItem[], steps: number): string {
  const open = todos.filter(todo => todo.status !== 'completed').length
  const lines = todos.map(todo => `- [${todo.status}] ${todo.content}`)
  return `Your todo list has not changed for ${steps} steps while ${open} of its ${todos.length} `
    + 'tasks are still open. Update it now with todo_write: mark every task you have finished '
    + '`completed`, and the one you are working on `in_progress`. Current list:\n'
    + lines.join('\n')
}

/**
 * Register the `todo_write` tool on `ctx.tools`, the `todos` (client-wired) and
 * `todoPlan` (host-only) units on `ctx.sessionProjections`, and the `todo:plan`
 * runtime-context contribution on `ctx.systemPrompt`.
 * @param ctx - registrant context carrying the tool and session-projection registries.
 * @param config - deployment's explicit todo policy.
 */
export function apply(ctx: Context, config: Config): void {
  const allowParallel = config.allowParallelInProgress
  // Standing-plan fold for the UI: the session's latest whole todo/write list,
  // replaced only by the next write, and null before the first write. Every
  // other event returns the same state reference, so an unchanged plan pushes
  // no client frame.
  //
  // The plan's lifetime is the session's, not the turn's. An earlier revision
  // cleared this client-visible fold on `turn/start` (stateVersion 2), on the
  // premise that a reader takes the strip as "what this turn is doing". The
  // read-back fold below invalidated that premise: once an agent reads its own
  // plan from runtime context on every step, it has no reason to re-write a list
  // that has not changed, so the clear stopped emptying the dock briefly and
  // started emptying it for the whole turn — measured at 96 consecutive steps
  // with no write. The model then believed its plan was on screen while the
  // reader saw an empty dock: one session, two different truths. Both folds now
  // fold the same input, so the dock and the model can never disagree.
  ctx.sessionProjections.register<'todos', TodoItem[] | null>({
    key: 'todos',
    stateSchema: todosProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'todo/write') return event.data.todos
      return state
    },
    wire: { viewSchema: todosProjectionSchema, view: state => state },
    stateVersion: 3,
  })
  // Host-only read-back fold: the same input, but declared without `wire`, so it
  // never reaches a client and no client-facing lifetime rule or `stateVersion`
  // bump can perturb the plan an agent reads back as runtime context.
  ctx.sessionProjections.register<'todoPlan', TodoItem[] | null>({
    key: 'todoPlan',
    stateSchema: todosProjectionSchema,
    init: () => null,
    apply: (state, event) => (event.type === 'todo/write' ? event.data.todos : state),
    stateVersion: 1,
  })
  // Staleness fold: `stepsSinceWrite` counts committed step boundaries, and
  // `remindedAt` folds the step count at the last notice this plugin injected —
  // read back out of the log rather than held in memory, so a restart neither
  // forgets the cadence nor re-nudges from the first threshold.
  ctx.sessionProjections.register<'todoStale', TodoStale>({
    key: 'todoStale',
    stateSchema: todoStaleSchema,
    init: () => ({ stepsSinceWrite: 0, remindedAt: null }),
    apply: (state, event) => {
      if (event.type === 'todo/write') return { stepsSinceWrite: 0, remindedAt: null }
      if (event.type === 'step/start') {
        return { ...state, stepsSinceWrite: state.stepsSinceWrite + 1 }
      }
      if (event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === name) {
        return { ...state, remindedAt: state.stepsSinceWrite }
      }
      return state
    },
    stateVersion: 1,
  })
  // Staleness nudge. The read-back above is the information half; this is the
  // salience half, and it is the half a real session showed to be missing. The
  // listener delegates first and folds the reminder onto whatever comes back, so
  // a later listener keeps its say and nothing is vetoed.
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    /* v8 ignore next -- an abort racing the waterfall needs a live cancellation, not a scripted run */
    if (decision.kind === 'reject' || signal.aborted) return decision
    const plan = ctx.sessionProjections.stateOf(agent.session, 'todoPlan') as TodoItem[] | null
    if (plan === null || plan.length === 0) return decision
    if (plan.every(todo => todo.status === 'completed')) return decision
    const { stepsSinceWrite, remindedAt } = ctx.sessionProjections
      .stateOf(agent.session, 'todoStale') as TodoStale
    if (stepsSinceWrite < STALE_FIRST_STEPS) return decision
    if (remindedAt !== null && stepsSinceWrite - remindedAt < STALE_REPEAT_STEPS) return decision
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: renderStaleReminder(plan, stepsSinceWrite) }],
        source: {
          kind: 'plugin',
          plugin: name,
          form: 'notice',
          summary: `todo plan unchanged for ${stepsSinceWrite} steps`,
        },
      })],
    }
  })
  // Read-back for the model. Without this contribution the only record an agent
  // has of its own list is the `todo_write` arguments in its transcript, which
  // compaction replaces with a lossy summary, and there is no read-back tool —
  // so a long turn, or any compacted session, silently drifts from the list the
  // UI renders. The runtime-context carrier re-emits a snapshot only when the
  // rendered text changes, so an unchanged list costs nothing on any later step.
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'todo:plan',
      order: scope.systemPrompt.getContextOrder('TODO_PLAN'),
      text: (context) => {
        const session = context.agent?.session
        if (session === undefined) return ''
        // This plugin registered the `todoPlan` unit in the same `apply`, so the
        // key is always registered wherever this provider runs; the cast records
        // that guarantee instead of inventing an unreachable `undefined` branch.
        const todos = ctx.sessionProjections.stateOf(session, 'todoPlan') as TodoItem[] | null
        return renderTodosContext(todos)
      },
    })
  })
  ctx.tools.register(defineTool({
    name: 'todo_write',
    description: describe(allowParallel),
    parameters: {
      todos: {
        type: 'array',
        required: true,
        description: 'The COMPLETE task list, replacing any previous list.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true, description: 'What the task is — a short imperative line.' },
            status: {
              type: 'string',
              required: true,
              enum: [...STATUSES],
              description: 'pending (not started) | in_progress (now) | completed (done).',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          todos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: [...STATUSES] },
              },
            },
          },
          counts: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              pending: { type: 'integer', required: true },
              inProgress: { type: 'integer', required: true },
              completed: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`,
      }],
    },
    execute(args, exec) {
      const todos = toTodoList(args.todos, allowParallel)
      if (!exec.agent) {
        // The list is per-agent-session state; a non-agent caller (no owning
        // session) has nowhere to write it. Reject rather than silently no-op.
        throw new Error('todo_write requires an owning agent session')
      }
      exec.agent.session.append('todo/write', { todos })
      const count = (status: TodoItem['status']): number => todos.filter(t => t.status === status).length
      return Promise.resolve({
        todos: todos.map(todo => ({ content: todo.content, status: todo.status })),
        counts: {
          pending: count('pending'),
          inProgress: count('in_progress'),
          completed: count('completed'),
        },
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Update todo list', kind: 'other', rawInput: args.todos }),
  }))
}
