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

import type {} from '@aeven/user-approval'
import type {} from '@aeven/user-questions'
import type {} from '@aeven/sandbox-policy'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@aeven/agent'
import type { BrowserChromiumStatus } from '@aeven/browser-chromium'
import type { McpServerReport } from '@aeven/mcp-client'
import { createUserMessage, HarnessError } from '@aeven/llm'
import type { Message } from '@aeven/llm'
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
 * Whether a turn's cancellation has already reached this point.
 *
 * A turn can cancel while its page lookup is in flight, so the signal is read
 * both before a lookup starts and where its answer is used.
 * @param signal - the turn's cancellation.
 * @returns whether the turn was cancelled.
 */
function isCancelled(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Whether an address is served from this machine, which makes it a page under
 * development rather than a site the user asked to see.
 * @param hostname - the host as `URL.hostname` reports it, bracketed for IPv6.
 * @returns true for `localhost`, its subdomains, the IPv6 loopback, the wildcard address, and any loopback IPv4 address.
 */
function isDevelopmentHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

/**
 * Whether a call's address is a page served from this machine.
 * @param url - the address a call navigates to or uploads into.
 * @returns {@link isDevelopmentHost} of its host, or false when no URL parser accepts the string, which only the pane's guest reads.
 */
function isDevelopmentAddress(url: string): boolean {
  try {
    return isDevelopmentHost(new URL(url).hostname)
  } catch {
    // A non-absolute address such as `about:blank` reaches no server, so no Host browser competes for it.
    return false
  }
}

/**
 * Whether the person's own request names an address, which makes opening it a
 * site visit they asked for rather than the model checking its own work.
 * @param messages - the session's derived transcript.
 * @param url - the address a call navigates to.
 * @returns true when the newest person message carries the address, its host, or its port.
 */
function personAskedForAddress(messages: readonly Message[], url: string): boolean {
  let request = ''
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    request = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  }
  if (request.includes(url)) return true
  try {
    const parsed = new URL(url)
    return request.includes(parsed.hostname) || (parsed.port !== '' && request.includes(`:${parsed.port}`))
  } catch {
    // Only a parsed address reaches this check, so no caller depends on an unparseable one matching.
    return false
  }
}

/**
 * t3code's browser instructions (`CodexDeveloperInstructions.ts`
 * `T3_CODE_BROWSER_TOOL_INSTRUCTIONS`), sent only while a browser is open, as
 * t3code omits them when its tools are not attached.
 */
const BROWSER_INSTRUCTIONS = [
  'This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.',
  'Task routing: a request to open, visit, or read a website is this pane\'s ("open linkedin") — open it here and keep the task here, including a local address the person names. Development and debugging belong to the Chrome DevTools browser (mcp__chrome_devtools__*): a localhost or 127.0.0.1 page of your own, and any task that changes the code behind a page. Never open a local dev server in this pane to check your own work, and never switch surfaces merely because an interaction failed.',
  'Use preview_sequence for known consecutive actions; it runs locally in order and waits for specified elements without another model request between actions. Use preview_upload to attach files directly; never use clipboard tricks, a local HTTP server, or a native picker for a supported upload.',
  'For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.',
  'A page served from this machine (localhost or 127.0.0.1) is an application under development: open it in the Chrome DevTools browser (mcp__chrome_devtools__*), not this pane. Use the headless browser tools for it only when that browser and this pane are both unavailable, and say that the check ran in a headless copy.',
  'Correct an actionable error in this browser. If this browser needs authentication, a captcha, or the user\'s confirmation, call preview_handoff and end your turn; never type credentials or switch browsers to bypass sign-in. Prefer preview_snapshot and focused actions over writing JavaScript for ordinary clicks or text entry; read a whole article with preview_content.',
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
 * Where a navigation opens the browser the status answer reports closed: `pane`
 * is the browser beside the session; `user-browser` is a new tab of the user's
 * own browser through the Aeven extension, which an Aeven web page answers.
 */
type OpensIn = 'pane' | 'user-browser'

/**
 * Read a status answer that reports a closed browser the client opens on a navigation.
 * @param value - the Client's answer.
 * @returns where the navigation opens it, for the `{ open: false, openable: true }` answer; null otherwise.
 */
function openableIn(value: JsonValue): OpensIn | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || value.open !== false || value.openable !== true) return null
  return value.opensIn === 'user-browser' ? 'user-browser' : 'pane'
}

/**
 * Whether a status answer comes from a Client whose only browser is the user's own, reached through the Aeven
 * extension, which an Aeven web page answers: that browser's history is then the only history there is.
 * @param value - the Client's answer.
 * @returns true for an answer carrying `surface: 'user-browser'`.
 */
function isUserBrowserSurface(value: JsonValue): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.surface === 'user-browser'
}

/**
 * Whether a status answer reports that the user's browser cannot run the Aeven extension, which an Aeven web page
 * answers when it is the session's only browser.
 * @param value - the Client's answer.
 * @returns true for the `{ unavailable: 'browser-unsupported' }` answer.
 */
function isUnsupportedBrowser(value: JsonValue): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.unavailable === 'browser-unsupported'
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
 * What to drive, in the terms the decision needs: the open page first for a
 * task that only visits a site, Chrome DevTools for development and debugging,
 * the Host's Chromium when nothing is open, and the user when there is neither. A
 * report that named only a closed pane is what leaves a model believing no
 * browser exists on the machine at all.
 * @param pageOpen - whether the browser beside the session shows a page.
 * @param opensIn - where a navigation opens the closed browser of the client holding the session, or null when it opens none.
 * @param unsupported - whether the client reports that the user's browser cannot run the Aeven extension.
 * @param host - the Host's Chromium as sampled, or null when the composition mounts none.
 * @returns the sentence the model acts on.
 */
function nextStepFor(pageOpen: boolean, opensIn: OpensIn | null, unsupported: boolean, host: HostBrowserReport | null): string {
  const devtools = host?.toolPrefix === undefined ? 'the Chrome DevTools browser' : `the Chrome DevTools browser (${host.toolPrefix}*)`
  if (pageOpen) return `Drive the page beside this session with the preview_* tools when the task is to open, visit, or read a site. Development and debugging, a localhost or 127.0.0.1 page included, belong to ${devtools}, not this pane.`
  if (opensIn === 'user-browser') return 'No page is open yet. preview_navigate opens an address in a new tab of the user\'s own browser, through the Aeven extension, where they are signed in to their sites; when the extension is missing, the user is asked to add it and the call continues once they have. Use it whenever the user asks to open, visit, or read a website, then drive the page with the other preview_* tools.'
  if (opensIn === 'pane') return `No page is open beside this session yet. preview_navigate opens the collaborative browser beside it at an address; use it whenever the user asks to open, visit, or go to a website or URL, then drive the page with the other preview_* tools. Open a local dev server in ${devtools} instead.`
  if (unsupported) return 'No browser is available in this session: the user\'s browser cannot run the Aeven extension, which needs Chrome, Edge, Brave, or another Chromium browser on a computer. If the task needs a browser, tell the user to open Aeven in one of those browsers or to use the Aeven desktop app.'
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
  return `No page is open beside this session. The Chromium on this Host is the browser the user can see and sign in to, and the ${host.toolPrefix}* tools drive it, starting it when it is not running. A page served from this machine (localhost or 127.0.0.1) is an application under development: verify it there first, and in the headless browser only when this one cannot start. Use it for remote pages too, preserving the user's signed-in browser session; use headless browsing only when neither visible surface is available.`
}

const selector = { type: 'string', description: "Element selector: CSS such as button[type='submit'] (from preview_snapshot's interactiveElements), or a locator such as text=Sign in, role=button[name=\"Save\"], label=Email, placeholder=Search, testid=submit, or xpath=//a. Join parts with >> to search inside a match; append >> nth=0 to pick one of several matches." } as const
const token = { type: 'string', description: 'Element token from the latest preview_snapshot with mode ax. Valid until the next browser action; do not combine with selector or coordinates.' } as const
const frame = { type: 'string', description: 'Selector of the iframe the target is in. Omit for the top document.' } as const
const modifiers = { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] }, description: 'Modifier keys held during the action.' } as const
const point = { type: 'object', additionalProperties: false, properties: { selector, x: { type: 'number' }, y: { type: 'number' } }, description: 'A selector, or viewport x and y in CSS pixels.' } as const
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
    using bounded = deadline(exec.signal, actionTimeoutMs, 'BROWSER_ACTION_TIMEOUT')
    return await unlessAborted(ctx.waterfall(
      scopeTarget(agent, agent),
      'browser/automation',
      { operation, input, agent, signal: bounded.signal, timeoutMs: actionTimeoutMs },
      unavailable,
    ), bounded.signal)
  }

  const uploadInput = async (input: { [key: string]: JsonValue }, exec: ToolRunContext): Promise<{ [key: string]: JsonValue }> => {
    const agent = callingAgent(exec)
    const policy = ctx.get('sandboxPolicy')
    if (policy === undefined) throw new HarnessError('upload requires the session file policy', 'BROWSER_UPLOAD_POLICY_UNAVAILABLE')
    if (policy.resolve({ session: agent.session }).mode === 'read-only') throw new HarnessError('file upload shares local file contents with a page; read-only access forbids it', 'BROWSER_UPLOAD_DENIED')
    const page = await run('status', {}, exec)
    if (typeof page !== 'object' || page === null || Array.isArray(page) || typeof page.url !== 'string') throw new HarnessError('the browser has no upload destination', 'BROWSER_UNAVAILABLE')
    const url = new URL(page.url)
    const paths = input.paths
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every(path => typeof path === 'string')) throw new HarnessError('upload requires file paths', 'BROWSER_UPLOAD_PATHS')
    if (!isDevelopmentHost(url.hostname)) {
      const approval = ctx.get('approval')
      if (approval === undefined) throw new HarnessError('upload requires user approval', 'BROWSER_UPLOAD_APPROVAL_UNAVAILABLE')
      const outcome = await approval.request({
        agent, toolName: exec.name, callId: exec.callId, signal: exec.signal,
        reason: `Share these local files with ${url.origin}: ${paths.join(', ')}`,
        allowSession: JSON.stringify({ origin: url.origin, paths }),
      })
      if (outcome !== 'allowed-once') throw new HarnessError('file upload was not approved', 'BROWSER_UPLOAD_DENIED')
    }
    return { ...input, origin: url.origin }
  }

  /** What the model is told once the person has seen the handoff. */
  const HANDOFF_DONE = 'The user saw your request and will do it. End your turn now with one short sentence; continue when they reply, and re-inspect the page first.'
  /** What the model is told when the person declines the handoff. */
  const HANDOFF_DECLINED = 'The user declined this step. Do not continue it or work around it; end your turn and say briefly what remains undone.'

  /**
   * Tell the person which browser step is theirs: the browser beside the session
   * shows it as a modal; without one, the chat asks it as a question.
   * @param input - the reason and what the person should do.
   * @param exec - the running tool call.
   * @returns the instruction that ends the agent's turn.
   */
  const handoff = async (input: { [key: string]: JsonValue }, exec: ToolRunContext): Promise<string> => {
    const agent = callingAgent(exec)
    const shown = await unlessAborted(ctx.waterfall(
      scopeTarget(agent, agent),
      'browser/automation',
      { operation: 'handoff', input: { reason: input.reason ?? 'other', message: input.message ?? '' }, agent, signal: exec.signal },
      () => Promise.resolve(null),
    ), exec.signal)
    if (shown !== null) {
      const accepted = typeof shown === 'object' && !Array.isArray(shown) && shown.accepted === true
      return accepted ? HANDOFF_DONE : HANDOFF_DECLINED
    }
    const questions = ctx.get('userQuestions')
    if (questions === undefined) throw new HarnessError('handing the browser to the person needs the browser beside the session or the user-questions service', 'BROWSER_HANDOFF_UNAVAILABLE')
    const answer = await questions.ask({
      agent,
      signal: exec.signal,
      questions: [{ id: 'handoff', question: typeof input.message === 'string' ? input.message : '', options: [{ label: 'OK' }, { label: 'Not now' }] }],
    })
    return answer.answers.find(item => item.id === 'handoff')?.selected.includes('OK') === true ? HANDOFF_DONE : HANDOFF_DECLINED
  }

  /**
   * Require the person's approval before the page's computer clipboard is read.
   * @param exec - the running tool call.
   * @throws {HarnessError} when approval is unavailable or refused.
   */
  const approveClipboardRead = async (exec: ToolRunContext): Promise<void> => {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new HarnessError('reading the clipboard requires user approval', 'BROWSER_CLIPBOARD_APPROVAL_UNAVAILABLE')
    const outcome = await approval.request({
      agent: callingAgent(exec), toolName: exec.name, callId: exec.callId, signal: exec.signal,
      reason: 'Read the text on your clipboard', allowSession: 'clipboard-read',
    })
    if (outcome !== 'allowed-once') throw new HarnessError('reading the clipboard was not approved', 'BROWSER_CLIPBOARD_DENIED')
  }

  /**
   * Require the person's approval before a page's WebMCP tool runs: the tool acts
   * with the person's session on that site. An approval for the session covers
   * the same tool on the same site.
   * @param tool - the page tool's name.
   * @param args - the arguments it runs with.
   * @param exec - the running tool call.
   * @throws {HarnessError} when approval is unavailable or refused.
   */
  const approveWebMcp = async (tool: string, args: JsonValue, exec: ToolRunContext): Promise<void> => {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new HarnessError('running a page tool requires user approval', 'BROWSER_WEBMCP_APPROVAL_UNAVAILABLE')
    const page = await run('status', {}, exec)
    const origin = typeof page === 'object' && page !== null && !Array.isArray(page) && typeof page.url === 'string' ? new URL(page.url).origin : 'this page'
    const outcome = await approval.request({
      agent: callingAgent(exec), toolName: exec.name, callId: exec.callId, signal: exec.signal,
      reason: `Run the page tool ${tool} on ${origin} with ${JSON.stringify(args)}`,
      allowSession: JSON.stringify({ webmcp: origin, tool }),
    })
    if (outcome !== 'allowed-once') throw new HarnessError('running the page tool was not approved', 'BROWSER_WEBMCP_DENIED')
  }

  /**
   * Require the person's approval before their browsing history is read; an
   * approval for the session covers later searches.
   * @param exec - the running tool call.
   * @throws {HarnessError} when approval is unavailable or refused.
   */
  const approveHistoryRead = async (exec: ToolRunContext, source: 'aeven' | 'browser'): Promise<void> => {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new HarnessError('reading browsing history requires user approval', 'BROWSER_HISTORY_APPROVAL_UNAVAILABLE')
    const outcome = await approval.request({
      agent: callingAgent(exec), toolName: exec.name, callId: exec.callId, signal: exec.signal,
      reason: source === 'browser' ? 'Search the history of your browser, through the Aeven extension' : 'Search the history of the browser beside the chat',
      allowSession: `browser-history:${source}`,
    })
    if (outcome !== 'allowed-once') throw new HarnessError('reading browsing history was not approved', 'BROWSER_HISTORY_DENIED')
  }

  /**
   * Require the person's approval before their bookmarks are read; an approval for the session covers later searches.
   * @param exec - the running tool call.
   * @throws {HarnessError} when approval is unavailable or refused.
   */
  const approveBookmarksRead = async (exec: ToolRunContext): Promise<void> => {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new HarnessError('reading bookmarks requires user approval', 'BROWSER_BOOKMARKS_APPROVAL_UNAVAILABLE')
    const outcome = await approval.request({
      agent: callingAgent(exec), toolName: exec.name, callId: exec.callId, signal: exec.signal,
      reason: 'Search the bookmarks of your browser, through the Aeven extension', allowSession: 'browser-bookmarks',
    })
    if (outcome !== 'allowed-once') throw new HarnessError('reading bookmarks was not approved', 'BROWSER_BOOKMARKS_DENIED')
  }

  /**
   * Require the person's approval before the browser's cookies or cache are cleared:
   * clearing cookies signs the person out of every site in this browser.
   * @param control - `clear-cookies` or `clear-cache`.
   * @param exec - the running tool call.
   * @throws {HarnessError} when approval is unavailable or refused.
   */
  const approveClearing = async (control: string, exec: ToolRunContext): Promise<void> => {
    const approval = ctx.get('approval')
    if (approval === undefined) throw new HarnessError('clearing browser data requires user approval', 'BROWSER_CLEAR_APPROVAL_UNAVAILABLE')
    const outcome = await approval.request({
      agent: callingAgent(exec), toolName: exec.name, callId: exec.callId, signal: exec.signal,
      reason: control === 'clear-cookies' ? 'Clear the browser\'s cookies, which signs you out of every site in it' : 'Clear the browser\'s cache',
    })
    if (outcome !== 'allowed-once') throw new HarnessError('clearing browser data was not approved', 'BROWSER_CLEAR_DENIED')
  }

  // The first step of each turn carries the open page, so the model knows what
  // the user is looking at before it decides whether a request is about it.
  // The context is an ordinary plugin user message, so it is logged. The page
  // is optional, so an unanswered lookup costs the step at most
  // `statusTimeoutMs`.
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    // The pane lookup needs nothing from the later listeners, so it runs while they do: a session without an open
    // pane waits out the status timeout once, alongside recall and connector setup, instead of after them. A turn
    // already cancelled here has no step to describe, so it issues no request.
    const pending = step === 1 && !isCancelled(signal) ? readSessionTab(agent, signal) : undefined
    const decision = await next()
    if (pending === undefined || decision.kind === 'reject' || isCancelled(signal)) return decision
    const lookup = await pending
    switch (lookup.kind) {
      case 'page': {
        const page = asSessionTabPage(lookup.page)
        if (page === null) return decision
        const text = renderBrowserContext(page)
        /* jscpd:ignore-start -- mirrors @aeven/time-context's time snapshot on the same session source form */
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
        /* jscpd:ignore-end */
      }
      case 'unanswered':
        ctx.logger.debug(`browser status unanswered after ${statusTimeoutMs}ms; step ${step} proceeds without the browser context`)
        return decision
      case 'failed': {
        // A turn that cancelled its own lookup is not a pane failure.
        if (!isCancelled(signal)) {
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
      let input = args as { [key: string]: JsonValue }
      if (operation === 'navigate' && typeof input.url === 'string' && isDevelopmentAddress(input.url)) {
        const agent = callingAgent(exec)
        const host = personAskedForAddress(agent.session.deriveMessages(), input.url)
          ? null
          : await readHostBrowser(agent, exec.signal)
        if (host?.toolPrefix !== undefined && host.toolsUnavailable === undefined) {
          throw new HarnessError(
            `${input.url} is served from this machine, so it belongs to the Chrome DevTools browser rather than the sidebar pane: nothing in the person's request asked you to open it. Call ${host.toolPrefix}new_page with {"url":"${input.url}"} and drive it with the other ${host.toolPrefix}* tools.`,
            'BROWSER_DEVELOPMENT_TARGET',
          )
        }
      }
      if (operation === 'upload') input = await uploadInput(input, exec)
      if (operation === 'clipboard' && input.action === 'read') await approveClipboardRead(exec)
      if (operation === 'history') {
        // A session whose only browser is the user's own has no browser beside the chat to search.
        if (input.source !== 'browser') {
          const lookup = await readSessionTab(callingAgent(exec), exec.signal)
          if (lookup.kind === 'page' && isUserBrowserSurface(lookup.page)) input = { ...input, source: 'browser' }
        }
        await approveHistoryRead(exec, input.source === 'browser' ? 'browser' : 'aeven')
      }
      if (operation === 'bookmarks') await approveBookmarksRead(exec)
      // Tab commands also reach Aeven's own Chrome, whose endpoint the Host knows.
      if (operation === 'tabs') {
        const chromium = await ctx.get('browserChromium')?.status(exec.signal).catch(() => undefined)
        if (chromium !== undefined) input = { ...input, chromium: chromium.browserUrl }
      }
      if (operation === 'webmcp' && input.action === 'invoke') await approveWebMcp(typeof input.name === 'string' ? input.name : '', input.input ?? {}, exec)
      if (operation === 'control' && (input.control === 'clear-cookies' || input.control === 'clear-cache')) await approveClearing(input.control, exec)
      if (operation === 'sequence' && (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 20)) throw new HarnessError('sequence requires 1 to 20 actions', 'BROWSER_SEQUENCE_ACTION')
      if (operation === 'sequence' && Array.isArray(input.actions)) {
        const actions: JsonValue[] = []
        for (const action of input.actions) {
          if (typeof action !== 'object' || action === null || Array.isArray(action)) throw new HarnessError('sequence actions must be objects', 'BROWSER_SEQUENCE_ACTION')
          actions.push(action.operation === 'upload' ? await uploadInput(action, exec) : action)
        }
        input = { ...input, actions }
      }
      return JSON.stringify(await run(operation, input, exec))
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
      const opensIn = lookup.kind === 'page' ? openableIn(lookup.page) : null
      const unsupported = lookup.kind === 'page' && isUnsupportedBrowser(lookup.page)
      const host = await readHostBrowser(callingAgent(exec), exec.signal)
      const report: { [key: string]: JsonValue } = {
        sessionTab: page,
        hostBrowser: host === null ? null : { ...host },
        nextStep: nextStepFor(page !== null, opensIn, unsupported, host),
      }
      return JSON.stringify(report)
    },
  })

  // Names and descriptions are t3code's `preview_*` toolkit
  // (`apps/server/src/mcp/toolkits/preview/tools.ts`), narrowed to the
  // parameters this browser implements.
  for (const tool of [
    status,
    defineTool({
      name: 'preview_screenshot',
      description: 'Capture the visible viewport of the collaborative browser as a JPEG image. Use it when page pixels are needed; inspect accessibility or DOM state for ordinary interaction.',
      parameters: {},
      timeoutMs: actionTimeoutMs,
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { attachment: { type: 'object', additionalProperties: true, required: true } } },
        render: (_args, value) => [{ type: 'image', attachment: value.attachment as unknown as ImageAttachmentRef }],
      },
      async execute(_args, exec) {
        const attachments = ctx.get('attachments')
        if (attachments === undefined) throw new HarnessError('browser screenshots require attachment storage', 'BROWSER_SCREENSHOT_STORAGE')
        const capture = await run('screenshot', {}, exec)
        if (typeof capture !== 'object' || capture === null || Array.isArray(capture) || typeof capture.data !== 'string' || capture.mimeType !== 'image/jpeg') {
          throw new HarnessError('the browser returned an invalid JPEG capture', 'BROWSER_SCREENSHOT_INVALID')
        }
        exec.signal.throwIfAborted()
        const attachment = await attachments.saveImage({ data: Buffer.from(capture.data, 'base64'), mediaType: 'image/jpeg', name: 'browser.jpg' })
        return { attachment: { ...attachment } }
      },
    }),
    action('preview_navigate', 'navigate',
      "Navigate the collaborative browser tab, opening that browser beside the session when it is closed. Use it whenever the user asks to open, visit, or go to a website or URL, rather than a shell command that opens another browser. Pass {url:'https://t3.chat'} for a website. A localhost or loopback address opens here only when the person's own request names it; a page you are building belongs to the Chrome DevTools browser.",
      { url: { type: 'string', required: true, description: 'Website URL. Use this for public pages and directly reachable URLs.' } }),
    action('preview_back', 'back',
      'Go back one page in the collaborative browser tab, showing the pointer pressing the control.',
      {}),
    action('preview_forward', 'forward',
      'Go forward one page in the collaborative browser tab, showing the pointer pressing the control.',
      {}),
    action('preview_browser_control', 'control',
      "Press a control of the browser itself with the pointer, as the user would: copy a screenshot of the page to the clipboard (capture), open the page in Chrome, hard reload, open DevTools, zoom in, out, or reset, switch the page's appearance, or clear cookies or cache (asks the user first; clearing cookies signs them out of every site).",
      { control: { type: 'string', required: true, enum: ['capture', 'open-in-chrome', 'hard-reload', 'devtools', 'zoom-in', 'zoom-out', 'zoom-reset', 'appearance:system', 'appearance:light', 'appearance:dark', 'clear-cache', 'clear-cookies'], description: 'The control to press.' } }),
    action('preview_tabs', 'tabs',
      "List, open, select, or close browser tabs: the sidebar browser's tabs beside the session, Aeven's own Chrome (browser chrome), the user's everyday Chrome (browser my-chrome) when they allowed it, and the tabs Aeven opened through its extension in any of the user's browsers (browser extension; each tab names its browserName). Every other preview_* tool acts on the current tab: new opens a tab (at url when given) and makes it current, select makes another tab current. Use the sidebar browser unless the task needs a full Chrome or the user's own Chrome and its sign-ins.",
      {
        action: { type: 'string', required: true, enum: ['list', 'new', 'select', 'close'], description: 'What to do.' },
        tabId: { type: 'string', description: 'The tab to select or close, from list.' },
        url: { type: 'string', description: 'Address a new tab opens at.' },
        browser: { type: 'string', enum: ['sidebar', 'chrome', 'my-chrome', 'extension'], description: "Where new opens the tab: sidebar (default), chrome (Aeven's own Chrome), my-chrome (the user's Chrome over remote debugging), or extension (the user's browser through the Aeven extension, in its Aeven tab group; Aeven starts that browser when it is closed)." },
        browserName: { type: 'string', description: 'With browser extension, which of the connected browsers new opens the tab in, such as Brave, as tab lists name it; omitted picks the most recently connected.' },
      }),
    action('preview_history', 'history',
      'Search the pages the user visited, newest first, by words in the address or title, to find something they read earlier: in the browser beside the chat, or with source browser in every browser of theirs the Aeven extension is connected in. Asks the user first.',
      {
        source: { type: 'string', enum: ['aeven', 'browser'], description: "aeven (default) searches the browser beside the chat; browser searches the user's own browser through the Aeven extension." },
        query: { type: 'string', description: 'Words that must all appear in the address or title; empty lists the newest pages.' },
        limit: { type: 'integer', description: 'Most pages to return, 1 to 200. Defaults to 20.' },
      }),
    action('preview_bookmarks', 'bookmarks',
      "Search the user's bookmarks in their own browser, through the Aeven extension, by words in the title or address. Asks the user first.",
      {
        query: { type: 'string', description: 'Words to match; empty lists recent bookmarks.' },
        limit: { type: 'integer', description: 'Most bookmarks to return, 1 to 200. Defaults to 20.' },
      }),
    action('preview_page_tools', 'webmcp',
      "Use the tools the open page offers to agents through WebMCP: list them, or invoke one with JSON input. A page tool does the page's own work directly (search, add to cart, fill a form) and is more reliable than clicking. Invoking asks the user first.",
      {
        action: { type: 'string', required: true, enum: ['list', 'invoke'], description: 'list the page tools, or invoke one.' },
        name: { type: 'string', description: 'The page tool to invoke, from list.' },
        input: { type: 'object', additionalProperties: true, description: "Arguments matching the tool's inputSchema." },
      }),
    action('preview_reload', 'reload',
      'Reload the page in the collaborative browser tab, showing the pointer pressing the control.',
      {}),
    action('preview_snapshot', 'snapshot',
      'Inspect a page before interacting. mode dom returns visible text and CSS selectors. mode ax reads the browser accessibility tree, including shadow DOM, and returns indexed nodes with snapshot-scoped tokens. Refresh after every action; truncated means nodes were omitted.',
      { mode: { type: 'string', enum: ['dom', 'ax'], description: 'Observation mode. Defaults to dom.' }, frame }),
    action('preview_click', 'click',
      'Click exactly one target in the collaborative browser tab: the pointer moves there first, and the call returns once a navigation the click started has loaded. Prefer a selector from preview_snapshot; x and y must be supplied together. clickCount 2 double-clicks; button right opens a context menu.',
      {
        selector, token, frame, modifiers,
        x: { type: 'number', description: 'Viewport-relative X coordinate in CSS pixels. Must be paired with y.' },
        y: { type: 'number', description: 'Viewport-relative Y coordinate in CSS pixels. Must be paired with x.' },
        clickCount: { type: 'integer', enum: [1, 2, 3], description: 'Clicks in a row: 1 (default), 2 for a double-click, 3 for a triple-click.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Defaults to left.' },
      }),
    action('preview_type', 'type',
      'Insert literal text into one input in the collaborative browser tab. Types into selector, or into the currently focused element when omitted; set clear=true to replace existing text. sequential=true types one character at a time for inputs that react to each keystroke, such as autocomplete.',
      {
        text: { type: 'string', required: true, description: 'Literal text to insert.' }, selector, token, frame,
        clear: { type: 'boolean', description: 'Clear the existing input value before inserting text. Defaults to false.' },
        sequential: { type: 'boolean', description: 'Type one character at a time with key events for line breaks and tabs. Defaults to false.' },
      }),
    action('preview_hover', 'hover',
      'Move the pointer over one target without clicking, to open a hover menu or tooltip.',
      { selector, token, frame, modifiers, x: { type: 'number', description: 'Viewport X in CSS pixels, with y.' }, y: { type: 'number', description: 'Viewport Y in CSS pixels, with x.' } }),
    action('preview_drag', 'drag',
      'Press the mouse on one point, move to another, and release: drag a slider, a card, or a file between targets.',
      { from: { ...point, required: true }, to: { ...point, required: true }, modifiers }),
    action('preview_select', 'select',
      'Choose options in a native <select> by option value or visible label. For a custom dropdown, click it open and click the option instead.',
      { selector, token, frame, values: { type: 'array', required: true, items: { type: 'string' }, description: 'Option values or labels; more than one only for a multiple select.' } }),
    action('preview_check', 'check',
      'Set a checkbox, radio button, or switch to checked or unchecked, clicking it only when its state differs.',
      { selector, token, frame, checked: { type: 'boolean', required: true, description: 'The state the control should end in.' } }),
    action('preview_read', 'read',
      'Read from elements without changing the page: their text, innerText, html, value, an attribute, the count of matches, whether they are visible, enabled, or checked, or their box. all=true reads every match.',
      {
        selector, token, frame,
        property: { type: 'string', enum: ['text', 'innerText', 'html', 'value', 'attribute', 'count', 'visible', 'enabled', 'checked', 'box'], description: 'What to read. Defaults to text.' },
        name: { type: 'string', description: 'Attribute name, for property attribute.' },
        all: { type: 'boolean', description: 'Read every match instead of exactly one.' },
      }),
    action('preview_wait', 'wait',
      'Wait until an element reaches a state, the address matches, or the page has loaded. Use it after an action that changes the page later, not fixed sleeps.',
      {
        selector, frame,
        state: { type: 'string', enum: ['visible', 'hidden', 'attached', 'detached'], description: 'Element state to wait for. Defaults to visible and enabled.' },
        url: { type: 'string', description: 'Text the address must contain, or a /regular expression/.' },
        load: { type: 'string', enum: ['load', 'domcontentloaded'], description: 'Document load state to wait for.' },
        timeoutMs: { type: 'number', description: 'Deadline, 1 to 60000 ms. Defaults to 5000.' },
      }),
    action('preview_content', 'content',
      "Read the open page's content in one call: markdown (default) for articles and documents, text, html, or youtube_transcript for the captions of an open YouTube video. Output past 100000 characters is truncated.",
      { format: { type: 'string', enum: ['markdown', 'text', 'html', 'youtube_transcript'], description: 'Output format. Defaults to markdown.' } }),
    action('preview_export_document', 'export',
      "Download the open Google Docs, Sheets, or Slides document into the user's Downloads folder with the user's own access. Docs: docx, pdf, md, txt, odt, rtf, epub; Sheets: xlsx, csv (the open sheet), pdf, ods, tsv; Slides: pptx, pdf, txt, odp. Text formats also return the content.",
      { format: { type: 'string', description: 'Export format; defaults to docx, xlsx, or pptx for the document kind.' } }),
    action('preview_clipboard', 'clipboard',
      "Read or write the computer's clipboard text, for example to paste into a page with preview_press Meta+v after writing. Reading asks the user first.",
      { action: { type: 'string', enum: ['read', 'write'], required: true, description: 'read or write.' }, text: { type: 'string', description: 'Text to write.' } }),
    action('preview_console', 'console',
      "Read the page's recent console messages and uncaught exceptions, newest last, to debug a page that misbehaves.",
      {
        levels: { type: 'array', items: { type: 'string', enum: ['log', 'info', 'warning', 'error', 'debug', 'exception'] }, description: 'Only these levels.' },
        limit: { type: 'integer', description: 'Most recent entries to return, 1 to 500. Defaults to 100.' },
        clear: { type: 'boolean', description: 'Forget the returned entries afterwards.' },
      }),
    action('preview_dialog', 'dialog',
      'Inspect or answer the JavaScript alert, confirm, prompt, or beforeunload dialog that blocks the page. Without action it reports the open dialog.',
      { action: { type: 'string', enum: ['accept', 'dismiss'], description: 'accept presses OK, dismiss presses Cancel.' }, promptText: { type: 'string', description: 'Text entered into a prompt dialog before accepting.' } }),
    action('preview_press', 'press',
      "Press one keyboard key in the collaborative browser tab. Examples: {key:'Enter'}, {key:'Escape'}, or {key:'a',modifiers:['Meta']}.",
      {
        key: { type: 'string', required: true, description: 'Keyboard key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character.' },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] }, description: 'Modifier keys held while pressing key.' },
      }),
    action('preview_scroll', 'scroll',
      'Scroll the collaborative browser tab with the mouse wheel at the pointer. Positive deltaY scrolls down and positive deltaX scrolls right; a selector or x and y scrolls the container under that point.',
      {
        deltaX: { type: 'number', description: 'Horizontal scroll delta in CSS pixels. Positive scrolls right. Defaults to 0.' },
        deltaY: { type: 'number', description: 'Vertical scroll delta in CSS pixels. Positive scrolls down. Defaults to 0.' },
        selector, token, frame,
        x: { type: 'number', description: 'Viewport X in CSS pixels, with y.' }, y: { type: 'number', description: 'Viewport Y in CSS pixels, with x.' },
      }),
    action('preview_upload', 'upload',
      'Attach local files in this browser. Prefer the file input selector; an Upload button selector opens and answers its chooser in the same action. Paths must be absolute paths on the Electron computer. Remote uploads require approval.',
      { selector, paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Absolute local file paths to attach.' } }),
    action('preview_sequence', 'sequence',
      'Execute 1 to 20 known actions in order in this browser, without model round trips. Stops at the first failure and reports its index. Use wait actions for page transitions, not fixed sleeps. Obtain selectors from the page first; include a final submit only when the user authorized that exact submission.',
      { actions: { type: 'array', required: true, items: { oneOf: [
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'click', required: true }, selector: { ...selector, required: true },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'type', required: true }, selector,
          text: { type: 'string', required: true }, clear: { type: 'boolean' },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'press', required: true }, key: { type: 'string', required: true },
          modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] } },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'upload', required: true }, selector,
          paths: { type: 'array', required: true, items: { type: 'string' } },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'wait', required: true }, selector, url: { type: 'string' },
          load: { type: 'string', enum: ['load', 'domcontentloaded'] },
          state: { type: 'string', enum: ['visible', 'hidden', 'attached', 'detached'] }, timeoutMs: { type: 'number' },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'hover', required: true }, selector: { ...selector, required: true },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'select', required: true }, selector: { ...selector, required: true },
          values: { type: 'array', required: true, items: { type: 'string' } },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'check', required: true }, selector: { ...selector, required: true },
          checked: { type: 'boolean', required: true },
        } },
        { type: 'object', additionalProperties: false, properties: {
          operation: { type: 'string', const: 'scroll', required: true }, selector,
          deltaX: { type: 'number' }, deltaY: { type: 'number' },
        } },
      ] }, description: '1 to 20 ordered actions. wait needs a selector, url, or load; a selector wait defaults to visible and enabled, with a 5000ms deadline; timeoutMs must be 1 to 60000.' } }),
    action('preview_evaluate', 'evaluate',
      'Evaluate JavaScript in the collaborative browser tab. Returns {value} with a serializable result up to 64 KB; the expression may mutate page state.',
      { expression: { type: 'string', required: true, description: "JavaScript expression evaluated in the page's main frame, for example document.title or (() => ({href: location.href}))()." }, frame }),
    defineTool({
      name: 'preview_handoff',
      description: 'Tell the user a browser step is theirs to do: signing in, a captcha or verification code, confirming a payment or purchase, or anything they asked to do themselves. The browser shows your message in a modal; then end your turn and continue when the user replies. Never type their credentials.',
      parameters: {
        reason: { type: 'string', required: true, enum: ['authentication', 'captcha', 'confirmation', 'user_requested', 'other'], description: 'Why the user takes over.' },
        message: { type: 'string', required: true, description: 'One sentence telling the user what to do, for example "Sign in to your Google account here, then tell me when you are done."' },
      },
      output: { schema: { type: 'string' }, ...text },
      async execute(args, exec) {
        return await handoff(args as { [key: string]: JsonValue }, exec)
      },
    }),
  ]) ctx.tools.register(tool)
}
