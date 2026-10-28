/**
 * Account sync provider for conversations: every device of an account lists, replays, and takes input for the
 * account's sessions. The device writing a session publishes its events as they commit; every other device
 * imports them and forwards the user's input for that session to the writing device (`ctx.sessionHandoff`).
 * @module @aeven/session-sync
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/sync'
import type {} from '@aeven/session-persistence'
import type {} from '@aeven/attachment'
import type {} from '@aeven/workspace'
import type { SessionId } from '@aeven/session'
import { SessionHandoff, type SessionHandoffInput, type SessionRunner } from '@aeven/session-handoff'
import { SessionMirror, type SessionSyncTuning } from './mirror.ts'

/** Provider configuration. */
export type Config = SessionSyncTuning

/** Session handoff over each account's synced session index and inbox. */
export default class SessionSync extends SessionHandoff {
  static inject = ['sync', 'sessionPersistence']

  static Config: z<Config> = z.object({
    publishMs: z.natural().min(250).default(3_000),
    liveMs: z.natural().default(100),
    batchBytes: z.natural().min(1_024).default(512 * 1024),
    backfillDays: z.natural().default(30),
  })

  private readonly mirrors = new Map<string, SessionMirror>()

  /**
   * @param ctx - Host context with sync and session persistence.
   * @param config - scan interval, live delay, batch size, and backfill window.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    ctx.on('sync/status', (owner) => { this.track(owner) })
    // A running turn reaches the account's other devices as it streams, not at the next scan.
    ctx.on('session-persistence/append', (header) => {
      if (header.owner !== undefined) this.mirrors.get(header.owner)?.appended(header)
    })
    ctx.effect(() => async () => {
      await Promise.all([...this.mirrors.values()].map(mirror => mirror.dispose()))
      this.mirrors.clear()
    }, 'session-sync.mirrors')
  }

  private track(owner: string): void {
    const state = this.ctx.sync.status(owner).state
    const existing = this.mirrors.get(owner)
    if (existing !== undefined) {
      if (state === 'online') existing.reconnected()
      return
    }
    if (state === 'unenrolled' || state === 'joining') return
    const mirror = new SessionMirror(
      owner, this.ctx.sync, this.ctx.sessionPersistence, this.config,
      (message) => { this.ctx.logger.warn(message) },
      this.ctx.get('attachments'), this.ctx.get('workspaceRegistry'),
      (sessionId, input) => { this.deliver(owner, sessionId, input) },
      (sessionId) => { this.liveChanged(owner, sessionId) },
    )
    this.mirrors.set(owner, mirror)
    mirror.start().catch((error: unknown) => {
      this.ctx.logger.warn(`session sync: starting failed: ${String(error)}`)
    })
  }

  /** @inheritdoc */
  runnerOf(owner: string, sessionId: SessionId): SessionRunner | undefined {
    return this.mirrors.get(owner)?.runnerOf(sessionId)
  }

  /** @inheritdoc */
  publishLive(owner: string, sessionId: SessionId, live: unknown): void {
    this.mirrors.get(owner)?.publishLive(sessionId, live)
  }

  /** @inheritdoc */
  liveOf(owner: string, sessionId: SessionId): unknown {
    return this.mirrors.get(owner)?.liveOf(sessionId)
  }

  /** @inheritdoc */
  async forward(owner: string, sessionId: SessionId, input: SessionHandoffInput): Promise<void> {
    const mirror = this.mirrors.get(owner)
    if (mirror === undefined) throw new Error('account sync does not serve this account on this device')
    await mirror.forward(sessionId, input)
  }
}
