/**
 * The turn rail's marks: the host outline joined with the loaded window, then
 * sampled to what the rail can actually show.
 *
 * The outline names every turn of the session; the loaded window knows which
 * of them have rendered rows. A loaded mark scrolls locally, an unloaded one
 * anchors a new window on its `turn/start` seq — so every turn is reachable
 * whatever the client holds.
 *
 * @module
 */

import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'

/** One rail mark: a turn, and how the rail reaches it. */
export interface TurnRailMark {
  readonly turn: number
  /** The turn's `turn/start` seq — the jump anchor, and a stable React key. */
  readonly seq: SessionSeq
  /** Rows for this turn are in the loaded window, so the rail scrolls to them. */
  readonly loaded: boolean
  /** Bounded prompt preview; `''` when the turn opened with no eligible text. */
  readonly prompt: string
  /** Bounded response preview; `''` until the turn produces assistant text. */
  readonly response: string
}

/**
 * Most marks the rail will render.
 *
 * The band is a fixed height and a mark needs its own pixels, so past this
 * count the rail samples instead of showing every turn: 100 marks in a ~420px
 * band sit ~4px apart, which is the tick size itself. Sampling above it keeps
 * the rail a scrubber over the whole session rather than an unreadable comb,
 * and keeps the rendered node count flat however long the session runs.
 */
export const MAX_RAIL_MARKS = 100

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
 * arrive. The newest turn is always kept — it is the one a reader returns to.
 * @param outline - the `turnOutline` projection value, treated as wire data.
 * @param loadedTurns - turns with rendered rows in the current window.
 * @returns marks in ascending turn order; a stable empty array when none.
 */
export function turnRailMarks(
  outline: unknown,
  loadedTurns: ReadonlySet<number>,
): readonly TurnRailMark[] {
  if (!Array.isArray(outline) || outline.length === 0) return EMPTY_MARKS
  const entries: { turn: number; seq: SessionSeq; prompt: string; response: string }[] = []
  for (const raw of outline) {
    const entry = outlineEntry(raw)
    if (entry !== undefined) entries.push(entry)
  }
  if (entries.length === 0) return EMPTY_MARKS
  const stride = Math.ceil(entries.length / MAX_RAIL_MARKS)
  const marks: TurnRailMark[] = []
  for (let index = 0; index < entries.length; index += stride) {
    const entry = entries[index] as (typeof entries)[number]
    marks.push({ ...entry, loaded: loadedTurns.has(entry.turn) })
  }
  // A stride that does not divide the outline evenly leaves the newest turn
  // off the ladder; the rail must always offer the live end.
  const newest = entries[entries.length - 1] as (typeof entries)[number]
  if (marks[marks.length - 1]?.turn !== newest.turn) {
    marks.push({ ...newest, loaded: loadedTurns.has(newest.turn) })
  }
  return marks
}
