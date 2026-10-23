/**
 * The turn the plugin chooses to review. A turn counts only when the log holds
 * it, its last assistant message is an uninterrupted reply, and the session
 * recorded the route the turn's requests used. These states are written straight
 * into the log and the turn boundary is dispatched directly, because the loop
 * cannot produce them.
 */

import { describe, expect, it } from 'vitest'
import { agentEvents } from '@aeven/agent'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@aeven/llm'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountReview, reviewConfig, transcriptOf, type ReviewHarness } from './harness.ts'

/** Write one turn that changed a file and answered, as the loop's log records it. */
function appendTurn(review: ReviewHarness, options: { turn?: number; interrupted?: boolean } = {}): void {
  const turn = options.turn ?? 1
  const session = review.agent.session
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'write the notes file' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('tool/call', { turn, step: 1, callId: ToolCallId('c1'), name: 'write', arguments: '{}' })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId('c1'),
      content: [{ type: 'text', text: 'wrote notes.md' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Wrote notes.md.' }],
      source: { provider: 'mock', model: 'mock' },
    }),
    ...options.interrupted === true ? { interrupted: true as const } : {},
  }, { surfaceOp: 'append' })
}

/** Dispatch the turn boundary for a hand-written log. */
async function stopTurn(review: ReviewHarness, turn = 1): Promise<void> {
  await agentEvents(review.ctx, review.agent).serial('agent/turn-stopping', {
    turn,
    signal: new AbortController().signal,
  })
}

describe('a turn the plugin will not review', () => {
  it('leaves a turn whose last reply was interrupted alone', async () => {
    const review = await mountReview([textResponse('{"complete": true, "issues": []}')])
    appendTurn(review, { interrupted: true })

    await stopTurn(review)

    expect(review.adapter.requests).toEqual([])
    expect(review.ofType('turn-review/request')).toEqual([])
  })

  it('leaves a turn alone when the session recorded no request route', async () => {
    const review = await mountReview([textResponse('{"complete": true, "issues": []}')])
    appendTurn(review)

    await stopTurn(review)

    expect(review.adapter.requests).toEqual([])
    expect(review.ofType('turn-review/request')).toEqual([])
  })

  it('leaves a turn alone when the log holds no such turn', async () => {
    const review = await mountReview([textResponse('{"complete": true, "issues": []}')])
    appendTurn(review, { turn: 1 })

    await stopTurn(review, 2)

    expect(review.adapter.requests).toEqual([])
    expect(review.ofType('turn-review/request')).toEqual([])
  })
})

describe('the turn a review quotes', () => {
  it('quotes only the work since that turn began', async () => {
    const review = await mountReview([
      textResponse('Nothing needed changing.'),
      toolCallResponse('c1', 'write', {}),
      textResponse('Wrote notes.md.'),
      textResponse('{"complete": true, "issues": []}'),
    ], reviewConfig())

    await review.turn('have a look')
    await review.turn('now write it')

    expect(transcriptOf(review.ofType('turn-review/request')[0]!.data)).toEqual([
      { user: 'now write it' },
      { call: 'write', arguments: '{}' },
      { result: 'wrote notes.md' },
      { assistant: 'Wrote notes.md.' },
    ])
  })
})
