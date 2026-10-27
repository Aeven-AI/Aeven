/**
 * Relevance judgment of turn-start recall. Retrieval returns candidates that share words or embedding direction with
 * the turn; this one model call decides which of them the assistant should read before it replies. Unlike MemOS's own
 * filter it sees what each candidate is — its domain, age, kind, and procedure status — and the person's current
 * request apart from the earlier conversation, and it may keep nothing.
 * @module @aeven/memory-memos/filter
 */
import type { MemoryDomain, ProcedureStatus } from '@aeven/memory'
import { embeddedJsonObject } from '@aeven/util-values'

/** What a candidate memory is, as the judgment reads it. */
export type CandidateKind = 'fact' | 'exchange' | 'log' | 'procedure' | 'episode' | 'skill' | 'knowledge'

/** One candidate memory offered to the judgment. */
export interface FilterCandidate {
  readonly kind: CandidateKind
  readonly domain: MemoryDomain
  /** Epoch milliseconds the memory was recorded, when known. */
  readonly recordedAt?: number
  readonly procedureStatus?: ProcedureStatus
  readonly text: string
}

/** Which lane leads the reply, whether the person is sharing their life, and the candidates kept, most important first. */
export interface RelevanceJudgment {
  readonly lead: 'person' | 'task'
  /** The person says how they feel or shares what is happening in their life, as opposed to asking about facts. */
  readonly sharing: boolean
  readonly keep: readonly number[]
}

/** System prompt of the judgment. */
export const RELEVANCE_PROMPT = `You choose which memories an assistant reads before it replies to a person.

REQUEST is what the person just said. CONTEXT is the conversation before it and may be empty; it tells you what REQUEST refers to, but REQUEST decides what is needed now.

Each candidate has labels:
- kind: fact (a lasting fact), exchange (a past conversation), log (a record of an action such as reading, searching, or running something), procedure (learned steps for a kind of task), episode (summary of a past session), skill or knowledge (learned know-how)
- domain: person (the user's own life and the people in it), project (their work), world (general knowledge, including what the assistant and its product are), or experience (know-how from earlier tasks)
- age: when it was recorded
- status, for procedures: active (proven) or candidate (unproven)

There are two lanes:
- Person lane: what someone who cares about this person should know right now: their situation, mood, health, relationships, family, work and money circumstances, recent events, and how they want to be treated. Recent memories matter most here. When the person refers to what happened today or lately, keep the memories of those events, the most serious first: distress, crisis, or not wanting to live come before biography, achievements and logistics.
- Task lane: what helps carry out the request: facts about the code, project, tools, and services, procedures for this kind of task, and the person's preferences for this kind of work.

Decide which lane leads from REQUEST, read with CONTEXT. When the person shares their personal life or asks for emotional support, the person lane leads and task memories are kept only when the request also needs them. When they ask for work or complain about the assistant's work, the task lane leads. Frustration, swearing or criticism of an answer does not by itself mean personal sharing or a request for emotional support.

Rules:
- Keep a memory only when the reply is better for having it. Returning no memories is correct when none helps: never keep the least bad.
- Drop logs unless the request asks what was done before.
- Keep a candidate (unproven) procedure only when it fits the request exactly.
- Drop memories that only share words or a topic with the request.
- Drop an earlier exchange where the person asked this same or nearly the same thing and the assistant already answered it, and an episode that summarizes such an exchange: that answer repeats the request, not what is known.
- Keep a memory where the person corrected the assistant, and the fact the correction established, whenever the request touches that subject: what the person said is true outranks what the assistant had answered. For a request about their project, keep facts about how it is built, hosted, run and paid for.
- Judge the content of every candidate, regardless of kind or domain: an episode or experience record can contain personal history. For a work request or complaint about an answer, drop unrelated health, family, relationship and financial history even when the person sounds upset. Keep task facts, relevant corrections and working preferences. When the person actually shares personal distress or asks for support, keep relevant personal history.
- When REQUEST asks what is known about a subject (a person, a project, the assistant itself, or a topic), keep every distinct fact about that subject, most informative first: the answer is those facts.
- Never keep two memories that state the same fact, even in different words: keep the most complete one, and the newer when they disagree.

Also say whether the person is sharing: true only when REQUEST shares personal circumstances or asks for emotional support, false when they ask about facts, memories, or work, even facts about themselves, or express frustration with the assistant's work.

Answer with only JSON: {"lead":"person" or "task","sharing":true or false,"keep":[candidate numbers, most important first]}`

const CANDIDATE_CHARS = 320
const DAY_MS = 86_400_000

/**
 * Age of a memory in words a model reads reliably.
 * @param recordedAt - epoch milliseconds the memory was recorded, when known.
 * @param now - current epoch milliseconds.
 * @returns a short age label.
 */
export function ageLabel(recordedAt: number | undefined, now: number): string {
  if (recordedAt === undefined) return 'unknown age'
  const days = Math.floor((now - recordedAt) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

/**
 * The judgment's user message.
 * @param request - the person's current message.
 * @param context - the earlier conversation, already bounded; empty when there is none.
 * @param candidates - the candidates, numbered from 1 in order.
 * @param now - current epoch milliseconds.
 * @returns the message text.
 */
export function relevanceInput(request: string, context: string, candidates: readonly FilterCandidate[], now: number): string {
  const lines = candidates.map((candidate, index) => {
    const labels = [
      candidate.kind,
      candidate.domain,
      ageLabel(candidate.recordedAt, now),
      ...candidate.procedureStatus === undefined ? [] : [candidate.procedureStatus],
    ].join(' · ')
    const text = candidate.text.replace(/\s+/g, ' ').trim().slice(0, CANDIDATE_CHARS)
    return `${index + 1}. [${labels}] ${text}`
  })
  return [`REQUEST:\n${request}`, `CONTEXT:\n${context || '(none)'}`, `CANDIDATES:\n${lines.join('\n')}`].join('\n\n')
}

/**
 * Read the judgment's answer.
 * @param text - the model's answer.
 * @param count - number of candidates offered.
 * @returns the judgment, or undefined when the answer is not usable.
 */
export function parseRelevance(text: string, count: number): RelevanceJudgment | undefined {
  const record = embeddedJsonObject(text)
  if (record === undefined) return undefined
  const { lead, sharing, keep } = record
  if (!Array.isArray(keep)) return undefined
  const kept: number[] = []
  for (const item of keep) {
    const index = typeof item === 'number' ? item - 1 : Number.NaN
    if (Number.isInteger(index) && index >= 0 && index < count && !kept.includes(index)) kept.push(index)
  }
  return { lead: lead === 'person' ? 'person' : 'task', sharing: sharing === true, keep: kept }
}

/** Openings of a summary that records an action rather than a lasting fact. */
const LOG_SUMMARY = new RegExp(
  String.raw`^(?:\[note\]|(?:the )?(?:user|assistant)(?: \([^)]*\))? `
  + String.raw`(?:requested|asked to (?:read|list|open|search|check)|searched|grepped|read|ran|opened`
  + String.raw`|inspected|listed|fetched|checked|loaded|viewed|scrolled|reloaded|measured|queried|edited|patched)`
  + String.raw`\b)`,
  'iu',
)

/**
 * Whether a memory records an action rather than a lasting fact: tagged so at capture, or, for memories captured
 * before that tag existed, summarized as one.
 * @param tags - the memory's tags.
 * @param summary - its summary.
 * @returns true for a log.
 */
export function isLogMemory(tags: readonly string[] | undefined, summary: string): boolean {
  return tags?.includes(LOG_TAG) === true || LOG_SUMMARY.test(summary.trim())
}

/** Tag of a memory that records an action rather than a lasting fact. */
export const LOG_TAG = 'kind:log'
