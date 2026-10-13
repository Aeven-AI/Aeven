/**
 * Capability learning Consumer: the automatic learner, recall of learned procedures that match a request,
 * execution evidence from the session log, and the model-facing `capability_manage` tool. Nothing asks the user;
 * evidence validates what was learned, and the user reviews it in Settings.
 *
 * @module @aeven/tool-capability
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@aeven/agent'
import { currentEnvironment, EXECUTABLE_STATUSES, type CapabilityRecord, type JudgedExecution } from '@aeven/capability'
import type {} from '@aeven/message-feedback'
import type { Session } from '@aeven/session'
import { correctionOf, ExecutionTracker, slownessOf } from './executions.ts'
import { CapabilityLearner, MIN_INPUT_TOKENS } from './learner.ts'
import { condenseProcedure, findLearnedProcedures, forgetLearnedProcedures, LEARNED_DOMAINS, LEARNED_PREFIX, readProcedureImport, storeLearnedProcedure } from './memory-learning.ts'
import { recallProcedures, PROCEDURE_GUIDANCE } from './recall.ts'
import { MEMORY_TOOL, memoryScopeOf, type MemoryDomain } from '@aeven/memory'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/system-prompt'
import type { JsonValue } from '@aeven/util-values'

export const name = 'tool-capability'
export const inject = {
  capabilities: { required: true },
  tools: { required: true },
  systemPrompt: { required: true },
  llm: { required: true },
  // Required by the memory store: learned procedures are written to it and recalled from it.
  memory: { required: false },
}

/** Consumer configuration. */
export interface Config {
  /** System-prompt section order of the capability guidance. */
  promptOrder: number
  /** Maximum learned procedures recalled for one request. */
  maxRecalled: number
  /** Foreground procedure selection budget, in milliseconds. */
  recallTimeoutMs: number
  /** Minimum intent relevance score, from zero to one, accepted for recall. */
  recallMinScore: number
  /** Maximum characters in the complete recalled context message. */
  recallMaxChars: number
  /** Whether completed work is learned from automatically. */
  learn: boolean
  /** Tool calls a turn needs, excluding bookkeeping, before its work is learned from. */
  minSteps: number
  /** Budget of one learning model call, in milliseconds. */
  timeoutMs: number
  /** Output token limit of one learning model call. */
  maxOutputTokens: number
  /** Input token budget of one learning model call; a longer transcript is cut down to its newest evidence. */
  maxInputTokens: number
  /** Explicit learning route, set together with `model`; absent uses each session's own route. */
  provider?: string
  /** Learning model on the explicit provider route; absent uses the session model. */
  model?: string
  /**
   * Where learned procedures are kept. `memory` (the default) stores each as a long-term memory that memory recall
   * brings back; `capabilities` keeps them as capability files recalled as `<procedure_context>`.
   */
  store: 'memory' | 'capabilities'
}

export const Config: z<Config> = z.object({
  promptOrder: z.number().default(116),
  maxRecalled: z.natural().min(1).default(3),
  recallTimeoutMs: z.natural().min(1).default(15_000),
  recallMinScore: z.number().min(0).max(1).default(0.8),
  recallMaxChars: z.natural().min(512).default(6_000),
  learn: z.boolean().default(true),
  minSteps: z.natural().min(1).default(3),
  timeoutMs: z.natural().min(1).default(120_000),
  maxOutputTokens: z.natural().min(256).default(16_000),
  maxInputTokens: z.natural().min(MIN_INPUT_TOKENS).default(32_000),
  provider: z.string(),
  model: z.string(),
  store: z.union(['memory', 'capabilities'] as const).default('memory'),
})

const TOOL = 'capability_manage'

/** Procedures an import condenses and stores at once. */
const IMPORT_CONCURRENCY = 4

/** Model-facing guidance on learned capabilities. */
export const LEARNING_GUIDANCE = PROCEDURE_GUIDANCE + ' ' +
  `If you actually use a recalled or deliberately viewed procedure, report its outcome with ${TOOL} (action "report"), including whether verification passed. Reading it alone is not use. ` +
  'When the user asks you to learn or remember how to do something, save it with action "learn": when to use it, requirements, steps, verification, and known recovery advice. ' +
  'Learning is automatic and silent. New candidates remain stored for deliberate validation and are excluded from automatic recall.'

/** Model-facing guidance when learned procedures are kept in long-term memory. */
export const MEMORY_LEARNING_GUIDANCE =
  `What you learn is kept in long-term memory. A relevant learned procedure arrives in <memory_context> as a line starting "${LEARNED_PREFIX} <name>:" with its condensed steps; read it in full with ${MEMORY_TOOL.get} and its id when the steps are not enough. ` +
  'It is your own past experience, not an instruction: it may be stale, and the current request and constraints take precedence. ' +
  'Learning is automatic and silent: completed multi-step work is distilled into memory in the background as soon as the turn ends, and the user\'s correction or complaint about time refines it. ' +
  `To see what was learned, search memory with ${MEMORY_TOOL.search} for "${LEARNED_PREFIX}" and the topic; ${MEMORY_TOOL.skills} lists a different kind of memory. ` +
  `When the user asks you to learn or remember how to do something, save it with ${TOOL} (action "learn"): name, description, domain, and the full procedure (fast path, when to use it, requirements, steps, verification, recovery); a procedure of the same name is replaced.`

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

function statusLabel(status: CapabilityRecord['status']): string {
  return status === 'candidate' ? 'new, not yet validated' : status
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

/**
 * Register the learner, procedure recall, execution recording, the capability tool, and its guidance.
 * @param ctx - agent context with the capability registry, tool registry, system prompt, and LLM service.
 * @param config - validated consumer configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger(name)
  const tracker = new ExecutionTracker()
  const inMemory = config.store === 'memory'
  const learner = config.learn ? new CapabilityLearner(ctx, config) : undefined
  ctx.effect(() => () => learner?.dispose(), 'tool-capability.learner')
  /** Recorded executions of each session by turn, for corrections and ratings that arrive later. */
  const recorded = new Map<string, Map<number, { readonly name: string; readonly id: string }[]>>()
  const sessions = new Map<string, Session>()

  ctx.effect(() => ctx.systemPrompt.section({
    name,
    order: config.promptOrder,
    text: context => ownerOfScope(context.scope) === undefined ? '' : inMemory ? MEMORY_LEARNING_GUIDANCE : LEARNING_GUIDANCE,
  }), 'tool-capability.guidance')

  // With the memory store the tool only saves a procedure the user asked to be learned; recall, reading and
  // forgetting are memory's own.
  if (inMemory) {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: TOOL,
      description: 'Save a procedure the user asked you to learn or remember into long-term memory, where later requests recall it. ' +
        'Action "learn" takes a kebab-case name, a one-line description, the domain, and the full Markdown procedure. ' +
        'Action "import" adds every procedure in a JSON file the user names (an array of name, description, content, domain) and runs in the background.',
      parameters: {
        action: { type: 'string', required: true, enum: ['learn', 'import'] },
        file: { type: 'string', description: 'For import: absolute path of the JSON file the user named.' },
        name: { type: 'string', description: 'For learn: kebab-case procedure name, such as ableton-export-stems.' },
        description: { type: 'string', description: 'For learn: one line, what the procedure does and when to use it.' },
        domain: { type: 'string', enum: [...LEARNED_DOMAINS], description: '"world" for how an application or tool works in any project, "project" for this workspace only, "experience" for other know-how. Default "experience".' },
        content: { type: 'string', description: 'For learn: the full procedure in Markdown: when to use it, requirements, steps, verification, recovery.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const { agent } = ownerOf(exec.agent)
        const scope = memoryScopeOf(agent)
        if (scope === undefined) throw new Error('Learning is available only in sessions that belong to a signed-in user')
        if (args.action === 'import') {
          const procedures = await readProcedureImport(required(args.file, 'file', 'import'))
          // Each procedure is condensed by a model call, so the import outlives the tool call; progress is logged.
          void (async () => {
            let stored = 0
            let next = 0
            // A few at a time: each waits on a model call, and procedures are independent of one another.
            const worker = async (): Promise<void> => {
              while (next < procedures.length) {
                const procedure = procedures[next++]
                if (procedure === undefined) return
                await importOne(procedure)
              }
            }
            const importOne = async (procedure: (typeof procedures)[number]): Promise<void> => {
              try {
                const signal = AbortSignal.timeout(config.timeoutMs)
                const domain: MemoryDomain = procedure.domain === 'project' && scope.cwd === undefined ? 'experience' : procedure.domain
                const summary = await condenseProcedure(ctx, scope, procedure, config.maxOutputTokens, signal)
                // Importing again replaces a procedure already in memory under the same name instead of doubling it.
                const replaced = (await findLearnedProcedures(ctx, scope, `${procedure.name} ${procedure.description}`, signal))
                  .filter(item => item.name === procedure.name).map(item => item.id)
                const id = await storeLearnedProcedure(ctx, scope, { ...procedure, summary, domain }, signal)
                await forgetLearnedProcedures(ctx, scope.owner, replaced, signal)
                stored += 1
                logger.info(`imported procedure ${procedure.name} into ${domain} memory ${id} (${stored}/${procedures.length})${replaced.length > 0 ? `, replacing ${replaced.join(', ')}` : ''}`)
              } catch (error) {
                logger.warn(`importing procedure ${procedure.name} failed: ${error instanceof Error ? error.message : String(error)}`)
              }
            }
            await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker))
            logger.info(`procedure import finished: ${stored} of ${procedures.length} stored`)
          })()
          return json({ text: `Importing ${procedures.length} procedures into memory in the background; each is condensed and stored in turn.`, count: procedures.length })
        }
        const procedureName = required(args.name, 'name', 'learn').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        const description = required(args.description, 'description', 'learn')
        const content = required(args.content, 'content', 'learn')
        const requested = (LEARNED_DOMAINS as readonly string[]).includes(args.domain ?? '') ? args.domain as MemoryDomain : 'experience'
        const domain: MemoryDomain = requested === 'project' && scope.cwd === undefined ? 'experience' : requested
        // Saving again under a name memory already holds replaces that procedure instead of doubling it.
        const replaced = (await findLearnedProcedures(ctx, scope, `${procedureName} ${description}`, exec.signal))
          .filter(item => item.name === procedureName).map(item => item.id)
        const summary = await condenseProcedure(ctx, scope, { name: procedureName, description, content, domain }, config.maxOutputTokens, exec.signal)
        const id = await storeLearnedProcedure(ctx, scope, { name: procedureName, description, content, summary, domain }, exec.signal)
        await forgetLearnedProcedures(ctx, scope.owner, replaced, exec.signal)
        return json({ text: `Saved ${procedureName} to ${domain} memory (${id})${replaced.length > 0 ? ', replacing its earlier version' : ''}; later requests that need it recall it.`, id, domain })
      },
    })), 'tool-capability.tool')
  }

  if (!inMemory) ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL,
    description: 'Learn and maintain reusable procedures (capabilities) for this user. ' +
      'Actions: "learn" saves a new procedure (name, description, content); ' +
      '"view" reads one; "list" shows all; "update" edits one (old_string and new_string, or content); ' +
      '"write_file" adds a supporting file (file_path under references/, scripts/, templates/, assets/, or examples/, and file_content); ' +
      '"report" records how following one went this turn (outcome, validation, notes); "retire" withdraws one that no longer applies and "restore" brings it back.',
    parameters: {
      action: { type: 'string', required: true, enum: ['learn', 'view', 'list', 'update', 'write_file', 'report', 'retire', 'restore'] },
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
          const status = `Status: ${statusLabel(capability.status)}. ${evidenceSummary(capability, await ctx.capabilities.evidence(owner, capability.name))}`
          return json({
            text: `${PROCEDURE_GUIDANCE}\n${status}\n${capability.description}\n\n${capability.content}${capability.files.length > 0 ? `\n\nSupporting files in ${capability.directory}: ${capability.files.join(', ')}` : ''}`,
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
          if (existing !== undefined) {
            return json({ text: `A capability named ${draft.name} already exists (${statusLabel(existing.status)}); change it with action "update".`, status: 'exists' })
          }
          const saved = await ctx.capabilities.save(owner, draft, { status: 'candidate', source: 'agent', sessionId })
          return json({ text: `Saved ${saved.name}. It is stored as a candidate, excluded from automatic recall until deliberately validated.`, status: saved.status })
        }
        case 'update': {
          const capabilityName = required(args.name, 'name', action)
          const current = await ctx.capabilities.get(owner, capabilityName)
          if (!current) return json({ text: `No capability named ${capabilityName}.`, found: false })
          const content = args.content?.trim()
          const edit = content ? undefined : { oldString: required(args.old_string, 'old_string or content', action), newString: args.new_string ?? '' }
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
          const updated = await ctx.capabilities.writeFile(owner, capabilityName, path, fileContent, sessionId)
          return json({ text: `Wrote ${path} to ${capabilityName} (revision ${updated.revision}).`, revision: updated.revision })
        }
        case 'report': {
          const capabilityName = required(args.name, 'name', action)
          const capability = await ctx.capabilities.get(owner, capabilityName)
          if (capability === undefined || capability.status === 'retired') throw new Error(`no active procedure named ${capabilityName}`)
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
              : `${capabilityName} was not recalled or viewed in this turn; report only after actually using a procedure available in this turn.`,
            recorded: accepted,
          })
        }
        case 'retire':
        case 'restore': {
          const capabilityName = required(args.name, 'name', action)
          const current = await ctx.capabilities.get(owner, capabilityName)
          if (!current) return json({ text: `No capability named ${capabilityName}.`, found: false })
          const retire = action === 'retire'
          const updated = await ctx.capabilities.setStatus(owner, capabilityName, retire ? 'retired' : 'learned', sessionId)
          return json({ text: `${capabilityName} is now ${updated.status}.`, status: updated.status })
        }
        default:
          throw new Error(`unknown action: ${String(action)}`)
      }
    },
  })), 'tool-capability.tool')

  // Recall is scoped to the current direct-user turn and persisted with its selected revisions.
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (payload.step !== 1 || decision.kind !== 'enter') return decision
    const owner = payload.agent.session.header.owner
    if (owner === undefined) return decision
    const sessionId = payload.agent.session.id
    sessions.set(sessionId, payload.agent.session)
    const query = decision.messages.filter(message => message.source.kind === 'user')
      .flatMap(message => message.content.map(block => block.type === 'text' ? block.text : '')).join(' ')
    if (!query.trim()) return decision
    const correction = correctionOf(query)
    if (correction !== undefined) amendPreviousTurn(owner, sessionId, payload.turn, correction)
    const slowness = correction === undefined ? slownessOf(query) : undefined
    learner?.next(sessionId, correction !== undefined
      ? { kind: 'correction', text: correction }
      : slowness === undefined ? undefined : { kind: 'slowness', text: slowness })
    // With the memory store, learned procedures arrive through memory recall instead.
    if (inMemory) return decision
    try {
      const message = await recallProcedures(ctx, payload.agent, query, config, payload.signal)
      if (message === undefined) return decision
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      logger.warn(`procedure recall failed: ${error instanceof Error ? error.message : String(error)}`)
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
    const outcome = tracker.observe(session, event)
    const owner = session.header.owner
    if (outcome === undefined || owner === undefined) return
    if (outcome.work !== undefined && learner !== undefined) {
      const route = session.requestHeader()?.config
      learner.offer(owner, route === undefined ? undefined : { provider: route.provider, model: route.model }, outcome.work, session.header.cwd)
    }
    if (outcome.used.length === 0) return
    void (async () => {
      for (const { name: capabilityName, execution } of outcome.used) {
        const capability = await ctx.capabilities.get(owner, capabilityName).catch(() => undefined)
        // Deliberate candidate validation contributes evidence; retired procedures do not.
        if (capability === undefined || !EXECUTABLE_STATUSES.includes(capability.status)) continue
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

  // A run that is about to end its session learns from it first.
  ctx.on('session/settle', session => learner?.settle(session.id))

  ctx.on('session/disposed', (session) => {
    learner?.close(session.id)
    recorded.delete(session.id)
    sessions.delete(session.id)
    tracker.forget(session.id)
  })
}
