/**
 * Model-facing memory Consumer: tools to search long-term memory and read its traces, policies,
 * environment models, episodes, and crystallized skills.
 *
 * @module @aeven/tool-memory
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@aeven/brand'
import type { Agent } from '@aeven/agent'
import { MEMORY_TOOL, memoryScopeOf, type MemoryEpisodeId, type MemoryItemId, type MemoryRecallLimits, type MemoryScope } from '@aeven/memory'
import { defineTool } from '@aeven/tools'
import type { JsonValue } from '@aeven/util-values'

export const name = 'tool-memory'
export const inject = ['memory', 'tools']

/** Consumer configuration. */
export interface Config {
  /** Maximum characters of each body or snippet a tool returns. */
  resultMaxChars: number
  /** Hard budget for one `memory_search`, in milliseconds. */
  searchTimeoutMs: number
}

export const Config: z<Config> = z.object({
  resultMaxChars: z.natural().min(128).default(1200),
  searchTimeoutMs: z.natural().min(100).default(3000),
})

const TEXT_OUTPUT = {
  schema: {
    type: 'object' as const,
    additionalProperties: true,
    properties: { text: { type: 'string' as const, required: true } },
  },
  render: (_args: unknown, value: Record<string, unknown>) => [{
    type: 'text' as const,
    text: typeof value['text'] === 'string' ? value['text'] : JSON.stringify(value),
  }],
} as const

type TextResult = { text: string } & Record<string, JsonValue>

/** Detach a result into lossless JSON, dropping absent optional fields. */
function json(value: { text: string } & Record<string, unknown>): TextResult {
  return JSON.parse(JSON.stringify(value)) as TextResult
}

function clip(value: string | undefined, maxChars: number): string {
  if (!value) return ''
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`
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

/**
 * Register the memory tools.
 * @param ctx - Host context with the memory slot and tool registry.
 * @param config - validated consumer configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const cap = config.resultMaxChars
  const tools: Parameters<typeof ctx.tools.register>[0][] = []

  tools.push(defineTool({
    name: MEMORY_TOOL.search,
    description: 'Search long-term memory of earlier work: past task traces, learned policies, environment knowledge, and reusable skills. ' +
      'Each direct-user turn already receives one automatic recall; use this to rephrase or broaden an insufficient recall, and before claiming earlier context is unavailable.',
    parameters: {
      query: { type: 'string', required: true, description: 'A concise free-text memory query.' },
      maxResults: { type: 'integer', description: 'Maximum results per kind (1-50).' },
      skills: { type: 'integer', description: 'Skill result limit (0-100).' },
      traces: { type: 'integer', description: 'Trace and policy result limit (0-100).' },
      worldModels: { type: 'integer', description: 'Environment-model result limit (0-100).' },
      sessionOnly: { type: 'boolean', description: 'Restrict results to memory captured from this session.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = args.query.trim()
      if (!query) throw new Error('query must be a non-empty string')
      const limits = limitsOf(args)
      const recall = await ctx.memory.recall({
        scope: scopeOf(exec.agent),
        query,
        purpose: 'tool',
        ...args.sessionOnly === true ? { sessionOnly: true } : {},
        ...limits === undefined ? {} : { limits },
        timeoutMs: config.searchTimeoutMs,
        signal: exec.signal,
      })
      const hits = recall.hits.map(hit => ({ kind: hit.kind, id: hit.id, domain: hit.domain, score: hit.score, snippet: clip(hit.snippet, cap) }))
      const text = hits.length === 0
        ? recall.timedOut ? 'Memory search timed out; no results.' : 'No relevant memories found.'
        : `Found ${hits.length} memories:\n\n${hits.map((hit, i) => `${i + 1}. [${hit.kind}:${hit.id}] (${hit.domain}) ${hit.snippet} (score=${hit.score.toFixed(3)})`).join('\n')}`
      return json({ text, hits, ...recall.timedOut ? { timedOut: true } : {} })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.get,
    description: 'Read one memory item found by a memory search: a past task trace, a learned policy, or an environment model.',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory item id.' },
      kind: { type: 'string', enum: ['trace', 'policy', 'world-model'], description: 'Item kind; defaults to trace.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const kind = args.kind ?? 'trace'
      const id = brandString<MemoryItemId>(args.id.trim())
      const item = await ctx.memory.detail({ scope: scopeOf(exec.agent), kind, id, signal: exec.signal })
      if (!item) return json({ text: `No ${kind} memory found for id "${id}".`, found: false, kind, id })
      const body = clip(item.body, cap)
      const facts = Object.fromEntries(Object.entries(item.facts).map(([key, value]) => [key, typeof value === 'string' ? clip(value, cap) : value]))
      return json({ text: `${item.title}\n\n${body}`.trim(), found: true, kind, id, body, facts })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.timeline,
    description: 'List the ordered traces of one past episode to reconstruct how an earlier task went.',
    parameters: {
      episodeId: { type: 'string', required: true, description: 'Episode id from a memory item.' },
      limit: { type: 'integer', description: 'Maximum traces (1-100).' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const episodeId = brandString<MemoryEpisodeId>(args.episodeId.trim())
      const entries = await ctx.memory.timeline({ scope: scopeOf(exec.agent), episodeId, limit: bounded(args.limit, 20, 1, 100), signal: exec.signal })
      const traces = entries.map(entry => ({ ...entry, userText: clip(entry.userText, cap), agentText: clip(entry.agentText, cap) }))
      return json({
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
    output: TEXT_OUTPUT,
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
      return json({
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
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const skills = await ctx.memory.skills({
        scope: scopeOf(exec.agent),
        ...args.status === undefined ? {} : { status: args.status },
        limit: bounded(args.limit, 10, 1, 50),
        signal: exec.signal,
      })
      const items = skills.map(skill => ({ ...skill, guide: clip(skill.guide, cap) }))
      return json({
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
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const id = brandString<MemoryItemId>(args.id.trim())
      const skill = await ctx.memory.useSkill({ scope: scopeOf(exec.agent), id, callId: exec.callId, signal: exec.signal })
      if (!skill) return json({ text: `No skill found for id "${id}".`, found: false, id })
      const guide = clip(skill.guide, cap)
      return json({ text: `${skill.name}\n\n${guide}`.trim(), found: true, ...skill, guide })
    },
  }))

  tools.push(defineTool({
    name: MEMORY_TOOL.remember,
    description: 'Store one fact the user explicitly asked you to remember, such as a preference, a name, or how they like a task done. ' +
      'Use only when the user asks you to remember something; ordinary conversation is remembered automatically.',
    parameters: {
      fact: { type: 'string', required: true, description: 'The fact to remember, stated concisely in the user\'s words.' },
      about: {
        type: 'string',
        enum: ['user', 'project'],
        description: 'user: a fact about the user that holds everywhere (the default). project: a fact that matters only in this project.',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const fact = args.fact.trim()
      if (!fact) throw new Error('fact must be a non-empty string')
      const id = await ctx.memory.remember({ scope: scopeOf(exec.agent), text: fact, domain: args.about === 'project' ? 'project' : 'person', signal: exec.signal })
      return json({ text: 'Remembered.', id })
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
