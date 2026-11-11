/**
 * The turn rail's marks: the host outline joined with the loaded window, then
 * sampled to what the rail can actually show.
 *
 * The outline names every human message of the session — each turn's opening
 * prompt and every message that steered a running turn — and the loaded window
 * knows which turns have rendered rows. A loaded mark scrolls locally, an
 * unloaded one anchors a new window on its seq — so every message is reachable
 * whatever the client holds.
 *
 * @module
 */

import { SessionSeq } from '@aeven/session/types'
import type {} from '@aeven/session-turn-outline/client'

/** One rail mark: a human message, and how the rail reaches it. */
export interface TurnRailMark {
  /** The turn the message belongs to. */
  readonly turn: number
  /** The message's 1-based position among every human message of the session. */
  readonly message: number
  /** The message opened its turn, rather than steering it while it ran. */
  readonly opener: boolean
  /**
   * The jump anchor and a stable React key: the turn's `turn/start` seq for an
   * opener, the message's own `user/message` seq otherwise.
   */
  readonly seq: SessionSeq
  /** Rows for the message's turn are in the loaded window, so the rail scrolls to them. */
  readonly loaded: boolean
  /** Bounded message preview; `''` when the message carries no eligible text. */
  readonly prompt: string
  /** Bounded response preview; `''` until the message is answered with assistant text. */
  readonly response: string
}

/**
 * Most marks the rail will render.
 *
 * The band is a fixed height and a mark needs its own pixels, so past this
 * count the rail samples instead of showing every message: 200 marks in a ~420px
 * band sit ~2px apart, a 1px line and a 1px gap, and the rail's hover
 * magnifier spreads the ones under the pointer apart. Sampling above it keeps
 * the rail a scrubber over the whole session rather than an unreadable comb,
 * and keeps the rendered node count flat however long the session runs.
 */
export const MAX_RAIL_MARKS = 200

const EMPTY_MARKS: readonly TurnRailMark[] = []

/**
 * Structurally narrow one wire outline entry.
 *
 * Projection values cross the wire, so they are parsed rather than trusted.
 * `turn` and `seq` are load-bearing — a mark can neither exist nor jump
 * without them — so a damaged entry is dropped; the previews are decorative,
 * so a damaged one degrades to `''` and the turn stays navigable by number.
 * @param value - one entry from the `turnOutline` wire value.
 * @returns the narrowed entry, or undefined when it cannot anchor a mark.
 */
function outlineEntry(value: unknown): { turn: number; seq: SessionSeq; prompt: string; response: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as { turn?: unknown; seq?: unknown; prompt?: unknown; response?: unknown }
  if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) return undefined
  if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0 || Object.is(entry.seq, -0)) {
    return undefined
  }
  return {
    turn: entry.turn,
    seq: SessionSeq(entry.seq),
    prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
    response: typeof entry.response === 'string' ? entry.response : '',
  }
}

/**
 * Build the rail's marks from the outline and the loaded turn set.
 *
 * Sampling is derived from the outline's length alone, never from what is
 * loaded, so paging history in changes a mark's `loaded` flag but never the
 * set of marks or their order: marks do not move under the reader as pages
 * arrive. The newest message is always kept — it is the one a reader returns to.
 * @param outline - the `turnOutline` projection value, treated as wire data.
 * @param loadedTurns - turns with rendered rows in the current window.
 * @returns marks in ascending seq order; a stable empty array when none.
 */
export function turnRailMarks(
  outline: unknown,
  loadedTurns: ReadonlySet<number>,
): readonly TurnRailMark[] {
  if (!Array.isArray(outline) || outline.length === 0) return EMPTY_MARKS
  const entries: Omit<TurnRailMark, 'loaded'>[] = []
  for (const raw of outline) {
    const entry = outlineEntry(raw)
    if (entry === undefined) continue
    const previous = entries.at(-1)
    // The outline is ordered by seq; a damaged entry out of that order cannot
    // be placed on the ladder.
    if (previous !== undefined && (entry.seq <= previous.seq || entry.turn < previous.turn)) continue
    entries.push({
      ...entry,
      message: entries.length + 1,
      opener: previous === undefined || previous.turn !== entry.turn,
    })
  }
  if (entries.length === 0) return EMPTY_MARKS
  const stride = Math.ceil(entries.length / MAX_RAIL_MARKS)
  const marks: TurnRailMark[] = []
  for (let index = 0; index < entries.length; index += stride) {
    const entry = entries[index] as (typeof entries)[number]
    marks.push({ ...entry, loaded: loadedTurns.has(entry.turn) })
  }
  // A stride that does not divide the outline evenly leaves the newest message
  // off the ladder; the rail must always offer the live end.
  const newest = entries[entries.length - 1] as (typeof entries)[number]
  if (marks[marks.length - 1]?.seq !== newest.seq) {
    marks.push({ ...newest, loaded: loadedTurns.has(newest.turn) })
  }
  return marks
}
