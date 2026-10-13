/**
 * Automatic learning. Completed work that looks like a reusable procedure is distilled by a background model call as
 * soon as its turn ends, into a new procedure or merged into one already learned, so the next request can use it
 * right away. The user's next message refines it: a correction or a complaint that the work was slow re-learns the
 * same work with that feedback. Nobody is asked. With `store: 'memory'` the procedure is a long-term memory that
 * memory recall brings back when a request needs it; with `store: 'capabilities'` it is a candidate capability that
 * the registry's evidence rules validate when it is next used.
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@aeven/llm'
import type { CapabilityOrigin, CapabilityRecord } from '@aeven/capability'
import type { MemoryDomain, MemoryItemId, MemoryScope } from '@aeven/memory'
import type { SessionId } from '@aeven/session/types'
import type { CompletedWork, WorkStep } from './executions.ts'
import { findLearnedProcedures, forgetLearnedProcedures, LEARNED_DOMAINS, storeLearnedProcedure, type LearnedProcedure } from './memory-learning.ts'

/** Learner configuration. */
export interface LearnerConfig {
  /** Tool calls a turn needs, excluding capability and skill bookkeeping, before its work is considered. */
  readonly minSteps: number
  /** Budget of one distillation model call, in milliseconds. */
  readonly timeoutMs: number
  /** Output token limit of one distillation. */
  readonly maxOutputTokens: number
  /** Input token budget of one distillation; a transcript beyond it is condensed, then cut down to its newest evidence. */
  readonly maxInputTokens: number
  /** Explicit distillation route; absent uses the session's own route. Set together with `model`. */
  readonly provider?: string
  readonly model?: string
  /** Where a learned procedure is kept: long-term memory, or the capability registry. */
  readonly store: 'memory' | 'capabilities'
}

/** Model route of one session's requests. */
export interface LearnerRoute {
  readonly provider: string
  readonly model: string
}

/** The user's reaction to learned work, in their words. */
export interface LearnerFeedback {
  readonly kind: 'correction' | 'slowness'
  readonly text: string
}

interface Held {
  readonly owner: string
  readonly route: LearnerRoute
  readonly work: CompletedWork
  /** The session's workspace, which a project procedure is filed under. */
  readonly cwd?: string
}

/** The latest work of a session that was learned from, kept so the user's next message can refine it. */
interface Recent extends Held {
  /** Procedure the work was learned into; absent while learning runs or when the work taught nothing. */
  learned?: { readonly name: string; readonly id?: MemoryItemId }
}

type Decision =
  | { readonly decision: 'skip' }
  | {
    readonly decision: 'create' | 'update'
    readonly name: string
    readonly description: string
    readonly content: string
    /** Memory store only: where the procedure applies. */
    readonly domain?: MemoryDomain
    /** Memory store only: the procedure condensed for recall. */
    readonly summary?: string
  }

/** Tool calls that record bookkeeping rather than doing the work. */
const BOOKKEEPING = /^(?:skill|capability_manage|todo_write|memory_[a-z_]+|ask_user(?:_question)?|tool_search|job_output)$/

const MAX_EXISTING = 40
const MAX_RELATED = 2

/**
 * Characters per token in the fixed text-density estimate of the input budget. The provider's own
 * tokenizer is not run, so the budget bounds this estimate rather than billed tokens.
 */
const CHARS_PER_TOKEN = 4

/** Marks where a transcript longer than the input budget was cut. */
const CUT_MARKER = '…[transcript cut to the learning input budget]'

/** Per-call character limits tried in turn, longest first, before older calls are dropped. */
const STEP_CLIPS = [1_500, 600, 240, 80] as const satisfies readonly number[]

/** The shortest per-call limit, kept while older calls are dropped. */
const SHORTEST_CLIP = 80

/**
 * Smallest input budget a learning call accepts. It stays above the longer fixed system prompt of about 1,100
 * estimated tokens, so a transcript bounded to any accepted budget still leaves that prompt room.
 */
export const MIN_INPUT_TOKENS = 2_000

/** Instructions both prompts share: what to learn, how fast work is taught, and how the user's feedback applies. */
const LEARNING_RULES = `Learn from successful multi-step operational work: how an application or tool does something (for example how to do a task in Ableton, Figma, or a CLI), setup, build, release, deployment, code changes in a repository, data or file processing, reporting, diagnosis, and similar work that took several tool calls. Learn it even when the work went smoothly, because next time the exploration is skipped; work that needed retries, dead ends, or a correction is the most valuable. Skip one-off questions, explanations, conversation, facts about the user, and work that failed.

The purpose is speed: the next request of this kind must finish in far fewer steps. <timing> gives how long the work took and how much of it was the assistant thinking between calls; each tool call shows the seconds spent before it ("think") and running it ("run"). Every call costs thinking time, so the fewest calls win. Find the time sinks: searches and reads that did not change what was done, checks heavier than the user asked for, work the user did not ask for, and retries. Write the shortest path that would have produced the same result, with the exact files, commands, and settings found, so none of them has to be searched for again. Keep the user's stated preferences for this kind of work (for example which checks they want and which they do not) as rules of the procedure.

<user_feedback>, when present, is what the user said after the work. A correction means the procedure must change to avoid what they corrected. A complaint about time means the fast path must cut what took the time.

Name a procedure after the kind of task, not this instance (for example "aeven-client-ui-change", not "rename-clear-history-button"). When an existing procedure covers the same kind of task, even with a different instance, update it: return its exact name and the complete merged procedure, keeping what still holds, fixing what the work showed to be wrong, and folding this instance in as an example. Create a new one only for a different kind of task.`

/** Sections every written procedure has. */
const PROCEDURE_SECTIONS = `in Markdown with these sections: "Fast path" (the minimal numbered sequence of calls for this kind of task, and a short "Avoid" list of the time sinks), "When to use", "Requirements" (including the user's preferences), "Steps" (numbered, with the exact commands, paths, settings, menu items, and tool parameters that worked; replace values that vary between uses with named placeholders), "Verification" (observable success criteria, no heavier than the user asked for), and "Recovery" (known failures and their fixes, from the work). Do not include the dead ends except under "Avoid" or "Recovery".`

const SYSTEM = `You maintain the reusable procedures (capabilities) an assistant learned for one user. You receive one completed piece of work: the user's request, the tool calls that did it with their results and timing, and the final answer. Decide whether it contains a procedure worth reusing, and write it.

${LEARNING_RULES}

Write the procedure so another session can follow it without this conversation, ${PROCEDURE_SECTIONS}

Reply with one JSON object and nothing else:
{"decision":"skip"}
or
{"decision":"create" or "update","name":"kebab-case-name","description":"One line: what it does and when to use it.","content":"The Markdown procedure."}`

/** Distillation prompt when learned procedures are kept in long-term memory. */
const MEMORY_SYSTEM = `You maintain the know-how an assistant learned for one user, kept in its long-term memory and recalled when a later request needs it. You receive one completed piece of work: the user's request, the tool calls that did it with their results and timing, and the final answer. Decide whether it taught a procedure worth remembering, and write it.

${LEARNING_RULES}

Write "content" so another session can follow it without this conversation, ${PROCEDURE_SECTIONS}

Write "summary" as the procedure condensed to at most 800 characters that can be followed on its own, because recall shows only the summary: start with the fast path (the minimal steps with their exact commands, files, or settings), then the time sinks to avoid and the user's preferences, then the check.

Choose "domain": "world" when it is how an application, tool, service, or environment works and applies in any project; "project" when it only applies to the current workspace's code or files; "experience" for other reusable know-how.

Reply with one JSON object and nothing else:
{"decision":"skip"}
or
{"decision":"create" or "update","name":"kebab-case-name","description":"One line: what it does and when to use it.","domain":"world" or "project" or "experience","summary":"The condensed procedure.","content":"The Markdown procedure."}`

/** Characters of the longer distillation prompt, which every input budget is measured against. */
const PROMPT_CHARS = Math.max(SYSTEM.length, MEMORY_SYSTEM.length)

/** One distillation request: the fixed system prompt and the transcript of the work. */
interface Transcript {
  /** The turn's request, verbatim. */
  readonly request: string
  /** How long the work took, one line. */
  readonly timing: string
  /** The turn's tool calls, oldest first, bookkeeping excluded. */
  readonly steps: readonly WorkStep[]
  /** When the turn started, in epoch milliseconds; the first call's thinking time counts from it. */
  readonly startedAt: number
  /** The turn's final answer, clipped. */
  readonly answer: string
  /** The user's reaction to the work, when it is re-learned for it. */
  readonly feedback?: LearnerFeedback
  /** One line per procedure already learned, or `(none)`. */
  readonly existing: string
  /** Full procedures of the capabilities this work may merge into. */
  readonly related: readonly string[]
}

/**
 * Estimated input tokens of one distillation request, the system prompt and the transcript together, at
 * `CHARS_PER_TOKEN` characters per token. The estimate ignores the provider's tokenizer and message
 * framing, so `maxInputTokens` bounds this estimate rather than the tokens the provider bills.
 * @param transcript - assembled transcript of one turn's work.
 * @returns estimated input tokens of the request.
 */
export function estimateDistillationTokens(transcript: string): number {
  return Math.ceil((PROMPT_CHARS + transcript.length) / CHARS_PER_TOKEN)
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function seconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`
}

/**
 * Timing of one turn: wall time, the share spent running tools, and the rest, which is the model thinking.
 * Parallel calls overlap, so tool time is the union of their running intervals.
 * @param work - the turn's work.
 * @param steps - its tool calls, bookkeeping excluded.
 * @returns one line for the distillation transcript.
 */
function timingOf(work: CompletedWork, steps: readonly WorkStep[]): string {
  const total = work.endedAt - work.startedAt
  const intervals = work.steps.flatMap(step => step.answeredAt === undefined ? [] : [[step.calledAt, step.answeredAt] as const]).sort((a, b) => a[0] - b[0])
  let tools = 0
  let reach = -Infinity
  for (const [start, end] of intervals) {
    const from = Math.max(start, reach)
    if (end > from) tools += end - from
    reach = Math.max(reach, end)
  }
  return `The work took ${seconds(total)} with ${steps.length} tool calls: about ${seconds(total - tools)} the assistant thinking between calls and ${seconds(tools)} running tools.`
}

function renderSteps(steps: readonly WorkStep[], startedAt: number, max: number, first: number): string[] {
  return steps.map((step, index) => {
    const previous = index === 0 ? undefined : steps[index - 1]
    const since = previous === undefined ? startedAt : previous.answeredAt ?? previous.calledAt
    const run = step.answeredAt === undefined ? '' : `, run ${seconds(step.answeredAt - step.calledAt)}`
    // A failed call keeps more of its result, because its error is what recovery advice is written from.
    const limit = step.failed ? Math.max(max, 600) : max
    return `${first + index + 1}. [think ${seconds(step.calledAt - since)}${run}] ${step.name} ${clip(step.input, limit)}\n   ${step.failed ? 'FAILED' : 'ok'}: ${clip(step.output ?? '(no result)', limit)}`
  })
}

function renderTranscript(transcript: Transcript, steps: readonly string[]): string {
  return [
    `<request>\n${transcript.request}\n</request>`,
    `<timing>\n${transcript.timing}\n</timing>`,
    `<tool_calls>\n${steps.join('\n')}\n</tool_calls>`,
    `<answer>\n${transcript.answer}\n</answer>`,
    ...transcript.feedback === undefined ? [] : [`<user_feedback kind="${transcript.feedback.kind}">\n${transcript.feedback.text}\n</user_feedback>`],
    `<existing_procedures>\n${transcript.existing}\n</existing_procedures>`,
    ...transcript.related,
  ].join('\n\n')
}

/**
 * Bound one distillation transcript to an input budget.
 *
 * Every call is first shortened, step by step, so the whole run stays visible: the calls that turned out not to be
 * needed are what the fast path is written from. Past the shortest form the oldest calls go, and the model is told
 * how many were left out. Text still above the budget keeps its beginning and ends with the cut marker, so the
 * transcript sent is never above the budget.
 * @param transcript - assembled sections of one turn's work.
 * @param maxInputTokens - input budget of one distillation, system prompt included.
 * @returns the transcript within the budget, and the number of oldest tool calls dropped from it.
 */
function boundTranscript(transcript: Transcript, maxInputTokens: number): { readonly text: string; readonly dropped: number } {
  const fits = (text: string): boolean => estimateDistillationTokens(text) <= maxInputTokens
  for (const max of STEP_CLIPS) {
    const text = renderTranscript(transcript, renderSteps(transcript.steps, transcript.startedAt, max, 0))
    if (fits(text)) return { text, dropped: 0 }
  }
  let dropped = 0
  const assembled = (): string => {
    const kept = transcript.steps.slice(dropped)
    const lines = renderSteps(kept, transcript.steps[dropped - 1]?.answeredAt ?? transcript.startedAt, SHORTEST_CLIP, dropped)
    return renderTranscript(transcript, dropped === 0 ? lines : [`(${dropped} older tool calls omitted to fit the learning input budget)`, ...lines])
  }
  while (dropped < transcript.steps.length && !fits(assembled())) dropped += 1
  const text = assembled()
  // Transcript characters left once the fixed system prompt is paid for.
  const room = Math.max(0, maxInputTokens * CHARS_PER_TOKEN - PROMPT_CHARS)
  if (text.length <= room) return { text, dropped }
  const cut = room >= CUT_MARKER.length ? `${text.slice(0, room - CUT_MARKER.length)}${CUT_MARKER}` : text.slice(0, room)
  return { text: cut, dropped }
}

const STOP_WORDS = new Set(['that', 'this', 'with', 'from', 'have', 'what', 'when', 'where', 'which', 'your', 'about', 'there', 'their', 'would', 'could', 'should', 'into', 'then', 'them', 'they', 'will', 'just', 'want', 'make', 'like', 'does', 'please'])

/**
 * Significant words of a text, for matching requests with capabilities.
 * @param text - any text.
 * @returns lower-case words of at least four letters, without common stop words.
 */
export function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !STOP_WORDS.has(word)))
}

/**
 * Words a request would share with a capability it matches.
 * @param record - the capability.
 * @returns words of its name, description, and originating request.
 */
export function capabilityWords(record: CapabilityRecord): Set<string> {
  return words(`${record.name.replaceAll('-', ' ')} ${record.description} ${record.origin?.request ?? ''}`)
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let count = 0
  for (const word of a) if (b.has(word)) count++
  return count
}

function parseDecision(text: string): Decision | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    // A reply that is not JSON carries no decision; the work is not learned from.
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record['decision'] === 'skip') return { decision: 'skip' }
  if (record['decision'] !== 'create' && record['decision'] !== 'update') return undefined
  const { name, description, content, domain, summary } = record
  if (typeof name !== 'string' || typeof description !== 'string' || typeof content !== 'string') return undefined
  if (!name.trim() || !description.trim() || !content.trim()) return undefined
  const kebab = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!kebab) return undefined
  return {
    decision: record['decision'],
    name: kebab,
    description: description.trim(),
    content: content.trim(),
    ...typeof domain === 'string' && (LEARNED_DOMAINS as readonly string[]).includes(domain) ? { domain: domain as MemoryDomain } : {},
    ...typeof summary === 'string' && summary.trim() ? { summary: summary.trim() } : {},
  }
}

/** Learns capabilities from the completed work of every live session this agent runs. */
export class CapabilityLearner {
  /** The latest learned work of each session, until the user's next message or the session's end. */
  private readonly recent = new Map<string, Recent>()
  /** Learning in flight, per owner, so one owner's distillations run one at a time. */
  private readonly owners = new Map<string, Promise<void>>()
  /** Learning in flight, per session, for a run that waits on it before ending the session. */
  private readonly sessions = new Map<string, Promise<void>>()
  private disposed = false
  private readonly logger: ReturnType<Context['logger']>

  /**
   * @param ctx - agent context with the capability registry and the LLM service.
   * @param config - learner configuration.
   */
  constructor(private readonly ctx: Context, private readonly config: LearnerConfig) {
    this.logger = ctx.logger('capability-learner')
  }

  /**
   * Consider one finished turn. Work that qualifies is learned from at once, in the background.
   * @param owner - account id of the session.
   * @param route - the session's model route.
   * @param work - the turn's work.
   * @param cwd - the session's workspace, when it has one.
   */
  offer(owner: string, route: LearnerRoute | undefined, work: CompletedWork, cwd?: string): void {
    this.recent.delete(work.sessionId)
    if (!this.qualifies(work)) return
    const resolved = this.config.provider !== undefined && this.config.model !== undefined
      ? { provider: this.config.provider, model: this.config.model }
      : route
    if (resolved === undefined) return
    const recent: Recent = { owner, route: resolved, work, ...cwd === undefined ? {} : { cwd } }
    this.recent.set(work.sessionId, recent)
    this.enqueue(recent)
  }

  /**
   * The user's next message arrived. Feedback on the previous turn re-learns its work with that feedback; any other
   * message ends the chance to refine it.
   * @param sessionId - the session.
   * @param feedback - the user's correction of, or complaint about the time of, the previous turn.
   */
  next(sessionId: string, feedback: LearnerFeedback | undefined): void {
    const recent = this.recent.get(sessionId)
    this.recent.delete(sessionId)
    if (recent !== undefined && feedback !== undefined) this.enqueue(recent, feedback)
  }

  /**
   * Forget a session that ended; learning already started still finishes.
   * @param sessionId - the session.
   */
  close(sessionId: string): void {
    this.recent.delete(sessionId)
  }

  /**
   * Wait for a session's learning in flight, because its owner is about to end it.
   * @param sessionId - the session.
   * @returns after learning from the session finished or failed.
   */
  async settle(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)
  }

  /** Stop learning: work not yet started is not learned from. */
  dispose(): void {
    this.disposed = true
    this.recent.clear()
  }

  private qualifies(work: CompletedWork): boolean {
    if (work.endReason !== 'completed' || !work.answer) return false
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name))
    if (steps.length < this.config.minSteps || steps.at(-1)?.failed === true) return false
    // Work that followed a learned capability is evidence for it; only work that had to recover teaches more.
    return work.loaded.length === 0 || steps.some(step => step.failed)
  }

  private enqueue(recent: Recent, feedback?: LearnerFeedback): void {
    const { owner, work } = recent
    // One distillation per owner at a time, so two sessions cannot create the same procedure twice.
    const previous = this.owners.get(owner) ?? Promise.resolve()
    const run = previous.then(async () => {
      if (this.disposed) return
      const learned = await this.learn(recent, feedback)
      if (learned !== undefined) recent.learned = learned
    }).catch((error: unknown) => {
      this.logger.warn(`learning from ${work.sessionId} turn ${work.turn} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.owners.set(owner, run)
    this.sessions.set(work.sessionId, run)
    void run.then(() => {
      if (this.owners.get(owner) === run) this.owners.delete(owner)
      if (this.sessions.get(work.sessionId) === run) this.sessions.delete(work.sessionId)
    })
  }

  private async learn(recent: Recent, feedback: LearnerFeedback | undefined): Promise<Recent['learned']> {
    if (this.config.store === 'memory') return this.learnIntoMemory(recent, feedback)
    const { owner, route, work } = recent
    const records = (await this.ctx.capabilities.list(owner)).filter(record => record.status !== 'retired')
    const requestWords = words(work.request)
    const learnedName = recent.learned?.name
    const related = [
      ...records.filter(record => record.name === learnedName || work.loaded.includes(record.name)),
      ...records
        .filter(record => record.name !== learnedName && !work.loaded.includes(record.name))
        .map(record => ({ record, score: overlap(requestWords, capabilityWords(record)) }))
        .filter(item => item.score >= 2)
        .sort((a, b) => b.score - a.score)
        .map(item => item.record),
    ].slice(0, MAX_RELATED)
    const relatedFull = await Promise.all(related.map(record => this.ctx.capabilities.get(owner, record.name)))
    const existingLines = records.slice(0, MAX_EXISTING).map(record => `- ${record.name}: ${record.description}`).join('\n') || '(none)'
    const decision = await this.distill(route, work, feedback, existingLines, relatedFull.filter(item => item !== undefined), SYSTEM)
    if (decision === undefined) return undefined
    if (decision.decision === 'skip') {
      this.logger.info(`nothing reusable in ${work.sessionId} turn ${work.turn}`)
      return undefined
    }
    const existing = await this.ctx.capabilities.get(owner, decision.name)
    // A capability the user or its own failures retired is not brought back by new work.
    if (existing?.status === 'retired') return undefined
    const draft = { name: decision.name, description: decision.description, content: decision.content }
    if (existing !== undefined) {
      const updated = await this.ctx.capabilities.save(owner, draft, { status: existing.status, source: existing.source, sessionId: work.sessionId })
      this.logger.info(`updated capability ${updated.name} to revision ${updated.revision} from ${work.sessionId} turn ${work.turn}`)
      return { name: updated.name }
    }
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name))
    const origin: CapabilityOrigin = {
      sessionId: work.sessionId,
      turn: work.turn,
      request: work.request.slice(0, 1_000),
      tools: steps.map(step => step.name),
      baseline: {
        durationMs: work.endedAt - work.startedAt,
        toolCalls: steps.length,
        failedToolCalls: steps.filter(step => step.failed).length,
        ...work.tokens === undefined ? {} : { tokens: work.tokens },
      },
    }
    const saved = await this.ctx.capabilities.save(owner, draft, { status: 'candidate', source: 'agent', sessionId: work.sessionId, origin })
    this.logger.info(`learned capability ${saved.name} from ${work.sessionId} turn ${work.turn}`)
    return { name: saved.name }
  }

  /**
   * Learn into long-term memory: look up the procedures memory already holds for the work, distill the work
   * against them, and store the result as a memory. A procedure the work improves is replaced rather than kept
   * beside its newer version.
   * @param recent - the work to learn from, with the procedure it was already learned into.
   * @param feedback - the user's reaction to the work, when it is re-learned for it.
   * @returns the procedure stored, or undefined when the work taught nothing.
   */
  private async learnIntoMemory(recent: Recent, feedback: LearnerFeedback | undefined): Promise<Recent['learned']> {
    const { owner, route, work, cwd } = recent
    const signal = AbortSignal.timeout(this.config.timeoutMs)
    const scope: MemoryScope = {
      owner,
      sessionId: work.sessionId as SessionId,
      ...cwd === undefined ? {} : { cwd },
      route: { provider: route.provider, model: route.model },
    }
    const known = await findLearnedProcedures(this.ctx, scope, `${work.request}\n\n${work.answer.slice(0, 600)}`, signal)
    // The procedure this work was already learned into is the one feedback refines, whether or not recall finds it.
    const learned = recent.learned
    if (learned?.id !== undefined && !known.some(item => item.id === learned.id)) {
      const detail = await this.ctx.memory.detail({ scope, kind: 'trace', id: learned.id, signal })
      if (detail !== undefined) known.unshift({ id: learned.id, name: learned.name, summary: detail.title, body: detail.body } satisfies LearnedProcedure)
    }
    const existing = known.slice(0, MAX_EXISTING).map(item => `- ${item.name}: ${item.summary}`).join('\n') || '(none)'
    const related = known.filter(item => item.body !== undefined).map(item => ({ name: item.name, description: item.summary, content: item.body ?? '' }))
    const decision = await this.distill(route, work, feedback, existing, related, MEMORY_SYSTEM)
    if (decision === undefined) return undefined
    if (decision.decision === 'skip') {
      this.logger.info(`nothing reusable in ${work.sessionId} turn ${work.turn}`)
      return undefined
    }
    const domain: MemoryDomain = decision.domain === 'project' && cwd === undefined ? 'experience' : decision.domain ?? 'experience'
    const replaced = known.filter(item => item.name === decision.name).map(item => item.id)
    const id = await storeLearnedProcedure(this.ctx, scope, {
      name: decision.name,
      description: decision.description,
      content: decision.content,
      summary: decision.summary ?? `${decision.description} ${decision.content}`,
      domain,
    }, signal)
    await forgetLearnedProcedures(this.ctx, owner, replaced, signal)
    this.logger.info(`learned procedure ${decision.name} into ${domain} memory ${id} from ${work.sessionId} turn ${work.turn}${feedback === undefined ? '' : ` with the user's ${feedback.kind} feedback`}${replaced.length > 0 ? `, replacing ${replaced.join(', ')}` : ''}`)
    return { name: decision.name, id }
  }

  private async distill(route: LearnerRoute, work: CompletedWork, feedback: LearnerFeedback | undefined, existing: string, related: readonly { name: string; description: string; content: string }[], system: string): Promise<Decision | undefined> {
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name))
    const { text, dropped } = boundTranscript({
      request: work.request,
      timing: timingOf(work, steps),
      steps,
      startedAt: work.startedAt,
      answer: work.answer.slice(0, 4_000),
      ...feedback === undefined ? {} : { feedback: { kind: feedback.kind, text: feedback.text.slice(0, 2_000) } },
      existing,
      related: related.map(procedure => `<procedure name="${procedure.name}">\n${procedure.description}\n\n${procedure.content}\n</procedure>`),
    }, this.config.maxInputTokens)
    if (dropped > 0) this.logger.info(`learning from ${work.sessionId} turn ${work.turn} omitted ${dropped} older tool calls to stay within ${this.config.maxInputTokens} input tokens`)
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'tool-capability' } })],
      maxTokens: this.config.maxOutputTokens,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })) assembler.push(chunk)
    const reply = assembler.blocks().map(block => block.type === 'text' ? block.text : '').join('')
    const decision = parseDecision(reply)
    if (decision === undefined) this.logger.warn(`learning from ${work.sessionId} turn ${work.turn} returned no decision: ${reply.slice(0, 200)}`)
    return decision
  }
}
