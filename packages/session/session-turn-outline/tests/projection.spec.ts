/**
 * The `turnOutline` projection unit: mounting the plugin beside the projection
 * registry serves the whole-log outline — one entry per started turn with its
 * `turn/start` seq and bounded prompt/response previews — and clients read it
 * as the `SessionProjectionMap` wire value.
 *
 * The registry drive covers the shipping path (real session, real append,
 * change feed, checkpoint/viewCheckpoint); the fold's own branch coverage for
 * event shapes a real Session log refuses to hold (regressing turn numbers,
 * events arriving outside a turn) runs against the exported definition.
 *
 * The preview budgets pinned here are the rail's: a preview that can exceed
 * `prompt`'s 50 or `response`'s 120 characters fails the unit's own wire
 * schema on the way out, so the caps are contract, not cosmetics.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@aeven/attachment'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@aeven/llm'
import SessionStore, { SessionId, SessionSeq } from '@aeven/session'
import type { Session, SessionEvent } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import * as SessionTurnOutlinePlugin from '@aeven/session-turn-outline'
import { turnOutlineProjectionDefinition } from '@aeven/session-turn-outline/src/projection.ts'
import type { TurnOutlineEntry, TurnOutlineState } from '@aeven/session-turn-outline/types'

/** The rail's prompt budget and response budget, from `src/projection.ts`. */
const PROMPT_LIMIT = 50
const RESPONSE_LIMIT = 120

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionTurnOutlinePlugin)
  return { ctx, session: ctx.sessions.create(SessionId('outlined')) }
}

/** Append one human prompt on the model-visible surface. */
function appendPrompt(session: Session, text: string): number {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

/** Append one assembled assistant message for the given turn and step. */
function appendResponse(session: Session, turn: number, step: number, text: string): number {
  return session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' }).seq
}

/** Build one synthetic committed event, for shapes a real log will not hold. */
function at(seq: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

/** Fold synthetic events through the exported definition. */
function fold(events: readonly SessionEvent[]): TurnOutlineState {
  return events.reduce<TurnOutlineState>(
    (state, event) => turnOutlineProjectionDefinition.apply(state, event),
    turnOutlineProjectionDefinition.init(),
  )
}

/** The published view of a state, through the unit's own wire face. */
function view(state: TurnOutlineState): readonly TurnOutlineEntry[] {
  return turnOutlineProjectionDefinition.wire.view(state)
}

/** One outline entry with empty previews, for exact fold expectations. */
function entry(turn: number, seq: number, prompt = '', response = ''): TurnOutlineEntry {
  return { turn, seq: SessionSeq(seq), prompt, response }
}

describe('turnOutline projection unit (registry drive)', () => {
  it('serves the empty outline on an empty log and checkpoints it at seq -1', async () => {
    const { ctx, session } = await harness()
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.turnOutline).toEqual([])
    expect(snapshot.asOfSeq).toBe(-1)
    expect(ctx.sessionProjections.checkpoint(session).turnOutline)
      .toEqual({ ver: 3, seq: -1, val: { settled: [], open: null } })
  })

  it('anchors each turn on its turn/start seq and fills prompt then response', async () => {
    const { ctx, session } = await harness()
    const boundary = session.append('turn/start', { turn: 1 }).seq
    appendPrompt(session, 'first prompt')
    const responseSeq = appendResponse(session, 1, 1, 'first answer')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // The open turn publishes before turn/end, anchored on its own boundary.
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline)
      .toEqual([entry(1, boundary, 'first prompt', 'first answer')])
    expect(responseSeq).toBeGreaterThan(boundary)

    const secondBoundary = session.append('turn/start', { turn: 2 }).seq
    appendPrompt(session, 'second prompt')
    appendResponse(session, 2, 1, 'second answer')
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline).toEqual([
      entry(1, boundary, 'first prompt', 'first answer'),
      entry(2, secondBoundary, 'second prompt', 'second answer'),
    ])
  })

  it('notifies the change feed once per value change with the causing seq', async () => {
    const { ctx, session } = await harness()
    const changes: { key: string; value: readonly TurnOutlineEntry[]; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value: value as readonly TurnOutlineEntry[], seq })
    })
    const boundary = session.append('turn/start', { turn: 1 }).seq
    const promptSeq = appendPrompt(session, 'counted prompt')
    const endSeq = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }).seq
    expect(changes).toEqual([
      { key: 'turnOutline', value: [entry(1, boundary)], seq: boundary },
      { key: 'turnOutline', value: [entry(1, boundary, 'counted prompt')], seq: promptSeq },
      { key: 'turnOutline', value: [entry(1, boundary, 'counted prompt')], seq: endSeq },
    ])
    // Events the fold ignores republish nothing: the seq after turn/end is a
    // step boundary, which carries no outline fact.
    session.append('step/start', { turn: 2, step: 1 })
    expect(changes).toHaveLength(3)
  })

  it('keeps the newest assistant text and the first human prompt for the open turn', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'opening prompt')
    // Steering inside the same turn keeps the first preview: the rail labels a
    // turn by what opened it.
    appendPrompt(session, 'steering note')
    appendResponse(session, 1, 1, 'first answer')
    appendResponse(session, 1, 2, 'final answer')
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline)
      .toEqual([entry(1, 0, 'opening prompt', 'final answer')])
  })

  it('keeps the text an interrupted turn reached and settles it at the next boundary', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'interrupted prompt')
    appendResponse(session, 1, 1, 'partial answer')
    // No turn/end: turn 2's boundary settles the turn that never closed.
    const secondBoundary = session.append('turn/start', { turn: 2 }).seq
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline).toEqual([
      entry(1, 0, 'interrupted prompt', 'partial answer'),
      entry(2, secondBoundary),
    ])
  })

  it('serves images-only and command-only turns as navigable entries with empty previews', async () => {
    const { ctx, session } = await harness()
    const boundary = session.append('turn/start', { turn: 1 }).seq
    session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('att-1'),
          mediaType: 'image/png',
          bytes: 4,
          width: 1,
          height: 1,
        },
      }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline).toEqual([entry(1, boundary)])
  })

  it('keeps injected context and tool results out of the prompt preview', async () => {
    const { ctx, session } = await harness()
    const boundary = session.append('turn/start', { turn: 1 }).seq
    // An agent.inject() row is a user-role message that is not a human prompt.
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'injected file-change notice' }],
      source: { kind: 'plugin', plugin: 'avn-fs-watch' },
    }), { surfaceOp: 'append' })
    // A tool result is user-role too, and carries no text block at all.
    session.append('user/message', createUserMessage({
      content: [{
        type: 'tool-result', toolCallId: ToolCallId('call-1'), content: [{ type: 'text', text: 'tool output' }], isError: false,
      }],
      source: { kind: 'tool', callId: ToolCallId('call-1') },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline).toEqual([entry(1, boundary)])
  })

  it('caps a long prompt at 50 characters and a long response at 120, ellipsized', async () => {
    const { ctx, session } = await harness()
    const boundary = session.append('turn/start', { turn: 1 }).seq
    appendPrompt(session, 'p'.repeat(200))
    appendResponse(session, 1, 1, 'r'.repeat(400))
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const outline = ctx.sessionProjections.snapshot(session).values.turnOutline
    expect(outline).toEqual([entry(1, boundary, `${'p'.repeat(PROMPT_LIMIT - 1)}…`, `${'r'.repeat(RESPONSE_LIMIT - 1)}…`)])
    // The unit's entry schema is what the budget protects; the served value
    // must pass it rather than merely look short.
    expect(() => turnOutlineProjectionDefinition.wire.viewSchema.parse(outline)).not.toThrow()
  })

  it('collapses whitespace across text blocks and stops reading past the budget', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    // Whitespace collapsing joins blocks with one space, and a line break
    // inside a block reads as one space, not as a break in the preview.
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first   line\nsecond' }, { type: 'text', text: '  tail  ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline)
      .toEqual([entry(1, 0, 'first line second tail')])
  })

  it('serves a prompt preview the rail can render for a multi-megabyte block', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'x'.repeat(4 * 1024 * 1024))
    const [outline] = ctx.sessionProjections.snapshot(session).values.turnOutline as readonly TurnOutlineEntry[]
    expect(outline?.prompt).toBe(`${'x'.repeat(PROMPT_LIMIT - 1)}…`)
  })

  it('serves the version-3 checkpoint through viewCheckpoint with no log read', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'cached prompt')
    appendResponse(session, 1, 1, 'cached answer')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const checkpoint = ctx.sessionProjections.checkpoint(session)
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).turnOutline)
      .toEqual([entry(1, 0, 'cached prompt', 'cached answer')])
  })

  it('discards a persisted row whose turns are not strictly increasing', async () => {
    const { ctx, session } = await harness()
    const checkpoint = ctx.sessionProjections.checkpoint(session)
    const row = checkpoint.turnOutline
    expect(row).toBeDefined()
    const descending = { settled: [entry(2, 9), entry(1, 3)], open: null }
    // The schema rejects it, so the key is absent from the served values: a
    // cold consumer refolds instead of trusting an impossible outline.
    expect(ctx.sessionProjections.viewCheckpoint({
      ...checkpoint,
      turnOutline: { ...row!, val: descending },
    })).toEqual({})
    // A well-formed row of the same shape does serve.
    expect(ctx.sessionProjections.viewCheckpoint({
      ...checkpoint,
      turnOutline: { ...row!, val: { settled: [entry(1, 3), entry(2, 9)], open: null } },
    }).turnOutline).toEqual([entry(1, 3), entry(2, 9)])
  })

  it('has no turnOutline key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('unregistered'))
    expect('turnOutline' in ctx.sessionProjections.snapshot(session).values).toBe(false)

    const fiber = await ctx.plugin(SessionTurnOutlinePlugin)
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'mounted prompt')
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline).toEqual([entry(1, 0, 'mounted prompt')])

    await fiber.dispose()
    expect('turnOutline' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    await ctx.fiber.dispose()
  })

  it('folds turns already in the log when the plugin mounts late (lazy cell build)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('late-mount'))
    session.append('turn/start', { turn: 1 })
    appendPrompt(session, 'pre-mount prompt')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(SessionTurnOutlinePlugin)
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline)
      .toEqual([entry(1, 0, 'pre-mount prompt')])
    await ctx.fiber.dispose()
  })
})

describe('turnOutline fold (definition, synthetic events)', () => {
  it('returns the same state reference for every event it does not fold', () => {
    const empty = turnOutlineProjectionDefinition.init()
    expect(turnOutlineProjectionDefinition.apply(empty, at(0, 'step/start', { turn: 1, step: 1 }))).toBe(empty)
    expect(turnOutlineProjectionDefinition.apply(empty, at(0, 'session/header', {}))).toBe(empty)
  })

  it('opens the first turn with empty previews on the first event of the log', () => {
    const state = fold([at(0, 'turn/start', { turn: 1 })])
    expect(state).toEqual({ settled: [], open: entry(1, 0) })
  })

  it('skips a boundary that does not advance the turn number', () => {
    // A retried or replayed boundary must not reorder the outline; the
    // standing entry keeps its seq and its previews.
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'kept' }] }),
      at(2, 'turn/start', { turn: 1 }),
      at(3, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'ignored' }] }),
    ])
    expect(state.open).toEqual(entry(1, 0, 'kept'))
  })

  it('skips a boundary below the newest settled turn', () => {
    const settled = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      at(2, 'turn/start', { turn: 2 }),
      at(3, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    expect(settled.settled).toEqual([entry(1, 0), entry(2, 2)])
    const regressed = turnOutlineProjectionDefinition.apply(settled, at(4, 'turn/start', { turn: 1 }))
    expect(regressed).toBe(settled)
  })

  it('ignores a human prompt outside any turn and a non-human user/message inside one', () => {
    const outside = fold([
      at(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'stray' }] }),
    ])
    expect(outside).toEqual({ settled: [], open: null })

    const injected = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', { source: { kind: 'tool', callId: 'c' }, content: [{ type: 'text', text: 'tool' }] }),
    ])
    expect(injected.open).toEqual(entry(1, 0))
  })

  it('leaves the prompt empty for content that normalizes to no text', () => {
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      // Non-text blocks and an all-whitespace text block both read as ''.
      at(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'image' }] }),
      at(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '   \n\t  ' }] }),
    ])
    expect(state.open).toEqual(entry(1, 0))
  })

  it('keeps the standing prompt when a later human message arrives', () => {
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] }),
    ])
    expect(turnOutlineProjectionDefinition.apply(
      state,
      at(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'steering' }] }),
    )).toBe(state)
  })

  it('publishes a preview of `` when the read budget holds only whitespace', () => {
    // The read stops at twice the budget; when that slice is whitespace, the
    // collapsed preview is empty and the entry keeps `''` rather than a lone
    // ellipsis.
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '\n'.repeat(PROMPT_LIMIT * 3) }] }),
    ])
    expect(state.open?.prompt).toBe('')
  })

  it('trims a clipped preview before its ellipsis', () => {
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', {
        source: { kind: 'user' },
        content: [{ type: 'text', text: `${'a'.repeat(PROMPT_LIMIT - 2)} ${'b'.repeat(80)}` }],
      }),
    ])
    // The 49th character is the space, so the ellipsis follows the last 'a'.
    expect(state.open?.prompt).toBe(`${'a'.repeat(PROMPT_LIMIT - 2)}…`)
  })

  it('ellipsizes a preview whose over-budget read collapsed to a short line', () => {
    // A read that ran past the budget can still collapse — whitespace
    // collapsing and trimming — to something under the char cap: the ellipsis
    // is then the mark that more text exists behind a short preview.
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', {
        source: { kind: 'user' },
        content: [{ type: 'text', text: `${'a'.repeat(PROMPT_LIMIT - 1)}  ${'b'.repeat(150)}` }],
      }),
    ])
    expect(state.open?.prompt).toBe(`${'a'.repeat(PROMPT_LIMIT - 1)}…`)
  })

  it('stops reading text blocks once the read budget is spent', () => {
    // The early exit bounds the work by the budget, not by content size: a
    // block past the spent budget is never assembled into the preview.
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: 'a'.repeat(PROMPT_LIMIT * 2) },
          { type: 'text', text: 'unread tail' },
        ],
      }),
    ])
    expect(state.open?.prompt).toBe(`${'a'.repeat(PROMPT_LIMIT - 1)}…`)
  })

  it('ellipsizes a preview the budget clipped to a short line with text still behind it', () => {
    // The read stops at one budget and reports the clip only when the block
    // holds MORE than the budget: at exactly the budget the trailing content
    // is simply lost from the preview, so a block one character longer is what
    // keeps the ellipsis honest. Whitespace collapsing then shrinks the
    // clipped read to one rail line, and that short preview is the only shape
    // that reaches the non-empty clipped branch rather than the char cap.
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', {
        source: { kind: 'user' },
        content: [{ type: 'text', text: `${'a'.repeat(PROMPT_LIMIT - 1)}${' '.repeat(PROMPT_LIMIT + 1)}b` }],
      }),
    ])
    expect(state.open?.prompt).toBe(`${'a'.repeat(PROMPT_LIMIT - 1)}…`)
  })

  it('ignores an assistant message outside any turn', () => {
    const empty = turnOutlineProjectionDefinition.init()
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'stray' }],
      source: { provider: 'mock', model: 'mock' },
    })
    expect(turnOutlineProjectionDefinition.apply(
      empty,
      at(0, 'assistant/message', { turn: 1, step: 1, message }),
    )).toBe(empty)
  })

  it('leaves the response unchanged for a text-free or repeated assistant message', () => {
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: { provider: 'mock', model: 'mock' },
    })
    const state = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'assistant/message', { turn: 1, step: 1, message }),
    ])
    expect(state.open).toEqual(entry(1, 0, '', 'answer'))
    // The same text again changes nothing downstream, and a text-free message
    // (an images-only or tool-only step) leaves the reached text standing.
    expect(turnOutlineProjectionDefinition.apply(
      state,
      at(2, 'assistant/message', { turn: 1, step: 2, message }),
    )).toBe(state)
    const textFree = createAssistantMessage({
      content: [{ type: 'tool-call', id: ToolCallId('call-1'), name: 'read', arguments: '{}' }],
      source: { provider: 'mock', model: 'mock' },
    })
    expect(turnOutlineProjectionDefinition.apply(
      state,
      at(3, 'assistant/message', { turn: 1, step: 3, message: textFree }),
    )).toBe(state)
  })

  it('closes the open turn on turn/end and ignores a close outside one', () => {
    const closed = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(closed).toEqual({ settled: [entry(1, 0)], open: null })
    expect(turnOutlineProjectionDefinition.apply(
      closed,
      at(2, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    )).toBe(closed)
  })
})

describe('turnOutline wire view', () => {
  it('memoizes the view per state so unchanged states publish nothing new', () => {
    const empty = turnOutlineProjectionDefinition.init()
    // No open turn: the settled array IS the view, so the empty outline is
    // handed out by reference.
    expect(view(empty)).toBe(empty.settled)
    expect(view(empty)).toBe(view(empty))

    const open = fold([at(0, 'turn/start', { turn: 1 })])
    expect(view(open)).toEqual([entry(1, 0)])
    expect(view(open)).toBe(view(open))
  })

  it('never mutates a view already handed out when the open turn settles', () => {
    const open = fold([at(0, 'turn/start', { turn: 1 })])
    const published = view(open)
    const closed = turnOutlineProjectionDefinition.apply(open, at(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(view(closed)).toEqual([entry(1, 0)])
    // The drive compares raw view results with Object.is and still holds
    // `published`; appending in place would edit a value already served.
    expect(published).toEqual([entry(1, 0)])
    expect(view(closed)).not.toBe(published)
  })

  it('accepts its own served value and rejects an out-of-order outline', () => {
    const schema = turnOutlineProjectionDefinition.wire.viewSchema
    const open = fold([
      at(0, 'turn/start', { turn: 1 }),
      at(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'prompt' }] }),
    ])
    expect(schema.parse(view(open))).toEqual([entry(1, 0, 'prompt')])
    expect(schema.safeParse([entry(2, 0), entry(1, 4)]).success).toBe(false)
    expect(schema.safeParse([entry(1, 0), entry(1, 4)]).success).toBe(false)
  })

  it('rejects a persisted state whose settled turns are not strictly increasing', () => {
    const schema = turnOutlineProjectionDefinition.stateSchema
    expect(schema.safeParse({ settled: [entry(1, 3), entry(2, 9)], open: null }).success).toBe(true)
    expect(schema.safeParse({ settled: [entry(2, 9), entry(1, 3)], open: null }).success).toBe(false)
    expect(schema.safeParse({ settled: [entry(1, 3), entry(1, 9)], open: null }).success).toBe(false)
  })

  it('rejects a persisted state whose previews exceed the rail budgets', () => {
    const schema = turnOutlineProjectionDefinition.stateSchema
    expect(schema.safeParse({ settled: [], open: entry(1, 0, 'p'.repeat(PROMPT_LIMIT)) }).success).toBe(true)
    expect(schema.safeParse({ settled: [], open: entry(1, 0, 'p'.repeat(PROMPT_LIMIT + 1)) }).success).toBe(false)
    expect(schema.safeParse({ settled: [], open: entry(1, 0, '', 'r'.repeat(RESPONSE_LIMIT)) }).success).toBe(true)
    expect(schema.safeParse({ settled: [], open: entry(1, 0, '', 'r'.repeat(RESPONSE_LIMIT + 1)) }).success).toBe(false)
  })
})
