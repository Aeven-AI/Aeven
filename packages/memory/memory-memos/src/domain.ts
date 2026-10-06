/** Memory domains stored as MemOS trace tags, and the classification that assigns them at capture. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { MemoryDomain } from '@aeven/memory'
import type { HostLlmBridge, HostLlmCompleteInput } from '@memtensor/memos-local-plugin/dist/core/llm/host-bridge.js'

/** Prefix of the trace tag that records a memory's domain. */
export const DOMAIN_TAG = 'domain:'

/**
 * Prefix of the trace tag that records a memory a correction replaced, followed by the trace that replaced it.
 * A correction answers the exchange before it, so the tag is written onto that earlier trace when the correction
 * is captured; automatic recall leaves a superseded trace out, while explicit search still returns it as history.
 */
export const SUPERSEDED_TAG = 'superseded:'

/** Domains a captured conversation turn is filed under. */
export type TurnDomain = MemoryDomain

const TURN_DOMAINS: readonly TurnDomain[] = ['person', 'project', 'world', 'experience']

/**
 * Domain of a trace from its tag, falling back to where it was captured: a trace inside a workspace belongs
 * to that project, while an untagged trace outside one is a work record nothing has classified. An untagged
 * trace is never read as a statement about the user, so an assistant's account of its own work cannot be
 * recalled as a fact about them.
 * @param tags - trace tags.
 * @param workspaceId - MemOS workspace key the trace was captured in, or null without a workspace.
 * @returns the recorded or inferred domain.
 */
export function traceDomain(tags: readonly string[] | undefined, workspaceId: string | null | undefined): TurnDomain {
  for (const tag of tags ?? []) {
    if (!tag.startsWith(DOMAIN_TAG)) continue
    const value = tag.slice(DOMAIN_TAG.length)
    if ((TURN_DOMAINS as readonly string[]).includes(value)) return value as TurnDomain
  }
  return workspaceId ? 'project' : 'experience'
}

/**
 * Tags with the domain tag replaced.
 * @param tags - current trace tags.
 * @param domain - domain to record.
 * @returns tags carrying exactly one domain tag.
 */
export function withDomainTag(tags: readonly string[] | undefined, domain: TurnDomain): string[] {
  return [...(tags ?? []).filter(tag => !tag.startsWith(DOMAIN_TAG)), `${DOMAIN_TAG}${domain}`]
}

/**
 * Tags recording that `replacementTraceId` replaced this memory, keeping every tag it already carried.
 * A memory can be superseded more than once, so the newest replacement is the one recall compares against;
 * earlier replacements stay listed because the history of what replaced what is the audit trail.
 * @param tags - current trace tags.
 * @param replacementTraceId - the trace that replaced this memory.
 * @returns tags carrying the replacement, without duplicates.
 */
export function withSupersededTag(tags: readonly string[] | undefined, replacementTraceId: string): string[] {
  return [...new Set([...(tags ?? []), `${SUPERSEDED_TAG}${replacementTraceId}`])]
}

/** Domain definitions shared by the standalone classifier and the turn judge. */
const DOMAIN_RULES = `- "person": a fact the user stated about themselves or a person they know that holds in any project: identity, names, family, preferences, habits, goals, equipment, working style.
- "project": a fact that matters only for the current project or workspace: its code, files, decisions, tasks, or state.
- "world": a reusable operation or verified fact about an application, tool, or environment that applies beyond this project, such as a command, key binding, path, setting, or procedure. The turn must state the usable fact itself. Do not choose "world" for discussion about designing Aeven, its memory system, or a proposed feature.
- "work": the turn records what the assistant did, found, answered, or planned, and the user stated no fact of their own.
Only the user's own words make a turn "person". An assistant's answer, report of its work, status update, or plan is "work".
When the conversation has no project, never answer "project".`

const CLASSIFY_PROMPT = `You label one memory taken from a conversation between a user and an AI assistant.
Answer with only a JSON object {"domain": "<domain>"}, where <domain> is one of:
${DOMAIN_RULES}`

/**
 * Rules appended to MemOS's summarize request for a turn's final reply, so the one call that writes the
 * stored summary also files the turn and detects a correction.
 */
const JUDGE_RULES = `Also put these keys in the same JSON object:
- "domain": one of the following.
${DOMAIN_RULES}
- "corrects": true when the USER message corrects or contradicts something PREVIOUS ASSISTANT stated, otherwise false.
PREVIOUS ASSISTANT is the reply the USER message answers. When the USER refers to it ("yes", "that one", "not my son"), the summary states the referent itself.`

/**
 * Domain named in a model answer.
 * @param text - the model's JSON answer.
 * @param project - working directory of the session, or undefined without a project.
 * @returns the domain, or undefined when the answer names none.
 */
function domainOf(text: string, project: string | undefined): TurnDomain | undefined {
  const answer = /"domain"\s*:\s*"(person|project|world|work)"/.exec(text)?.[1]
  if (answer === undefined) return undefined
  if (answer === 'work') return 'experience'
  if (answer === 'project' && project === undefined) return 'experience'
  return answer as TurnDomain
}

/** Facts the classifier reads from one captured turn. */
export interface ClassifyInput {
  readonly userText: string
  readonly assistantText: string
  readonly summary: string
  /** Working directory of the session, or undefined for a conversation without a project. */
  readonly project: string | undefined
}

/**
 * Ask the session's model which domain a captured turn belongs to, when {@link TurnJudgeContext} produced no
 * judgment for it. A turn that only records the assistant's own work, or that claims a project without one, is
 * filed as `experience`: recalled in every session of the owner, and never attributed to the user as a fact about themselves.
 * @param bridge - host bridge bound to the owning session's route by the caller.
 * @param input - the turn's text, its stored summary, and its project.
 * @param timeoutMs - bound on the classification call.
 * @returns the domain, or undefined when the model's answer is unusable.
 */
export async function classifyTurnDomain(bridge: HostLlmBridge, input: ClassifyInput, timeoutMs: number): Promise<TurnDomain | undefined> {
  const completion = await bridge.complete({
    messages: [
      { role: 'system', content: CLASSIFY_PROMPT },
      {
        role: 'user',
        content: [
          `PROJECT: ${input.project ?? 'none'}`,
          `USER: ${input.userText.slice(0, 1500)}`,
          `ASSISTANT: ${input.assistantText.slice(0, 1500)}`,
          `SUMMARY: ${input.summary.slice(0, 300)}`,
        ].join('\n\n'),
      },
    ],
    temperature: 0,
    maxTokens: 40,
    timeoutMs,
  })
  return domainOf(completion.text, input.project)
}

/** What the summarize request of a captured turn's final reply decided beyond the summary MemOS stores. */
export interface TurnJudgment {
  readonly domain: TurnDomain
  /** The user message corrects the reply before it, so that reply's trace is superseded. */
  readonly corrects: boolean
}

/** Context the turn judgment reads beyond the exchange MemOS sends. */
export interface TurnJudgeInput {
  /** Working directory of the session, or undefined for a conversation without a project. */
  readonly project: string | undefined
  /** The captured reply the user message answers; undefined when the previous turn was not captured in this process. */
  readonly previousReply: string | undefined
}

/** A captured turn's request extended with the judgment rules, and the reader of its answer. */
export interface JudgedRequest {
  readonly input: HostLlmCompleteInput
  /**
   * Record the judgment from one answer; a later answer to the same capture replaces it.
   * @param text - the model's JSON answer.
   */
  read(text: string): void
}

interface JudgeSlot {
  readonly input: TurnJudgeInput
  judgment?: TurnJudgment
}

const SUMMARIZE_OP = 'capture.summarize'
const PREVIOUS_REPLY_CHARS = 1000

/**
 * Async-local scope of one turn capture. The trace the runtime annotates is the only one whose summarize request
 * carries an `ASSISTANT` section: MemOS lightweight capture summarizes the whole turn as one step, and full capture
 * summarizes each tool call as a step without assistant text before the final reply. Extending that request lets
 * one model call write a summary that names its referent, file the turn's domain, and detect a correction, instead
 * of a second classification call after capture.
 */
export class TurnJudgeContext {
  private readonly storage = new AsyncLocalStorage<JudgeSlot>()

  /**
   * Run one turn capture with judgment enabled for its final reply's summarize request.
   * @param input - context the judgment reads.
   * @param operation - the MemOS turn-end capture.
   * @returns the operation's result, and the judgment when that request ran through the Host bridge with a usable answer.
   */
  async run<T>(input: TurnJudgeInput, operation: () => Promise<T>): Promise<{ readonly result: T; readonly judgment?: TurnJudgment }> {
    const slot: JudgeSlot = { input }
    const result = await this.storage.run(slot, operation)
    return slot.judgment === undefined ? { result } : { result, judgment: slot.judgment }
  }

  /**
   * Extend a Host bridge request when it summarizes the final reply of the capture in scope.
   * @param input - the request MemOS sent.
   * @returns the extended request and its answer reader, or undefined for every other request.
   */
  extend(input: HostLlmCompleteInput): JudgedRequest | undefined {
    const slot = this.storage.getStore()
    if (slot === undefined || input.op !== SUMMARIZE_OP) return undefined
    const request = input.messages.find(message => message.role === 'user')
    if (request === undefined || !/(?:^|\n)ASSISTANT:\n/.test(request.content)) return undefined
    const context = [
      `PROJECT: ${slot.input.project ?? 'none'}`,
      ...slot.input.previousReply ? [`PREVIOUS ASSISTANT:\n${slot.input.previousReply.slice(0, PREVIOUS_REPLY_CHARS)}`] : [],
    ].join('\n\n')
    // The bridge joins system messages in order, so the rules follow MemOS's summary instructions.
    const messages = [
      ...input.messages.map(message => message === request ? { ...message, content: `${context}\n\n${message.content}` } : message),
      { role: 'system' as const, content: JUDGE_RULES },
    ]
    return {
      input: { ...input, messages },
      read(text) {
        const domain = domainOf(text, slot.input.project)
        if (domain !== undefined) slot.judgment = { domain, corrects: /"corrects"\s*:\s*true\b/.test(text) }
      },
    }
  }
}
