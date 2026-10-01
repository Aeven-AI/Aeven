/**
 * Automatic capability learning. Completed work that looks like a reusable procedure is held until the user's
 * next message shows it was not corrected, then a background model call distills it into a candidate
 * capability or merges it into an existing one. Nobody is asked; the registry's evidence rules validate the
 * result when it is next used.
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@aeven/llm'
import type { CapabilityOrigin, CapabilityRecord } from '@aeven/capability'
import type { CompletedWork } from './executions.ts'

/** Learner configuration. */
export interface LearnerConfig {
  /** Tool calls a turn needs, excluding capability and skill bookkeeping, before its work is considered. */
  readonly minSteps: number
  /** Milliseconds a finished turn waits for a correction before it is learned from without one. */
  readonly settleMs: number
  /** Budget of one distillation model call, in milliseconds. */
  readonly timeoutMs: number
  /** Output token limit of one distillation. */
  readonly maxOutputTokens: number
  /** Input token budget of one distillation; a transcript beyond it is cut down to its newest evidence. */
  readonly maxInputTokens: number
  /** Explicit distillation route; absent uses the session's own route. Set together with `model`. */
  readonly provider?: string
  readonly model?: string
}

/** Model route of one session's requests. */
export interface LearnerRoute {
  readonly provider: string
  readonly model: string
}

interface Pending {
  readonly owner: string
  readonly route: LearnerRoute
  readonly work: CompletedWork
  readonly timer: ReturnType<typeof setTimeout>
}

type Decision =
  | { readonly decision: 'skip' }
  | { readonly decision: 'create' | 'update'; readonly name: string; readonly description: string; readonly content: string }

/** Tool calls that record bookkeeping rather than doing the work. */
const BOOKKEEPING = /^(?:skill|capability_manage|todo_write|memory_[a-z_]+|ask_user(?:_question)?)$/

const MAX_EXISTING = 40
const MAX_RELATED = 2

/**
 * Characters per token in the fixed text-density estimate of the input budget. The provider's own
 * tokenizer is not run, so the budget bounds this estimate rather than billed tokens.
 */
const CHARS_PER_TOKEN = 4

/** Marks where a transcript longer than the input budget was cut. */
const CUT_MARKER = '…[transcript cut to the learning input budget]'

/**
 * Smallest input budget a learning call accepts. It stays above the fixed system prompt of about 423
 * estimated tokens, so a transcript bounded to any accepted budget still leaves that prompt room.
 */
export const MIN_INPUT_TOKENS = 1_000

const SYSTEM = `You maintain the reusable procedures (capabilities) an assistant learned for one user. You receive one completed piece of work: the user's request, the tool calls that did it with their results, and the final answer. Decide whether it contains a procedure worth reusing, and write it.

Learn a procedure from the first successful multi-step operational task: setup, build, release, deployment, data or file processing, reporting, diagnosis, and similar work that took several tool calls. Learn it even when the work went smoothly, because the next time the exploration is skipped; work that needed retries, dead ends, or a correction is the most valuable. Skip one-off questions, explanations, conversation, facts about the user, and work that failed.

When the work repeats or improves one of the existing capabilities, update that capability: return its exact name and the complete merged procedure, keeping what still holds and fixing what the work showed to be wrong. Otherwise create a new one.

Write the procedure so another session can follow it without this conversation, in Markdown with these sections: "When to use", "Requirements", "Steps" (numbered, with the exact commands, paths, settings, and tool parameters that worked; replace values that vary between uses with named placeholders), "Verification" (observable success criteria), and "Recovery" (known failures and their fixes, from the work). Do not include the dead ends except as recovery advice.

Reply with one JSON object and nothing else:
{"decision":"skip"}
or
{"decision":"create" or "update","name":"kebab-case-name","description":"One line: what it does and when to use it.","content":"The Markdown procedure."}`

/** One distillation request: the fixed system prompt and the transcript of the work. */
interface Transcript {
  /** The turn's request, verbatim. */
  readonly request: string
  /** One rendered line per tool call, oldest first. */
  readonly steps: readonly string[]
  /** The turn's final answer, clipped. */
  readonly answer: string
  /** One line per existing capability, or `(none)`. */
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
  return Math.ceil((SYSTEM.length + transcript.length) / CHARS_PER_TOKEN)
}

function renderTranscript(transcript: Transcript): string {
  return [
    `<request>\n${transcript.request}\n</request>`,
    `<tool_calls>\n${transcript.steps.join('\n')}\n</tool_calls>`,
    `<answer>\n${transcript.answer}\n</answer>`,
    `<existing_capabilities>\n${transcript.existing}\n</existing_capabilities>`,
    ...transcript.related,
  ].join('\n\n')
}

/**
 * Bound one distillation transcript to an input budget.
 *
 * The oldest tool calls go first, and the model is told how many were left out, because a procedure is
 * written from the request, the newest calls, and the answer. Text still above the budget keeps its
 * beginning and ends with the cut marker, so the fixed system prompt and the newest evidence survive and
 * the transcript sent is never above the budget.
 * @param transcript - assembled sections of one turn's work.
 * @param maxInputTokens - input budget of one distillation, system prompt included.
 * @returns the transcript within the budget, and the number of oldest tool calls dropped from it.
 */
function boundTranscript(transcript: Transcript, maxInputTokens: number): { readonly text: string; readonly dropped: number } {
  let steps = transcript.steps
  let dropped = 0
  const assembled = (): string => renderTranscript({
    ...transcript,
    steps: dropped === 0 ? steps : [`(${dropped} older tool calls omitted to fit the learning input budget)`, ...steps],
  })
  while (steps.length > 0 && estimateDistillationTokens(assembled()) > maxInputTokens) {
    steps = steps.slice(1)
    dropped += 1
  }
  const text = assembled()
  // Transcript characters left once the fixed system prompt is paid for.
  const room = Math.max(0, maxInputTokens * CHARS_PER_TOKEN - SYSTEM.length)
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
  const { name, description, content } = record
  if (typeof name !== 'string' || typeof description !== 'string' || typeof content !== 'string') return undefined
  if (!name.trim() || !description.trim() || !content.trim()) return undefined
  return { decision: record['decision'], name: name.trim(), description: description.trim(), content: content.trim() }
}

/** Learns capabilities from the completed work of every live session this agent runs. */
export class CapabilityLearner {
  private readonly pending = new Map<string, Pending>()
  private readonly owners = new Map<string, Promise<void>>()
  private readonly logger: ReturnType<Context['logger']>

  /**
   * @param ctx - agent context with the capability registry and the LLM service.
   * @param config - learner configuration.
   */
  constructor(private readonly ctx: Context, private readonly config: LearnerConfig) {
    this.logger = ctx.logger('capability-learner')
  }

  /**
   * Consider one finished turn. Work that qualifies waits for the user's next message or `settleMs`.
   * @param owner - account id of the session.
   * @param route - the session's model route.
   * @param work - the turn's work.
   */
  offer(owner: string, route: LearnerRoute | undefined, work: CompletedWork): void {
    void this.flush(work.sessionId)
    if (!this.qualifies(work)) return
    const resolved = this.config.provider !== undefined && this.config.model !== undefined
      ? { provider: this.config.provider, model: this.config.model }
      : route
    if (resolved === undefined) return
    const timer = setTimeout(() => { void this.flush(work.sessionId) }, this.config.settleMs)
    timer.unref?.()
    this.pending.set(work.sessionId, { owner, route: resolved, work, timer })
  }

  /**
   * The user's next message arrived: a correction discards the held work, anything else releases it.
   * @param sessionId - the session.
   * @param corrected - whether the message corrects the previous answer.
   */
  next(sessionId: string, corrected: boolean): void {
    if (corrected) this.drop(sessionId)
    else void this.flush(sessionId)
  }

  /**
   * Release held work of a session that ended.
   * @param sessionId - the session.
   */
  close(sessionId: string): void {
    void this.flush(sessionId)
  }

  /**
   * Learn from a session's held work now and wait for it, because its owner is about to end it.
   * @param sessionId - the session.
   * @returns after learning from the session finished or failed.
   */
  async settle(sessionId: string): Promise<void> {
    await this.flush(sessionId)
  }

  /** Stop every timer; held work is discarded. */
  dispose(): void {
    for (const sessionId of [...this.pending.keys()]) this.drop(sessionId)
  }

  private qualifies(work: CompletedWork): boolean {
    if (work.endReason !== 'completed' || !work.answer) return false
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name))
    if (steps.length < this.config.minSteps || steps.at(-1)?.failed === true) return false
    // Work that followed a learned capability is evidence for it; only work that had to recover teaches more.
    return work.loaded.length === 0 || steps.some(step => step.failed)
  }

  private drop(sessionId: string): void {
    const held = this.pending.get(sessionId)
    if (held === undefined) return
    clearTimeout(held.timer)
    this.pending.delete(sessionId)
  }

  private flush(sessionId: string): Promise<void> {
    const held = this.pending.get(sessionId)
    if (held === undefined) return Promise.resolve()
    this.drop(sessionId)
    // One distillation per owner at a time, so two sessions cannot create the same capability twice.
    const previous = this.owners.get(held.owner) ?? Promise.resolve()
    const run = previous.then(() => this.learn(held)).catch((error: unknown) => {
      this.logger.warn(`learning from ${held.work.sessionId} turn ${held.work.turn} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.owners.set(held.owner, run)
    return run.then(() => {
      if (this.owners.get(held.owner) === run) this.owners.delete(held.owner)
    })
  }

  private async learn({ owner, route, work }: Pending): Promise<void> {
    const records = (await this.ctx.capabilities.list(owner)).filter(record => record.status !== 'retired')
    const requestWords = words(work.request)
    const related = [
      ...records.filter(record => work.loaded.includes(record.name)),
      ...records
        .filter(record => !work.loaded.includes(record.name))
        .map(record => ({ record, score: overlap(requestWords, capabilityWords(record)) }))
        .filter(item => item.score >= 2)
        .sort((a, b) => b.score - a.score)
        .map(item => item.record),
    ].slice(0, MAX_RELATED)
    const relatedFull = await Promise.all(related.map(record => this.ctx.capabilities.get(owner, record.name)))
    const decision = await this.distill(route, work, records, relatedFull.filter(item => item !== undefined))
    if (decision === undefined) return
    if (decision.decision === 'skip') {
      this.logger.info(`nothing reusable in ${work.sessionId} turn ${work.turn}`)
      return
    }
    const existing = await this.ctx.capabilities.get(owner, decision.name)
    // A capability the user or its own failures retired is not brought back by new work.
    if (existing?.status === 'retired') return
    const draft = { name: decision.name, description: decision.description, content: decision.content }
    if (existing !== undefined) {
      const updated = await this.ctx.capabilities.save(owner, draft, { status: existing.status, source: existing.source, sessionId: work.sessionId })
      this.logger.info(`updated capability ${updated.name} to revision ${updated.revision} from ${work.sessionId} turn ${work.turn}`)
      return
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
  }

  private async distill(route: LearnerRoute, work: CompletedWork, records: readonly CapabilityRecord[], related: readonly { name: string; description: string; content: string }[]): Promise<Decision | undefined> {
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name)).map((step, index) =>
      `${index + 1}. ${step.name} ${step.input}\n   ${step.failed ? 'FAILED' : 'ok'}: ${step.output ?? '(no result)'}`)
    const { text, dropped } = boundTranscript({
      request: work.request,
      steps,
      answer: work.answer.slice(0, 4_000),
      existing: records.slice(0, MAX_EXISTING).map(record => `- ${record.name}: ${record.description}`).join('\n') || '(none)',
      related: related.map(capability => `<capability name="${capability.name}">\n${capability.description}\n\n${capability.content}\n</capability>`),
    }, this.config.maxInputTokens)
    if (dropped > 0) this.logger.info(`learning from ${work.sessionId} turn ${work.turn} omitted ${dropped} older tool calls to stay within ${this.config.maxInputTokens} input tokens`)
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM,
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
