import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@aeven/agent'
import BrowserChromium from '@aeven/browser-chromium'
import { ToolCallId } from '@aeven/llm'
import { Session, SessionId } from '@aeven/session'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime, { defineTool } from '@aeven/tools'
import type {} from '@aeven/mcp-client'
import * as ToolBrowser from '@aeven/tool-browser'
import type { BrowserAutomationRequestEvent, Config } from '@aeven/tool-browser'

const PAGE = { open: true, url: 'http://127.0.0.1:5173/', title: 'Dev server', loading: false }

/** A debugging port nothing can be listening on, so a status sample is deterministic. */
const CLOSED_PORT = 1

async function mount(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolBrowser, config)
  return ctx
}

/**
 * Mount the Host's Chromium as the Web profile does, against a port nothing
 * answers on. Its executable path deliberately names no file: a status sample
 * that launched a browser would raise an unhandled spawn error in this worker.
 */
async function mountHostBrowser(ctx: Context): Promise<void> {
  await ctx.plugin(BrowserChromium, {
    port: CLOSED_PORT,
    executablePath: '/nonexistent/aeven-chrome',
    mcpServerName: 'chrome_devtools',
    launchOnStart: false,
  })
}

/** Register one tool under the Host browser's MCP prefix, as a connected chrome-devtools-mcp would. */
function registerDevtoolsTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'mcp__chrome_devtools__list_pages',
    description: 'List pages.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
    execute: () => Promise.resolve('[]'),
  }))
}

/** Run one registered tool as `agent`, or without a calling agent when it is omitted. */
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

function sessionAgent(id = 'agent'): Agent {
  const session = Session.create(SessionId(id))
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('tool-browser must return its context through the decision') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Answer every `browser/automation` request with `answer`, recording each request. */
function answer(
  ctx: Context,
  respond: (request: BrowserAutomationRequestEvent) => Promise<unknown>,
): BrowserAutomationRequestEvent[] {
  const seen: BrowserAutomationRequestEvent[] = []
  ctx.on('browser/automation', (request) => {
    seen.push(request)
    return respond(request) as never
  })
  return seen
}

async function preStep(ctx: Context, agent: Agent, step = 1, signal = new AbortController().signal) {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

function contextText(decision: Awaited<ReturnType<typeof preStep>>): string[] {
  if (decision.kind !== 'enter') return []
  return decision.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

describe('tool-browser first-step context', () => {
  it('adds the open page to the first step of a turn', async () => {
    const ctx = await mount()
    const seen = answer(ctx, () => Promise.resolve(PAGE))

    const decision = await preStep(ctx, sessionAgent())

    expect(seen.map(request => request.operation)).toEqual(['status'])
    expect(contextText(decision)).toHaveLength(1)
    expect(contextText(decision)[0]).toMatch(
      /^The user has the in-app browser open beside this chat, showing: Dev server — http:\/\/127\.0\.0\.1:5173\/\n\n/,
    )
  })

  it('reads the page only on the first step', async () => {
    const ctx = await mount()
    const seen = answer(ctx, () => Promise.resolve(PAGE))

    const decision = await preStep(ctx, sessionAgent(), 2)

    expect(seen).toEqual([])
    expect(contextText(decision)).toEqual([])
  })

  it.each([
    ['no browser', null],
    ['a blank page', { ...PAGE, url: 'about:blank' }],
    ['an empty address', { ...PAGE, url: '' }],
    ['no address', { open: true }],
  ])('adds nothing for %s', async (_label, page) => {
    const ctx = await mount()
    answer(ctx, () => Promise.resolve(page))

    expect(contextText(await preStep(ctx, sessionAgent()))).toEqual([])
  })

  it('adds nothing when no listener answers the waterfall', async () => {
    const ctx = await mount()

    expect(contextText(await preStep(ctx, sessionAgent()))).toEqual([])
  })

  it('proceeds without the page when the browser never answers, and cancels the request', async () => {
    const ctx = await mount({ statusTimeoutMs: 20 })
    const debug = vi.spyOn(ctx.logger, 'debug')
    const seen = answer(ctx, () => new Promise(() => {}))

    const decision = await preStep(ctx, sessionAgent())

    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.signal?.aborted).toBe(true)
    expect(debug).toHaveBeenCalledWith('browser status unanswered after 20ms; step 1 proceeds without the browser context')
  })

  it('stops waiting when the turn is cancelled', async () => {
    const ctx = await mount({ statusTimeoutMs: 60_000 })
    const warn = vi.spyOn(ctx.logger, 'warn')
    const debug = vi.spyOn(ctx.logger, 'debug')
    const turn = new AbortController()
    answer(ctx, () => {
      setTimeout(() => { turn.abort(new Error('turn cancelled')) }, 0)
      return new Promise(() => {})
    })

    const decision = await preStep(ctx, sessionAgent(), 1, turn.signal)

    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(warn).not.toHaveBeenCalled()
    expect(debug).not.toHaveBeenCalled()
  })

  it('skips the lookup when the turn is already cancelled', async () => {
    const ctx = await mount()
    const seen = answer(ctx, () => Promise.resolve(PAGE))
    const turn = new AbortController()
    turn.abort()

    expect(contextText(await preStep(ctx, sessionAgent(), 1, turn.signal))).toEqual([])
    expect(seen).toEqual([])
  })

  it('stops waiting when the lookup signal is already aborted before the race starts', async () => {
    const ctx = await mount({ statusTimeoutMs: 60_000 })
    const turn = new AbortController()
    answer(ctx, (request) => {
      // The listener runs synchronously inside the waterfall call, before the
      // wait is armed, so the bounded signal is already aborted at that point.
      turn.abort(new Error('turn cancelled'))
      expect(request.signal?.aborted).toBe(true)
      return new Promise(() => {})
    })

    expect(await preStep(ctx, sessionAgent(), 1, turn.signal)).toEqual({ kind: 'enter', messages: [] })
  })

  it.each([
    ['an Error', new Error('client went away'), 'client went away'],
    ['a non-Error value', 'client went away', 'client went away'],
  ])('logs and proceeds when the browser fails with %s', async (_label, failure, message) => {
    const ctx = await mount()
    const warn = vi.spyOn(ctx.logger, 'warn')
    // A browser listener may reject with an arbitrary value, which the warning must stringify.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the case under test.
    answer(ctx, () => Promise.reject(failure))

    expect(await preStep(ctx, sessionAgent())).toEqual({ kind: 'enter', messages: [] })
    expect(warn).toHaveBeenCalledWith(`browser status failed: ${message}; step 1 proceeds without the browser context`)
  })

  it('leaves a rejected step untouched', async () => {
    const ctx = await mount({ statusTimeoutMs: 60_000 })
    const pane = Promise.withResolvers<unknown>()
    const seen = answer(ctx, () => pane.promise)

    const decision = await agentEvents(ctx, sessionAgent()).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )

    // The lookup runs beside the later listeners, so a rejected step has already asked for the page; the decision
    // neither waits for that answer nor carries it.
    expect(decision).toEqual({ kind: 'reject' })
    expect(seen.map(request => request.operation)).toEqual(['status'])
    pane.resolve(PAGE)
    await Promise.resolve()
  })
})

describe('tool-browser tools', () => {
  it('declares the configured wait as every tool timeout', async () => {
    const ctx = await mount({ actionTimeoutMs: 1_234 })
    const names = ['preview_status', 'preview_navigate', 'preview_snapshot', 'preview_click', 'preview_type', 'preview_press', 'preview_scroll', 'preview_evaluate']

    expect(names.map(name => ctx.tools.get(name)?.timeoutMs)).toEqual(names.map(() => 1_234))
  })

  it('returns the browser answer as JSON', async () => {
    const ctx = await mount()
    const seen = answer(ctx, request => Promise.resolve({ echoed: request.input }))

    const result = await call(ctx, 'preview_navigate', { url: 'https://example.com' }, sessionAgent())

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: '{"echoed":{"url":"https://example.com"}}' }])
    expect(seen[0]?.operation).toBe('navigate')
  })

  it('fails with an instruction when a call that needs a page has no browser', async () => {
    const ctx = await mount()

    const result = await call(ctx, 'preview_navigate', { url: 'https://example.com' }, sessionAgent())

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('BROWSER_UNAVAILABLE')
  })

  it('fails without a calling agent', async () => {
    const ctx = await mount()

    const result = await call(ctx, 'preview_status', {})

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('BROWSER_NO_AGENT')
  })
})

describe('tool-browser status report', () => {
  /** The fields `preview_status` answers with. */
  interface Report {
    /** The page in the browser beside the session, or null. */
    sessionTab: unknown
    /** The Host's Chromium, or null when the composition mounts none. */
    hostBrowser: unknown
    /** What the model should drive, or what to ask the user for. */
    nextStep: string
  }

  function reportOf(result: Awaited<ReturnType<typeof call>>): Report {
    const block = result.content[0]
    return JSON.parse(block !== undefined && 'text' in block ? block.text : '') as Report
  }

  it('reports no surface when the composition mounts none and no page is open', async () => {
    const ctx = await mount()

    const report = reportOf(await call(ctx, 'preview_status', {}, sessionAgent()))

    expect(report.sessionTab).toBeNull()
    expect(report.hostBrowser).toBeNull()
    expect(report.nextStep).toContain('right sidebar (Browser)')
  })

  it('reports the Host browser when no page is open beside the session', async () => {
    const ctx = await mount()
    await mountHostBrowser(ctx)
    registerDevtoolsTool(ctx)

    const report = reportOf(await call(ctx, 'preview_status', {}, sessionAgent()))

    expect(report.sessionTab).toBeNull()
    expect(report.hostBrowser).toEqual({
      browserUrl: `http://127.0.0.1:${String(CLOSED_PORT)}`,
      running: false,
      launchable: true,
      toolPrefix: 'mcp__chrome_devtools__',
    })
    expect(report.nextStep).toContain('the mcp__chrome_devtools__* tools drive it')
  })

  it('says the Host browser tools are not serving when no server registered them', async () => {
    const ctx = await mount()
    await mountHostBrowser(ctx)

    const report = reportOf(await call(ctx, 'preview_status', {}, sessionAgent()))

    expect(report.hostBrowser).toMatchObject({ toolsUnavailable: 'no tool server for them is mounted' })
    expect(report.nextStep).toContain('are not serving: no tool server for them is mounted')
  })

  it('names the failed server and how to restart it when its tools are missing', async () => {
    const ctx = await mount()
    await mountHostBrowser(ctx)
    ctx.on('mcp/servers', async (_request, next) => [...await next(), {
      serverName: 'chrome_devtools',
      toolPrefix: 'mcp__chrome_devtools__',
      state: 'failed' as const,
      error: 'spawn npx ENOENT',
      restart: () => Promise.resolve({ state: 'failed' as const }),
    }])

    const report = reportOf(await call(ctx, 'preview_status', {}, sessionAgent()))

    expect(report.hostBrowser).toMatchObject({
      toolsUnavailable: 'the chrome_devtools server is stopped (spawn npx ENOENT); tool_search "restart:chrome_devtools" connects it again',
    })
  })

  it('reports the Host browser when the page lookup never answers', async () => {
    const ctx = await mount({ statusTimeoutMs: 20 })
    await mountHostBrowser(ctx)
    answer(ctx, () => new Promise(() => {}))

    const report = reportOf(await call(ctx, 'preview_status', {}, sessionAgent()))

    expect(report.sessionTab).toBeNull()
    expect(report.hostBrowser).not.toBeNull()
  })

  it('prefers the page beside the session when both surfaces exist', async () => {
    const ctx = await mount()
    await mountHostBrowser(ctx)
    answer(ctx, () => Promise.resolve(PAGE))

    const report = reportOf(await call(ctx, 'preview_status', {}, sessionAgent()))

    expect(report.sessionTab).toEqual({ url: PAGE.url, title: PAGE.title })
    expect(report.hostBrowser).not.toBeNull()
    expect(report.nextStep).toBe('Drive the page beside this session with the preview_* tools.')
  })
})

describe('tool-browser config', () => {
  it('defaults both waits', () => {
    expect(ToolBrowser.Config({})).toEqual({ statusTimeoutMs: 2_000, actionTimeoutMs: 60_000 })
  })

  it.each([
    ['a zero status wait', { statusTimeoutMs: 0 }],
    ['a fractional action wait', { actionTimeoutMs: 1.5 }],
    ['a wait beyond the timer range', { statusTimeoutMs: 2 ** 31 }],
  ])('rejects %s', (_label, config) => {
    expect(() => ToolBrowser.Config(config)).toThrow()
  })
})
