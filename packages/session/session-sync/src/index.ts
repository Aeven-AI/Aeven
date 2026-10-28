/**
 * Account sync Consumer for conversation history: every device of an account lists and replays the account's
 * sessions. Each session is published by the device that created it and imported read-only elsewhere.
 * @module @aeven/session-sync
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/sync'
import type {} from '@aeven/session-persistence'
import type {} from '@aeven/attachment'
import type {} from '@aeven/workspace'
import { SessionMirror, type SessionSyncTuning } from './mirror.ts'

export const name = 'session-sync'

export const inject = ['sync', 'sessionPersistence']

/** Plugin configuration. */
export type Config = SessionSyncTuning

export const Config: z<Config> = z.object({
  publishMs: z.natural().min(250).default(3_000),
  liveMs: z.natural().default(100),
  batchBytes: z.natural().min(1_024).default(512 * 1024),
  backfillDays: z.natural().default(30),
})

/**
 * Mirror each account's sessions while account sync serves the account.
 * @param ctx - Host context with sync and session persistence.
 * @param config - scan interval, batch size, and backfill window.
 */
export function apply(ctx: Context, config: Config): void {
  const mirrors = new Map<string, SessionMirror>()
  ctx.on('sync/status', (owner) => {
    const state = ctx.sync.status(owner).state
    const existing = mirrors.get(owner)
    if (existing !== undefined) {
      if (state === 'online') existing.reconnected()
      return
    }
    if (state === 'unenrolled' || state === 'joining') return
    const mirror = new SessionMirror(owner, ctx.sync, ctx.sessionPersistence, config, (message) => { ctx.logger.warn(message) }, ctx.get('attachments'), ctx.get('workspaceRegistry'))
    mirrors.set(owner, mirror)
    mirror.start().catch((error: unknown) => {
      ctx.logger.warn(`session sync: starting failed: ${String(error)}`)
    })
  })
  // A running turn reaches the account's other devices as it streams, not at the next scan.
  ctx.on('session-persistence/append', (header) => {
    if (header.owner !== undefined) mirrors.get(header.owner)?.appended(header)
  })
  ctx.effect(() => async () => {
    await Promise.all([...mirrors.values()].map(mirror => mirror.dispose()))
    mirrors.clear()
  }, 'session-sync.mirrors')
}
