/**
 * Model-facing mail tools over `ctx.mail`: `mail_accounts`, `mail_search`, `mail_read`,
 * `mail_update`, and `mail_send`. The tools are registered for an agent only while its
 * session owner has at least one usable mail account, and one tool set serves every account,
 * so the catalog does not grow with the number of mailboxes. Sending and permanent deletion
 * ask the user for approval.
 * @module @aeven/tool-mail
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@aeven/agent'
import type {} from '@aeven/mail'
import type { PreToolDecision } from '@aeven/tools'
import { mailTools } from './tools.ts'

export { EXTERNAL_MAIL_CONTENT_NOTICE } from './format.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-mail'

/** Services required by the mail tools; `mail` is optional so a composition without it still mounts. */
export const inject = { tools: { required: true }, mail: { required: false } }

/** Per-tool cooperative timeouts. */
export interface Config {
  /** Budget for account, search, read, and update calls, in milliseconds. */
  timeoutMs: number
  /** Budget for send calls, in milliseconds. */
  sendTimeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.natural().min(1).default(120_000),
  sendTimeoutMs: Schema.natural().min(1).default(120_000),
})

/**
 * Register the mail tools while the session owner has mail accounts, and route sends and permanent deletes through approval.
 * @param ctx - plugin context; per-session when mounted from an agent preset.
 * @param config - cooperative timeouts.
 */
export function apply(ctx: Context, config: Config): void {
  let unregister: (() => void) | undefined
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const owner = agent.session.header.owner
    const mail = ctx.get('mail')
    const available = owner !== undefined && mail !== undefined && (await mail.accounts(owner)).length > 0
    if (available && unregister === undefined) {
      const disposers = mailTools(mail, config).map(tool => ctx.tools.register(tool))
      unregister = () => { for (const dispose of disposers) dispose() }
    } else if (!available && unregister !== undefined) {
      unregister()
      unregister = undefined
    }
    return next()
  })
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'mail_send' && exec.name !== 'mail_update') return next()
    // A deny from a later policy still wins; otherwise these calls always ask.
    const decision = await next()
    if (decision.kind === 'deny') return decision
    const args = exec.arguments as Record<string, unknown> | undefined
    if (exec.name === 'mail_send' && args?.draft !== true) {
      const to = Array.isArray(args?.to) ? args.to.join(', ') : ''
      const what = typeof args?.subject === 'string' ? `an email “${args.subject}”` : args?.replyTo !== undefined ? 'a reply' : 'an email'
      return { kind: 'ask', reason: `Send ${what} from ${String(args?.account)} to ${to}.` }
    }
    if (exec.name === 'mail_update' && args?.action === 'delete') {
      const count = Array.isArray(args.ids) ? args.ids.length : 0
      return { kind: 'ask', reason: `Permanently delete ${String(count)} email${count === 1 ? '' : 's'} from ${String(args.account)}.` }
    }
    return decision
  })
}
