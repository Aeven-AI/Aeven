/**
 * Model-facing memory Consumer: tools to search long-term memory and read its traces, policies,
 * environment models, episodes, and crystallized skills.
 *
 * @module @aeven/tool-memory
 */
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@aeven/brand'
import type { Agent } from '@aeven/agent'
import { MEMORY_TOOL, memoryOriginLabel, memoryScopeOf, type MemoryDomain, type MemoryEpisodeId, type MemoryItemId, type MemoryRecallLimits, type MemoryScope } from '@aeven/memory'
import { defineTool, textOutput, textResult } from '@aeven/tools'

export const name = 'tool-memory'
export const inject = ['memory', 'tools']

/** Consumer configuration. */
export interface Config {
  /** Maximum characters of each body or snippet a tool returns. */
  resultMaxChars: number
  /** Hard budget for one `memory_search`, in milliseconds. */
  searchTimeoutMs: number
  /** Maximum already-distilled facts accepted by one bulk write. */
  bulkMaxFacts: number
}

export const Config: z<Config> = z.object({
  resultMaxChars: z.natural().min(128).default(1200),
  searchTimeoutMs: z.natural().min(100).default(3000),
  bulkMaxFacts: z.natural().min(1).default(500),
})

function clip(value: string | undefined, maxChars: number): string {
  if (!value) return ''
  if (value.length <= maxChars) return value
  let end = Math.max(0, maxChars - 1)
  // Never end on the first half of a surrogate pair: a lone surrogate is not
  // valid in the JSON a provider parses, and it fails the whole request.
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${value.slice(0, end)}…`
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined ? fallback : Math.max(min, Math.min(max, Math.trunc(value)))
}

function scopeOf(agent: Agent | undefined): MemoryScope {
  if (!agent) throw new Error('Memory tools run only inside an agent session')
  const scope = memoryScopeOf(agent)
  if (scope === undefined) throw new Error('Memory is available only in sessions that belong to a signed-in user')
  return scope
}

function limitsOf(args: { maxResults?: number; skills?: number; traces?: number; worldModels?: number }): MemoryRecallLimits | undefined {
  const shared = args.maxResults === undefined ? undefined : bounded(args.maxResults, 10, 1, 50)
  const skills = args.skills === undefined ? shared : bounded(args.skills, 0, 0, 100)
  const traces = args.traces === undefined ? shared : bounded(args.traces, 0, 0, 100)
  const worldModels = args.worldModels === undefined ? shared : bounded(args.worldModels, 0, 0, 100)
  if (skills === undefined && traces === undefined && worldModels === undefined) return undefined
  return { skills: skills ?? 0, traces: traces ?? 0, worldModels: worldModels ?? 0 }
}

/** Most topics one search may name, so a scattered query stays inside the search budget. */
const MAX_SEARCH_QUERIES = 4

/**
 * Merge the results of several queries, keeping each memory once at its best score.
 * @param hits - every query's hits, in any order.
 * @returns one ranked list, best first.
 */
function mergeHits<T extends { readonly id: string; readonly score: number }>(hits: readonly T[]): T[] {
  const best = new Map<string, T>()
  for (const hit of hits) {
    const seen = best.get(hit.id)
    if (seen === undefined || hit.score > seen.score) best.set(hit.id, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

/**
 * Register the memory tools.
 * @param ctx - Host context with the memory slot and tool registry.
 * @param config - validated consumer configuration.
 */

/** One fact read from an import file. */
interface ImportedFact {
  readonly text: string
  readonly domain: MemoryDomain
  /** Epoch milliseconds of the fact's `date`, when the file gives one. */
  readonly recordedAt?: number
}

/**
 * Read a fact file: `.jsonl` with one `{"fact", "about"?, "date"?}` object per line, or `.txt` with one fact per line.
 * @param path - absolute path of the file.
 * @param fallback - domain of a fact whose line names none.
 * @returns the facts in file order, and the 1-based numbers of non-empty lines that hold no fact.
 */
async function readFactFile(path: string, fallback: MemoryDomain): Promise<{ entries: ImportedFact[]; invalid: number[] }> {
  if (!isAbsolute(path)) throw new Error(`file must be an absolute path: ${path}`)
  const extension = extname(path).toLowerCase()
  if (extension !== '.jsonl' && extension !== '.txt') throw new Error('file must be a .jsonl or .txt fact file')
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/)
  const entries: ImportedFact[] = []
  const invalid: number[] = []
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (extension === '.txt') {
      entries.push({ text: trimmed, domain: fallback })
      return
    }
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    } catch {
      // A line that is not JSON is reported back by number instead of failing the whole import.
      invalid.push(index + 1)
      return
    }
    const { fact, about, date } = (value ?? {}) as Record<string, unknown>
    if (typeof fact !== 'string' || !fact.trim()) {
      invalid.push(index + 1)
      return
    }
    const time = typeof date === 'string' ? Date.parse(date) : Number.NaN
    entries.push({
      text: fact.trim(),
      domain: about === 'project' ? 'project' : about === 'knowledge' ? 'world' : about === 'user' ? 'person' : fallback,
      ...Number.isFinite(time) ? { recordedAt: time } : {},
    })
  })
  return { entries, invalid }
}

export function apply(ctx: Context, config: Config): void {
  const cap = config.resultMaxChars
  const tools: Parameters<typeof ctx.tools.register>[0][] = []

  tools.push(defineTool({
    name: MEMORY_TOOL.search,
    description: 'Search long-term memory of earlier work: past task traces, learned policies, environment knowledge, and reusable skills. ' +
      'Each direct-user turn already receives one automatic recall; use this to rephrase or broaden an insufficient recall, and before claiming earlier context is unavailable. ' +
      'For several unrelated topics, pass `queries` with one topic each instead of one long query.',
    parameters: {
      query: { type: 'string', description: 'A concise free-text memory query. Give this, or `queries` for several topics.' },
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to four queries, each naming one topic. Retrieval embeds a query whole, so one string holding several unrelated names - a person, a product and a year - matches none of them, while one query per name returns each.',
      },
      maxResults: { type: 'integer', description: 'Maximum results per kind (1-50).' },
      skills: { type: 'integer', description: 'Skill result limit (0-100).' },
      traces: { type: 'integer', description: 'Trace and policy result limit (0-100).' },
      worldModels: { type: 'integer', description: 'Environment-model result limit (0-100).' },
      sessionOnly: { type: 'boolean', description: 'Restrict results to memory captured from this session.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const asked = [...args.query === undefined ? [] : [args.query], ...args.queries ?? []]
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
      if (asked.length === 0) throw new Error('query or queries must be a non-empty string')
      const queries = [...new Set(asked)].slice(0, MAX_SEARCH_QUERIES)
      const limits = limitsOf(args)
      const recalls = await Promise.all(queries.map(query => ctx.memory.recall({
        scope: scopeOf(exec.agent),
        query,
        purpose: 'tool',
        ...args.sessionOnly === true ? { sessionOnly: true } : {},
        ...limits === undefined ? {} : { limits },
        timeoutMs: config.searchTimeoutMs,
        signal: exec.signal,
      })))
      // One memory can answer two of the queries; it is reported once, at its best score.
      const merged = mergeHits(recalls.flatMap(recall => recall.hits))
      const timedOut = recalls.some(recall => recall.timedOut)
      const hits = merged.map(hit => ({
        kind: hit.kind, id: hit.id, domain: hit.domain, score: hit.score, snippet: clip(hit.snippet, cap), origin: memoryOriginLabel(hit),
      }))
      const text = hits.length === 0
        ? timedOut ? 'Memory search timed out; no results.' : 'No relevant memories found.'
        : `Found ${hits.length} memories:\n\n${hits.map((hit, i) => `${i + 1}. [${hit.kind}:${hit.id}] (${hit.domain}) ${hit.snippet}${hit.origin ? ` (${hit.origin})` : ''} (score=${hit.score.toFixed(3)})`).join('\n')}`
      return textResult({ text, hits, ...timedOut ? { timedOut: true } : {} })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.get,
    description: 'Read one memory item found by a memory search: a past task trace, a learned policy, or an environment model.',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory item id.' },
      kind: { type: 'string', enum: ['trace', 'policy', 'world-model'], description: 'Item kind; defaults to trace.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const kind = args.kind ?? 'trace'
      const id = brandString<MemoryItemId>(args.id.trim())
      const item = await ctx.memory.detail({ scope: scopeOf(exec.agent), kind, id, signal: exec.signal })
      if (!item) return textResult({ text: `No ${kind} memory found for id "${id}".`, found: false, kind, id })
      const body = clip(item.body, cap)
      const facts = Object.fromEntries(Object.entries(item.facts).map(([key, value]) => [key, typeof value === 'string' ? clip(value, cap) : value]))
      return textResult({ text: `${item.title}\n\n${body}`.trim(), found: true, kind, id, body, facts })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.timeline,
    description: 'List the ordered traces of one past episode to reconstruct how an earlier task went.',
    parameters: {
      episodeId: { type: 'string', required: true, description: 'Episode id from a memory item.' },
      limit: { type: 'integer', description: 'Maximum traces (1-100).' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const episodeId = brandString<MemoryEpisodeId>(args.episodeId.trim())
      const limit = bounded(args.limit, 20, 1, 100)
      const entries = await ctx.memory.timeline({ scope: scopeOf(exec.agent), episodeId, limit, signal: exec.signal })
      const traces = entries.map(entry => ({ ...entry, userText: clip(entry.userText, cap), agentText: clip(entry.agentText, cap) }))
      return textResult({
        text: traces.length === 0
          ? `No traces found for episode "${episodeId}".`
          : `Episode ${episodeId}:\n\n${traces.map((trace, i) => `${i + 1}. ${trace.userText || trace.agentText || trace.id}`).join('\n')}`,
        episodeId,
        traces,
      })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.environments,
    description: 'List learned knowledge about working environments: repository structure, application behavior, constraints, and recurring patterns.',
    parameters: {
      query: { type: 'string', description: 'Optional keyword filter.' },
      limit: { type: 'integer', description: 'Maximum environments (1-30).' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = args.query?.trim()
      const models = await ctx.memory.environments({
        scope: scopeOf(exec.agent),
        ...query ? { query } : {},
        limit: bounded(args.limit, 5, 1, 30),
        signal: exec.signal,
      })
      const environments = models.map(model => ({ ...model, body: clip(model.body, cap) }))
      return textResult({
        text: environments.length === 0
          ? 'No learned environments found.'
          : environments.map((model, i) => `${i + 1}. [${model.id}] ${model.title}\n${model.body}`).join('\n\n'),
        environments,
      })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.skills,
    description: 'List reusable skills learned from successful earlier work.',
    parameters: {
      status: { type: 'string', enum: ['candidate', 'active', 'archived'], description: 'Optional lifecycle filter.' },
      limit: { type: 'integer', description: 'Maximum skills (1-50).' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const skills = await ctx.memory.skills({
        scope: scopeOf(exec.agent),
        ...args.status === undefined ? {} : { status: args.status },
        limit: bounded(args.limit, 10, 1, 50),
        signal: exec.signal,
      })
      const items = skills.map(skill => ({ ...skill, guide: clip(skill.guide, cap) }))
      return textResult({
        text: items.length === 0
          ? 'No skills found.'
          : items.map((skill, i) => `${i + 1}. [${skill.id}] ${skill.name} (${skill.status})\n${skill.guide}`).join('\n\n'),
        skills: items,
      })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.skill,
    description: 'Load one learned skill to apply it to the current task; loading records that the skill was used.',
    parameters: {
      id: { type: 'string', required: true, description: 'Skill id from a skill listing or memory search.' },
    },
    output: textOutput(),
    async execute(args, exec) {
      const id = brandString<MemoryItemId>(args.id.trim())
      const skill = await ctx.memory.useSkill({ scope: scopeOf(exec.agent), id, callId: exec.callId, signal: exec.signal })
      if (!skill) return textResult({ text: `No skill found for id "${id}".`, found: false, id })
      const guide = clip(skill.guide, cap)
      return textResult({ text: `${skill.name}\n\n${guide}`.trim(), found: true, ...skill, guide })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.remember,
    description: 'Store one fact the user explicitly asked you to remember, such as a preference, a name, or how they like a task done. ' +
      'Use only when the user asks you to remember something; ordinary conversation is remembered automatically. ' +
      'Preserve attribution, dates and uncertainty: distinguish a source\'s advertised claim, an observation, a plan and an assessment. Do not store your interpretation as a verified fact.',
    parameters: {
      fact: { type: 'string', required: true, description: 'The fact to remember, stated concisely in the user\'s words.' },
      about: {
        type: 'string',
        enum: ['user', 'project', 'knowledge'],
        description: 'user: a fact about the user that holds everywhere (the default). project: a fact that matters only in this project. knowledge: information about a product or subject beyond the current project, not the user\'s own life.',
      },
    },
    output: textOutput(),
    async execute(args, exec) {
      const fact = args.fact.trim()
      if (!fact) throw new Error('fact must be a non-empty string')
      const id = await ctx.memory.remember({ scope: scopeOf(exec.agent), text: fact, domain: args.about === 'project' ? 'project' : args.about === 'knowledge' ? 'world' : 'person', signal: exec.signal })
      return textResult({ text: 'Remembered.', id })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.rememberBulk,
    description: 'Import already-distilled facts when the user asks to import or remember many facts. ' +
      'Use this instead of repeated memory_remember calls. Each fact is stored verbatim as its own memory, with batched embeddings and no per-fact summarization. ' +
      'When the facts are in a file, pass `file` and the tool reads it itself: every fact is imported exactly as written, none is left out or reworded. ' +
      `Otherwise pass \`facts\`, at most ${config.bulkMaxFacts} per call. ` +
      'Facts the memory already holds with the same text are skipped, so importing a file again is safe. ' +
      'Preserve attribution, dates and uncertainty: distinguish a source\'s advertised claim, an observation, a plan and an assessment. Do not store your interpretation as a verified fact.',
    parameters: {
      facts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Already-distilled, self-contained facts; name whom each fact is about. Give this or `file`.',
      },
      file: {
        type: 'string',
        description: 'Absolute path of a fact file: `.jsonl` with one {"fact": "...", "about": "user" | "project" | "knowledge", "date": "YYYY-MM-DD"} object per line (`about` and `date` optional), or `.txt` with one fact per line. Give this or `facts`.',
      },
      about: {
        type: 'string', enum: ['user', 'project', 'knowledge'],
        description: 'user: facts about the user or people they know (the default). project: facts specific to the current project. knowledge: facts about the world, a product, or a subject that are not about the user\'s own life.',
      },
    },
    output: textOutput(),
    async execute(args, exec) {
      if ((args.facts === undefined) === (args.file === undefined)) throw new Error('give either facts or file')
      const fallback: MemoryDomain = args.about === 'project' ? 'project' : args.about === 'knowledge' ? 'world' : 'person'
      let entries: ImportedFact[]
      let invalid: number[] = []
      if (args.file !== undefined) {
        ({ entries, invalid } = await readFactFile(args.file, fallback))
      } else {
        const facts = (args.facts ?? []).map(fact => fact.trim())
        if (facts.length === 0 || facts.length > config.bulkMaxFacts || facts.some(fact => !fact)) {
          throw new Error(`facts must contain 1-${config.bulkMaxFacts} non-empty strings`)
        }
        entries = facts.map(text => ({ text, domain: fallback }))
      }
      const scope = scopeOf(exec.agent)
      let written = 0
      let skipped = 0
      // Batches are atomic on their own; a failure stops the import and reports what earlier batches wrote.
      for (const domain of ['person', 'project', 'world'] as const) {
        const ofDomain = entries.filter(entry => entry.domain === domain)
        for (let start = 0; start < ofDomain.length; start += config.bulkMaxFacts) {
          const batch = ofDomain.slice(start, start + config.bulkMaxFacts)
          const result = await ctx.memory.rememberMany({
            scope,
            facts: batch.map(entry => ({ text: entry.text, ...entry.recordedAt === undefined ? {} : { recordedAt: entry.recordedAt } })),
            domain,
            signal: exec.signal,
          })
          written += result.ids.length
          skipped += result.skipped
        }
      }
      const invalidNote = invalid.length === 0 ? '' : `; ${invalid.length} lines were not facts (lines ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? ', …' : ''})`
      return textResult({
        text: `Imported ${written} facts; skipped ${skipped} already in memory${invalidNote}.`,
        written,
        skipped,
        invalid: invalid.length,
      })
    },
  }))

  // Registered only while a provider exists, so a composition without one shows the model no memory tools.
  ctx.effect(() => ctx.memory.whileActive(() => {
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }), 'tool-memory.tools')
}
