/**
 * Model-facing capability learning: the `capability_manage` tool, guidance on when to learn, and recall of
 * unconfirmed drafts. Anything that becomes or changes executable instructions is confirmed by the user.
 *
 * @module @aeven/tool-capability
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@aeven/agent'
import { currentEnvironment, type Capability, type CapabilityRecord, type JudgedExecution } from '@aeven/capability'
import type {} from '@aeven/message-feedback'
import type { Session } from '@aeven/session'
import { correctionOf, ExecutionTracker } from './executions.ts'
import { createUserMessage } from '@aeven/llm'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/system-prompt'
import type {} from '@aeven/user-questions'
import type { JsonValue } from '@aeven/util-values'

export const name = 'tool-capability'
export const inject = ['capabilities', 'tools', 'systemPrompt']

/** Consumer configuration. */
export interface Config {
  /** System-prompt section order of the learning guidance. */
  promptOrder: number
  /** Maximum unconfirmed drafts recalled for one turn. */
  maxDrafts: number
  /** Maximum characters of a procedure shown in a confirmation question. */
  previewMaxChars: number
}

export const Config: z<Config> = z.object({
  promptOrder: z.number().default(116),
  maxDrafts: z.natural().min(1).default(3),
  previewMaxChars: z.natural().min(200).default(4000),
})

const TOOL = 'capability_manage'
const CONFIRM = 'Learn it'
const DECLINE = 'Discard'
const APPLY = 'Apply change'
const KEEP = 'Keep as is'

/** Model-facing guidance on when and how to learn a capability. */
export const LEARNING_GUIDANCE = `You can learn capabilities: reusable procedures saved for this user and offered in the skill catalog in later sessions. ` +
  `Save one with ${TOOL} (action "learn") when the user asks you to learn or remember how to do something, or after you worked out a multi-step procedure that is likely to recur, especially after errors, dead ends, or a correction from the user. ` +
  `Write it so another session can follow it without this conversation: when to use it, requirements, numbered steps with the exact commands, paths, and settings, how to verify success, and how to recover from known failures. Put scripts or reference material in supporting files. ` +
  `Saving asks the user to confirm; until they do, the procedure is kept as an unconfirmed draft. Do not save one-off answers, facts about the user, or procedures that did not work. ` +
  `After following a learned capability, report the outcome with ${TOOL} (action "report"), including whether its verification step passed; if a step was wrong, fix the procedure with action "update".`

const TEXT_OUTPUT = {
  schema: {
    type: 'object' as const,
    additionalProperties: true,
    properties: { text: { type: 'string' as const, required: true } },
  },
  render: (_args: unknown, value: Record<string, unknown>) => [{
    type: 'text' as const,
    text: typeof value['text'] === 'string' ? value['text'] : JSON.stringify(value),
  }],
} as const

type TextResult = { text: string } & Record<string, JsonValue>

function json(value: { text: string } & Record<string, unknown>): TextResult {
  return JSON.parse(JSON.stringify(value)) as TextResult
}

/** The prompt assembly scope of an agent's request is the agent itself. */
function ownerOfScope(scope: unknown): string | undefined {
  if (scope === null || typeof scope !== 'object' || !('session' in scope)) return undefined
  return (scope as Agent).session.header.owner
}

function ownerOf(agent: Agent | undefined): { agent: Agent; owner: string } {
  if (!agent) throw new Error('Capabilities are available only inside an agent session')
  const owner = agent.session.header.owner
  if (owner === undefined) throw new Error('Capabilities are available only in sessions that belong to a signed-in user')
  return { agent, owner }
}

function required(value: string | undefined, field: string, action: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`action "${action}" requires ${field}`)
  return trimmed
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function statusLabel(status: CapabilityRecord['status']): string {
  return status === 'candidate' ? 'unconfirmed draft' : status
}

function describeRecord(record: CapabilityRecord): string {
  return `${record.name} (${statusLabel(record.status)}, revision ${record.revision}): ${record.description}`
}

function evidenceSummary(record: CapabilityRecord, judged: readonly JudgedExecution[]): string {
  const current = judged.filter(item => item.execution.revision === record.revision)
  if (current.length === 0) return 'No recorded runs of this revision yet.'
  const count = (verdict: JudgedExecution['verdict']) => current.filter(item => item.verdict === verdict).length
  const recent = current.slice(-3).map(item => `${new Date(item.execution.endedAt).toISOString().slice(0, 16)} ${item.verdict}${item.correction ? ` (corrected: ${item.correction.slice(0, 120)})` : ''}`)
  return `Runs of revision ${record.revision}: ${current.length} (verified ${count('verified')}, succeeded ${count('succeeded')}, failed ${count('failed')}, unknown ${count('unknown')}). Recent: ${recent.join('; ')}.`
}

const STOP_WORDS = new Set(['that', 'this', 'with', 'from', 'have', 'what', 'when', 'where', 'which', 'your', 'about', 'there', 'their', 'would', 'could', 'should', 'into', 'then', 'them', 'they', 'will', 'just', 'want', 'make', 'like', 'does', 'please'])

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !STOP_WORDS.has(word)))
}

/**
 * Register the capability tool, the learning guidance, and draft recall.
 * @param ctx - agent context with the capability registry, tool registry, and system prompt.
 * @param config - validated consumer configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger(name)
  const recalledDrafts = new Map<string, Set<string>>()
  const tracker = new ExecutionTracker()
  /** Recorded executions of each session by turn, for corrections and ratings that arrive later. */
  const recorded = new Map<string, Map<number, { readonly name: string; readonly id: string }[]>>()
  const sessions = new Map<string, Session>()

  /** Ask the user one yes/no question; `unavailable` when nobody can answer in this session. */
  async function confirm(agent: Agent, question: string, detail: string, yes: string, no: string, signal: AbortSignal): Promise<'yes' | 'no' | 'unavailable'> {
    const questions = ctx.get('userQuestions')
    if (questions === undefined) return 'unavailable'
    try {
      const answer = await questions.ask({
        questions: [{ id: 'capability', header: 'Capability', question, detail, options: [{ label: yes }, { label: no }] }],
        agent,
        signal,
      })
      const selected = answer.answers.find(item => item.id === 'capability')?.selected ?? []
      return selected.includes(yes) ? 'yes' : 'no'
    } catch (error) {
      signal.throwIfAborted()
      // No answerer can reach a human here, for example in a subagent: the draft stays unconfirmed.
      logger.debug(`capability confirmation unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return 'unavailable'
    }
  }

  /** The procedure as the user reviews it: its leading title is the question's, and the description is not repeated. */
  function preview(capability: Pick<Capability, 'description' | 'content'>): string {
    const body = capability.content.trim().replace(/^#\s+[^\n]*\n+/, '')
    const lead = body.includes(capability.description.trim()) ? '' : `${capability.description.trim()}\n\n`
    return clip(`${lead}${body}`, config.previewMaxChars)
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name,
    order: config.promptOrder,
    text: context => ownerOfScope(context.scope) === undefined ? '' : LEARNING_GUIDANCE,
  }), 'tool-capability.guidance')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL,
    description: 'Learn and maintain reusable procedures (capabilities) for this user. ' +
      'Actions: "learn" saves a new procedure (name, description, content) and asks the user to confirm it; ' +
      '"view" reads one; "list" shows all; "update" edits one (old_string and new_string, or content); ' +
      '"write_file" adds a supporting file (file_path under references/, scripts/, templates/, assets/, or examples/, and file_content); ' +
      '"delete" removes one; "report" records how following one went this turn (outcome, validation, notes); "retire" withdraws one and "restore" brings it back. ' +
      'Changes to a confirmed capability are confirmed by the user.',
    parameters: {
      action: { type: 'string', required: true, enum: ['learn', 'view', 'list', 'update', 'write_file', 'delete', 'report', 'retire', 'restore'] },
      name: { type: 'string', description: 'Kebab-case capability name, such as release-aeven-desktop.' },
      description: { type: 'string', description: 'One line: what the capability does and when to use it.' },
      content: { type: 'string', description: 'The full procedure in Markdown: when to use it, requirements, steps, verification, recovery.' },
      old_string: { type: 'string', description: 'For update: the exact passage to replace; it must occur once.' },
      new_string: { type: 'string', description: 'For update: the replacement passage.' },
      file_path: { type: 'string', description: 'For write_file: path of the supporting file.' },
      file_content: { type: 'string', description: 'For write_file: the file content.' },
      outcome: { type: 'string', enum: ['succeeded', 'failed'], description: 'For report: whether following the capability achieved its goal.' },
      validation: { type: 'string', enum: ['passed', 'failed', 'not-run'], description: 'For report: result of the capability\'s verification step.' },
      notes: { type: 'string', description: 'For report: what went wrong or differed from the procedure.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      const sessionId = agent.session.id
      const action = args.action
      switch (action) {
        case 'list': {
          const records = await ctx.capabilities.list(owner)
          return json({
            text: records.length === 0 ? 'No capabilities learned yet.' : records.map(describeRecord).join('\n'),
            capabilities: records.map(record => ({ name: record.name, status: record.status, revision: record.revision, description: record.description })),
          })
        }
        case 'view': {
          const capability = await ctx.capabilities.get(owner, required(args.name, 'name', action))
          if (!capability) return json({ text: `No capability named ${args.name}.`, found: false })
          const status = capability.status === 'candidate' ? 'Unconfirmed draft: verify each step before relying on it.' : `Status: ${capability.status}. ${evidenceSummary(capability, await ctx.capabilities.evidence(owner, capability.name))}`
          return json({
            text: `${status}\n${capability.description}\n\n${capability.content}${capability.files.length > 0 ? `\n\nSupporting files in ${capability.directory}: ${capability.files.join(', ')}` : ''}`,
            found: true,
            status: capability.status,
            revision: capability.revision,
            directory: capability.directory,
            files: [...capability.files],
          })
        }
        case 'learn': {
          const draft = {
            name: required(args.name, 'name', action),
            description: required(args.description, 'description', action),
            content: required(args.content, 'content', action),
          }
          const existing = await ctx.capabilities.get(owner, draft.name)
          if (existing !== undefined && existing.status !== 'candidate') {
            return json({ text: `A capability named ${draft.name} already exists (${existing.status}); change it with action "update".`, status: 'exists' })
          }
          // Remember immediately: the draft is durable before anyone is asked.
          await ctx.capabilities.save(owner, draft, { status: 'candidate', source: 'agent', sessionId })
          const decision = await confirm(agent, `Learn the capability "${draft.name}"?`, preview(draft), CONFIRM, DECLINE, exec.signal)
          if (decision === 'yes') {
            await ctx.capabilities.setStatus(owner, draft.name, 'learned', sessionId)
            return json({ text: `Learned ${draft.name}. It is available in the skill catalog from the next session on.`, status: 'learned' })
          }
          if (decision === 'no') {
            await ctx.capabilities.remove(owner, draft.name)
            return json({ text: `The user declined; ${draft.name} was not saved.`, status: 'declined' })
          }
          return json({ text: `Saved ${draft.name} as an unconfirmed draft; the user has not confirmed it.`, status: 'candidate' })
        }
        case 'update': {
          const capabilityName = required(args.name, 'name', action)
          const current = await ctx.capabilities.get(owner, capabilityName)
          if (!current) return json({ text: `No capability named ${capabilityName}.`, found: false })
          const content = args.content?.trim()
          const edit = content ? undefined : { oldString: required(args.old_string, 'old_string or content', action), newString: args.new_string ?? '' }
          if (current.status !== 'candidate') {
            const detail = edit ? `Replace:\n${edit.oldString}\n\nWith:\n${edit.newString}` : preview({ description: args.description?.trim() || current.description, content: content ?? '' })
            if (await confirm(agent, `Change the learned capability "${capabilityName}"?`, clip(detail, config.previewMaxChars), APPLY, KEEP, exec.signal) !== 'yes') {
              return json({ text: `The change to ${capabilityName} was not confirmed; it is unchanged.`, status: 'unchanged' })
            }
          }
          const updated = edit
            ? await ctx.capabilities.patch(owner, capabilityName, edit, sessionId)
            : await ctx.capabilities.save(owner, { name: capabilityName, description: args.description?.trim() || current.description, content: content ?? '' }, { status: current.status, source: current.source, sessionId })
          return json({ text: `Updated ${capabilityName} to revision ${updated.revision}.`, revision: updated.revision })
        }
        case 'write_file': {
          const capabilityName = required(args.name, 'name', action)
          const path = required(args.file_path, 'file_path', action)
          const fileContent = args.file_content ?? ''
          const current = await ctx.capabilities.get(owner, capabilityName)
          if (!current) return json({ text: `No capability named ${capabilityName}.`, found: false })
          if (current.status !== 'candidate'
            && await confirm(agent, `Add ${path} to the learned capability "${capabilityName}"?`, clip(fileContent, config.previewMaxChars), APPLY, KEEP, exec.signal) !== 'yes') {
            return json({ text: `The file was not confirmed; ${capabilityName} is unchanged.`, status: 'unchanged' })
          }
          const updated = await ctx.capabilities.writeFile(owner, capabilityName, path, fileContent, sessionId)
          return json({ text: `Wrote ${path} to ${capabilityName} (revision ${updated.revision}).`, revision: updated.revision })
        }
        case 'delete': {
          const capabilityName = required(args.name, 'name', action)
          const current = await ctx.capabilities.get(owner, capabilityName)
          if (!current) return json({ text: `No capability named ${capabilityName}.`, found: false })
          if (current.status !== 'candidate'
            && await confirm(agent, `Delete the learned capability "${capabilityName}"?`, current.description, 'Delete', KEEP, exec.signal) !== 'yes') {
            return json({ text: `Deletion was not confirmed; ${capabilityName} is kept.`, status: 'kept' })
          }
          await ctx.capabilities.remove(owner, capabilityName)
          return json({ text: `Deleted ${capabilityName}.`, status: 'deleted' })
        }
        case 'report': {
          const capabilityName = required(args.name, 'name', action)
          const outcome = args.outcome
          if (outcome === undefined) throw new Error('action "report" requires outcome')
          const notes = args.notes?.trim()
          const accepted = tracker.report(sessionId, capabilityName, {
            outcome,
            validation: args.validation ?? 'not-run',
            ...notes ? { notes } : {},
          })
          return json({
            text: accepted
              ? `Recorded: ${capabilityName} ${outcome}, verification ${args.validation ?? 'not-run'}.`
              : `${capabilityName} was not loaded in this turn; report only on a capability you loaded with the skill tool this turn.`,
            recorded: accepted,
          })
        }
        case 'retire':
        case 'restore': {
          const capabilityName = required(args.name, 'name', action)
          const current = await ctx.capabilities.get(owner, capabilityName)
          if (!current || current.status === 'candidate') return json({ text: `No confirmed capability named ${capabilityName}.`, found: false })
          const retire = action === 'retire'
          if (await confirm(agent, `${retire ? 'Retire' : 'Restore'} the capability "${capabilityName}"?`, current.description, retire ? 'Retire' : 'Restore', KEEP, exec.signal) !== 'yes') {
            return json({ text: `Not confirmed; ${capabilityName} is unchanged.`, status: current.status })
          }
          const updated = await ctx.capabilities.setStatus(owner, capabilityName, retire ? 'retired' : 'learned', sessionId)
          return json({ text: `${capabilityName} is now ${updated.status}.`, status: updated.status })
        }
        default:
          throw new Error(`unknown action: ${String(action)}`)
      }
    },
  })), 'tool-capability.tool')

  // Remember immediately: unconfirmed drafts that match the request are recalled once per session.
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (payload.step !== 1 || decision.kind !== 'enter') return decision
    const owner = payload.agent.session.header.owner
    if (owner === undefined) return decision
    sessions.set(payload.agent.session.id, payload.agent.session)
    const query = decision.messages.filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.map(block => block.type === 'text' ? block.text : '')).join(' ')
    const correction = correctionOf(query)
    if (correction !== undefined) amendPreviousTurn(owner, payload.agent.session.id, payload.turn, correction)
    const queryWords = words(query)
    if (queryWords.size === 0) return decision
    try {
      const seen = recalledDrafts.get(payload.agent.session.id) ?? new Set<string>()
      const drafts = (await ctx.capabilities.list(owner))
        .filter(record => record.status === 'candidate' && !seen.has(record.name))
        .map(record => ({ record, overlap: [...words(`${record.name.replaceAll('-', ' ')} ${record.description}`)].filter(word => queryWords.has(word)).length }))
        .filter(item => item.overlap >= 2)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, config.maxDrafts)
      if (drafts.length === 0) return decision
      for (const { record } of drafts) seen.add(record.name)
      recalledDrafts.set(payload.agent.session.id, seen)
      const text = `<capability_drafts>\nUnconfirmed procedures saved earlier that may apply. The user has not confirmed them: read one with ${TOOL} (action "view") and verify each step before relying on it.\n${drafts.map(({ record }) => `- ${record.name}: ${record.description}`).join('\n')}\n</capability_drafts>`
      const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: name, form: 'recall' } })
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      logger.warn(`draft recall failed: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
  })

  /** A correction answers the most recent earlier turn that used a capability. */
  function amendPreviousTurn(owner: string, sessionId: string, turn: number, text: string): void {
    const byTurn = recorded.get(sessionId)
    const previous = byTurn === undefined ? undefined : Math.max(...[...byTurn.keys()].filter(key => key < turn))
    const executions = previous === undefined || !Number.isFinite(previous) ? undefined : byTurn?.get(previous)
    for (const execution of executions ?? []) {
      void ctx.capabilities.amend(owner, execution.name, { kind: 'correction', executionId: execution.id, at: Date.now(), text: text.slice(0, 500) })
        .catch((error: unknown) => logger.warn(`correction for ${execution.name} failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  ctx.on('session/event', (session, event) => {
    const used = tracker.observe(session, event)
    const owner = session.header.owner
    if (used === undefined || owner === undefined) return
    void (async () => {
      for (const { name: capabilityName, execution } of used) {
        const capability = await ctx.capabilities.get(owner, capabilityName).catch(() => undefined)
        // A loaded skill that is not one of the owner's confirmed capabilities has no lifecycle here.
        if (capability === undefined || capability.status === 'candidate' || capability.status === 'retired') continue
        const id = await ctx.capabilities.recordExecution(owner, capabilityName, { ...execution, environment: currentEnvironment() })
        const byTurn = recorded.get(session.id) ?? new Map<number, { name: string; id: string }[]>()
        byTurn.set(execution.turn, [...byTurn.get(execution.turn) ?? [], { name: capabilityName, id }])
        recorded.set(session.id, byTurn)
      }
    })().catch((error: unknown) => logger.warn(`recording capability execution failed: ${error instanceof Error ? error.message : String(error)}`))
  })

  ctx.on('message-feedback/changed', (change) => {
    const session = sessions.get(change.sessionId)
    const byTurn = recorded.get(change.sessionId)
    const owner = session?.header.owner
    if (!session || !byTurn || owner === undefined || change.item === undefined) return
    let turn: number | undefined
    for (const event of session.snapshotEvents()) {
      if (event.type === 'assistant/message' && event.data.message.id === change.messageId) turn = event.data.turn
    }
    for (const execution of turn === undefined ? [] : byTurn.get(turn) ?? []) {
      void ctx.capabilities.amend(owner, execution.name, {
        kind: 'rating',
        executionId: execution.id,
        at: Date.now(),
        rating: change.item.rating,
        ...change.item.note === undefined ? {} : { note: change.item.note },
      }).catch((error: unknown) => logger.warn(`rating for ${execution.name} failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  })

  ctx.on('session/disposed', (session) => {
    recalledDrafts.delete(session.id)
    recorded.delete(session.id)
    sessions.delete(session.id)
    tracker.forget(session.id)
  })
}
