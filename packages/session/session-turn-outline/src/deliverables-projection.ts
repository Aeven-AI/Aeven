/**
 * The `turnDeliverables` projection unit: every Turn's produced files, folded from the whole log with the same
 * readers the client's turn-scoped `deliverables` Definition uses. A client that pages history in windows holds a
 * long Turn's closing message without the `turn/start` that Definition starts from, so it cannot rebuild the
 * Turn's produced files from the events it holds; it reads this value instead.
 *
 * Entries fold per Turn by path and declaration, so the value grows with distinct files, not with edits. A
 * `session/rewind` drops entries first recorded at or after its target.
 *
 * @module @aeven/session-turn-outline/deliverables-projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ImageAttachmentRef } from '@aeven/attachment'
import { isAppendSurfaceEvent } from '@aeven/session/surface'
import type { ProjectionDefinition } from '@aeven/session-projection'
import {
  declaredOutputs, isRecord, mutationCalls, resultText, settledMutation, sharedImages,
  type MutationCall, type ProducedPath,
} from './produced.ts'
import type { TurnDeliverables, TurnDeliverablesState } from './types.ts'

const lineCountsSchema = z.object({ added: z.number(), deleted: z.number() })

const imageSchema = z.custom<ImageAttachmentRef>(
  value => isRecord(value) && typeof value.attachmentId === 'string',
)

const producedPathSchema: ZodType<ProducedPath> = z.object({
  seq: z.number(),
  path: z.string(),
  created: z.boolean(),
  counts: lineCountsSchema.optional(),
  attachmentId: z.string().optional(),
  image: imageSchema.optional(),
  declared: z.literal(true).optional(),
})

const turnDeliverablesSchema: ZodType<readonly TurnDeliverables[]> = z.array(z.object({
  turn: z.number().int(),
  produced: z.array(producedPathSchema).readonly(),
})).readonly()

const mutationCallSchema: ZodType<MutationCall> = z.object({
  name: z.string(),
  path: z.string(),
  lines: z.number().optional(),
  creates: z.boolean(),
})

const stateSchema: ZodType<TurnDeliverablesState> = z.object({
  calls: z.record(z.string(), z.array(mutationCallSchema).readonly()),
  turns: turnDeliverablesSchema,
})

const EMPTY: TurnDeliverablesState = { calls: {}, turns: [] }

/**
 * Fold one mutation into a Turn's entries: a path seen with the same declaration keeps its first seq and
 * creation, sums line counts while both sides recorded them, and takes the newest stored copy.
 */
function foldInto(produced: readonly ProducedPath[], next: ProducedPath): readonly ProducedPath[] {
  const index = produced.findIndex(entry => entry.path === next.path && entry.declared === next.declared)
  if (index < 0) return [...produced, next]
  const seen = produced[index] as ProducedPath
  const counts = seen.counts === undefined || next.counts === undefined
    ? undefined
    : { added: seen.counts.added + next.counts.added, deleted: seen.counts.deleted + next.counts.deleted }
  // The newest stored copy wins, with the image reference that came with it.
  const copy = next.attachmentId === undefined ? seen : next
  const merged: ProducedPath = {
    seq: seen.seq,
    path: seen.path,
    created: seen.created,
    ...counts === undefined ? {} : { counts },
    ...copy.attachmentId === undefined ? {} : { attachmentId: copy.attachmentId },
    ...copy.image === undefined ? {} : { image: copy.image },
    ...seen.declared === true ? { declared: true as const } : {},
  }
  return produced.map((entry, at) => (at === index ? merged : entry))
}

/** Add a Turn's new entries, and draw images other results shared for copies already listed. */
function withTurn(
  turns: readonly TurnDeliverables[],
  turn: number,
  additions: readonly ProducedPath[],
  images: ReadonlyMap<string, ImageAttachmentRef>,
): readonly TurnDeliverables[] {
  const index = turns.findIndex(entry => entry.turn === turn)
  const current = index < 0 ? [] : (turns[index] as TurnDeliverables).produced
  let produced = current
  for (const addition of additions) produced = foldInto(produced, addition)
  // A copy shared by another result of the Turn, such as the image the agent viewed after writing it, is drawn too.
  const drawn = produced.map((entry) => {
    const image = entry.image === undefined && entry.attachmentId !== undefined ? images.get(entry.attachmentId) : undefined
    return image === undefined ? entry : { ...entry, image }
  })
  if (drawn.some((entry, at) => entry !== produced[at])) produced = drawn
  if (produced === current) return turns
  if (index < 0) return [...turns, { turn, produced }]
  return turns.map((entry, at) => (at === index ? { turn, produced } : entry))
}

/** The `turnDeliverables` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const turnDeliverablesProjectionDefinition = {
  key: 'turnDeliverables',
  stateVersion: 1,
  stateSchema,
  init: () => EMPTY,
  apply: (state, event) => {
    switch (event.type) {
      case 'tool/call': {
        const calls = mutationCalls(event.data.name, event.data.arguments)
        if (calls.length === 0) return state
        return { calls: { ...state.calls, [String(event.data.callId)]: calls }, turns: state.turns }
      }
      case 'tool/result': {
        if (!isAppendSurfaceEvent(event)) return state
        const callId = String(event.data.message.source.callId)
        const pending = state.calls[callId]
        const calls = pending === undefined ? state.calls : Object.fromEntries(Object.entries(state.calls).filter(([id]) => id !== callId))
        const result = event.data.message.content[0]
        if (result.isError === true) return calls === state.calls ? state : { calls, turns: state.turns }
        const content = result.content as readonly unknown[]
        const { meta } = event.data
        const images = sharedImages(content)
        const declared = declaredOutputs(event.seq, meta, content)
        const additions = declared ?? (pending === undefined
          ? []
          : pending.map(call => ({ seq: event.seq, path: call.path, ...settledMutation(call, resultText(content), meta) })))
        const turns = additions.length === 0 && images.size === 0
          ? state.turns
          : withTurn(state.turns, event.data.turn, additions, images)
        return calls === state.calls && turns === state.turns ? state : { calls, turns }
      }
      case 'session/rewind': {
        const target = event.data.seq
        const turns = state.turns
          .map(entry => ({ turn: entry.turn, produced: entry.produced.filter(file => file.seq < target) }))
          .filter(entry => entry.produced.length > 0)
        const unchanged = turns.length === state.turns.length
          && turns.every((entry, at) => entry.produced.length === (state.turns[at] as TurnDeliverables).produced.length)
        return unchanged && Object.keys(state.calls).length === 0 ? state : { calls: {}, turns: unchanged ? state.turns : turns }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: turnDeliverablesSchema,
    // `turns` keeps its reference across pending-call changes, so those publish nothing.
    view: state => state.turns,
  },
} satisfies ProjectionDefinition<'turnDeliverables', TurnDeliverablesState>
