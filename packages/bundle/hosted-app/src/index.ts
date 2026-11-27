/**
 * @aeven/hosted-app — the hosted Aeven Web bundle. The package's substance is
 * `cordis.patch.yml`, declared by the `avn.bundle.patch` manifest field and
 * applied after `@aeven/web-app` by the `hosted` profile. Its runtime plugin
 * bounds model streams, tells each served page to keep its settings on the
 * Host, and reports when the Host's event loop was held, without installing
 * policy in desktop compositions.
 * @module @aeven/hosted-app
 */

import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/agent'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/llm'
import type {} from '@aeven/attachment'
import type {} from '@aeven/session-handoff'
import type {} from '@aeven/host-webserver'
import { AccountRequests, type RequestLimits } from './limits.ts'

/**
 * Page global naming where a served page keeps settings; `@aeven/client-ui-settings` reads it. Every page of this
 * Host belongs to a signed-in account whose settings the Host keeps, so pages read and write them through the Host
 * although they are not served from the reader's own machine.
 */
export const SETTINGS_PAGE_GLOBAL = '__AVN_SETTINGS__'

/**
 * Page global holding the reader's country as an ISO 3166 alpha-2 code, read from the request header
 * {@link Config.countryHeader} names; absent when the header is. `@aeven/client-ui-settings-integrations` starts the
 * WhatsApp country-code box from it, because a browser's language (`en-US` on a phone in the Netherlands) is a poor
 * guess of where its reader is.
 */
export const READER_COUNTRY_GLOBAL = '__AVN_READER_COUNTRY__'

export const name = 'hosted-runtime'
export const inject = ['agents', 'llm']

/** Hosted-only admission settings, the request header the edge states the reader's country in, and page analytics. */
export type Config = RequestLimits & {
  /** Lower-case request header carrying the reader's ISO 3166 alpha-2 country, such as Cloudflare's `cf-ipcountry`. */
  countryHeader: string
  /** Google Analytics 4 measurement id, such as `G-XXXXXXXXXX`, whose gtag every served page loads; absent loads none. */
  googleAnalyticsId?: string
  /**
   * Longest event-loop delay within one `eventLoopLagIntervalMs` window that is logged as a warning, in milliseconds.
   * Every account shares this process's event loop, so a delay is time no account's turn advanced; `0` logs none.
   */
  eventLoopLagWarnMs: number
  /** Length of one event-loop delay window, in milliseconds. */
  eventLoopLagIntervalMs: number
}

export const Config: z<Config> = z.object({
  countryHeader: z.string().default('cf-ipcountry'),
  googleAnalyticsId: z.string().pattern(/^G-[A-Z0-9]+$/u).required(false),
  perAccount: z.natural().min(1).default(2),
  total: z.natural().min(1).default(64),
  queuedPerAccount: z.natural().min(1).default(8),
  queuedTotal: z.natural().min(1).default(128),
  eventLoopLagWarnMs: z.natural().default(250),
  eventLoopLagIntervalMs: z.natural().min(1_000).default(10_000),
})

/**
 * Bound every streaming LLM request for the hosted composition, including auxiliary calls.
 * @param ctx - hosted Host context.
 * @param config - concurrent and queued request bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table, _origin, request) => {
    table.push({ kind: 'global', name: SETTINGS_PAGE_GLOBAL, value: { persistence: 'host' } })
    const country = request?.headers[config.countryHeader]
    // Cloudflare answers `XX` (unknown) and `T1` (Tor) besides real countries; only a real alpha-2 code is stated.
    if (typeof country === 'string' && /^[A-Z]{2}$/u.test(country) && country !== 'XX' && country !== 'T1') {
      table.push({ kind: 'global', name: READER_COUNTRY_GLOBAL, value: country })
    }
    const analytics = config.googleAnalyticsId
    if (analytics !== undefined) {
      // The queue and its config call come first; gtag.js drains `dataLayer` whenever it arrives. The page title names
      // the open conversation, so every event carries the fixed title `Æven` instead.
      table.push({
        kind: 'script',
        placement: 'head',
        text: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('set',{page_title:'Æven'});gtag('config',${JSON.stringify(analytics)},{page_title:'Æven'})`,
      })
      table.push({ kind: 'script-src', placement: 'head', src: `https://www.googletagmanager.com/gtag/js?id=${analytics}` })
    }
  })
  ctx.on('attachment/missing', async (id, signal, next) => {
    signal?.throwIfAborted()
    const owner = ctx.agents.currentInitiator()?.session.header.owner ?? ctx.get('identityUsers')?.actingUser()?.id
    if (owner === undefined) return next()
    if (await ctx.get('sessionHandoff')?.fetchAttachment(id, owner) === true) return true
    return next()
  })
  if (config.eventLoopLagWarnMs > 0) {
    const lag = monitorEventLoopDelay({ resolution: 20 })
    lag.enable()
    const report = setInterval(() => {
      // The histogram records nanoseconds and includes the timer's own resolution.
      const max = lag.max / 1e6
      const p99 = lag.percentile(99) / 1e6
      lag.reset()
      if (max >= config.eventLoopLagWarnMs) {
        ctx.logger('hosted-runtime').warn(`event loop held for ${max.toFixed(0)} ms (p99 ${p99.toFixed(0)} ms) within ${String(config.eventLoopLagIntervalMs / 1000)} s; no account's turn advanced meanwhile`)
      }
    }, config.eventLoopLagIntervalMs)
    // The report never keeps the Host process alive.
    report.unref()
    ctx.effect(() => () => {
      clearInterval(report)
      lag.disable()
    }, 'hosted event-loop delay report')
  }
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
