/**
 * Model-facing `browser_*` tools over the `browser/automation` waterfall: the
 * model reads and drives the page the user sees in the browser beside its
 * session, ported from t3code's `preview_*` toolkit.
 *
 * The tools perform nothing themselves. The client holding the session's
 * browser answers the waterfall; without one, every call fails with an
 * instruction to open the browser.
 *
 * Every wait on the waterfall is bounded. A forwarded waterfall stays pending
 * until a connected client answers it, so with no client connected an
 * unbounded wait never settles: the first-step page lookup gives up after
 * `statusTimeoutMs` and the step proceeds without the browser context, and
 * each `preview_*` call declares `actionTimeoutMs` as its tool timeout.
 *
 * @module @aeven/tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@aeven/agent'
import type { BrowserChromiumStatus } from '@aeven/browser-chromium'
import type { McpServerReport } from '@aeven/mcp-client'
import { createUserMessage, HarnessError } from '@aeven/llm'
import { scopeTarget } from '@aeven/scope'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@aeven/timeout'
import { defineTool, type ParameterSchemaSpec, type ToolRunContext } from '@aeven/tools'
import { assertNever, type JsonValue } from '@aeven/util-values'
import type { BrowserAutomationOperation } from './types.ts'

export type { BrowserAutomationOperation, BrowserAutomationRequestEvent } from './types.ts'

export const name = 'tool-browser'
export const inject = ['tools', 'agents']

/** How long the browser beside a session is given to answer. Invalid values fail plugin load. */
export interface Config {
  /** Milliseconds the first step of a turn waits for the open page before it proceeds without the browser context. */
  statusTimeoutMs?: number
  /** Milliseconds a `preview_*` call waits for the browser before it fails as timed out. */
  actionTimeoutMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  statusTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(2_000),
  actionTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(60_000),
})

/** The timeout code of the first-step page lookup's own deadline. */
export const BROWSER_STATUS_TIMEOUT = 'BROWSER_STATUS_TIMEOUT'

/**
 * Settle as `work` does, or reject with the signal's reason once it aborts.
 * Waterfall listeners are not obliged to honor the request's signal, so the
 * caller's wait is bounded here rather than by the listener.
 * @param work - the pending waterfall.
 * @param signal - the lifetime the wait may not outlast.
 * @returns what `work` settles with.
 * @throws the signal's reason when it aborts first.
 */
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error)
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason as Error) }
    signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

/**
 * t3code's browser instructions (`CodexDeveloperInstructions.ts`
 * `T3_CODE_BROWSER_TOOL_INSTRUCTIONS`), sent only while a browser is open, as
 * t3code omits them when its tools are not attached.
 */
const BROWSER_INSTRUCTIONS = [
  'This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.',
  'For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.',
  'A page served from this machine (localhost or 127.0.0.1) is an application under development: verify it first in the browser the user can see — this pane, or the Chromium preview_status reports. Use the headless browser tools for it only when neither is available, and say that the check ran in a headless copy.',
  'A failed preview call is retried with corrected arguments when the error is actionable. When a remote page itself refuses it — it needs a signed-in session, or it answers automated reads with a block page — stop retrying and escalate in order: the headless browser tools open no window, and a page that refuses those too is read in the browser the user can see, which does open one. Ask the user to sign in; never type credentials.',
].join('\n')

/**
 * The in-app browser context ChatGPT gives its model each turn: which page is
 * open beside the chat. It is ambient UI state, not an instruction to use it.
 * @param page - the browser's status.
 * @returns the context text.
 */
function renderBrowserContext(page: { readonly url?: unknown; readonly title?: unknown }): string {
  return `The user has the in-app browser open beside this chat, showing: ${String(page.title)} — ${String(page.url)}\n\n${BROWSER_INSTRUCTIONS}`
}

/**
 * Read a status answer as the page the first-step context renders.
 * @param value - the Client's answer.
 * @returns the page title and address, or null when the answer carries no ordinary address.
 */
function asSessionTabPage(value: JsonValue): { readonly url: string; readonly title: JsonValue } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const url = value.url
  return typeof url === 'string' && url !== '' && url !== 'about:blank' ? { url, title: value.title ?? null } : null
}

/**
 * How the browser beside the session answered a status lookup. The three
 * absent outcomes are different facts: `absent` is a session whose pane is not
 * mounted, `unanswered` is a connected Client that has not answered yet, and
 * `failed` is a pane that broke.
 */
type SessionTabLookup =
  | { readonly kind: 'page'; readonly page: JsonValue }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unanswered' }
  | { readonly kind: 'failed'; readonly error: unknown }

/** How the model reads one MCP server state. */
const SERVER_STATE_TEXT: Record<McpServerReport['state'], string> = {
  connecting: 'starting',
  connected: 'connected',
  retrying: 'reconnecting',
  failed: 'stopped',
}

/** What the Host's Chromium reports, narrowed to the fields the model acts on. */
type HostBrowserReport = {
  /** The debugging endpoint the tools that drive this browser attach to. */
  readonly browserUrl: string
  /** Whether a browser answers there now. */
  readonly running: boolean
  /** Whether an executable was found, so a launch can succeed. */
  readonly launchable: boolean
  /** Prefix of the tool names that drive this browser; absent when no MCP server drives it. */
  readonly toolPrefix?: string
  /** Why the tools under `toolPrefix` are not registered for this session; absent while they are. */
  readonly toolsUnavailable?: string
}

/**
 * What to drive, in the terms the decision needs: the open page first, the
 * Host's Chromium when nothing is open, and the user when there is neither. A
 * report that named only a closed pane is what leaves a model believing no
 * browser exists on the machine at all.
 * @param pageOpen - whether the browser beside the session shows a page.
 * @param host - the Host's Chromium as sampled, or null when the composition mounts none.
 * @returns the sentence the model acts on.
 */
function nextStepFor(pageOpen: boolean, host: HostBrowserReport | null): string {
  if (pageOpen) return 'Drive the page beside this session with the preview_* tools.'
  if (host === null) {
    return 'No browser is open beside this session, and this deployment mounts none on the Host. Ask the user to open one from the right sidebar (Browser).'
  }
  if (host.toolPrefix === undefined) {
    return `Nothing answers on ${host.browserUrl} and this deployment configures no tool server to drive a browser there. Ask the user to open the browser from the right sidebar (Browser).`
  }
  if (host.toolsUnavailable !== undefined) {
    return `The Chromium on this Host is the browser the user can see and sign in to, but the ${host.toolPrefix}* tools that drive it are not serving: ${host.toolsUnavailable}. If they still do not connect, ask the user to open the browser from the right sidebar (Browser).`
  }
  if (!host.running && !host.launchable) {
    return `No Chrome or Chromium executable was found on this Host, so the browser behind ${host.browserUrl} cannot start. Ask the user to install one, or to open the browser from the right sidebar (Browser).`
  }
  return `No page is open beside this session. The Chromium on this Host is the browser the user can see and sign in to, and the ${host.toolPrefix}* tools drive it, starting it when it is not running. A page served from this machine (localhost or 127.0.0.1) is an application under development: verify it there first, and in the headless browser only when this one cannot start. For a remote page it opens a visible window, so reach for it after a headless read was refused, or when the page needs a signed-in session.`
}

const selector = { type: 'string', description: "CSS selector such as button[type='submit'], from preview_snapshot's interactiveElements." } as const
const text = { render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }

/**
 * Register the `preview_*` tools and the first-step browser context.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees both fields are set after validation.
  const statusTimeoutMs = config.statusTimeoutMs as number
  const actionTimeoutMs = config.actionTimeoutMs as number
  /**
   * The agent a tool call belongs to.
   * @param exec - the running tool call.
   * @returns the calling agent.
   * @throws {HarnessError} when no agent made the call.
   */
  const callingAgent = (exec: ToolRunContext): Agent => {
    const agent = exec.agent
    if (agent === undefined) throw new HarnessError('browser tools need a calling agent', 'BROWSER_NO_AGENT')
    return agent
  }

  /**
   * Ask the browser beside the session for its page. A forwarded waterfall
   * stays pending until a Client answers it, so the wait is bounded by
   * `statusTimeoutMs`, and the bounded signal cancels the pending request.
   * @param agent - the session whose browser answers.
   * @param signal - the turn's cancellation.
   * @returns the page, or which way the lookup found none.
   */
  const readSessionTab = async (agent: Agent, signal: AbortSignal): Promise<SessionTabLookup> => {
    using bounded = deadline(signal, statusTimeoutMs, BROWSER_STATUS_TIMEOUT)
    try {
      const page = await unlessAborted(ctx.waterfall(
        scopeTarget(agent, agent),
        'browser/automation',
        { operation: 'status', input: {}, agent, signal: bounded.signal },
        () => Promise.resolve(null),
      ), bounded.signal)
      return page === null ? { kind: 'absent' } : { kind: 'page', page }
    } catch (error) {
      return timeoutOf(bounded.signal, BROWSER_STATUS_TIMEOUT) === undefined
        ? { kind: 'failed', error }
        : { kind: 'unanswered' }
    }
  }

  /**
   * Sample the Chromium this deployment mounts, when it mounts one.
   * @param signal - the tool call's cancellation.
   * @returns the fields the model acts on, or null when no `browserChromium` service is mounted.
   */
  const readHostBrowser = async (agent: Agent, signal: AbortSignal): Promise<HostBrowserReport | null> => {
    const chromium = ctx.get('browserChromium')
    if (chromium === undefined) return null
    const status: BrowserChromiumStatus = await chromium.status(signal)
    const report: HostBrowserReport = {
      browserUrl: status.browserUrl,
      running: status.running,
      launchable: status.launchable,
      ...status.toolPrefix === undefined ? {} : { toolPrefix: status.toolPrefix },
    }
    const prefix = status.toolPrefix
    if (prefix === undefined || ctx.tools.schemas(agent).some(tool => tool.name.startsWith(prefix))) return report
    const servers = await ctx.waterfall(scopeTarget(agent, agent), 'mcp/servers', { agent }, () => Promise.resolve([]))
    const server = servers.find(candidate => candidate.toolPrefix === prefix)
    const toolsUnavailable = server === undefined
      ? 'no tool server for them is mounted'
      : server.state === 'connected'
        ? `the ${server.serverName} server is connected but registered no tools for this session`
        : `the ${server.serverName} server is ${SERVER_STATE_TEXT[server.state]}${server.error === undefined ? '' : ` (${server.error})`}; tool_search "restart:${server.serverName}" connects it again`
    return { ...report, toolsUnavailable }
  }

  const run = async (
    operation: BrowserAutomationOperation,
    input: { [key: string]: JsonValue },
    exec: ToolRunContext,
  ): Promise<JsonValue> => {
    const agent = callingAgent(exec)
    const unavailable = () => Promise.reject(new HarnessError(
      'No browser is open beside this session, and preview_* drives only that browser. Call preview_status to see the browser surfaces this session has, or ask the user to open one from the right sidebar (Browser).',
      'BROWSER_UNAVAILABLE',
    ))
    return ctx.waterfall(
      scopeTarget(agent, agent),
      'browser/automation',
      { operation, input, agent, signal: exec.signal },
      unavailable,
    )
  }

  // The first step of each turn carries the open page, so the model knows what
  // the user is looking at before it decides whether a request is about it.
  // The context is an ordinary plugin user message, so it is logged. The page
  // is optional, so an unanswered lookup costs the step at most
  // `statusTimeoutMs`.
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1 || signal.aborted) return decision
    const lookup = await readSessionTab(agent, signal)
    switch (lookup.kind) {
      case 'page': {
        const page = asSessionTabPage(lookup.page)
        if (page === null) return decision
        const text = renderBrowserContext(page)
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
            }),
          ],
        }
      }
      case 'unanswered':
        ctx.logger.debug(`browser status unanswered after ${statusTimeoutMs}ms; step ${step} proceeds without the browser context`)
        return decision
      case 'failed': {
        // A turn that cancelled its own lookup is not a pane failure.
        if (!signal.aborted) {
          const reason = lookup.error instanceof Error ? lookup.error.message : String(lookup.error)
          ctx.logger.warn(`browser status failed: ${reason}; step ${step} proceeds without the browser context`)
        }
        return decision
      }
      case 'absent':
        return decision
      default:
        return assertNever(lookup)
    }
  }, { prepend: true })

  const action = (
    toolName: string,
    operation: BrowserAutomationOperation,
    description: string,
    parameters: ParameterSchemaSpec,
  ) => defineTool({
    name: toolName,
    description,
    parameters,
    timeoutMs: actionTimeoutMs,
    output: { schema: { type: 'string' }, ...text },
    async execute(args, exec) {
      return JSON.stringify(await run(operation, args as { [key: string]: JsonValue }, exec))
    },
  })

  // `preview_status` answers without a page, because the page beside the
  // session and the Chromium this deployment mounts are different browsers. A
  // report that named only the first is what leaves a model believing no
  // browser exists on the machine at all.
  const status = defineTool({
    name: 'preview_status',
    description: 'Report every browser surface this session can drive: the page in the collaborative browser beside it, including its URL, title, and loading state, and the Chromium on this Host when the deployment mounts one. Call this first for browser work, including when a page refused a plain fetch.',
    parameters: {},
    timeoutMs: actionTimeoutMs,
    output: { schema: { type: 'string' }, ...text },
    async execute(_args, exec) {
      const lookup = await readSessionTab(callingAgent(exec), exec.signal)
      const page = lookup.kind === 'page' ? asSessionTabPage(lookup.page) : null
      const host = await readHostBrowser(callingAgent(exec), exec.signal)
      const report: { [key: string]: JsonValue } = {
        sessionTab: page,
        hostBrowser: host === null ? null : { ...host },
        nextStep: nextStepFor(page !== null, host),
      }
      return JSON.stringify(report)
    },
  })

  // Names and descriptions are t3code's `preview_*` toolkit
  // (`apps/server/src/mcp/toolkits/preview/tools.ts`), narrowed to the
  // parameters this browser implements.
  for (const tool of [
    status,
    action('preview_navigate', 'navigate',
      "Navigate the collaborative browser tab. Pass {url:'https://t3.chat'} for a website or a local dev server URL.",
      { url: { type: 'string', required: true, description: 'Website URL. Use this for public pages and directly reachable URLs.' } }),
    action('preview_back', 'back',
      'Go back one page in the collaborative browser tab, showing the pointer pressing the control.',
      {}),
    action('preview_forward', 'forward',
      'Go forward one page in the collaborative browser tab, showing the pointer pressing the control.',
      {}),
    action('preview_reload', 'reload',
      'Reload the page in the collaborative browser tab, showing the pointer pressing the control.',
      {}),
    action('preview_snapshot', 'snapshot',
      'Inspect a page before interacting. Returns page state: URL, title, visible text, and interactive elements with CSS selectors.',
      {}),
    action('preview_click', 'click',
      'Click exactly one target in the collaborative browser tab. Prefer a selector from preview_snapshot; x and y must be supplied together.',
      { selector, x: { type: 'number', description: 'Viewport-relative X coordinate in CSS pixels. Must be paired with y.' }, y: { type: 'number', description: 'Viewport-relative Y coordinate in CSS pixels. Must be paired with x.' } }),
    action('preview_type', 'type',
      'Insert literal text into one input in the collaborative browser tab. Types into selector, or into the currently focused element when omitted; set clear=true to replace existing text.',
      { text: { type: 'string', required: true, description: 'Literal text to insert.' }, selector, clear: { type: 'boolean', description: 'Clear the existing input value before inserting text. Defaults to false.' } }),
    action('preview_press', 'press',
      "Press one keyboard key in the collaborative browser tab. Examples: {key:'Enter'}, {key:'Escape'}, or {key:'a',modifiers:['Meta']}.",
      {
        key: { type: 'string', required: true, description: 'Keyboard key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character.' },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] }, description: 'Modifier keys held while pressing key.' },
      }),
    action('preview_scroll', 'scroll',
      'Scroll the collaborative browser tab. Positive deltaY scrolls down and positive deltaX scrolls right; a selector targets a container.',
      { deltaX: { type: 'number', description: 'Horizontal scroll delta in CSS pixels. Positive scrolls right. Defaults to 0.' }, deltaY: { type: 'number', description: 'Vertical scroll delta in CSS pixels. Positive scrolls down. Defaults to 0.' }, selector }),
    action('preview_evaluate', 'evaluate',
      'Evaluate JavaScript in the collaborative browser tab. Returns {value} with a serializable result up to 64 KB; the expression may mutate page state.',
      { expression: { type: 'string', required: true, description: "JavaScript expression evaluated in the page's main frame, for example document.title or (() => ({href: location.href}))()." } }),
  ]) ctx.tools.register(tool)
}
