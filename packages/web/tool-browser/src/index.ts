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
import type { PreStepDecision } from '@aeven/agent'
import { createUserMessage, HarnessError } from '@aeven/llm'
import { scopeTarget } from '@aeven/scope'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@aeven/timeout'
import { defineTool, type ParameterSchemaSpec, type ToolRunContext } from '@aeven/tools'
import type { JsonValue } from '@aeven/util-values'
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
  'Do not switch to Chrome, computer use, or standalone browser automation merely because a first call fails. A failed preview tool call should be inspected and retried with corrected arguments when the error is actionable.',
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
  const run = async (
    operation: BrowserAutomationOperation,
    input: { [key: string]: JsonValue },
    exec: ToolRunContext,
  ): Promise<JsonValue> => {
    const agent = exec.agent
    if (agent === undefined) throw new HarnessError('browser tools need a calling agent', 'BROWSER_NO_AGENT')
    const unavailable = () => Promise.reject(new HarnessError(
      'No automation-capable browser is open beside this session. Ask the user to open it from the right sidebar (Browser).',
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
  // `statusTimeoutMs`; the bounded signal also cancels the pending request.
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1 || signal.aborted) return decision
    using bounded = deadline(signal, statusTimeoutMs, BROWSER_STATUS_TIMEOUT)
    const page = await unlessAborted(ctx.waterfall(
      scopeTarget(agent, agent),
      'browser/automation',
      { operation: 'status', input: {}, agent, signal: bounded.signal },
      () => Promise.resolve(null),
    ), bounded.signal).catch((error: unknown) => {
      if (timeoutOf(bounded.signal, BROWSER_STATUS_TIMEOUT) !== undefined) {
        ctx.logger.debug(`browser status unanswered after ${statusTimeoutMs}ms; step ${step} proceeds without the browser context`)
      } else if (!signal.aborted) {
        ctx.logger.warn(`browser status failed: ${error instanceof Error ? error.message : String(error)}; step ${step} proceeds without the browser context`)
      }
      return null
    }) as { url?: unknown; title?: unknown } | null
    if (page === null || typeof page.url !== 'string' || page.url === '' || page.url === 'about:blank') return decision
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

  // Names and descriptions are t3code's `preview_*` toolkit
  // (`apps/server/src/mcp/toolkits/preview/tools.ts`), narrowed to the
  // parameters this browser implements.
  for (const tool of [
    action('preview_status', 'status',
      'Report whether the collaborative browser tab beside this session is automation-capable, including its URL, title, and loading state.',
      {}),
    action('preview_navigate', 'navigate',
      "Navigate the collaborative browser tab. Pass {url:'https://t3.chat'} for a website or a local dev server URL.",
      { url: { type: 'string', required: true, description: 'Website URL. Use this for public pages and directly reachable URLs.' } }),
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
