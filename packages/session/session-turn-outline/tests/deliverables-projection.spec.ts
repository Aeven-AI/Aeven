/**
 * The `turnDeliverables` projection unit: mounting the plugin beside the projection registry serves every Turn's
 * produced files from the whole log, so a client whose loaded window holds a long Turn's closing message without its
 * `turn/start` still lists the files the Turn wrote. The registry drive covers the shipping path (real session, real
 * append, snapshot); the rewind branch runs against the exported definition.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@aeven/llm'
import SessionStore, { SessionId, SessionSeq } from '@aeven/session'
import type { Session, SessionEvent } from '@aeven/session'
import SessionProjectionRegistry from '@aeven/session-projection'
import * as SessionTurnOutlinePlugin from '@aeven/session-turn-outline'
import { turnDeliverablesProjectionDefinition } from '@aeven/session-turn-outline/src/deliverables-projection.ts'
import type { TurnDeliverables } from '@aeven/session-turn-outline/types'

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionTurnOutlinePlugin)
  return { ctx, session: ctx.sessions.create(SessionId('produced')) }
}

let calls = 0

/** Append one tool call and its result in `turn`; returns the result's seq. */
function runTool(
  session: Session,
  turn: number,
  name: string,
  args: unknown,
  result: { text?: string; isError?: boolean; meta?: NonNullable<SessionEvent<'tool/result'>['data']['meta']> } = {},
): number {
  const callId = ToolCallId(`call-${String(++calls)}`)
  session.append('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify(args) })
  return session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: result.text ?? 'ok' }],
      isError: result.isError ?? false,
    }),
    ...result.meta === undefined ? {} : { meta: result.meta },
  }, { surfaceOp: 'append' }).seq
}

function turnDeliverables(ctx: Context, session: Session): readonly TurnDeliverables[] | undefined {
  return ctx.sessionProjections.snapshot(session).values.turnDeliverables
}

describe('turnDeliverables projection', () => {
  it('lists the files each Turn wrote, one entry per path with summed line counts', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    const created = runTool(session, 1, 'write', { file_path: 'src/a.js', content: 'one\ntwo\n' }, { text: 'Created file src/a.js' })
    runTool(session, 1, 'edit', { file_path: 'src/a.js', old_string: 'one', new_string: 'uno' }, {
      meta: { diffs: [{ path: 'src/a.js', oldText: 'one\ntwo', newText: 'uno\ntwo' }] },
    })
    const second = runTool(session, 1, 'write', { file_path: 'index.html', content: '<p>' }, { text: 'Created file index.html' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    const other = runTool(session, 2, 'write', { file_path: 'notes.md', content: 'x' }, { text: 'Created file notes.md' })

    expect(turnDeliverables(ctx, session)).toEqual([
      {
        turn: 1,
        produced: [
          { seq: created, path: 'src/a.js', created: true, counts: { added: 3, deleted: 1 } },
          { seq: second, path: 'index.html', created: true, counts: { added: 1, deleted: 0 } },
        ],
      },
      { turn: 2, produced: [{ seq: other, path: 'notes.md', created: true, counts: { added: 1, deleted: 0 } }] },
    ])
  })

  it('records the outputs a command declared, and nothing for failed or unsupported calls', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    runTool(session, 1, 'write', { file_path: 'broken.txt', content: 'x' }, { isError: true })
    runTool(session, 1, 'read', { file_path: 'src/a.js' })
    const built = runTool(session, 1, 'bash', { command: 'node build.mjs' }, {
      meta: { producedFiles: [{ path: '/work/page.html', created: true, attachmentId: 'att-1' }] },
    })

    expect(turnDeliverables(ctx, session)).toEqual([
      { turn: 1, produced: [{ seq: built, path: '/work/page.html', created: true, declared: true, attachmentId: 'att-1' }] },
    ])
  })

  it('keeps its published value while a call awaits its result', () => {
    const fold = turnDeliverablesProjectionDefinition
    const state = { calls: {}, turns: [{ turn: 1, produced: [{ seq: 3, path: 'a.txt', created: true }] }] }
    const call = {
      type: 'tool/call', seq: SessionSeq(4), time: 0,
      data: { turn: 1, step: 2, callId: ToolCallId('pending'), name: 'write', arguments: '{"file_path":"b.txt","content":"y"}' },
    } as unknown as SessionEvent
    const next = fold.apply(state, call)
    expect(next).not.toBe(state)
    expect(fold.wire.view(next)).toBe(fold.wire.view(state))
  })

  it('drops the files a rewind discarded', () => {
    const fold = turnDeliverablesProjectionDefinition
    const kept = { seq: 3, path: 'kept.txt', created: true }
    const state = { calls: {}, turns: [{ turn: 1, produced: [kept, { seq: 9, path: 'gone.txt', created: true }] }] }
    const rewind = { type: 'session/rewind', seq: SessionSeq(12), time: 0, data: { seq: SessionSeq(5) } } as unknown as SessionEvent
    expect(fold.apply(state, rewind).turns).toEqual([{ turn: 1, produced: [kept] }])
  })
})
