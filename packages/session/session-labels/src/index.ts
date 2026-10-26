/**
 * Session bookmarks: the `sessionLabels` projection unit (a user's labels on
 * points of one session's log, folded from `session/label` events) and the
 * service that writes them. The event is log-only, so nothing here reaches a
 * model request.
 * @module @aeven/session-labels
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionSeq } from '@aeven/session'
import { normalizeSessionTitle } from '@aeven/session-title'
import { sessionLabelsProjectionDefinition } from './projection.ts'
import type { Config, SessionLabelSnapshot } from './types.ts'

export type * from './types.ts'
export { sessionLabelsProjectionDefinition } from './projection.ts'

/** Rejection of a write whose point names no logged event. */
export class SessionLabelTargetError extends Error {
  /** @param at - the seq the write addressed. */
  constructor(at: SessionSeq) {
    super(`session label: seq ${at} names no logged event`)
    this.name = 'SessionLabelTargetError'
  }
}

/**
 * Session bookmarks: the label verb and the `sessionLabels` projection it
 * feeds. Mounting this package provides both halves, because the write path
 * and the fold are one unit — a client that can label a point can also read
 * the labels back.
 */
export class SessionLabelsService extends Service {
  static inject = ['sessionProjections']
  static Config: z<Config> = z.object({
    maxLabelBytes: z.number().step(1).min(1).required(),
  })

  private readonly config: Config

  /**
   * @param ctx - context carrying the projection registry the fold registers on.
   * @param config - label text budget.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionLabels')
    const candidate: unknown = config
    if (candidate === null || typeof candidate !== 'object') {
      throw new Error('session-labels: configuration is required')
    }
    const value = candidate as Config
    if (!Number.isInteger(value.maxLabelBytes) || value.maxLabelBytes <= 0) {
      throw new Error('session-labels: maxLabelBytes must be a positive integer')
    }
    this.config = { maxLabelBytes: value.maxLabelBytes }
    ctx.sessionProjections.register(sessionLabelsProjectionDefinition)
  }

  /**
   * Set or remove the bookmark at one logged point. A label carries the same
   * one-line, control-stripped, byte-bounded text contract as a session title,
   * because both are user-authored text the client renders as one line.
   * @param session - the live session whose log receives the event.
   * @param at - the point to label; must name an event already in this log.
   * @param text - raw user input; text that normalizes to nothing removes the bookmark.
   * @returns the text the point now carries and the committed event's seq.
   * @throws {SessionLabelTargetError} when `at` names no logged event.
   */
  label(session: Session, at: SessionSeq, text: string): SessionLabelSnapshot {
    if (session.eventAt(at) === undefined) throw new SessionLabelTargetError(at)
    const label = normalizeSessionTitle(text, this.config.maxLabelBytes)
    const event = session.append('session/label', { at, label })
    return { at, label: label === '' ? null : label, eventSeq: event.seq }
  }
}

export default SessionLabelsService

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session bookmark writes and the fold that serves them. */
    sessionLabels: SessionLabelsService
  }
}

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /**
     * A bookmark on one logged point of this session: sets the label at `at`, or
     * removes it when `label` is empty. The event points at an earlier `seq` and
     * changes nothing model-visible, so a warm, a review, or a transcript sees
     * the same conversation with or without it.
     */
    'session/label': import('./types.ts').SessionLabelEventData
  }
}
