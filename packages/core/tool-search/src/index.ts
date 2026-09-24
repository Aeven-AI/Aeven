/**
 * Deferred tools: tools matching the configured name patterns (every MCP
 * server's `mcp__*` tools by default) leave the model request until the model
 * loads them with `tool_search`.
 *
 * A deployment with a computer-use driver and a browser DevTools server
 * carries close to a hundred MCP tools and 150 KB of their schemas on every
 * request, and providers cap a request's tool count (128 for the Aeven and
 * DeepSeek APIs). Deferring keeps the request to the tools a session uses: a
 * system section names every deferred tool, and `tool_search` returns the
 * schemas the model asks for and adds those tools to its following requests.
 *
 * The request header logs each request's tool list, so what the model saw
 * stays reconstructable from the session log. The loaded set is rebuilt from
 * the session's own `tool_search` results when a resumed agent first
 * assembles a request.
 *
 * @module @aeven/tool-search
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/agent'
import { HarnessError, type ToolSchema } from '@aeven/llm'
import type {} from '@aeven/system-prompt'
import { defineTool } from '@aeven/tools'

export const name = 'tool-search'
export const inject = ['tools', 'systemPrompt']

/** Which tools wait for `tool_search` and how many schemas one search returns. */
export interface Config {
  /** Tool name patterns to defer; `*` matches any run of characters. */
  defer: string[]
  /** Schemas one keyword search returns at most. */
  maxResults: number
}

export const Config: z<Config> = z.object({
  defer: z.array(z.string().min(1)).default(['mcp__*']),
  maxResults: z.number().step(1).min(1).max(50).default(5),
})

/** The tool the model loads deferred tools with. */
const TOOL_NAME = 'tool_search'

/** First line of every successful result; the loaded set is rebuilt from it on resume. */
const LOADED_PREFIX = 'Loaded tools: '

/** Section naming the deferred tools. */
const SECTION = 'deferred-tools'

/**
 * Compile the defer patterns into one matcher.
 * @param patterns - name patterns with `*` wildcards.
 * @returns whether a tool name is deferred.
 */
function matcher(patterns: readonly string[]): (name: string) => boolean {
  const escape = (value: string) => value.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  const compiled = patterns.map(pattern => new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`, 'u'))
  return toolName => compiled.some(pattern => pattern.test(toolName))
}

/**
 * The words a tool name and description offer a search.
 * @param text - name or description.
 * @returns lowercase terms.
 */
function terms(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)
}

/**
 * Rank deferred tools against a keyword query. Terms prefixed with `+` must
 * appear in the tool's name; the rest score by where they appear.
 * @param tools - the deferred tools.
 * @param query - the model's keywords.
 * @param limit - how many to return.
 * @returns the best matches, best first.
 */
export function searchTools(tools: readonly ToolSchema[], query: string, limit: number): ToolSchema[] {
  const words = query.trim().split(/\s+/u).filter(Boolean)
  const required = words.filter(word => word.startsWith('+')).flatMap(word => terms(word.slice(1)))
  const optional = words.filter(word => !word.startsWith('+')).flatMap(terms)
  return tools
    .map((tool) => {
      const nameTerms = terms(tool.name)
      if (!required.every(term => nameTerms.some(candidate => candidate.includes(term)))) return { tool, score: -1 }
      const description = tool.description.toLowerCase()
      let score = required.length
      for (const term of optional) {
        if (nameTerms.includes(term)) score += 3
        else if (nameTerms.some(candidate => candidate.includes(term))) score += 2
        else if (description.includes(term)) score += 1
      }
      return { tool, score }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map(entry => entry.tool)
}

/**
 * The section listing deferred tools, grouped by MCP server. It names every
 * deferred tool, loaded or not, so the text stays the same across a session.
 * @param names - the deferred tool names.
 * @returns the section text.
 */
export function renderDeferredSection(names: readonly string[]): string {
  const groups = new Map<string, string[]>()
  for (const toolName of [...names].sort()) {
    const parts = toolName.split('__')
    const group = parts.length >= 3 ? `${parts[0] as string}__${parts[1] as string}__` : ''
    const short = parts.length >= 3 ? parts.slice(2).join('__') : toolName
    const list = groups.get(group) ?? []
    list.push(short)
    groups.set(group, list)
  }
  const lines = [...groups].map(([group, shorts]) => group === '' ? shorts.join(', ') : `${group}{${shorts.join(', ')}}`)
  return [
    `These tools are available but their schemas are not loaded, so they cannot be called yet. Call ${TOOL_NAME} to load them: query "select:<name>[,<name>...]" loads exact tools; keywords search names and descriptions ("+prefix" requires a name match). Loaded tools become callable from your next step.`,
    ...lines,
  ].join('\n')
}

/**
 * The tools a session loaded, from its own `tool_search` results.
 * @param agent - the agent whose session is read.
 * @returns the loaded tool names.
 */
function loadedFromLog(agent: Agent): Set<string> {
  const loaded = new Set<string>()
  const searches = new Set<string>()
  for (const message of agent.session.deriveMessages()) {
    for (const block of message.content) {
      if (block.type === 'tool-call' && block.name === TOOL_NAME) searches.add(block.id)
      if (block.type !== 'tool-result' || block.isError === true || !searches.has(block.toolCallId)) continue
      const first = block.content.find(part => part.type === 'text')
      const line = first?.type === 'text' ? first.text.split('\n', 1)[0] : undefined
      if (line?.startsWith(LOADED_PREFIX) !== true) continue
      for (const toolName of line.slice(LOADED_PREFIX.length).split(',')) {
        if (toolName.trim() !== '') loaded.add(toolName.trim())
      }
    }
  }
  return loaded
}

/**
 * Register `tool_search` and defer matching tools from every assembled request.
 * @param ctx - plugin context carrying the tool registry and the system prompt.
 * @param config - defer patterns and the search limit.
 */
export function apply(ctx: Context, config: Config): void {
  const deferred = matcher(config.defer)
  const loadedByAgent = new WeakMap<Agent, Set<string>>()
  const loadedFor = (agent: Agent): Set<string> => {
    let loaded = loadedByAgent.get(agent)
    if (loaded === undefined) {
      loaded = loadedFromLog(agent)
      loadedByAgent.set(agent, loaded)
    }
    return loaded
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    const agent = context.agent
    if (agent === undefined) return result
    const pending = result.tools.filter(tool => deferred(tool.name))
    // Without deferrable tools, the search tool itself is dead weight.
    if (pending.length === 0) return { ...result, tools: result.tools.filter(tool => tool.name !== TOOL_NAME) }
    const loaded = loadedFor(agent)
    return {
      ...result,
      tools: result.tools.filter(tool => !deferred(tool.name) || loaded.has(tool.name)),
      sections: [...result.sections, { name: SECTION, text: renderDeferredSection(pending.map(tool => tool.name)) }],
    }
  })

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Load deferred tools by name or keyword so they can be called. Use "select:a,b" for exact names from the deferred tools list, or keywords to search names and descriptions; prefix a keyword with + to require it in the name.',
    parameters: {
      query: { type: 'string', required: true, description: 'Either "select:<name>[,<name>...]" or search keywords.' },
      max_results: { type: 'integer', description: 'Keyword searches return at most this many tools.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new HarnessError('tool_search needs a calling agent', 'TOOL_SEARCH_NO_AGENT')
      const candidates = ctx.tools.schemas(agent).filter(tool => deferred(tool.name))
      const query = args.query.trim()
      let found: ToolSchema[]
      if (query.startsWith('select:')) {
        const wanted = query.slice('select:'.length).split(',').map(value => value.trim()).filter(Boolean)
        found = candidates.filter(tool => wanted.includes(tool.name))
        const missing = wanted.filter(value => !found.some(tool => tool.name === value))
        if (found.length === 0) {
          throw new HarnessError(`No deferred tool is named ${missing.join(', ')}. Use a name from the deferred tools list.`, 'TOOL_SEARCH_NOT_FOUND')
        }
      } else {
        found = searchTools(candidates, query, args.max_results ?? config.maxResults)
        if (found.length === 0) {
          throw new HarnessError(`No deferred tool matches "${query}". Try other keywords or a name from the deferred tools list.`, 'TOOL_SEARCH_NOT_FOUND')
        }
      }
      const loaded = loadedFor(agent)
      for (const tool of found) loaded.add(tool.name)
      return Promise.resolve([
        `${LOADED_PREFIX}${found.map(tool => tool.name).join(', ')}`,
        ...found.map(tool => `<function>${JSON.stringify(tool)}</function>`),
      ].join('\n'))
    },
  }))
}
