/**
 * Tools a run conversation receives: every run can file itself as quiet, report that its task failed, or pause its
 * own bot; a bot with outgoing handoff edges or a board also hands work on. None of them creates, widens, or resumes
 * a bot, a trigger, an edge, or a board: pausing only narrows what the bot does, and a handoff is a request the
 * receiving bot carries out with its own model, permission, connectors, and grants.
 */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@aeven/brand'
import type { ToolDefinition } from '@aeven/tools'
import { z } from 'zod'
import type { AutomationId, Handoff, HandoffId } from './types.ts'

/** What the run tools may do, bound by the service to one run of one bot. */
export interface RunToolsAccess {
  /** Record that the run has nothing new to report; the service decides at settlement whether it is quiet. */
  noUpdate(): void
  /**
   * Record that the run's task could not be done; the run settles `failed` with the reason.
   * @param reason - what went wrong, in the run's words.
   */
  reportFailure(reason: string): void
  /** Record that the bot pauses once the run settles without a failure. */
  pause(): void
  /** Bots of the same owner whose `bot` trigger names this bot, with the mode each edge declares. */
  readonly targets: readonly { readonly id: AutomationId; readonly name: string; readonly mode: 'wait' | 'dispatch' }[]
  /** Whether the bot belongs to a board, which gives it the board tools. */
  readonly onBoard: boolean
  /**
   * Hand one task to a target bot.
   * @param to - the target's id or exact name.
   * @param task - self-contained request.
   * @returns the stored handoff; a repeated identical request returns the same handoff.
   */
  handoff(to: string, task: string): Promise<Handoff>
  /** @returns the handoffs on this bot's boards, newest first, bounded by the service. */
  tasks(): readonly Handoff[]
  /**
   * Settle the handoff this run carries out before the run ends.
   * @param id - the handoff.
   * @param status - `done` or `failed`.
   * @param result - what the receiving bot reports.
   * @returns the settled handoff.
   */
  settle(id: HandoffId, status: 'done' | 'failed', result: string): Promise<Handoff>
}

/** Project a handoff onto the fields a run reads. */
function view(handoff: Handoff): Record<string, unknown> {
  return {
    id: handoff.id, from: handoff.fromName, to: handoff.toName, status: handoff.status, task: handoff.task,
    result: handoff.result, reason: handoff.reason, replyTo: handoff.replyTo, createdAt: handoff.createdAt,
  }
}

const json = { schema: { type: 'object' as const, additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }

/**
 * Register the run tools on one run conversation.
 * @param agentCtx - the run agent's context; its disposal removes the tools.
 * @param access - the service's operations bound to this run.
 * @returns disposer for every registered tool.
 */
export function registerRunTools(agentCtx: Context, access: RunToolsAccess): () => void {
  const tools: ToolDefinition[] = [{
    name: 'bot_no_update',
    description: 'Call when this run found nothing worth reporting, for example no new email since the last check. The run is filed quietly. Do not call it when you produced a file, needed an approval, or found something your owner should read.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: json,
    execute: (_args, exec) => {
      exec.signal.throwIfAborted()
      access.noUpdate()
      return Promise.resolve({ recorded: 'This run is filed as having nothing new. End your turn with a one-line answer saying so.' })
    },
    presentCall: () => ({ card: 'generic', title: 'Nothing new', kind: 'other' }),
  }, {
    name: 'bot_report_failure',
    description: 'Call when you could not do the task, with the reason. The run is recorded as failed even though your turn completes, and a later no-update call does not change that.',
    parameters: { type: 'object', properties: {
      reason: { type: 'string', description: 'What could not be done and why, in one or two sentences.' },
    }, required: ['reason'], additionalProperties: false },
    output: json,
    execute: (args, exec) => {
      exec.signal.throwIfAborted()
      const { reason } = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict().parse(args)
      access.reportFailure(reason)
      return Promise.resolve({ recorded: 'This run is recorded as failed with your reason. End your turn with what you tried.' })
    },
    presentCall: args => ({ card: 'generic', title: 'Report failure', kind: 'other', rawInput: args }),
  }, {
    name: 'bot_pause',
    description: 'Pause your own bot when its task says to stop, for example once the condition it watches for is met. Nothing wakes it again until your owner resumes it. The pause takes effect when this run ends, unless the run is recorded as failed.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: json,
    execute: (_args, exec) => {
      exec.signal.throwIfAborted()
      access.pause()
      return Promise.resolve({ recorded: 'Your bot pauses when this run ends. Only your owner can resume it.' })
    },
    presentCall: () => ({ card: 'generic', title: 'Pause this bot', kind: 'other' }),
  }]
  if (access.targets.length > 0) {
    tools.push({
      name: 'bot_handoff',
      description: `Hand a self-contained task to another bot of this account. It runs with its own permissions and accounts and reports back through its handoff. Bots you can hand work to: ${access.targets.map(target => `${target.name} (${target.mode === 'wait' ? 'you are woken with its result' : 'no reply'})`).join('; ')}.`,
      parameters: { type: 'object', properties: {
        to: { type: 'string', enum: access.targets.map(target => target.name), description: 'The bot that should do the task.' },
        task: { type: 'string', description: 'Complete request, including the data it needs and how to verify its result.' },
      }, required: ['to', 'task'], additionalProperties: false },
      output: json,
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        const { to, task } = z.object({ to: z.string().min(1), task: z.string().trim().min(1).max(32_000) }).strict().parse(args)
        return view(await access.handoff(to, task))
      },
      presentCall: args => ({ card: 'generic', title: 'Hand off to bot', kind: 'other', rawInput: args }),
    })
  }
  if (access.onBoard) {
    tools.push({
      name: 'board_tasks',
      description: 'List the tasks your board\'s bots handed each other, newest first, with their status and results.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: json,
      execute: (_args, exec) => { exec.signal.throwIfAborted(); return Promise.resolve({ tasks: access.tasks().map(view) }) },
      presentCall: () => ({ card: 'generic', title: 'Board tasks', kind: 'read' }),
    }, {
      name: 'board_task_update',
      description: 'Settle the handoff you are carrying out with its result before you finish. Without it, your final answer becomes the result.',
      parameters: { type: 'object', properties: {
        id: { type: 'string', description: 'Handoff ID from your task notice.' },
        status: { type: 'string', enum: ['done', 'failed'] },
        result: { type: 'string', description: 'What you did or found, with evidence.' },
      }, required: ['id', 'status', 'result'], additionalProperties: false },
      output: json,
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        const input = z.object({ id: z.string().min(1), status: z.enum(['done', 'failed']), result: z.string().trim().min(1).max(32_000) }).strict().parse(args)
        return view(await access.settle(brandString<HandoffId>(input.id), input.status, input.result))
      },
      presentCall: args => ({ card: 'generic', title: 'Update board task', kind: 'other', rawInput: args }),
    })
  }
  const disposers = tools.map(tool => agentCtx.tools.register(tool))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
