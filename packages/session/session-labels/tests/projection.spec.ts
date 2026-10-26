/**
 * The `sessionLabels` fold: one label per point, a later label at the same
 * point replacing the earlier one, an empty label removing it, and the rows
 * always read oldest first.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@aeven/session'
import { SessionSeq } from '@aeven/session'
import { sessionLabelsProjectionDefinition as unit } from '@aeven/session-labels'
import type { SessionLabelsState } from '@aeven/session-labels'

/** One `session/label` event at a seq, or a removal when the label is empty. */
function labelEvent(at: number, label: string): SessionEvent {
  return {
    type: 'session/label',
    seq: SessionSeq(at + 100),
    time: 0,
    data: { at: SessionSeq(at), label },
  } as SessionEvent
}

/** Fold the given events from the unit's initial state. */
function fold(events: readonly SessionEvent[]): SessionLabelsState {
  let state: SessionLabelsState = unit.init()
  for (const event of events) state = unit.apply(state, event)
  return state
}

/** The view the seam serves for the given events. */
function view(events: readonly SessionEvent[]) {
  return unit.wire.view(fold(events))
}

describe('session bookmarks', () => {
  it('starts empty', () => {
    expect(view([])).toEqual([])
  })

  it('lists bookmarks oldest first however they were set', () => {
    expect(view([labelEvent(30, 'after the fix'), labelEvent(10, 'repro'), labelEvent(20, 'first guess')]))
      .toEqual([
        { at: 10, label: 'repro' },
        { at: 20, label: 'first guess' },
        { at: 30, label: 'after the fix' },
      ])
  })

  it('replaces the label at one point instead of adding a second', () => {
    expect(view([labelEvent(10, 'repro'), labelEvent(10, 'repro, tighter')]))
      .toEqual([{ at: 10, label: 'repro, tighter' }])
  })

  it('removes the bookmark when the label is empty', () => {
    expect(view([labelEvent(10, 'repro'), labelEvent(20, 'fix'), labelEvent(10, '')]))
      .toEqual([{ at: 20, label: 'fix' }])
  })

  it('keeps the same state reference for an unrelated event', () => {
    const state = fold([labelEvent(10, 'repro')])
    const unchanged = unit.apply(state, { type: 'turn/start', seq: SessionSeq(200), time: 0, data: { turn: 1 } } as SessionEvent)
    expect(unchanged).toBe(state)
  })

  it('keeps the same state reference when a removal removes nothing', () => {
    const state = fold([labelEvent(10, 'repro')])
    expect(unit.apply(state, labelEvent(20, ''))).toBe(state)
  })
})
