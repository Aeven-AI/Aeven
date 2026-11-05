/**
 * @aeven/hosted-app — the hosted Aeven Web bundle. The package's substance is
 * `cordis.patch.yml`, declared by the `avn.bundle.patch` manifest field and
 * applied after `@aeven/web-app` by the `hosted` profile. Its runtime plugin
 * bounds model streams without installing policy in desktop compositions.
 * @module @aeven/hosted-app
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/agent'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/llm'
import { AccountRequests, type RequestLimits } from './limits.ts'

export const name = 'hosted-runtime'
export const inject = ['agents', 'llm']

/** Hosted-only admission settings. */
export type Config = RequestLimits

export const Config: z<Config> = z.object({
  perAccount: z.natural().min(1).default(2),
  total: z.natural().min(1).default(64),
  queuedPerAccount: z.natural().min(1).default(8),
  queuedTotal: z.natural().min(1).default(128),
})

/**
 * Bound every streaming LLM request for the hosted composition, including auxiliary calls.
 * @param ctx - hosted Host context.
 * @param config - concurrent and queued request bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const requests = new AccountRequests(config)
  const closing = new AbortController()
  ctx.effect(() => () => {
    closing.abort(new Error('Hosted runtime is shutting down'))
    requests.close()
  }, 'hosted request admission')
  ctx.on('llm/stream', async function* (options, next) {
    const owner = (options.sessionId === undefined ? undefined : ctx.agents.get(options.sessionId)?.session.header.owner)
      ?? ctx.agents.currentInitiator()?.session.header.owner ?? ctx.get('identityUsers')?.actingUser()?.id
    const signal = options.signal === undefined ? closing.signal : AbortSignal.any([options.signal, closing.signal])
    const release = await requests.acquire(owner, signal)
    try {
      signal.throwIfAborted()
      yield* next()
    } finally {
      release()
    }
  }, { prepend: true })
}
