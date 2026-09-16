/**
 * The `turnOutline` projection unit: a fold of `turn/start` boundaries, first
 * human prompts, and final assistant responses into the whole-log turn
 * outline the chat turn rail renders for turns outside a client's paged event
 * window.
 *
 * `turn/start` — not the prompt `user/message` — anchors each entry because
 * its seq is the jump target: the loop logs `turn/start` before the turn's
 * prompt and steps, so a window anchored there contains the whole turn.
 *
 * The state holds the open turn apart from the settled ones. Previews change
 * only on the open turn, and they change many times per turn — once per
 * prompt and once per assistant message — so keeping it separate makes each
 * of those a write to one small object instead of a copy of the whole
 * outline. The outline itself is copied once per turn, when the open turn
 * settles.
 *
 * @module @deepseek-ai/dsh-session-turn-outline/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { TurnOutlineEntry, TurnOutlineState } from './types.ts'

/** Prompt budget: the rail preview's first line. */
const PROMPT_PREVIEW_LIMIT = 50
/** Response budget: the rail preview's remaining lines. */
const RESPONSE_PREVIEW_LIMIT = 120

type MessageContent = SessionEvent<'user/message'>['data']['content']

/**
 * Space-join text blocks, collapse whitespace, and cap at `limit` with a
 * trailing ellipsis when clipped.
 *
 * Reading stops as soon as `limit` characters are available. The fold sees
 * every message event, so a multi-megabyte block must never be concatenated
 * or regex-normalized whole for a preview this short: both the per-block
 * slice and the early exit bound the work by `limit`, not by content size.
 * @param content - message content blocks.
 * @param limit - preview budget in characters, ellipsis included.
 * @returns the bounded preview, or `''` when no text block carries content.
 */
function preview(content: MessageContent, limit: number): string {
  // Collect at most one limit's worth of text plus slack for whitespace
  // collapsing, which can only shorten what was read.
  const budget = limit * 2
  const parts: string[] = []
  let length = 0
  let clipped = false
  for (const block of content) {
    if (block.type !== 'text') continue
    if (length >= budget) {
      clipped = true
      break
    }
    const chunk = block.text.length > budget - length
      ? block.text.slice(0, budget - length)
      : block.text
    if (block.text.length > chunk.length) clipped = true
    parts.push(chunk)
    length += chunk.length
    if (clipped) break
  }
  const normalized = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (normalized.length > limit - 1) return `${normalized.slice(0, limit - 1).trimEnd()}…`
  return clipped && normalized !== '' ? `${normalized}…` : normalized
}

const turnOutlineEntrySchema = z.object({
  turn: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative().transform(SessionSeq),
  prompt: z.string().max(PROMPT_PREVIEW_LIMIT),
  response: z.string().max(RESPONSE_PREVIEW_LIMIT),
}).strict()

const turnOutlineEntriesSchema: ZodType<readonly TurnOutlineEntry[]> = z.array(turnOutlineEntrySchema)
  .superRefine((turns, context) => {
    let previous = -1
    for (const entry of turns) {
      if (entry.turn <= previous) {
        context.addIssue({ code: 'custom', message: 'turn outline entries must be strictly increasing by turn' })
        return
      }
      previous = entry.turn
    }
  })

const turnOutlineStateSchema: ZodType<TurnOutlineState> = z.object({
  settled: turnOutlineEntriesSchema,
  open: turnOutlineEntrySchema.nullable(),
}).strict()

const EMPTY_OUTLINE: TurnOutlineState = { settled: [], open: null }

/**
 * Published view: the settled turns plus the open one.
 *
 * Memoized on the state that produced it. The drive holds the two latest raw
 * view results and compares them with `Object.is`, so a fresh array for an
 * unchanged state would republish the whole outline to every client on every
 * event. Weak so a superseded state and its view are collected together.
 *
 * That retained previous result is also why `settled` is copied rather than
 * appended to in place: the drive still holds the array a settled state
 * published, and mutating it would edit a value already handed out and defeat
 * the comparison that suppresses republication.
 */
const viewCache = new WeakMap<TurnOutlineState, readonly TurnOutlineEntry[]>()

function outlineView(state: TurnOutlineState): readonly TurnOutlineEntry[] {
  const cached = viewCache.get(state)
  if (cached !== undefined) return cached
  const value = state.open === null ? state.settled : [...state.settled, state.open]
  viewCache.set(state, value)
  return value
}

/** The `turnOutline` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const turnOutlineProjectionDefinition = {
  key: 'turnOutline',
  stateVersion: 3,
  stateSchema: turnOutlineStateSchema,
  init: () => EMPTY_OUTLINE,
  apply: (state, event) => {
    // Every uninteresting event returns the same reference; `Object.is` then
    // gates all downstream work.
    switch (event.type) {
      case 'turn/start': {
        // Order guard: a boundary that does not advance the turn number keeps
        // the outline sorted, and a retried turn's previews land on the entry
        // already standing.
        const newest = state.open ?? state.settled.at(-1)
        if (newest !== undefined && event.data.turn <= newest.turn) return state
        // An open turn with no `turn/end` settles when the next one starts, so
        // an interrupted turn still reaches the outline.
        const settled = state.open === null ? state.settled : [...state.settled, state.open]
        return {
          settled,
          open: { turn: event.data.turn, seq: event.seq, prompt: '', response: '' },
        }
      }
      case 'user/message': {
        // Only the open turn can still be waiting for its opening human
        // prompt; later human messages in the same turn (steering) keep the
        // first preview.
        if (event.data.source.kind !== 'user') return state
        const open = state.open
        if (open === null || open.prompt !== '') return state
        const prompt = preview(event.data.content, PROMPT_PREVIEW_LIMIT)
        if (prompt === '') return state
        return { settled: state.settled, open: { ...open, prompt } }
      }
      case 'assistant/message': {
        // Newest text-bearing message wins: the open turn's response tracks
        // the latest answer directly, so an interrupted turn keeps the text it
        // had reached.
        const open = state.open
        if (open === null) return state
        const response = preview(event.data.message.content, RESPONSE_PREVIEW_LIMIT)
        if (response === '' || response === open.response) return state
        return { settled: state.settled, open: { ...open, response } }
      }
      case 'turn/end': {
        const open = state.open
        if (open === null) return state
        return { settled: [...state.settled, open], open: null }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: turnOutlineEntriesSchema,
    view: outlineView,
  },
} satisfies ProjectionDefinition<'turnOutline', TurnOutlineState>
