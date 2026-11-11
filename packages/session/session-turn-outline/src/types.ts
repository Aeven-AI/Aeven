/**
 * Pure types of the turn-outline domain: the ONE home of the `turnOutline`
 * projection-key declaration, free of this package's host-side value imports
 * (zod, the projection definition). Host consumers import `./types`; client
 * aggregates import `./client`, which re-exports this module.
 *
 * @module @aeven/session-turn-outline/types
 */

import type { SessionSeq } from '@aeven/session/types'

export {}

/**
 * One human message's outline facts, independent of what a client has paged
 * in. Each started turn has one opening entry, plus one entry per human
 * message that steered it while it ran.
 */
export interface TurnOutlineEntry {
  /** Host-assigned number of the turn the message belongs to (the `turn/start` payload). */
  readonly turn: number
  /**
   * The jump anchor: the turn's `turn/start` seq for its opening entry, so a
   * window anchored there holds the whole turn; the message's own
   * `user/message` seq for a steering entry.
   */
  readonly seq: SessionSeq
  /** Bounded message-text preview; `''` until the opening prompt lands, or for an images-only message. */
  readonly prompt: string
  /** Bounded preview of the newest assistant text after this message and before the next one. */
  readonly response: string
}

/**
 * Fold state: the settled entries plus the open entry, held apart.
 *
 * Only the open entry's previews can still change, and they change several
 * times, so keeping it out of `settled` makes each of those a field write on
 * one small object instead of a copy of the whole outline. `settled` is
 * rebuilt once per entry, when the open entry closes.
 */
export interface TurnOutlineState {
  /** Closed entries in ascending seq order; never rewritten after an entry closes. */
  readonly settled: readonly TurnOutlineEntry[]
  /** The entry still collecting previews — the newest message of the running turn — or null outside a turn. */
  readonly open: TurnOutlineEntry | null
  /** The open entry is a turn opener whose first human message has not landed yet. */
  readonly awaitingPrompt: boolean
}

declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Whole-log turn outline fold state (settled entries plus the open one). */
    turnOutline: TurnOutlineState
  }
  interface SessionProjectionMap {
    /**
     * One entry per human message of every started turn, with its jump seq and
     * bounded previews, strictly increasing by seq; see {@link TurnOutlineEntry}.
     */
    turnOutline: readonly TurnOutlineEntry[]
  }
}
