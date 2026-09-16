/**
 * Pure types of the turn-outline domain: the ONE home of the `turnOutline`
 * projection-key declaration, free of this package's host-side value imports
 * (zod, the projection definition). Host consumers import `./types`; client
 * aggregates import `./client`, which re-exports this module.
 *
 * @module @deepseek-ai/dsh-session-turn-outline/types
 */

import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

export {}

/** One started turn's outline facts, independent of what a client has paged in. */
export interface TurnOutlineEntry {
  /** Host-assigned turn number (the `turn/start` payload). */
  readonly turn: number
  /** The turn's `turn/start` event seq — the anchor a jump installs its window on. */
  readonly seq: SessionSeq
  /** Bounded first-human-prompt preview; `''` until an eligible prompt lands. */
  readonly prompt: string
  /** Bounded final-response preview; `''` until the turn ends with assistant text. */
  readonly response: string
}

/**
 * Fold state: the settled turns plus the open turn, held apart.
 *
 * Only the open turn's previews can still change, and they change several
 * times within a turn, so keeping it out of `settled` makes each of those a
 * field write on one small object instead of a copy of the whole outline.
 * `settled` is rebuilt once per turn, when the open turn closes.
 */
export interface TurnOutlineState {
  /** Ended turns in ascending turn order; never rewritten after a turn closes. */
  readonly settled: readonly TurnOutlineEntry[]
  /** The turn currently open, or null outside one. */
  readonly open: TurnOutlineEntry | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Whole-log turn outline fold state (settled turns plus the open one). */
    turnOutline: TurnOutlineState
  }
  interface SessionProjectionMap {
    /** Every started turn with its `turn/start` seq and bounded previews, strictly increasing by turn; see {@link TurnOutlineEntry}. */
    turnOutline: readonly TurnOutlineEntry[]
  }
}
