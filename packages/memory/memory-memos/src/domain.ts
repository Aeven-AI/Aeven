/** Memory domains stored as MemOS trace tags, and the classification that assigns them at capture. */
import type { MemoryDomain } from '@aeven/memory'
import type { HostLlmBridge } from '@memtensor/memos-local-plugin/dist/core/llm/host-bridge.js'

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

const CLASSIFY_PROMPT = `You label one memory taken from a conversation between a user and an AI assistant.
Answer with only a JSON object {"domain": "<domain>"}, where <domain> is one of:
- "person": something the user themselves stated that holds in any project: preferences, habits, identity, goals, equipment, working style.
- "project": a fact that matters only for the current project or workspace: its code, files, decisions, tasks, or state.
- "world": a reusable operation or verified fact about an application, tool, or environment that applies beyond this project, such as a command, key binding, path, setting, or procedure. The turn must state the usable fact itself. Do not choose "world" for discussion about designing Aeven, its memory system, or a proposed feature.
- "work": the turn records what the assistant did, found, or planned while working, and the user stated no fact of their own.
Only the user's own words make a turn "person". An assistant's report of its work, a status update, or a plan is "work".
When the conversation has no project, never answer "project".`

/** Facts the classifier reads from one captured turn. */
export interface ClassifyInput {
  readonly userText: string
  readonly assistantText: string
  readonly summary: string
  /** Working directory of the session, or undefined for a conversation without a project. */
  readonly project: string | undefined
}

/**
 * Ask the session's model which domain a captured turn belongs to. A turn that only records the
 * assistant's own work, or that claims a project without one, is filed as `experience`: recalled in every
 * session of the owner, and never attributed to the user as a fact about themselves.
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
  const match = /"domain"\s*:\s*"(person|project|world|work)"/.exec(completion.text)
  const answer = match?.[1]
  if (answer === undefined) return undefined
  if (answer === 'work') return 'experience'
  if (answer === 'project' && input.project === undefined) return 'experience'
  return answer as TurnDomain
}
