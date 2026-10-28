/**
 * Turn review: before a file-changing turn or an action commitment closes, one auxiliary model call reads the turn's
 * user messages, tool calls, tool results, and final reply, and names requests left undone or done
 * differently than asked, and claims that no tool result supports or that a tool result
 * contradicts. Findings steer the agent into another step; a clean review, a failed review call,
 * or a spent per-turn review budget lets the turn close.
 * @module @aeven/turn-review
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@aeven/llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message, MessageSource } from '@aeven/llm'
import type { Agent } from '@aeven/agent'
import type { SessionEvent } from '@aeven/session'
import { deadline, MAX_TIMER_DELAY_MS } from '@aeven/timeout'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'turn-review'

/** The model runtime the review call goes through. */
export const inject = ['llm']

/** Timeout reason code for review calls. */
export const TURN_REVIEW_TIMEOUT_CODE = 'TURN_REVIEW_TIMEOUT'

/** Exact review request recorded before dispatch. */
export interface TurnReviewRequestEventData {
  /** The reviewed turn. */
  readonly turn: number
  /** Review round within the turn, from 1. */
  readonly round: number
  /** Provider and model the review call uses. */
  readonly route: { readonly provider: string; readonly model: string }
  /** Exact review system prompt. */
  readonly system: string
  /** Exact review messages. */
  readonly messages: Message[]
  /** Review output-token cap. */
  readonly maxTokens: number
}

/** Parsed review outcome. */
export interface TurnReviewVerdictEventData {
  /** The reviewed turn. */
  readonly turn: number
  /** Review round within the turn, from 1. */
  readonly round: number
  /** Whether the reviewer found the turn complete. */
  readonly complete: boolean
  /** One sentence per finding; empty when complete. */
  readonly issues: string[]
}

/** A review call that produced no verdict; the turn closed with its reply as written. */
export interface TurnReviewFailureEventData {
  /** The reviewed turn. */
  readonly turn: number
  /** Review round within the turn, from 1. */
  readonly round: number
  /** Why the call produced no verdict: a timeout, a stream failure, an output-token cap, or an unparsable answer. */
  readonly message: string
}

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one turn-review model request. */
    'turn-review/request': TurnReviewRequestEventData
    /** Log-only parsed outcome of one turn-review model request. */
    'turn-review/verdict': TurnReviewVerdictEventData
    /** Log-only record of one turn-review model request that produced no verdict. */
    'turn-review/failure': TurnReviewFailureEventData
  }
}

/** Plugin configuration; every field is changeable from `cordis.yml`. */
export interface Config {
  /** Tool names whose successful call in a turn makes it a turn to review. */
  triggerTools: string[]
  /** Reviews per turn; a turn whose findings persist after this many rounds closes anyway. */
  maxReviewsPerTurn: number
  /** Cap on the characters of one tool argument, tool result, or message quoted to the reviewer. */
  maxEntryChars: number
  /** Cap on the characters of the whole turn transcript sent to the reviewer; the oldest entries are dropped first. */
  maxTranscriptChars: number
  /** Review output-token cap. */
  maxOutputTokens: number
  /** End-to-end deadline of one review call in milliseconds. */
  timeoutMs: number
  /** Explicit review provider; pairs with `model`. Absent uses the turn's own route. */
  provider?: string
  /** Explicit review model; pairs with `provider`. */
  model?: string
}

/** Validated schema for {@link Config}. */
export const Config: z<Config> = z.object({
  triggerTools: z.array(z.string()).default(['write', 'edit', 'str_replace_editor']),
  maxReviewsPerTurn: z.natural().min(1).default(2),
  maxEntryChars: z.natural().min(100).default(2000),
  maxTranscriptChars: z.natural().min(1000).default(60000),
  maxOutputTokens: z.natural().min(64).default(4000),
  timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(90000),
  provider: z.string(),
  model: z.string(),
})

const SOURCE: MessageSource = { kind: 'plugin', plugin: 'turn-review' }

const SYSTEM = [
  'You review the work an AI assistant did in one turn, before its final reply reaches the user.',
  'You receive the turn as a JSON array in order: the user\'s messages (including messages sent while the assistant was working), the assistant\'s tool calls with their results, and the assistant\'s replies. The last reply is the one about to be sent.',
  'Find only these problems:',
  '1. A user request in this turn that was not done, was done differently than asked (for example a value set to the opposite of what was asked, or an approximation where the user asked to copy), or was dropped without the reply saying so.',
  '2. A claim in the final reply (done, fixed, verified, matches, works, green) that no tool result shows, or that a tool result contradicts.',
  '   This includes a claim that something does not exist, is missing, or is not supported when the tool result behind it read only a filtered, truncated, or partial view: a search pattern or filter that could not match the thing, a cut list, or a first page.',
  '3. A change presented as working although no tool result observed it after the last edit; for a visual or UI change, observing means a browser read or screenshot taken after the last edit and build.',
  '4. A reply claims work is starting, running, or continuing without a corresponding dispatched tool or continuing job, or promises to act after the turn ends with no job to do it.',
  'For an action request, listing unfinished authorised work is not completion. Report it unless the user stopped or changed the task, or a concrete blocker requires user input. Questions and requests for a plan do not require execution.',
  'Do not report style, wording, scope suggestions, or improvements nobody asked for. Disclosing that a check was not run avoids a false verification claim but does not excuse leaving requested work unfinished.',
  'Answer with JSON only, no prose and no code fence: {"complete": true, "issues": []} or {"complete": false, "issues": ["..."]}. Each issue is one sentence that names the request or claim and what the tool results show.',
].join('\n')

/** One transcript entry quoted to the reviewer. */
type Entry =
  | { readonly user: string }
  | { readonly call: string; readonly arguments: string }
  | { readonly result: string; readonly error?: true }
  | { readonly assistant: string }

/**
 * Validate the provider/model pair.
 * @param config - validated plugin configuration.
 */
function assertRoute(config: Config): void {
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('turn-review: provider and model must be configured together')
  }
}

/** Keep the head and tail of long text, which carry a command and its outcome. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.floor((max - 20) / 2)
  return `${text.slice(0, half)}\n…[${text.length - 2 * half} chars cut]…\n${text.slice(-half)}`
}

/** The text of content blocks; non-text blocks are named, not quoted. */
function blockText(content: readonly ContentBlock[]): string {
  return content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('\n')
}

/** Events of one turn, from its `turn/start` to the end of the log. */
function turnEvents(agent: Agent, turn: number): readonly SessionEvent[] {
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) return events.slice(index)
  }
  return []
}

/**
 * Whether the turn closes on a final reply: its last assistant message carries text and no tool call.
 * @param events - the turn's events.
 * @returns true when the turn ends with a reply to the user.
 */
function endsWithReply(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    if (event.data.interrupted === true) return false
    const content = event.data.message.content
    return content.some(block => block.type === 'text' && block.text.trim() !== '')
      && !content.some(block => block.type === 'tool-call')
  }
  return false
}

/**
 * Screen a tool-free final reply for first-person action commitments. The reviewer
 * judges the request and execution evidence; a phrase alone never forces a tool.
 * Code examples and quoted lines do not describe the assistant's current work.
 * @param events - the current turn's events.
 * @returns whether semantic review should inspect an action commitment.
 */
function promisesAction(events: readonly SessionEvent[]): boolean {
  const reply = events.findLast(event => event.type === 'assistant/message')
  if (reply?.type !== 'assistant/message') return false
  const text = reply.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text).join('\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*>.*$/gm, '')
  return new RegExp([
    "\\b(?:i(?:['’]m|\\s+am|['’]ll|\\s+will)|we(?:['’]re|\\s+are|['’]ll|\\s+will))\\s+",
    '(?:(?:now|currently|still|just|keep)\\s+)?(?:going\\s+to\\s+)?(?:be\\s+)?',
    '(?:start(?:ing)?|continu(?:e|ing)|work(?:ing)?|writ(?:e|ing)|edit(?:ing)?|implement(?:ing)?|fix(?:ing)?|build(?:ing)?|',
    'run(?:ning)?|check(?:ing)?|investigat(?:e|ing)|read(?:ing)?|updat(?:e|ing)|creat(?:e|ing)|remov(?:e|ing)|',
    'delet(?:e|ing)|send(?:ing)?|upload(?:ing)?|deploy(?:ing)?|push(?:ing)?|merg(?:e|ing))\\b',
  ].join(''), 'i').test(text)
}

/**
 * Whether a trigger tool completed without error in the turn.
 * @param events - the turn's events.
 * @param triggers - trigger tool names.
 * @returns true when the turn changed files through a trigger tool.
 */
function changedFiles(events: readonly SessionEvent[], triggers: ReadonlySet<string>): boolean {
  const calls = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool/call' && triggers.has(event.data.name)) calls.add(event.data.callId)
    if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      if (calls.has(block.toolCallId) && block.isError !== true) return true
    }
  }
  return false
}

/**
 * Quote the turn to the reviewer, dropping the oldest tool entries first when over budget.
 * User messages and assistant replies are always kept.
 * @param events - the turn's events.
 * @param config - entry and transcript caps.
 * @returns the JSON transcript.
 */
function transcript(events: readonly SessionEvent[], config: Config): string {
  const entries: Entry[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message':
        if (event.data.source.kind === 'user') entries.push({ user: clip(blockText(event.data.content), config.maxEntryChars) })
        break
      case 'tool/call':
        entries.push({ call: event.data.name, arguments: clip(event.data.arguments, config.maxEntryChars) })
        break
      case 'tool/result': {
        const block = event.data.message.content[0]
        entries.push({
          result: clip(blockText(block.content), config.maxEntryChars),
          ...block.isError === true ? { error: true as const } : {},
        })
        break
      }
      case 'assistant/message': {
        const text = event.data.message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n')
          .trim()
        if (text !== '') entries.push({ assistant: clip(text, config.maxEntryChars) })
        break
      }
      default:
        // Every other event type carries no request, tool outcome, or reply.
        break
    }
  }
  let json = JSON.stringify(entries)
  while (json.length > config.maxTranscriptChars) {
    const index = entries.findIndex(entry => 'call' in entry || 'result' in entry)
    if (index === -1) break
    entries.splice(index, 1)
    json = JSON.stringify(entries)
  }
  return json
}

/** Translate a terminal finish reason into a review-call failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted':
      return new Error(`turn-review: ${finish.failure.message}`)
    case 'max-tokens':
      return new Error('turn-review: review output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('turn-review: review model requested a tool')
    default:
      return new Error(`turn-review: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Parse the reviewer's JSON answer.
 * @param text - the reviewer's text output.
 * @returns the verdict.
 * @throws when the answer carries no JSON object or no boolean `complete` field.
 */
function parseVerdict(text: string): { complete: boolean; issues: string[] } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) throw new Error('turn-review: review answer holds no JSON object')
  const parsed = JSON.parse(text.slice(start, end + 1)) as { complete?: unknown; issues?: unknown }
  const { complete, issues } = parsed
  if (typeof complete !== 'boolean') throw new Error('turn-review: review answer lacks a boolean "complete"')
  const list = Array.isArray(issues) ? issues.filter((issue): issue is string => typeof issue === 'string' && issue.trim() !== '') : []
  return { complete: complete || list.length === 0, issues: complete ? [] : list }
}

/**
 * Register the review on every turn boundary.
 * @param ctx - Host context carrying the model runtime.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertRoute(config)
  const triggers = new Set(config.triggerTools)
  const logger = ctx.logger(name)
  /** Review rounds spent per agent, keyed by the turn they belong to. */
  const rounds = new WeakMap<Agent, { turn: number; count: number }>()

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    const spent = rounds.get(agent)
    const count = spent?.turn === turn ? spent.count : 0
    if (count >= config.maxReviewsPerTurn) return
    const events = turnEvents(agent, turn)
    if (!endsWithReply(events) || (!changedFiles(events, triggers) && !promisesAction(events))) return
    const header = agent.session.requestHeader()?.config
    const route = config.provider !== undefined && config.model !== undefined
      ? { provider: config.provider, model: config.model }
      : header === undefined ? undefined : { provider: header.provider, model: header.model }
    if (route === undefined) return
    const round = count + 1
    rounds.set(agent, { turn, count: round })

    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: `Review this turn:\n${transcript(events, config)}` }],
      source: SOURCE,
    })]
    let verdict: { complete: boolean; issues: string[] }
    try {
      using callDeadline = deadline(signal, config.timeoutMs, TURN_REVIEW_TIMEOUT_CODE)
      const options: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        system: SYSTEM,
        messages,
        maxTokens: config.maxOutputTokens,
        sessionId: agent.session.id,
        signal: callDeadline.signal,
      }
      agent.session.append('turn-review/request', { turn, round, route, system: SYSTEM, messages, maxTokens: config.maxOutputTokens })
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      const failure = finishError(assembler.finish)
      if (failure !== undefined) throw failure
      verdict = parseVerdict(assembler.blocks().map(block => block.type === 'text' ? block.text : '').join(''))
    } catch (error: unknown) {
      // The turn's own cancellation propagates; a failed review leaves the reply as written.
      signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('turn %d review failed: %s', turn, message)
      agent.session.append('turn-review/failure', { turn, round, message })
      return
    }
    agent.session.append('turn-review/verdict', { turn, round, ...verdict })
    if (verdict.complete) return
    const text = [
      'Internal review of your draft reply, not a message from the user:',
      ...verdict.issues.map(issue => `- ${issue}`),
      'Complete the user’s requested work or state its blocker; remove unsupported optional promises. Revise the full answer to the user’s request, preserving supported results. Do not reply to or acknowledge this review.',
    ].join('\n')
    agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: SOURCE }))
  })
}
