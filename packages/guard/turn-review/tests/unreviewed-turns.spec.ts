/**
 * Turns the plugin leaves alone: no file-changing tool ran, the change tool
 * failed, the turn ends on a tool call rather than a reply, or the reply is
 * empty. None of them spends a review call, and none of them logs a request.
 */

import { describe, expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountReview, reviewConfig } from './harness.ts'

describe('a turn with nothing to review', () => {
  it('leaves a turn with no tool call alone', async () => {
    const review = await mountReview([textResponse('Nothing needed changing.')])

    await review.turn()

    expect(review.adapter.requests).toHaveLength(1)
    expect(review.ofType('turn-review/request')).toEqual([])
    expect(review.injected()).toEqual([])
  })

  it('leaves a turn whose only tool call did not change a file alone', async () => {
    const review = await mountReview([toolCallResponse('c1', 'read', {}), textResponse('Read it.')])

    await review.turn()

    expect(review.adapter.requests).toHaveLength(2)
    expect(review.ofType('turn-review/request')).toEqual([])
  })

  it('leaves a turn alone when the changing tool failed', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'str_replace_editor', {}),
      textResponse('The edit failed, so nothing changed.'),
    ])

    await review.turn()

    expect(review.ofType('tool/result').map(event => event.data.message.content[0]))
      .toMatchObject([{ type: 'tool-result', isError: true }])
    expect(review.adapter.requests).toHaveLength(2)
    expect(review.ofType('turn-review/request')).toEqual([])
  })

  it('leaves a turn alone when it ends on a tool call instead of a reply', async () => {
    const review = await mountReview([toolCallResponse('c1', 'edit', {})])

    await review.turn()

    expect(review.adapter.requests).toHaveLength(1)
    expect(review.ofType('turn-review/request')).toEqual([])
    expect(review.ofType('turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
  })

  it('leaves a turn alone when the final reply is empty', async () => {
    const review = await mountReview([toolCallResponse('c1', 'write', {}), textResponse('   ')])

    await review.turn()

    expect(review.adapter.requests).toHaveLength(2)
    expect(review.ofType('turn-review/request')).toEqual([])
  })

  it('leaves a turn alone when no configured tool is a trigger', async () => {
    const review = await mountReview(
      [toolCallResponse('c1', 'write', {}), textResponse('Wrote notes.md.')],
      reviewConfig({ triggerTools: ['patch'] }),
    )

    await review.turn()

    expect(review.adapter.requests).toHaveLength(2)
    expect(review.ofType('turn-review/request')).toEqual([])
  })
})
