/**
 * The model-facing `offer_desktop` tool over the `desktop-handoff/offer` waterfall.
 *
 * On a Host with no access to the reader's computer, such as Aeven Web, a
 * request that needs that computer cannot be done. The tool opens the
 * "Available in Aeven Desktop" dialog in the window showing the session, with
 * a button that continues the same conversation in the desktop app. It reads
 * and changes nothing itself.
 *
 * The wait is bounded by `answerTimeoutMs`: a forwarded waterfall stays pending
 * until a connected client answers it, and no window may be showing the session.
 *
 * @module @aeven/tool-desktop-handoff
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeTarget } from '@aeven/scope'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { defineTool } from '@aeven/tools'
import type { DesktopHandoffReason, DesktopHandoffResult } from './types.ts'

export type { DesktopHandoffOfferEvent, DesktopHandoffReason, DesktopHandoffResult } from './types.ts'

export const name = 'tool-desktop-handoff'
export const inject = ['tools', 'agents']

/** How long the tool waits for a window to answer. Invalid values fail plugin load. */
export interface Config {
  /** Milliseconds a window showing the session has to open the dialog before the offer counts as unanswered. */
  answerTimeoutMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  answerTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(10_000),
})

/** The reasons the model may give, in the order its schema lists them. */
const REASONS: readonly DesktopHandoffReason[] = ['computer', 'files', 'terminal', 'device', 'models']

/**
 * The model-facing text for one outcome.
 * @param result - how the offer ended.
 * @returns the tool result text.
 */
export function renderDesktopHandoffResult(result: DesktopHandoffResult): string {
  switch (result) {
    case 'shown':
      return 'A dialog in the user\'s window now offers to continue this conversation in Aeven Desktop, or to download it. Tell the user in one sentence what the desktop app would do for this request.'
    case 'no-window':
      return 'No window is showing this conversation, so nothing opened. Tell the user that the Aeven desktop app can do this on their computer.'
  }
}

/**
 * Register the `offer_desktop` tool.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the field is set after validation.
  const answerTimeoutMs = config.answerTimeoutMs as number

  ctx.tools.register(defineTool({
    name: 'offer_desktop',
    description: 'Offer the user the Aeven desktop app when their request needs their own computer and this environment cannot do it: '
      + 'controlling apps on their computer (computer use), their own files and folders, a terminal on their machine, phone simulators, or local models. '
      + 'A dialog opens in the user\'s window with a button that continues this conversation in Aeven Desktop. '
      + 'Call it once, at the point where you would otherwise say the request cannot be done here, and never for something this environment can do.',
    parameters: {
      reason: {
        type: 'string',
        required: true,
        enum: [...REASONS],
        description: 'What the request needs: computer (apps and computer use), files (their own files and folders), terminal, device (phone simulators and emulators), or models (models that run on their machine).',
      },
    },
    /* jscpd:ignore-start -- the string-answer tool shape tool-location shares; each tool owns its own contract. */
    timeoutMs: answerTimeoutMs,
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('offer_desktop needs a calling agent')
      /* jscpd:ignore-end */
      const raw = (args as { reason?: unknown }).reason
      // The schema enumerates the reasons; a value outside it is the model's JSON, so it falls back to computer.
      const reason = REASONS.find(candidate => candidate === raw) ?? 'computer'
      const bounded = AbortSignal.any([exec.signal, AbortSignal.timeout(answerTimeoutMs)])
      const unanswered = new Promise<DesktopHandoffResult>((resolve) => {
        if (bounded.aborted) resolve('no-window')
        else bounded.addEventListener('abort', () => { resolve('no-window') }, { once: true })
      })
      const result = await Promise.race([
        ctx.waterfall(scopeTarget(agent, agent), 'desktop-handoff/offer', { reason, agent, signal: bounded },
          () => Promise.resolve<DesktopHandoffResult>('no-window')),
        unanswered,
      ])
      exec.signal.throwIfAborted()
      return renderDesktopHandoffResult(result)
    },
  }))
}
