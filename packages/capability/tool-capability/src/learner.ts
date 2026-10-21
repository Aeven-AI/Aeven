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
import type { LearnedProcedure, MemoryDomain, MemoryItemId, MemoryScope, ProcedureStatus } from '@aeven/memory'
import type { SessionId } from '@aeven/session/types'
import type { CompletedWork, WorkInstruction, WorkStep } from './executions.ts'
import { forgetLearnedProcedures, LEARNED_DOMAINS, recallLearnedNames, storeLearnedProcedure } from './memory-learning.ts'

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
  /**
   * Memory store only: distinct learned procedures a session sees above which the procedures of one kind of task
   * are merged in the background, once per owner and workspace per process; zero never merges.
   */
  readonly consolidateAbove: number
  /**
   * Memory store only: days a `candidate` procedure waits for confirming work before it is archived; archived
   * procedures are kept for restoring and are neither recalled nor merged into.
   */
  readonly candidateTtlDays: number
}

/** Model route of one session's requests. */
export interface LearnerRoute {
  readonly provider: string
  readonly model: string
}

/** The user's reaction to learned work, in their words. */
export interface LearnerFeedback {
  /**
   * `correction` and `slowness` are recognized reactions to the work; `reply` is any other next message, which the
   * distillation reads for acceptance or rejection.
   */
  readonly kind: 'correction' | 'slowness' | 'reply'
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
    /** Memory store only: other listed procedures this one now covers, which are forgotten. */
    readonly replaces?: readonly string[]
  }

/** Tool calls that record bookkeeping rather than doing the work. */
const BOOKKEEPING = /^(?:skill|capability_manage|todo_write|memory_[a-z_]+|ask_user(?:_question)?|tool_search|job_output)$/

const MAX_EXISTING = 40
const MAX_RELATED = 2

/** Learned procedures, one line each, the memory-store distillation chooses among. */
const MAX_EXISTING_PROCEDURES = 120

/** Learned procedures whose full text the memory-store distillation reads. */
const MAX_RELATED_PROCEDURES = 3

/** Characters of one listed procedure's description. */
const EXISTING_LINE_CHARS = 160

/** Characters of one related procedure's full text in a memory-store distillation. */
const RELATED_PROCEDURE_CHARS = 6_000

/** Procedures one grouping call sorts; it bounds the call's reply, which names every grouped procedure. */
const GROUP_BATCH = 150

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

<user_feedback> is what the user said next, after the work. A correction means the procedure must change to avoid what they corrected. A complaint about time means the fast path must cut what took the time. With kind "reply", read it as their reaction: when it rejects, disputes, or contradicts the answer, the work did not succeed — skip it.

Never learn from a conversation about the user's own life: relationships, family, feelings, health, money, or how to talk with them, even when it used tools such as reading messages, mail, or files. How to be with this person is not a procedure. Also skip: failures caused by the environment (a missing binary, credentials, an uninstalled package), which the user can fix and which would harden into false rules; negative claims about tools ("X does not work"); transient errors that resolved; one-off tasks that are not a class of work; and work that ended without a method that actually worked.

Lines in <tool_calls> starting "USER (during the work):" are what the user said while the work ran, placed after the calls that preceded them. Each is a requirement of the procedure from its first step: a call that went against one, such as a test run after "no tests", or browser measuring and screenshots after "just make the change", goes under "Avoid", never in the fast path. Repeated complaints or impatience mean the fast path must be far shorter. Tests, browser inspection, screenshots, and measurements belong in the fast path only when the user asked for them.

Name a procedure after the kind of task, not this instance (for example "aeven-client-ui-change", not "rename-clear-history-button"). When an existing procedure covers the same kind of task, even with a different instance, update it: return its exact name and the complete merged procedure, keeping what still holds, fixing what the work showed to be wrong, and folding this instance in as an example. Create a new one only for a different kind of task.`

/** How a memory-store procedure chooses its domain. */
const DOMAIN_RULE = 'Choose "domain": "world" when it is how an application, tool, service, or environment works and applies in any project; "project" when it only applies to the current workspace\'s code or files; "experience" for other reusable know-how.'

/** Sections every written procedure has. */
const PROCEDURE_SECTIONS = 'in Markdown with these sections: "Fast path" (the minimal numbered sequence of calls for this kind of task, and a short "Avoid" list of the time sinks), "When to use", "Requirements" (including the user\'s preferences), "Steps" (numbered, with the exact commands, paths, settings, menu items, and tool parameters that worked; replace values that vary between uses with named placeholders), "Verification" (observable success criteria, no heavier than the user asked for), and "Recovery" (known failures and their fixes, from the work). Do not include the dead ends except under "Avoid" or "Recovery".'

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

${DOMAIN_RULE}

When the procedure you write now covers other procedures in <existing_procedures> that are the same kind of task, list their exact names in "replaces"; they are forgotten in favour of this one.

Reply with one JSON object and nothing else:
{"decision":"skip"}
or
{"decision":"create" or "update","name":"kebab-case-name","description":"One line: what it does and when to use it.","domain":"world" or "project" or "experience","summary":"The condensed procedure.","content":"The Markdown procedure.","replaces":["other-procedure-name"]}`

/** How grouping finds the learned procedures that are one kind of task. */
const GROUP_SYSTEM = `You maintain the procedures an assistant learned for one user. Each line of <procedures> is one procedure: its name and what it does. Many were learned separately from single instances of the same kind of task. Group the procedures that cover the same kind of task so each group can be merged into one procedure; for example "app-button-color-tweak", "settings-focus-style", and "ui-typography-change" in one repository are one kind of task, changing the styling of that application's UI. Keep different kinds of task apart, even within one application or repository. Name each group after its kind of task, in kebab case.

Reply with one JSON object and nothing else, listing only groups of two or more procedures, each procedure in at most one group, with the exact names from <procedures>:
{"groups":[{"name":"kebab-case-name","members":["procedure-name","procedure-name"]}]}`

/** How one group of learned procedures is merged. */
const MERGE_SYSTEM = `You maintain the know-how an assistant learned for one user, kept in its long-term memory and recalled when a later request needs it. You receive several procedures learned separately for the same kind of task, newest first, and the name of the kind of task. Merge them into one procedure under that name that another session can follow without the original conversations: keep every step, file, command, setting, user preference, and recovery that still holds, drop repetition, settle contradictions in favour of the newest procedure, and keep the instances as short examples. The purpose is speed: the "Fast path" must be the fewest calls that do this kind of task.

Write "content" ${PROCEDURE_SECTIONS}

Write "summary" as the procedure condensed to at most 800 characters that can be followed on its own, because recall shows only the summary: start with the fast path (the minimal steps with their exact commands, files, or settings), then the time sinks to avoid and the user's preferences, then the check.

${DOMAIN_RULE}

Reply with one JSON object and nothing else:
{"decision":"create","name":"kebab-case-name","description":"One line: what it does and when to use it.","domain":"world" or "project" or "experience","summary":"The condensed procedure.","content":"The Markdown procedure."}`

/** Characters of the longest learning prompt, which every input budget is measured against. */
const PROMPT_CHARS = Math.max(SYSTEM.length, MEMORY_SYSTEM.length, GROUP_SYSTEM.length, MERGE_SYSTEM.length)

/** One distillation request: the fixed system prompt and the transcript of the work. */
interface Transcript {
  /** The turn's request, verbatim. */
  readonly request: string
  /** How long the work took, one line. */
  readonly timing: string
  /** The turn's tool calls, oldest first, bookkeeping excluded. */
  readonly steps: readonly WorkStep[]
  /** Direct-user messages that arrived while the work ran, rendered between the calls they followed. */
  readonly instructions: readonly WorkInstruction[]
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
  const intervals = work.steps
    .flatMap(step => step.answeredAt === undefined ? [] : [[step.calledAt, step.answeredAt] as const])
    .sort((a, b) => a[0] - b[0])
  let tools = 0
  let reach = -Infinity
  for (const [start, end] of intervals) {
    const from = Math.max(start, reach)
    if (end > from) tools += end - from
    reach = Math.max(reach, end)
  }
  return `The work took ${seconds(total)} with ${steps.length} tool calls: about ${seconds(total - tools)} the assistant thinking between calls and ${seconds(tools)} running tools.`
}

function instructionLine(instruction: WorkInstruction): string {
  return `USER (during the work): ${clip(instruction.text, 1_000)}`
}

function renderSteps(
  steps: readonly WorkStep[], startedAt: number, max: number, first: number, instructions: readonly WorkInstruction[],
): string[] {
  const lines: string[] = []
  const pending = [...instructions]
  steps.forEach((step, index) => {
    while (pending[0] !== undefined && pending[0].at <= step.calledAt) {
      const instruction = pending.shift()
      if (instruction !== undefined) lines.push(instructionLine(instruction))
    }
    const previous = index === 0 ? undefined : steps[index - 1]
    const since = previous === undefined ? startedAt : previous.answeredAt ?? previous.calledAt
    const run = step.answeredAt === undefined ? '' : `, run ${seconds(step.answeredAt - step.calledAt)}`
    // A failed call keeps more of its result, because its error is what recovery advice is written from.
    const limit = step.failed ? Math.max(max, 600) : max
    lines.push(`${first + index + 1}. [think ${seconds(step.calledAt - since)}${run}] ${step.name} ${clip(step.input, limit)}\n   ${step.failed ? 'FAILED' : 'ok'}: ${clip(step.output ?? '(no result)', limit)}`)
  })
  lines.push(...pending.map(instructionLine))
  return lines
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
    const text = renderTranscript(transcript, renderSteps(transcript.steps, transcript.startedAt, max, 0, transcript.instructions))
    if (fits(text)) return { text, dropped: 0 }
  }
  let dropped = 0
  const assembled = (): string => {
    const kept = transcript.steps.slice(dropped)
    const since = transcript.steps[dropped - 1]?.answeredAt ?? transcript.startedAt
    const lines = renderSteps(kept, since, SHORTEST_CLIP, dropped, transcript.instructions)
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

/**
 * The newest procedure under each name.
 * @param procedures - procedures, newest first.
 * @returns the procedures by name.
 */
const DAY_MS = 86_400_000

/**
 * Status of a procedure written from new work. Writing never proves a procedure: it is `active` only when it replaces
 * an active procedure without a correction and keeps most of that procedure's steps. Anything new, corrected, or
 * materially rewritten is a `candidate`, which memory recall promotes once it informs work the user does not correct.
 * @param previous - the stored procedures the new one replaces.
 * @param content - the new procedure's Markdown.
 * @param feedback - the user's next message after the work.
 * @returns the status to store.
 */
function procedureStatusAfter(
  previous: readonly LearnedProcedure[],
  content: string,
  feedback: LearnerFeedback | undefined,
): ProcedureStatus {
  if (feedback?.kind === 'correction') return 'candidate'
  const active = previous.find(procedure => procedure.status === 'active')
  return active !== undefined && sameSteps(active.content, content) ? 'active' : 'candidate'
}

/** Share of the earlier procedure's step lines a rewrite must keep to stay proven. */
const KEPT_STEPS = 0.6

/**
 * Whether a rewrite keeps most of a procedure's steps, compared by normalized line.
 * @param before - the earlier procedure's Markdown.
 * @param after - the rewrite.
 * @returns true when at least {@link KEPT_STEPS} of the earlier lines remain.
 */
function sameSteps(before: string, after: string): boolean {
  const lines = (text: string): Set<string> => new Set(text.split('\n').map(line => line.replace(/\s+/g, ' ').trim().toLowerCase()).filter(line => line.length > 8))
  const earlier = lines(before)
  if (earlier.size === 0) return false
  const later = lines(after)
  let kept = 0
  for (const line of earlier) if (later.has(line)) kept++
  return kept / earlier.size >= KEPT_STEPS
}

function latestByName(procedures: readonly LearnedProcedure[]): Map<string, LearnedProcedure> {
  const latest = new Map<string, LearnedProcedure>()
  for (const procedure of procedures) if (!latest.has(procedure.name)) latest.set(procedure.name, procedure)
  return latest
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
  const { name, description, content, domain, summary, replaces } = record
  if (typeof name !== 'string' || typeof description !== 'string' || typeof content !== 'string') return undefined
  if (!name.trim() || !description.trim() || !content.trim()) return undefined
  const kebab = kebabName(name)
  if (!kebab) return undefined
  const covered = Array.isArray(replaces) ? replaces.flatMap(item => typeof item === 'string' && kebabName(item) ? [kebabName(item)] : []) : []
  return {
    decision: record['decision'],
    name: kebab,
    description: description.trim(),
    content: content.trim(),
    ...typeof domain === 'string' && (LEARNED_DOMAINS as readonly string[]).includes(domain) ? { domain: domain as MemoryDomain } : {},
    ...typeof summary === 'string' && summary.trim() ? { summary: summary.trim() } : {},
    ...covered.length === 0 ? {} : { replaces: covered },
  }
}

function kebabName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** One group of learned procedures to merge, as a grouping call returned it. */
interface ProcedureGroup {
  readonly name: string
  readonly members: readonly string[]
}

function parseGroups(text: string, names: ReadonlySet<string>): ProcedureGroup[] | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    // A reply that is not JSON groups nothing; these procedures stay as they are.
    return undefined
  }
  const groups = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)['groups'] : undefined
  if (!Array.isArray(groups)) return undefined
  const taken = new Set<string>()
  return groups.flatMap((group: unknown) => {
    if (group === null || typeof group !== 'object') return []
    const { name, members } = group as Record<string, unknown>
    if (typeof name !== 'string' || !kebabName(name) || !Array.isArray(members)) return []
    const kept = members.filter((member): member is string => typeof member === 'string' && names.has(member) && !taken.has(member))
    const distinct = [...new Set(kept)]
    if (distinct.length < 2) return []
    for (const member of distinct) taken.add(member)
    return [{ name: kebabName(name), members: distinct }]
  })
}

/** Learns capabilities from the completed work of every live session this agent runs. */
export class CapabilityLearner {
  /** The latest learned work of each session, until the user's next message or the session's end. */
  private readonly recent = new Map<string, Recent>()
  /** Learning in flight, per owner, so one owner's distillations run one at a time. */
  private readonly owners = new Map<string, Promise<void>>()
  /** Learning in flight, per session, for a run that waits on it before ending the session. */
  private readonly sessions = new Map<string, Promise<void>>()
  /** Merges of learned procedures in flight, per owner, run one at a time beside that owner's learning. */
  private readonly merges = new Map<string, Promise<void>>()
  /** Owner and workspace pairs whose procedures were grouped for merging in this process. */
  private readonly consolidated = new Set<string>()
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
   * Consider one finished turn. Qualifying work is held until the person's next message and learned from with that
   * message as feedback; work still held when a newer turn qualifies is learned from without a reaction.
   * @param owner - account id of the session.
   * @param route - the session's model route.
   * @param work - the turn's work.
   * @param cwd - the session's workspace, when it has one.
   */
  offer(owner: string, route: LearnerRoute | undefined, work: CompletedWork, cwd?: string): void {
    const pending = this.recent.get(work.sessionId)
    this.recent.delete(work.sessionId)
    if (pending !== undefined) this.enqueue(pending)
    if (!this.qualifies(work)) return
    const resolved = this.config.provider !== undefined && this.config.model !== undefined
      ? { provider: this.config.provider, model: this.config.model }
      : route
    if (resolved === undefined) return
    const recent: Recent = { owner, route: resolved, work, ...cwd === undefined ? {} : { cwd } }
    // Held until the user's next message, so their reaction to the answer decides what, if anything, is learned.
    this.recent.set(work.sessionId, recent)
  }

  /**
   * The user's next message arrived: the held work is learned from with that message as its feedback.
   * @param sessionId - the session.
   * @param feedback - the user's next message, classified as a correction, a complaint about time, or a reply.
   */
  next(sessionId: string, feedback: LearnerFeedback): void {
    const recent = this.recent.get(sessionId)
    this.recent.delete(sessionId)
    if (recent !== undefined) this.enqueue(recent, feedback)
  }

  /**
   * A session ended: held work is learned from without a reaction; learning already started still finishes.
   * @param sessionId - the session.
   */
  close(sessionId: string): void {
    const recent = this.recent.get(sessionId)
    this.recent.delete(sessionId)
    if (recent !== undefined) this.enqueue(recent)
  }

  /**
   * Learn from a session's held work and wait for its learning in flight, because its owner is about to end it.
   * @param sessionId - the session.
   * @returns after learning from the session finished or failed.
   */
  async settle(sessionId: string): Promise<void> {
    this.close(sessionId)
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
    // A turn memory filed as being about the person is never a procedure, whatever tools it used.
    const domain = await this.ctx.get('memory')?.turnDomain({ sessionId: recent.work.sessionId as SessionId, turn: recent.work.turn })
    if (domain === 'person') {
      this.logger.info(`skipped ${recent.work.sessionId} turn ${recent.work.turn}: a conversation about the person`)
      return undefined
    }
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
      const options = { status: existing.status, source: existing.source, sessionId: work.sessionId }
      const updated = await this.ctx.capabilities.save(owner, draft, options)
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
   * Learn into long-term memory: list the procedures memory already holds for the session's workspace, rank them
   * against the work, distill the work against them, and store the result as a memory. Every procedure stored under
   * the result's name, and every procedure the result says it covers, is forgotten in favour of it.
   * @param recent - the work to learn from, with the procedure it was already learned into.
   * @param feedback - the user's reaction to the work, when it is re-learned for it.
   * @returns the procedure stored, or undefined when the work taught nothing.
   */
  private async learnIntoMemory(recent: Recent, feedback: LearnerFeedback | undefined): Promise<Recent['learned']> {
    const { owner, route, work, cwd } = recent
    const signal = AbortSignal.timeout(this.config.timeoutMs)
    const scope = this.scopeOf(recent)
    const all = await this.ctx.memory.procedures({ owner, ...cwd === undefined ? {} : { cwd }, signal })
    await this.archiveStaleCandidates(owner, all, signal)
    const cutoff = Date.now() - this.config.candidateTtlDays * DAY_MS
    // Archived and expiring candidates are not offered for merging; work of their kind starts a fresh candidate.
    const latest = latestByName(all.filter(procedure => procedure.status === 'active'
      || (procedure.status === 'candidate' && procedure.time >= cutoff)))
    // The backlog is merged whether or not this work teaches anything new.
    this.consolidateWhenNeeded(recent, latest.size)
    const recalled = await recallLearnedNames(this.ctx, scope, `${work.request}\n\n${work.answer.slice(0, 600)}`, signal)
    const requestWords = words(work.request)
    const rank = (procedure: LearnedProcedure): number => {
      // The procedure this work was already learned into is the one feedback refines, then what recall ranks.
      if (procedure.name === recent.learned?.name) return Number.MAX_SAFE_INTEGER
      const recalledAt = recalled.indexOf(procedure.name)
      return (recalledAt === -1 ? 0 : 1_000 - recalledAt) + overlap(requestWords, words(`${procedure.name.replaceAll('-', ' ')} ${procedure.description}`))
    }
    const ordered = [...latest.values()]
      .map(procedure => ({ procedure, score: rank(procedure) }))
      .sort((a, b) => b.score - a.score || b.procedure.time - a.procedure.time)
    const existing = ordered.slice(0, MAX_EXISTING_PROCEDURES)
      .map(({ procedure }) => `- ${procedure.name}: ${clip(procedure.description, EXISTING_LINE_CHARS)}`).join('\n') || '(none)'
    const related = ordered.filter(item => item.score >= 2).slice(0, MAX_RELATED_PROCEDURES).map(({ procedure }) => ({
      name: procedure.name,
      description: procedure.description,
      content: clip(procedure.content, RELATED_PROCEDURE_CHARS),
    }))
    const decision = await this.distill(route, work, feedback, existing, related, MEMORY_SYSTEM)
    if (decision === undefined) return undefined
    if (decision.decision === 'skip') {
      this.logger.info(`nothing reusable in ${work.sessionId} turn ${work.turn}`)
      return undefined
    }
    const domain: MemoryDomain = decision.domain === 'project' && cwd === undefined ? 'experience' : decision.domain ?? 'experience'
    const covered = new Set([decision.name, ...decision.replaces ?? []])
    const previous = all.filter(procedure => covered.has(procedure.name))
    const replaced = previous.map(procedure => procedure.id)
    const status = procedureStatusAfter(previous, decision.content, feedback)
    const id = await storeLearnedProcedure(this.ctx, scope, {
      name: decision.name,
      description: decision.description,
      content: decision.content,
      summary: decision.summary ?? `${decision.description} ${decision.content}`,
      domain,
    }, status, signal)
    await forgetLearnedProcedures(this.ctx, owner, replaced, signal)
    const learnedNote = `learned ${status} procedure ${decision.name} into ${domain} memory ${id} from ${work.sessionId} turn ${work.turn}`
    const feedbackNote = feedback === undefined ? '' : ` with the user's ${feedback.kind} feedback`
    const replacedNote = replaced.length > 0 ? `, replacing ${replaced.join(', ')}` : ''
    this.logger.info(`${learnedNote}${feedbackNote}${replacedNote}`)
    return { name: decision.name, id }
  }

  /**
   * Archive the candidates no later work confirmed within `candidateTtlDays`.
   * @param owner - account id.
   * @param procedures - the owner's procedures.
   * @param signal - cancellation.
   */
  private async archiveStaleCandidates(owner: string, procedures: readonly LearnedProcedure[], signal: AbortSignal): Promise<void> {
    const cutoff = Date.now() - this.config.candidateTtlDays * DAY_MS
    for (const procedure of procedures) {
      if (procedure.status !== 'candidate' || procedure.time >= cutoff) continue
      await this.ctx.memory.setProcedureStatus({ owner, id: procedure.id, status: 'archived', signal })
      this.logger.info(`archived candidate procedure ${procedure.name}: unconfirmed for ${this.config.candidateTtlDays} days`)
    }
  }

  private scopeOf(recent: Held): MemoryScope {
    const { owner, route, work, cwd } = recent
    return {
      owner,
      sessionId: work.sessionId as SessionId,
      ...cwd === undefined ? {} : { cwd },
      route: { provider: route.provider, model: route.model },
    }
  }

  /**
   * Start merging an owner's procedures of one kind of task when a session sees more than the configured number,
   * once per owner and workspace per process. Merges run on their own queue, so a session's learning and its end
   * never wait for them.
   * @param recent - the work whose learning found the count, which supplies the owner, workspace, and route.
   * @param kinds - distinct procedures the session sees.
   */
  private consolidateWhenNeeded(recent: Recent, kinds: number): void {
    const above = this.config.consolidateAbove
    if (above === 0 || kinds <= above) return
    const key = `${recent.owner}\u0000${recent.cwd ?? ''}`
    if (this.consolidated.has(key)) return
    this.consolidated.add(key)
    this.merge(recent.owner, async () => {
      const groups = await this.groupProcedures(recent)
      this.logger.info(`merging ${groups.length} groups of learned procedures of ${recent.owner}`)
      for (const group of groups) this.merge(recent.owner, () => this.mergeGroup(recent, group), `merging procedures into ${group.name}`)
    }, `grouping learned procedures of ${recent.owner}`)
  }

  private merge(owner: string, job: () => Promise<void>, label: string): void {
    const previous = this.merges.get(owner) ?? Promise.resolve()
    const run = previous.then(async () => {
      if (!this.disposed) await job()
    }).catch((error: unknown) => {
      this.logger.warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.merges.set(owner, run)
    void run.then(() => { if (this.merges.get(owner) === run) this.merges.delete(owner) })
  }

  /**
   * Forget older copies stored under one name, then sort the remaining procedures into groups of one kind of task.
   * Procedures are sorted by name and grouped in batches, so procedures of one kind in different batches stay apart.
   * @param recent - work that supplies the owner, workspace, and route.
   * @returns groups of two or more procedures to merge.
   */
  private async groupProcedures(recent: Recent): Promise<ProcedureGroup[]> {
    const { owner, cwd, route } = recent
    const signal = AbortSignal.timeout(this.config.timeoutMs)
    const all = await this.ctx.memory.procedures({ owner, ...cwd === undefined ? {} : { cwd }, signal })
    const latest = latestByName(all)
    const kept = new Set([...latest.values()].map(procedure => procedure.id))
    const copies = all.filter(procedure => !kept.has(procedure.id)).map(procedure => procedure.id)
    await forgetLearnedProcedures(this.ctx, owner, copies, signal)
    if (copies.length > 0) this.logger.info(`forgot ${copies.length} older copies of learned procedures of ${owner}`)
    const sorted = [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))
    const room = Math.max(0, this.config.maxInputTokens * CHARS_PER_TOKEN - PROMPT_CHARS)
    const groups: ProcedureGroup[] = []
    for (let start = 0; start < sorted.length;) {
      const lines: string[] = []
      let chars = 0
      while (start < sorted.length && lines.length < GROUP_BATCH) {
        const procedure = sorted[start]
        if (procedure === undefined) break
        const line = `- ${procedure.name}: ${clip(procedure.description, EXISTING_LINE_CHARS)}`
        if (lines.length > 0 && chars + line.length + 1 > room) break
        lines.push(line)
        chars += line.length + 1
        start += 1
      }
      const names = new Set(lines.map(line => line.slice(2, line.indexOf(':'))))
      const reply = await this.complete(route, GROUP_SYSTEM, `<procedures>\n${lines.join('\n')}\n</procedures>`)
      const found = parseGroups(reply, names)
      if (found === undefined) this.logger.warn(`grouping learned procedures returned no groups: ${reply.slice(0, 200)}`)
      groups.push(...found ?? [])
    }
    return groups
  }

  /**
   * Merge one group into a single procedure and forget its members. Members forgotten or replaced since the
   * grouping are left out; a group with fewer than two left is not merged.
   * @param recent - work that supplies the owner, workspace, session, and route.
   * @param group - the procedures to merge.
   */
  private async mergeGroup(recent: Recent, group: ProcedureGroup): Promise<void> {
    const { owner, cwd, route } = recent
    const signal = AbortSignal.timeout(this.config.timeoutMs)
    const procedures = await this.ctx.memory.procedures({ owner, ...cwd === undefined ? {} : { cwd }, signal })
    const latest = latestByName(procedures.filter(procedure => procedure.status !== 'archived'))
    const members = group.members.flatMap(name => latest.get(name) ?? []).sort((a, b) => b.time - a.time)
    if (members.length < 2) return
    const room = Math.max(0, this.config.maxInputTokens * CHARS_PER_TOKEN - PROMPT_CHARS)
    const each = Math.floor(room / members.length) - 200
    const text = [
      `<kind_of_task>${group.name}</kind_of_task>`,
      ...members.map(member => `<procedure name="${member.name}" learned="${new Date(member.time).toISOString().slice(0, 10)}">\n${member.description}\n\n${clip(member.content, Math.max(each, 0))}\n</procedure>`),
    ].join('\n\n')
    const reply = await this.complete(route, MERGE_SYSTEM, text)
    const decision = parseDecision(reply)
    if (decision === undefined || decision.decision === 'skip') {
      this.logger.warn(`merging procedures into ${group.name} returned no procedure: ${reply.slice(0, 200)}`)
      return
    }
    const domain: MemoryDomain = decision.domain === 'project' && cwd === undefined ? 'experience' : decision.domain ?? 'experience'
    // A merge rewrites its members, so only an all-active group whose steps survive stays proven.
    const status: ProcedureStatus = members.every(member => member.status === 'active')
      && members.some(member => sameSteps(member.content, decision.content)) ? 'active' : 'candidate'
    const id = await storeLearnedProcedure(this.ctx, this.scopeOf(recent), {
      name: decision.name,
      description: decision.description,
      content: decision.content,
      summary: decision.summary ?? `${decision.description} ${decision.content}`,
      domain,
    }, status, signal)
    const replaced = members.map(member => member.id)
    await forgetLearnedProcedures(this.ctx, owner, replaced, signal)
    this.logger.info(`merged ${members.map(member => member.name).join(', ')} into procedure ${decision.name} (${domain} memory ${id})`)
  }

  private async distill(
    route: LearnerRoute,
    work: CompletedWork,
    feedback: LearnerFeedback | undefined,
    existing: string,
    related: readonly { name: string; description: string; content: string }[],
    system: string,
  ): Promise<Decision | undefined> {
    const steps = work.steps.filter(step => !BOOKKEEPING.test(step.name))
    const { text, dropped } = boundTranscript({
      request: work.request,
      timing: timingOf(work, steps),
      steps,
      instructions: work.instructions ?? [],
      startedAt: work.startedAt,
      answer: work.answer.slice(0, 4_000),
      ...feedback === undefined ? {} : { feedback: { kind: feedback.kind, text: feedback.text.slice(0, 2_000) } },
      existing,
      related: related.map(procedure => `<procedure name="${procedure.name}">\n${procedure.description}\n\n${procedure.content}\n</procedure>`),
    }, this.config.maxInputTokens)
    if (dropped > 0) this.logger.info(`learning from ${work.sessionId} turn ${work.turn} omitted ${dropped} older tool calls to stay within ${this.config.maxInputTokens} input tokens`)
    const reply = await this.complete(route, system, text)
    const decision = parseDecision(reply)
    if (decision === undefined) this.logger.warn(`learning from ${work.sessionId} turn ${work.turn} returned no decision: ${reply.slice(0, 200)}`)
    return decision
  }

  /**
   * One learning model call.
   * @param route - model route.
   * @param system - system prompt.
   * @param text - the user message.
   * @returns the reply text.
   */
  private async complete(route: LearnerRoute, system: string, text: string): Promise<string> {
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'tool-capability' } })],
      maxTokens: this.config.maxOutputTokens,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })) assembler.push(chunk)
    return assembler.blocks().map(block => block.type === 'text' ? block.text : '').join('')
  }
}
