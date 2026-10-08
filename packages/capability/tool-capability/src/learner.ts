/**
 * Automatic learning. Completed work that looks like a reusable procedure is held until the user's next message
 * shows it was not corrected, then a background model call distills it into a procedure or merges it into one
 * already learned. Nobody is asked. With `store: 'memory'` the procedure is a long-term memory that memory recall
 * brings back when a request needs it; with `store: 'capabilities'` it is a candidate capability that the
 * registry's evidence rules validate when it is next used.
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@aeven/llm'
import type { CapabilityOrigin, CapabilityRecord } from '@aeven/capability'
import type { MemoryDomain, MemoryScope } from '@aeven/memory'
import type { SessionId } from '@aeven/session/types'
import type { CompletedWork } from './executions.ts'
import { findLearnedProcedures, forgetLearnedProcedures, LEARNED_DOMAINS, storeLearnedProcedure } from './memory-learning.ts'

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
  /** Where a learned procedure is kept: long-term memory, or the capability registry. */
  readonly store: 'memory' | 'capabilities'
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
  /** The session's workspace, which a project procedure is filed under. */
  readonly cwd?: string
  readonly timer: ReturnType<typeof setTimeout>
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
 * Smallest input budget a learning call accepts. It stays above the longer fixed system prompt of about 583
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

/** Distillation prompt when learned procedures are kept in long-term memory. */
const MEMORY_SYSTEM = `You maintain the know-how an assistant learned for one user, kept in its long-term memory and recalled when a later request needs it. You receive one completed piece of work: the user's request, the tool calls that did it with their results, and the final answer. Decide whether it taught a procedure worth remembering, and write it.

Learn from successful multi-step operational work: how an application or tool does something (for example how to do a task in Ableton, Figma, or a CLI), setup, build, release, deployment, data or file processing, reporting, diagnosis, and similar work that took several tool calls. Learn it even when the work went smoothly, because next time the exploration is skipped; work that needed retries, dead ends, or a correction is the most valuable. Skip one-off questions, explanations, conversation, facts about the user, and work that failed.

When the work repeats or improves one of the procedures already learned, update it: return its exact name and the complete merged procedure, keeping what still holds and fixing what the work showed to be wrong. Otherwise create a new one.

Write "content" so another session can follow it without this conversation, in Markdown with these sections: "When to use", "Requirements", "Steps" (numbered, with the exact commands, paths, settings, menu items, and tool parameters that worked; replace values that vary between uses with named placeholders), "Verification" (observable success criteria), and "Recovery" (known failures and their fixes, from the work). Do not include the dead ends except as recovery advice.

Write "summary" as the procedure condensed to at most 800 characters that can be followed on its own: the trigger, then the essential steps with their exact commands or settings, then the check.

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
  /** One rendered line per tool call, oldest first. */
  readonly steps: readonly string[]
  /** The turn's final answer, clipped. */
  readonly answer: string
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

function renderTranscript(transcript: Transcript): string {
  return [
    `<request>\n${transcript.request}\n</request>`,
    `<tool_calls>\n${transcript.steps.join('\n')}\n</tool_calls>`,
    `<answer>\n${transcript.answer}\n</answer>`,
    `<existing_procedures>\n${transcript.existing}\n</existing_procedures>`,
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
   * @param cwd - the session's workspace, when it has one.
   */
  offer(owner: string, route: LearnerRoute | undefined, work: CompletedWork, cwd?: string): void {
    void this.flush(work.sessionId)
    if (!this.qualifies(work)) return
    const resolved = this.config.provider !== undefined && this.config.model !== undefined
      ? { provider: this.config.provider, model: this.config.model }
      : route
    if (resolved === undefined) return
    const timer = setTimeout(() => { void this.flush(work.sessionId) }, this.config.settleMs)
    timer.unref?.()
    this.pending.set(work.sessionId, { owner, route: resolved, work, ...cwd === undefined ? {} : { cwd }, timer })
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

  private async learn(held: Pending): Promise<void> {
    if (this.config.store === 'memory') return this.learnIntoMemory(held)
    const { owner, route, work } = held
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
    const existingLines = records.slice(0, MAX_EXISTING).map(record => `- ${record.name}: ${record.description}`).join('\n') || '(none)'
    const decision = await this.distill(route, work, existingLines, relatedFull.filter(item => item !== undefined), SYSTEM)
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

  /**
   * Learn into long-term memory: look up the procedures memory already holds for the request, distill the work
   * against them, and store the result as a memory. A procedure the work improves is replaced rather than kept
   * beside its newer version.
   * @param held - the work to learn from.
   */
  private async learnIntoMemory({ owner, route, work, cwd }: Pending): Promise<void> {
    const signal = AbortSignal.timeout(this.config.timeoutMs)
    const scope: MemoryScope = {
      owner,
      sessionId: work.sessionId as SessionId,
      ...cwd === undefined ? {} : { cwd },
      route: { provider: route.provider, model: route.model },
    }
    const known = await findLearnedProcedures(this.ctx, scope, work.request, signal)
    const existing = known.slice(0, MAX_EXISTING).map(item => `- ${item.name}: ${item.summary}`).join('\n') || '(none)'
    const related = known.filter(item => item.body !== undefined).map(item => ({ name: item.name, description: item.summary, content: item.body ?? '' }))
    const decision = await this.distill(route, work, existing, related, MEMORY_SYSTEM)
    if (decision === undefined) return
    if (decision.decision === 'skip') {
      this.logger.info(`nothing reusable in ${work.sessionId} turn ${work.turn}`)
      return
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
    this.logger.info(`learned procedure ${decision.name} into ${domain} memory ${id} from ${work.sessionId} turn ${work.turn}${replaced.length > 0 ? `, replacing ${replaced.join(', ')}` : ''}`)
  }

  private async distill(route: LearnerRoute, work: CompletedWork, existing: string, related: readonly { name: string; description: string; content: string }[], system: string): Promise<Decision | undefined> {
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name)).map((step, index) =>
      `${index + 1}. ${step.name} ${step.input}\n   ${step.failed ? 'FAILED' : 'ok'}: ${step.output ?? '(no result)'}`)
    const { text, dropped } = boundTranscript({
      request: work.request,
      steps,
      answer: work.answer.slice(0, 4_000),
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
