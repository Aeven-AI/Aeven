/**
 * Deferred tools: tools matching the configured name patterns (every MCP
 * server's `mcp__*` tools by default) leave the model request until the model
 * asks for them with `tool_search`.
 *
 * Providers cap a request's tool count (128 for the Aeven and DeepSeek APIs),
 * and every change to the request's tool list re-bills the cached prompt. The
 * system prompt therefore carries an index of the deferred tools, grouped by
 * namespace with a readable title, plus the MCP servers that are configured but
 * not serving and why. The index is frozen per agent; later changes reach the
 * model as a logged update message, so connecting or losing a server does not
 * rewrite the prompt.
 *
 * `tool_search` takes three query forms. Keywords list matching tools and load
 * nothing. `select:` loads exact tools: an agent presented with `run_code`
 * receives their SDK declarations in the result and calls them inside a
 * program, so its request tool list never changes; any other agent receives
 * their schemas and has them added to its following requests, refused when the
 * request would exceed `maxRequestTools`. `restart:` reconnects an MCP server
 * that is down.
 *
 * The request header logs each request's tool list, so what the model saw
 * stays reconstructable from the session log. The loaded set is rebuilt from
 * the session's raw `tool/call` and `tool/result` events, which compaction
 * does not remove, when a resumed agent first assembles a request.
 *
 * @module @aeven/tool-search
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@aeven/agent'
import type {} from '@aeven/agent'
import type {} from '@aeven/code-runtime'
import { createUserMessage, HarnessError, type ToolSchema } from '@aeven/llm'
import type { McpServerReport } from '@aeven/mcp-client'
import { scopeTarget } from '@aeven/scope'
import { SessionSeq, type Session } from '@aeven/session'
import type {} from '@aeven/system-prompt'
import { defineTool, RUN_CODE_NAME, renderToolsSdkDeclarations, renderToolsSdkPyDeclarations, type ToolSdkSchema } from '@aeven/tools'

export const name = 'tool-search'
export const inject = ['tools', 'systemPrompt']

/** A titled group of deferred tools that are not MCP tools. */
export interface ToolGroup {
  /** What the group's tools do, shown in the index (`Image and video generation`). */
  title: string
  /** Tool name patterns in the group; `*` matches any run of characters. */
  tools: string[]
}

/** Which tools wait for `tool_search`, how they are grouped, and the request limits. */
export interface Config {
  /** Tool name patterns to defer; `*` matches any run of characters. */
  defer?: string[]
  /** Titles for deferred tools that are not MCP tools; the first matching group wins. */
  groups?: ToolGroup[]
  /** Tools one keyword search lists at most. */
  maxResults?: number
  /** Most tools one model request may declare; a `select:` that would exceed it is refused. */
  maxRequestTools?: number
}

export const Config: z<Config> = z.object({
  defer: z.array(z.string().min(1)).default(['mcp__*']),
  groups: z.array(z.object({
    title: z.string().min(1).required(),
    tools: z.array(z.string().min(1)).required(),
  })).default([]),
  maxResults: z.number().step(1).min(1).max(20).default(8),
  maxRequestTools: z.number().step(1).min(1).default(128),
})

/** The tool the model loads deferred tools with. */
const TOOL_NAME = 'tool_search'

/** First line of a native load result; the loaded set is rebuilt from it on resume. */
const LOADED_PREFIX = 'Loaded tools: '

/** First line of a `run_code` declaration result; such loads leave the request tool list unchanged. */
const DECLARED_PREFIX = 'Declared for run_code: '

/** Section naming the deferred tools. */
const SECTION = 'deferred-tools'

/** Title of deferred tools that match no configured group. */
const OTHER_TITLE = 'Other tools'

/** Index text the model receives when nothing is deferred. */
const EMPTY_INDEX = 'Deferred tools: none.'

/** Words a keyword query carries that say nothing about a tool. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'into', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'with'])

/** One namespace line of the index. */
interface IndexEntry {
  title: string
  /** Common name prefix (`mcp__server__`), or empty for a titled group of native tools. */
  prefix: string
  /** Tool names with the prefix removed, sorted. */
  names: string[]
}

/** An MCP server the agent's tools can come from that is not serving. */
interface UnavailableServer {
  title: string
  serverName: string
  toolPrefix: string
  state: McpServerReport['state']
  error?: string
}

/** Everything the index names for one agent at one moment. */
export interface IndexSnapshot {
  /** Namespaces with deferred tools, sorted by title. */
  entries: IndexEntry[]
  /** Configured MCP servers that are not serving. */
  unavailable: UnavailableServer[]
}

/** Per-agent discovery state. */
interface AgentState {
  /** Tools whose schemas this agent's requests carry. */
  loaded: Set<string>
  /** Whether the agent's last request presented `run_code`. */
  ptc: boolean
  /** Tools the last request declared besides loaded deferred tools. */
  baseTools: number
  /** Index text in the system prompt, frozen until compaction; undefined before the first request and when nothing is deferred. */
  section: string | undefined
  /** Index text the model last received, by the section or an update message; undefined before the first request. */
  announced?: string
}

/**
 * Compile name patterns into one matcher.
 * @param patterns - name patterns with `*` wildcards.
 * @returns whether a tool name matches any pattern.
 */
function matcher(patterns: readonly string[]): (name: string) => boolean {
  const escape = (value: string) => value.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  const compiled = patterns.map(pattern => new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`, 'u'))
  return toolName => compiled.some(pattern => pattern.test(toolName))
}

/**
 * The words a tool name, title, or description offers a search.
 * @param text - name, title, or description.
 * @returns lowercase terms.
 */
function terms(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)
}

/**
 * The MCP namespace prefix of a tool name.
 * @param toolName - a public tool name.
 * @returns `mcp__<server>__`, or undefined for a tool outside any MCP server.
 */
export function mcpPrefix(toolName: string): string | undefined {
  const parts = toolName.split('__')
  return parts[0] === 'mcp' && parts.length >= 3 ? `mcp__${parts[1] as string}__` : undefined
}

/**
 * The first sentence of a description, bounded for a search listing.
 * @param description - a tool description.
 * @returns one short line.
 */
function summary(description: string): string {
  const line = description.replace(/\s+/gu, ' ').trim()
  const sentence = /^.+?[.!?](?=\s|$)/u.exec(line)?.[0] ?? line
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence
}

/**
 * Rank deferred tools against a keyword query. Terms prefixed with `+` must
 * appear in the tool's name or namespace title. Name and title matches outrank
 * description matches, and a tool whose only evidence is one description word
 * is dropped, so a common word such as "page" or "window" does not list
 * unrelated tools.
 * @param tools - the deferred tools, each with its namespace title.
 * @param query - the model's keywords.
 * @param limit - how many to return.
 * @returns the best matches, best first.
 */
export function searchTools<T extends { tool: ToolSchema; title: string }>(tools: readonly T[], query: string, limit: number): T[] {
  const words = query.trim().split(/\s+/u).filter(Boolean)
  const required = words.filter(word => word.startsWith('+')).flatMap(word => terms(word.slice(1)))
  const optional = new Set(words.filter(word => !word.startsWith('+')).flatMap(terms).filter(term => !STOP_WORDS.has(term)))
  return tools
    .map((entry) => {
      const nameTerms = terms(entry.tool.name)
      const titleTerms = terms(entry.title)
      const named = [...nameTerms, ...titleTerms]
      if (!required.every(term => named.some(candidate => candidate.includes(term)))) return { entry, score: 0 }
      const descriptionTerms = new Set(terms(entry.tool.description))
      let score = required.length * 3
      let descriptionHits = 0
      for (const term of optional) {
        if (nameTerms.includes(term)) score += 3
        else if (titleTerms.includes(term)) score += 2
        else if (term.length >= 3 && named.some(candidate => candidate.includes(term))) score += 2
        else if (descriptionTerms.has(term)) {
          score += 1
          descriptionHits += 1
        }
      }
      return { entry, score: score === descriptionHits && descriptionHits < 2 ? 0 : score }
    })
    .filter(ranked => ranked.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.tool.name.localeCompare(b.entry.tool.name))
    .slice(0, limit)
    .map(ranked => ranked.entry)
}

/**
 * Render the index text. It names every deferred tool, loaded or not, so it
 * does not change when the model loads a tool.
 * @param snapshot - the namespaces and unavailable servers.
 * @param ptc - whether deferred tools are called inside `run_code`.
 * @returns the index text, or undefined when there is nothing to name.
 */
export function renderIndex(snapshot: IndexSnapshot, ptc: boolean): string | undefined {
  if (snapshot.entries.length === 0 && snapshot.unavailable.length === 0) return undefined
  const lines = [ptc
    ? `Deferred tools: call them inside ${RUN_CODE_NAME} as tools["<name>"](args). ${TOOL_NAME} "select:<name>[,<name>...]" returns their declarations; a keyword query lists matching tools with what they do and loads nothing.`
    : `Deferred tools: their schemas are not loaded, so they cannot be called yet. ${TOOL_NAME} "select:<name>[,<name>...]" loads exact tools, callable from your next step; a keyword query lists matching tools with what they do and loads nothing.`]
  for (const entry of snapshot.entries) {
    lines.push(entry.prefix === ''
      ? `- ${entry.title}: ${entry.names.join(', ')}`
      : `- ${entry.title}: ${entry.prefix}{${entry.names.join(', ')}}`)
  }
  if (snapshot.unavailable.length > 0) {
    lines.push('Not serving now:')
    for (const server of snapshot.unavailable) {
      const state = server.state === 'failed' ? 'stopped' : server.state === 'retrying' ? 'reconnecting' : 'starting'
      lines.push(`- ${server.title} (${server.toolPrefix}*): ${state}${server.error === undefined ? '' : ` after: ${server.error}`}. ${TOOL_NAME} "restart:${server.serverName}" connects it again.`)
    }
  }
  return lines.join('\n')
}

/**
 * The tools a session loaded into its requests, from its raw `tool_search`
 * events. Raw events survive compaction, which rewrites only derived history.
 * @param session - the session whose log is read.
 * @returns the loaded tool names.
 */
function loadedFromLog(session: Session): Set<string> {
  const loaded = new Set<string>()
  const searches = new Set<string>()
  for (let seq = 0; seq < session.seq; seq++) {
    const event = session.eventAt(SessionSeq(seq))
    if (event?.type === 'tool/call' && event.data.name === TOOL_NAME) searches.add(event.data.callId)
    if (event?.type !== 'tool/result' || !searches.has(event.data.message.source.callId)) continue
    const result = event.data.message.content[0]
    if (result.isError === true) continue
    const first = result.content.find(part => part.type === 'text')
    const line = first?.type === 'text' ? first.text.split('\n', 1)[0] : undefined
    if (line?.startsWith(LOADED_PREFIX) !== true) continue
    for (const toolName of line.slice(LOADED_PREFIX.length).split(',')) {
      if (toolName.trim() !== '') loaded.add(toolName.trim())
    }
  }
  return loaded
}

/**
 * Register `tool_search`, defer matching tools from every assembled request,
 * and keep the model's deferred-tool index current.
 * @param ctx - plugin context carrying the tool registry and the system prompt.
 * @param config - defer patterns, groups, and limits.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery's `.default()` fills every field before apply runs.
  const maxResults = config.maxResults as number
  const maxRequestTools = config.maxRequestTools as number
  const deferred = matcher(config.defer as string[])
  const groups = (config.groups as ToolGroup[]).map(group => ({ title: group.title, matches: matcher(group.tools) }))
  const states = new WeakMap<Agent, AgentState>()
  const stateOf = (agent: Agent): AgentState => {
    let state = states.get(agent)
    if (state === undefined) {
      state = { loaded: loadedFromLog(agent.session), ptc: false, baseTools: 0, section: undefined }
      states.set(agent, state)
    }
    return state
  }

  /** The deferred tools this agent can see, excluding `tool_search` itself. */
  const deferredTools = (agent: Agent): ToolSchema[] =>
    ctx.tools.schemas(agent).filter(tool => tool.name !== TOOL_NAME && deferred(tool.name))

  const servers = (agent: Agent): Promise<McpServerReport[]> => ctx.waterfall(
    scopeTarget(agent, agent),
    'mcp/servers',
    { agent },
    () => Promise.resolve([]),
  )

  /** The namespace title of one deferred tool. */
  const titleOf = (toolName: string, reports: readonly McpServerReport[]): string => {
    const prefix = mcpPrefix(toolName)
    if (prefix !== undefined) {
      const report = reports.find(candidate => candidate.toolPrefix === prefix)
      return report?.title ?? prefix.slice('mcp__'.length, -2)
    }
    return groups.find(group => group.matches(toolName))?.title ?? OTHER_TITLE
  }

  const snapshot = async (agent: Agent): Promise<IndexSnapshot> => {
    const reports = await servers(agent)
    const byNamespace = new Map<string, IndexEntry>()
    for (const tool of deferredTools(agent)) {
      const prefix = mcpPrefix(tool.name) ?? ''
      const title = titleOf(tool.name, reports)
      const key = `${title}\0${prefix}`
      const entry = byNamespace.get(key) ?? { title, prefix, names: [] }
      entry.names.push(tool.name.slice(prefix.length))
      byNamespace.set(key, entry)
    }
    const entries = [...byNamespace.values()]
      .map(entry => ({ ...entry, names: entry.names.sort() }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.prefix.localeCompare(b.prefix))
    const unavailable = reports
      // A server whose tools this agent never defers is not this index's to report.
      .filter(report => report.state !== 'connected' && deferred(`${report.toolPrefix}tool`))
      .map((report): UnavailableServer => ({
        title: report.title ?? report.serverName,
        serverName: report.serverName,
        toolPrefix: report.toolPrefix,
        state: report.state,
        ...report.error === undefined ? {} : { error: report.error },
      }))
      .sort((a, b) => a.serverName.localeCompare(b.serverName))
    return { entries, unavailable }
  }

  ctx.on('agent/session-start', ({ agent, source }) => {
    // Compaction drops the update messages, so the next request freezes a fresh index.
    if (source !== 'compact') return
    const state = states.get(agent)
    if (state === undefined) return
    state.section = undefined
    delete state.announced
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const state = states.get(payload.agent)
    if (decision.kind === 'reject' || state?.announced === undefined) return decision
    const current = renderIndex(await snapshot(payload.agent), state.ptc) ?? EMPTY_INDEX
    if (current === state.announced) return decision
    state.announced = current
    const text = `The deferred tools changed. This index replaces the one in the system prompt and any earlier update:\n${current}`
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'notice', summary: 'Deferred tools changed' },
        }),
      ],
    }
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    const agent = context.agent
    if (agent === undefined) return result
    const state = stateOf(agent)
    state.ptc = result.tools.some(tool => tool.name === RUN_CODE_NAME)
    if (state.announced === undefined) {
      state.section = renderIndex(await snapshot(agent), state.ptc)
      state.announced = state.section ?? EMPTY_INDEX
    }
    // Without anything to find or restart, the search tool itself is dead weight.
    const searchable = state.announced !== EMPTY_INDEX
    const tools = result.tools.filter(tool => tool.name === TOOL_NAME
      ? searchable
      : !deferred(tool.name) || (!state.ptc && state.loaded.has(tool.name)))
    state.baseTools = tools.filter(tool => !state.loaded.has(tool.name)).length
    if (tools.length > maxRequestTools) {
      throw new HarnessError(`This request would declare ${tools.length} tools; the provider accepts at most ${maxRequestTools}. Defer more tools with the tool-search \`defer\` patterns.`, 'TOOL_SEARCH_LIMIT')
    }
    return {
      ...result,
      tools,
      sections: state.section === undefined ? result.sections : [...result.sections, { name: SECTION, text: state.section }],
    }
  })

  /** SDK declarations for loaded tools, in the mounted code runtime's language. */
  const declarations = (agent: Agent, found: readonly ToolSchema[]): string => {
    const schemas = found.flatMap((tool): ToolSdkSchema[] => {
      const definition = ctx.tools.get(tool.name, agent)
      /* v8 ignore next -- `schemas()` and `get()` read the same visible set, so a listed tool resolves. */
      return definition === undefined ? [] : [{ ...tool, output: definition.output.schema }]
    })
    return ctx.get('codeRuntime')?.language === 'python'
      ? renderToolsSdkPyDeclarations(schemas)
      : renderToolsSdkDeclarations(schemas)
  }

  const select = async (agent: Agent, wanted: string[]): Promise<string> => {
    const state = stateOf(agent)
    const found = deferredTools(agent).filter(tool => wanted.includes(tool.name))
    const missing = wanted.filter(value => !found.some(tool => tool.name === value))
    if (found.length === 0) {
      const reports = await servers(agent)
      const down = reports.find(report => report.state !== 'connected' && missing.some(value => value.startsWith(report.toolPrefix)))
      throw new HarnessError(down === undefined
        ? `No deferred tool is named ${missing.join(', ')}. Use a name from the deferred tools index.`
        : `${down.title ?? down.serverName} is not serving${down.error === undefined ? '' : ` (${down.error})`}. Call ${TOOL_NAME} with "restart:${down.serverName}" to connect it again.`, 'TOOL_SEARCH_NOT_FOUND')
    }
    const note = missing.length === 0 ? '' : `\nNot deferred tools: ${missing.join(', ')}.`
    if (state.ptc) {
      return `${DECLARED_PREFIX}${found.map(tool => tool.name).join(', ')}\nCall them inside ${RUN_CODE_NAME} as tools["<name>"](args).${note}\n${declarations(agent, found)}`
    }
    const adding = found.filter(tool => !state.loaded.has(tool.name))
    const total = state.baseTools + state.loaded.size + adding.length
    if (total > maxRequestTools) {
      throw new HarnessError(`Loading ${adding.length} more tools would declare ${total} tools in one request; the provider accepts at most ${maxRequestTools}. Load only the tools this task needs.`, 'TOOL_SEARCH_LIMIT')
    }
    for (const tool of adding) state.loaded.add(tool.name)
    return [
      `${LOADED_PREFIX}${found.map(tool => tool.name).join(', ')}${note}`,
      ...found.map(tool => `<function>${JSON.stringify(tool)}</function>`),
    ].join('\n')
  }

  const search = async (agent: Agent, query: string, limit: number): Promise<string> => {
    const reports = await servers(agent)
    const candidates = deferredTools(agent).map(tool => ({ tool, title: titleOf(tool.name, reports) }))
    const found = searchTools(candidates, query, limit)
    if (found.length === 0) {
      const titles = [...new Set(candidates.map(candidate => candidate.title))].sort()
      return `No deferred tool matches "${query}". Deferred namespaces: ${titles.length === 0 ? 'none' : titles.join('; ')}.`
    }
    return [
      ...found.map(({ tool, title }) => `- ${tool.name} (${title}): ${summary(tool.description)}`),
      `Nothing was loaded. Load tools with ${TOOL_NAME} "select:${found.map(({ tool }) => tool.name).join(',')}" or a subset.`,
    ].join('\n')
  }

  const restart = async (agent: Agent, serverName: string): Promise<string> => {
    const report = (await servers(agent)).find(candidate => candidate.serverName === serverName)
    if (report === undefined) throw new HarnessError(`No MCP server named ${serverName} serves this session.`, 'TOOL_SEARCH_NOT_FOUND')
    const status = await report.restart()
    const title = report.title ?? serverName
    if (status.state !== 'connected') {
      throw new HarnessError(`${title} did not connect${status.error === undefined ? '' : `: ${status.error}`}.`, 'TOOL_SEARCH_RESTART_FAILED')
    }
    const names = ctx.tools.schemas(agent).map(tool => tool.name).filter(toolName => toolName.startsWith(report.toolPrefix)).sort()
    return `${title} is connected. Its tools: ${names.length === 0 ? 'none' : names.join(', ')}.`
  }

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Find and load deferred tools. "select:a,b" loads exact tools named in the deferred tools index; keywords list matching tools with what they do and load nothing (prefix a keyword with + to require it in the tool name or namespace); "restart:<server>" connects an MCP server the index lists as not serving.',
    parameters: {
      query: { type: 'string', required: true, description: 'Either "select:<name>[,<name>...]", "restart:<server>", or search keywords.' },
      max_results: { type: 'integer', description: 'Keyword searches list at most this many tools.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new HarnessError('tool_search needs a calling agent', 'TOOL_SEARCH_NO_AGENT')
      const query = args.query.trim()
      if (query.startsWith('select:')) {
        return select(agent, query.slice('select:'.length).split(',').map(value => value.trim()).filter(Boolean))
      }
      if (query.startsWith('restart:')) return restart(agent, query.slice('restart:'.length).trim())
      return search(agent, query, Math.min(args.max_results ?? maxResults, maxResults))
    },
  }))
}
