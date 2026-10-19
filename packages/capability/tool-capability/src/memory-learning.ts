/**
 * Learned procedures kept in long-term memory. A procedure learned from completed work, or saved because the user
 * asked, is one memory: its full Markdown is the stored text, and its summary is the procedure condensed, so the
 * memory recall that opens every direct-user turn already carries the steps. Nothing is written as a skill or a
 * capability file, and the memory's own supersession, inspection and forgetting apply to it.
 */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, type ReasoningEffortId } from '@aeven/llm'
import { LEARNED_PROCEDURE_PREFIX, type MemoryDomain, type MemoryItemId, type MemoryScope } from '@aeven/memory'

/** A recalled learned procedure: the prefix and its kebab-case name. */
const NAMED = /^Learned procedure ([a-z0-9][a-z0-9-]*):/

/** Longest summary written; memory recall shows up to 1,000 characters of one memory. */
const SUMMARY_MAX = 950

/** Recall budget of the lookup that runs before a distillation, in milliseconds. */
const LOOKUP_TIMEOUT_MS = 15_000

/**
 * Traces the lookup asks recall for. Recall ranks every memory of the owner, and the turn just captured and the
 * session's earlier turns match the work most closely, so a small limit leaves no room for the procedures.
 */
const LOOKUP_TRACES = 30

/** Domains a learned procedure is filed under. */
export const LEARNED_DOMAINS = ['world', 'experience', 'project'] as const satisfies readonly MemoryDomain[]

/** One procedure to store. */
export interface ProcedureDraft {
  readonly name: string
  readonly description: string
  /** Full Markdown procedure. */
  readonly content: string
  /** The procedure condensed to what can be followed from it alone. */
  readonly summary: string
  readonly domain: MemoryDomain
}

/**
 * Collapse whitespace and clip text to a length, ending on a whole word.
 * @param text - any text.
 * @param max - longest result.
 * @returns the clipped text.
 */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

/**
 * Names of the learned procedures memory recall ranks for a request, best first.
 * @param ctx - context with the memory service.
 * @param scope - the session's memory scope.
 * @param query - the request the procedures should serve.
 * @param signal - cancellation.
 * @returns distinct procedure names.
 */
export async function recallLearnedNames(ctx: Context, scope: MemoryScope, query: string, signal: AbortSignal): Promise<string[]> {
  const recall = await ctx.memory.recall({
    scope,
    query,
    purpose: 'tool',
    timeoutMs: LOOKUP_TIMEOUT_MS,
    limits: { skills: 0, traces: LOOKUP_TRACES, worldModels: 0 },
    signal,
  })
  const names: string[] = []
  for (const hit of recall.hits) {
    const named = hit.kind === 'trace' ? NAMED.exec(hit.snippet) : null
    const name = named?.[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Ids of every learned procedure stored under a name, for a save that replaces them.
 * @param ctx - context with the memory service.
 * @param scope - the session's memory scope.
 * @param names - procedure names.
 * @param signal - cancellation.
 * @returns the ids.
 */
export async function learnedIdsNamed(
  ctx: Context,
  scope: MemoryScope,
  names: readonly string[],
  signal: AbortSignal,
): Promise<MemoryItemId[]> {
  const procedures = await ctx.memory.procedures({ owner: scope.owner, ...scope.cwd === undefined ? {} : { cwd: scope.cwd }, signal })
  return procedures.filter(procedure => names.includes(procedure.name)).map(procedure => procedure.id)
}

/**
 * Store one procedure as a memory whose summary is the condensed procedure.
 * @param ctx - context with the memory service.
 * @param scope - the session's memory scope.
 * @param draft - the procedure.
 * @param signal - cancellation.
 * @returns the stored memory's id.
 */
export async function storeLearnedProcedure(
  ctx: Context,
  scope: MemoryScope,
  draft: ProcedureDraft,
  signal: AbortSignal,
): Promise<MemoryItemId> {
  const text = `${LEARNED_PROCEDURE_PREFIX} ${draft.name}: ${draft.description}\n\n${draft.content}`
  const id = await ctx.memory.remember({ scope, text, domain: draft.domain, signal })
  // The summary capture wrote is a one-line gist; the learned summary carries the steps recall should deliver.
  await ctx.memory.edit({ owner: scope.owner, id, summary: clip(`${LEARNED_PROCEDURE_PREFIX} ${draft.name}: ${draft.summary}`, SUMMARY_MAX), signal })
  return id
}

/**
 * Forget learned procedures a newer one replaces.
 * @param ctx - context with the memory service.
 * @param owner - account id.
 * @param ids - memories to forget.
 * @param signal - cancellation.
 */
export async function forgetLearnedProcedures(
  ctx: Context,
  owner: string,
  ids: readonly MemoryItemId[],
  signal: AbortSignal,
): Promise<void> {
  for (const id of ids) await ctx.memory.forget({ owner, id, signal })
}

/** Prompt that condenses an imported or explicitly saved procedure into the summary memory recall shows. */
const CONDENSE = 'Condense one procedure into at most 800 characters that can be followed on its own: the trigger, then the fast path (the fewest steps, with their exact commands, files, settings, or tool names), then what to avoid and the user\'s preferences, then the check. Keep placeholders such as <name> as they are. Reply with the condensed text only.'

/** Reasoning effort asked of the condensing call. */
const LOW_REASONING = 'low' as ReasoningEffortId

/** One procedure in an import file. */
export interface ImportedProcedure {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly domain: MemoryDomain
}

/**
 * Read an import file: a JSON array of procedures with a name, a description, Markdown content, and a domain.
 * @param path - the file.
 * @returns the valid procedures; an entry missing a field or naming another domain is left out.
 */
export async function readProcedureImport(path: string): Promise<ImportedProcedure[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('an import file holds a JSON array of procedures')
  return parsed.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== 'object') return []
    const { name, description, content, domain } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof description !== 'string' || typeof content !== 'string') return []
    if (!name.trim() || !description.trim() || !content.trim()) return []
    if (!(LEARNED_DOMAINS as readonly unknown[]).includes(domain)) return []
    return [{ name: name.trim(), description: description.trim(), content: content.trim(), domain: domain as MemoryDomain }]
  })
}

/**
 * Condense a procedure with the session's model, so an imported or saved memory is recalled with its steps.
 * @param ctx - context with the LLM service.
 * @param scope - the session's memory scope, whose route runs the call.
 * @param procedure - the procedure.
 * @param maxTokens - output limit of the call; a reasoning model spends part of it before it writes.
 * @param signal - cancellation.
 * @returns the condensed procedure, or the description and opening of the content when the model gives nothing.
 */
export async function condenseProcedure(
  ctx: Context,
  scope: MemoryScope,
  procedure: ImportedProcedure,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  const fallback = `${procedure.description} ${procedure.content}`
  const route = scope.route
  if (route === undefined) return fallback
  const run = async (reasoningEffort?: ReasoningEffortId): Promise<string> => {
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      system: CONDENSE,
      messages: [createUserMessage({ content: [{ type: 'text', text: `${procedure.name}: ${procedure.description}\n\n${procedure.content}` }], source: { kind: 'plugin', plugin: 'tool-capability' } })],
      maxTokens,
      signal,
    })) assembler.push(chunk)
    return assembler.blocks().map(block => block.type === 'text' ? block.text : '').join('').trim()
  }
  let text: string
  try {
    // Condensing needs little thought, and a route's default reasoning can spend the whole output budget on it.
    text = await run(LOW_REASONING)
  } catch (error) {
    if (signal.aborted) throw error
    // A provider that names its efforts differently refuses `low`; its own default still condenses.
    text = await run()
  }
  return text || fallback
}
