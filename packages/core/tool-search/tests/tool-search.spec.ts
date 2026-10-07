import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent, type PreStepDecision } from '@aeven/agent'
import { CodeRuntime, type CodeRunRequest, type CodeRunResult } from '@aeven/code-runtime'
import { createToolResultMessage, ToolCallId } from '@aeven/llm'
import type { McpServerReport } from '@aeven/mcp-client'
import { scopeTarget } from '@aeven/scope'
import { Session, SessionId } from '@aeven/session'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime, { defineTool, type Config as ToolsConfig } from '@aeven/tools'
import * as ToolSearch from '@aeven/tool-search'
import { mcpPrefix, renderIndex, searchTools } from '@aeven/tool-search'

class FakeRuntime extends CodeRuntime {
  readonly language: string
  readonly isolation = 'fake'

  constructor(ctx: Context, config: { language?: string } = {}) {
    super(ctx)
    this.language = config.language ?? 'typescript'
  }

  run(_request: CodeRunRequest): Promise<CodeRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

interface SetupOptions {
  mode?: ToolsConfig['mode']
  language?: string
  config?: ToolSearch.Config
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: options.mode ?? 'native' })
  if (options.mode !== undefined && options.mode !== 'native') await ctx.plugin(FakeRuntime, options.language === undefined ? {} : { language: options.language })
  await ctx.plugin(ToolSearch, options.config ?? {})
  return ctx
}

function tool(ctx: Context, name: string, description = `${name} tool.`) {
  return ctx.tools.register(defineTool({
    name,
    description,
    parameters: { text: { type: 'string', required: true, description: 'Text.' } },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
    execute: () => Promise.resolve('ok'),
  }))
}

function agentWith(session = Session.create(SessionId('agent'))): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function servers(ctx: Context, reports: Partial<McpServerReport>[]) {
  ctx.on('mcp/servers', async (_request, next) => [...await next(), ...reports.map((report): McpServerReport => ({
    serverName: 'srv',
    toolPrefix: 'mcp__srv__',
    state: 'connected',
    restart: () => Promise.resolve({ state: 'connected' }),
    ...report,
  }))])
}

const assemble = (ctx: Context, agent: Agent) => ctx.systemPrompt.assemble({ scope: agent, agent })
const toolNames = async (ctx: Context, agent: Agent) => (await assemble(ctx, agent)).tools.map(schema => schema.name)
const indexOf = async (ctx: Context, agent: Agent) => (await assemble(ctx, agent)).sections.find(section => section.name === 'deferred-tools')?.text

let calls = 0
async function search(ctx: Context, agent: Agent, query: string, extra: Record<string, unknown> = {}) {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`search-${++calls}`),
    name: 'tool_search',
    arguments: { query, ...extra },
    agent,
  })
  const first = result.content[0]
  return { isError: result.isError, text: first?.type === 'text' ? first.text : '' }
}

async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return ctx.waterfall(scopeTarget(agent, agent), 'agent/pre-step', {
    agent, messages: [], turn: 1, step: 2, signal: new AbortController().signal,
  }, () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [] }))
}

describe('tool-search index', () => {
  it('defers MCP tools and names them under their server title', async () => {
    const ctx = await setup()
    tool(ctx, 'read')
    tool(ctx, 'mcp__telegram_1a2b3c4d__send_file')
    tool(ctx, 'mcp__telegram_1a2b3c4d__get_history')
    tool(ctx, 'mcp__other__ping')
    servers(ctx, [{ serverName: 'telegram_1a2b3c4d', toolPrefix: 'mcp__telegram_1a2b3c4d__', title: 'Telegram (Olivier)' }])
    const agent = agentWith()

    const assembly = await assemble(ctx, agent)

    expect(assembly.tools.map(schema => schema.name).sort()).toEqual(['read', 'tool_search'])
    expect(assembly.sections.find(section => section.name === 'deferred-tools')?.text).toBe([
      'Deferred tools: their schemas are not loaded, so they cannot be called yet. tool_search "select:<name>[,<name>...]" loads exact tools, callable from your next step; a keyword query lists matching tools with what they do and loads nothing.',
      '- other: mcp__other__{ping}',
      '- Telegram (Olivier): mcp__telegram_1a2b3c4d__{get_history, send_file}',
    ].join('\n'))
  })

  it('groups deferred native tools by configured title and lists servers that are not serving', async () => {
    const ctx = await setup({ config: { defer: ['mcp__*', 'grok_*', 'mail_*'], groups: [{ title: 'Image and video generation', tools: ['grok_*'] }] } })
    tool(ctx, 'grok_imagine_image')
    tool(ctx, 'mail_send')
    servers(ctx, [
      { serverName: 'chrome_devtools', toolPrefix: 'mcp__chrome_devtools__', title: 'Chrome the user can see', state: 'failed', error: 'spawn npx ENOENT' },
      { serverName: 'playwright', toolPrefix: 'mcp__playwright__', state: 'retrying' },
      { serverName: 'starting', toolPrefix: 'mcp__starting__', state: 'connecting' },
    ])

    expect(await indexOf(ctx, agentWith())).toBe([
      'Deferred tools: their schemas are not loaded, so they cannot be called yet. tool_search "select:<name>[,<name>...]" loads exact tools, callable from your next step; a keyword query lists matching tools with what they do and loads nothing.',
      '- Image and video generation: grok_imagine_image',
      '- Other tools: mail_send',
      'Not serving now:',
      '- Chrome the user can see (mcp__chrome_devtools__*): stopped after: spawn npx ENOENT. tool_search "restart:chrome_devtools" connects it again.',
      '- playwright (mcp__playwright__*): reconnecting. tool_search "restart:playwright" connects it again.',
      '- starting (mcp__starting__*): starting. tool_search "restart:starting" connects it again.',
    ].join('\n'))
  })

  it('drops tool_search and the section when nothing is deferred or down', async () => {
    const ctx = await setup()
    tool(ctx, 'read')
    servers(ctx, [{ serverName: 'never_deferred', toolPrefix: 'mcp__never_deferred__', state: 'failed' }])
    const native = await setup({ config: { defer: ['grok_*'] } })
    tool(native, 'read')
    servers(native, [{ serverName: 'never_deferred', toolPrefix: 'mcp__never_deferred__', state: 'failed' }])

    expect(await toolNames(ctx, agentWith())).toEqual(['read', 'tool_search'])
    const assembly = await assemble(native, agentWith())
    expect(assembly.tools.map(schema => schema.name)).toEqual(['read'])
    expect(assembly.sections.some(section => section.name === 'deferred-tools')).toBe(false)
  })

  it('leaves an assembly without an agent untouched', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__srv__ping')

    expect((await ctx.systemPrompt.assemble()).tools.map(schema => schema.name).sort()).toEqual(['mcp__srv__ping', 'tool_search'])
  })

  it('keeps the frozen index and announces changes once in a pre-step message', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    const first = await indexOf(ctx, agent)

    expect(await preStep(ctx, agent)).toEqual({ kind: 'enter', messages: [] })
    tool(ctx, 'mcp__srv__pong')
    const decision = await preStep(ctx, agent)

    expect(await indexOf(ctx, agent)).toBe(first)
    expect(decision.kind === 'enter' ? decision.messages : []).toHaveLength(1)
    const message = decision.kind === 'enter' ? decision.messages[0] : undefined
    const text = message?.content[0]?.type === 'text' ? message.content[0].text : ''
    expect(text).toContain('This index replaces the one in the system prompt')
    expect(text).toContain('- srv: mcp__srv__{ping, pong}')
    expect(await preStep(ctx, agent)).toEqual({ kind: 'enter', messages: [] })
  })

  it('announces an empty index when every deferred tool goes away', async () => {
    const ctx = await setup()
    const dispose = tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    await assemble(ctx, agent)
    dispose()

    const decision = await preStep(ctx, agent)

    const message = decision.kind === 'enter' ? decision.messages[0] : undefined
    expect(message?.content[0]?.type === 'text' ? message.content[0].text : '').toContain('Deferred tools: none.')
    expect(await toolNames(ctx, agent)).toEqual([])
  })

  it('stays silent before the first request, on a rejected step, and refreezes after compaction', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    expect(await preStep(ctx, agent)).toEqual({ kind: 'enter', messages: [] })
    await assemble(ctx, agent)
    tool(ctx, 'mcp__srv__pong')
    ctx.on('agent/pre-step', () => Promise.resolve<PreStepDecision>({ kind: 'reject' }), { prepend: true })
    expect(await preStep(ctx, agent)).toEqual({ kind: 'reject' })

    ctx.emit(scopeTarget(agent, agent), 'agent/session-start', { agent, source: 'resume' })
    expect(await indexOf(ctx, agent)).not.toContain('pong')
    ctx.emit(scopeTarget(agent, agent), 'agent/session-start', { agent, source: 'compact' })
    const unseen = agentWith(Session.create(SessionId('unseen')))
    ctx.emit(scopeTarget(unseen, unseen), 'agent/session-start', { agent: unseen, source: 'compact' })

    expect(await indexOf(ctx, agent)).toContain('mcp__srv__{ping, pong}')
  })

  it('renders the run_code form and nothing for an empty snapshot', () => {
    expect(renderIndex({ entries: [], unavailable: [] }, false)).toBeUndefined()
    expect(renderIndex({ entries: [{ title: 'srv', prefix: 'mcp__srv__', names: ['ping'] }], unavailable: [] }, true))
      .toContain('call them inside run_code as tools["<name>"](args)')
  })
})

describe('tool_search keyword search', () => {
  it('lists matches by name and namespace title without loading them', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__chrome_devtools__navigate_page', 'Navigate the selected page to a URL. Then wait.')
    tool(ctx, 'mcp__telegram_1a2b3c4d__get_history', 'Read messages from a chat within a time window.')
    servers(ctx, [{ serverName: 'chrome_devtools', toolPrefix: 'mcp__chrome_devtools__', title: 'Chrome the user can see' }])
    const agent = agentWith()
    await assemble(ctx, agent)

    const result = await search(ctx, agent, 'open the chrome browser window page')

    expect(result.text).toBe([
      '- mcp__chrome_devtools__navigate_page (Chrome the user can see): Navigate the selected page to a URL.',
      'Nothing was loaded. Load tools with tool_search "select:mcp__chrome_devtools__navigate_page" or a subset.',
    ].join('\n'))
    expect(await toolNames(ctx, agent)).not.toContain('mcp__chrome_devtools__navigate_page')
  })

  it('requires +terms in the name or title and reports the namespaces when nothing matches', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__srv__send_message', 'Send a chat message to a contact.')
    tool(ctx, 'mcp__srv__list_chats', 'List chats.')
    const agent = agentWith()

    expect((await search(ctx, agent, '+send chat message')).text).toContain('mcp__srv__send_message')
    expect((await search(ctx, agent, '+send chat')).text).not.toContain('list_chats')
    expect((await search(ctx, agent, 'contact message')).text).toContain('mcp__srv__send_message')
    expect((await search(ctx, agent, 'mess')).text).toContain('mcp__srv__send_message')
    expect((await search(ctx, agent, 'contact')).text).toBe('No deferred tool matches "contact". Deferred namespaces: srv.')
    const empty = await setup()
    expect((await search(empty, agentWith(), 'anything')).text).toBe('No deferred tool matches "anything". Deferred namespaces: none.')
  })

  it('matches namespace titles, keeps namespaces that share a title apart, and bounds summaries', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__gmail_aaaaaaaa__search', `Search ${'mail '.repeat(40)}`)
    tool(ctx, 'mcp__gmail_bbbbbbbb__search', 'Search mail without an ending')
    servers(ctx, [
      { serverName: 'gmail_aaaaaaaa', toolPrefix: 'mcp__gmail_aaaaaaaa__', title: 'Gmail (work)' },
      { serverName: 'gmail_bbbbbbbb', toolPrefix: 'mcp__gmail_bbbbbbbb__', title: 'Gmail (work)' },
    ])
    const agent = agentWith()

    expect(await indexOf(ctx, agent)).toContain('- Gmail (work): mcp__gmail_aaaaaaaa__{search}\n- Gmail (work): mcp__gmail_bbbbbbbb__{search}')
    const lines = (await search(ctx, agent, 'work')).text.split('\n')
    expect(lines[0]).toMatch(/^- mcp__gmail_aaaaaaaa__search \(Gmail \(work\)\): Search (mail )+.*\.\.\.$/u)
    expect(lines[0]?.length).toBeLessThan(220)
    expect(lines[1]).toBe('- mcp__gmail_bbbbbbbb__search (Gmail (work)): Search mail without an ending')
  })

  it('caps results at maxResults even when the model asks for more', async () => {
    const ctx = await setup({ config: { maxResults: 2 } })
    for (const name of ['a', 'b', 'c']) tool(ctx, `mcp__srv__ping_${name}`)

    const result = await search(ctx, agentWith(), 'ping', { max_results: 10 })

    expect(result.text.split('\n').filter(line => line.startsWith('- '))).toHaveLength(2)
  })

  it('ranks and summarizes through the exported helpers', () => {
    const long = 'x'.repeat(200)
    const tools = [
      { tool: { name: 'mcp__a__z', description: long, parameters: {} }, title: 'A' },
      { tool: { name: 'mcp__a__y', description: 'two words here', parameters: {} }, title: 'A' },
    ]
    expect(searchTools(tools, 'two words', 5).map(entry => entry.tool.name)).toEqual(['mcp__a__y'])
    expect(mcpPrefix('mcp__a__z')).toBe('mcp__a__')
    expect(mcpPrefix('read')).toBeUndefined()
  })
})

describe('tool_search select', () => {
  it('loads native schemas into the next request and notes names that are not deferred', async () => {
    const ctx = await setup()
    tool(ctx, 'read')
    tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    await assemble(ctx, agent)

    const result = await search(ctx, agent, 'select:mcp__srv__ping, read')

    expect(result.text.split('\n')[0]).toBe('Loaded tools: mcp__srv__ping')
    expect(result.text).toContain('Not deferred tools: read.')
    expect(result.text).toContain('<function>{"name":"mcp__srv__ping"')
    expect(await toolNames(ctx, agent)).toContain('mcp__srv__ping')
  })

  it('refuses a load that would exceed maxRequestTools', async () => {
    const ctx = await setup({ config: { maxRequestTools: 3 } })
    tool(ctx, 'read')
    tool(ctx, 'mcp__srv__a')
    tool(ctx, 'mcp__srv__b')
    const agent = agentWith()
    await assemble(ctx, agent)
    await search(ctx, agent, 'select:mcp__srv__a')
    await assemble(ctx, agent)

    const refused = await search(ctx, agent, 'select:mcp__srv__b')

    expect(refused).toEqual({ isError: true, text: expect.stringContaining('would declare 4 tools in one request; the provider accepts at most 3') as string })
    expect((await search(ctx, agent, 'select:mcp__srv__a')).isError).toBe(false)
  })

  it('fails the assembly loudly when the undeferred tools alone exceed maxRequestTools', async () => {
    const ctx = await setup({ config: { maxRequestTools: 1 } })
    tool(ctx, 'read')
    tool(ctx, 'write')

    await expect(assemble(ctx, agentWith())).rejects.toThrow(/would declare 2 tools; the provider accepts at most 1/)
  })

  it('explains an unknown name, or the server that is down', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__srv__ping')
    servers(ctx, [
      { serverName: 'chrome_devtools', toolPrefix: 'mcp__chrome_devtools__', state: 'failed', error: 'spawn npx ENOENT' },
      { serverName: 'quiet', toolPrefix: 'mcp__quiet__', state: 'retrying', title: 'Quiet' },
    ])
    const agent = agentWith()

    expect((await search(ctx, agent, 'select:nope')).text).toContain('No deferred tool is named nope. Use a name from the deferred tools index.')
    expect((await search(ctx, agent, 'select:mcp__chrome_devtools__new_page')).text)
      .toContain('chrome_devtools is not serving (spawn npx ENOENT). Call tool_search with "restart:chrome_devtools" to connect it again.')
    expect((await search(ctx, agent, 'select:mcp__quiet__x')).text).toContain('Quiet is not serving. Call tool_search')
  })

  it('returns TypeScript declarations and keeps the request tool list fixed under run_code', async () => {
    const ctx = await setup({ mode: 'both' })
    tool(ctx, 'read')
    tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    const before = await toolNames(ctx, agent)

    const result = await search(ctx, agent, 'select:mcp__srv__ping')

    expect(result.text.split('\n').slice(0, 2)).toEqual([
      'Declared for run_code: mcp__srv__ping',
      'Call them inside run_code as tools["<name>"](args).',
    ])
    expect(result.text).toContain('```ts')
    expect(result.text).toContain('mcp__srv__ping: {\n    /** Text. */\n    text: string;')
    expect(await toolNames(ctx, agent)).toEqual(before)
    expect(before).toContain('run_code')
    expect(await indexOf(ctx, agent)).toContain('call them inside run_code')
  })

  it('returns Python stubs under a Python code runtime', async () => {
    const ctx = await setup({ mode: 'both', language: 'python' })
    tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    await assemble(ctx, agent)

    expect((await search(ctx, agent, 'select:mcp__srv__ping')).text).toContain('```python')
  })

  it('refuses a call without an agent', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('x'), name: 'tool_search', arguments: { query: 'x' } })

    expect(result.isError).toBe(true)
  })
})

describe('tool_search restart', () => {
  it('restarts a server and lists the tools it registered', async () => {
    const ctx = await setup()
    servers(ctx, [{
      serverName: 'chrome_devtools',
      toolPrefix: 'mcp__chrome_devtools__',
      title: 'Chrome the user can see',
      state: 'failed',
      restart: () => {
        tool(ctx, 'mcp__chrome_devtools__new_page')
        return Promise.resolve({ state: 'connected' })
      },
    }, { serverName: 'empty', toolPrefix: 'mcp__empty__' }])
    const agent = agentWith()

    expect((await search(ctx, agent, 'restart:chrome_devtools')).text)
      .toBe('Chrome the user can see is connected. Its tools: mcp__chrome_devtools__new_page.')
    expect((await search(ctx, agent, 'restart:empty')).text).toBe('empty is connected. Its tools: none.')
  })

  it('reports a failed restart and an unknown server', async () => {
    const ctx = await setup()
    servers(ctx, [
      { serverName: 'down', state: 'failed', restart: () => Promise.resolve({ state: 'retrying', error: 'ECONNREFUSED' }) },
      { serverName: 'silent', state: 'failed', restart: () => Promise.resolve({ state: 'failed' }) },
    ])
    const agent = agentWith()

    expect(await search(ctx, agent, 'restart:down')).toEqual({ isError: true, text: expect.stringContaining('down did not connect: ECONNREFUSED.') as string })
    expect((await search(ctx, agent, 'restart:silent')).text).toContain('silent did not connect.')
    expect((await search(ctx, agent, 'restart:nope')).text).toContain('No MCP server named nope serves this session.')
  })
})

describe('tool-search resume', () => {
  it('rebuilds loaded tools from the raw session log, ignoring failed and declaration-only loads', async () => {
    const ctx = await setup()
    tool(ctx, 'mcp__srv__a')
    tool(ctx, 'mcp__srv__b')
    tool(ctx, 'mcp__srv__c')
    const session = Session.create(SessionId('resumed'))
    const record = (callId: string, name: string, text: string, isError = false) => {
      session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: '{}' })
      session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text }], isError }) }, { surfaceOp: 'append' })
    }
    record('1', 'tool_search', 'Loaded tools: mcp__srv__a, \n<function>{}</function>')
    record('2', 'tool_search', 'Loaded tools: mcp__srv__b', true)
    record('3', 'tool_search', 'Declared for run_code: mcp__srv__c')
    record('4', 'read', 'Loaded tools: mcp__srv__c')
    session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('5'), name: 'tool_search', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('5'), content: [], isError: false }) }, { surfaceOp: 'append' })

    const names = await toolNames(ctx, agentWith(session))

    expect(names).toContain('mcp__srv__a')
    expect(names).not.toContain('mcp__srv__b')
    expect(names).not.toContain('mcp__srv__c')
  })
})

describe('tool-search lifecycle', () => {
  it('unregisters tool_search and stops filtering when disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.plugin(ToolSearch, {})
    await fiber
    tool(ctx, 'mcp__srv__ping')
    const agent = agentWith()
    expect(await toolNames(ctx, agent)).toEqual(['tool_search'])

    await fiber.dispose()

    expect(await toolNames(ctx, agent)).toEqual(['mcp__srv__ping'])
  })
})
