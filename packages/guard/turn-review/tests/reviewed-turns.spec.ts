/**
 * Reviewing a file-changing turn: a clean verdict lets the turn close, findings
 * send the agent into another step with the reviewer's list, and the per-turn
 * budget bounds how often a turn is held open. Every request and verdict is
 * logged, so the transcript the reviewer read is reconstructable.
 */

import { describe, expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountReview, reviewConfig, transcriptOf } from './harness.ts'

const CLEAN = '{"complete": true, "issues": []}'
const FINDING = '{"complete": false, "issues": ["The reply says the build passes, but no tool result shows a build."]}'

/** The reviewer's system prompt, pinned as the model sees it. */
const REVIEW_SYSTEM = [
  'You review the work an AI assistant did in one turn, before its final reply reaches the user.',
  'You receive the turn as a JSON array in order: the user\'s messages (including messages sent while the assistant was working), the assistant\'s tool calls with their results, and the assistant\'s replies. The last reply is the one about to be sent.',
  'Find only these problems:',
  '1. A user request in this turn that was not done, was done differently than asked (for example a value set to the opposite of what was asked, or an approximation where the user asked to copy), or was dropped without the reply saying so.',
  '2. A claim in the final reply (done, fixed, verified, matches, works, green) that no tool result shows, or that a tool result contradicts.',
  '3. A change presented as working although no tool result observed it after the last edit; for a visual or UI change, observing means a browser read or screenshot taken after the last edit and build.',
  'Do not report style, wording, scope suggestions, or improvements nobody asked for. If the final reply already says plainly that something is not done or not checked, that item is not a problem.',
  'Answer with JSON only, no prose and no code fence: {"complete": true, "issues": []} or {"complete": false, "issues": ["..."]}. Each issue is one sentence that names the request or claim and what the tool results show.',
].join('\n')

describe('a turn that ends with a reply after changing a file', () => {
  it('logs the review request and a clean verdict, and adds no message to the conversation', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'read', {}),
      toolCallResponse('c2', 'write', { body: 'notes' }),
      textResponse('Wrote notes.md.'),
      textResponse(CLEAN),
    ])

    await review.turn()

    expect(review.adapter.requests).toHaveLength(4)
    const requests = review.ofType('turn-review/request')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.data.turn).toBe(1)
    expect(requests[0]!.data.round).toBe(1)
    expect(requests[0]!.data.route).toEqual({ provider: 'mock', model: 'mock' })
    expect(requests[0]!.data.maxTokens).toBe(4000)
    expect(review.ofType('turn-review/verdict').map(event => event.data)).toEqual([
      { turn: 1, round: 1, complete: true, issues: [] },
    ])
    expect(review.injected()).toEqual([])
  })

  it('sends the reviewer the turn as an ordered JSON transcript of requests, calls, results, and replies', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'read', {}),
      toolCallResponse('c2', 'write', { body: 'notes' }),
      textResponse('Wrote notes.md.'),
      textResponse(CLEAN),
    ])

    await review.turn()

    const request = review.ofType('turn-review/request')[0]!.data
    expect(transcriptOf(request)).toEqual([
      { user: 'write the notes file' },
      { call: 'read', arguments: '{}' },
      { result: '[reasoning]' },
      { call: 'write', arguments: '{"body":"notes"}' },
      { result: 'wrote notes.md' },
      { assistant: 'Wrote notes.md.' },
    ])
    const prompt = request.messages[0]?.content[0]
    expect(prompt?.type === 'text' ? prompt.text.startsWith('Review this turn:\n[') : false).toBe(true)
    expect(request.messages[0]?.source).toEqual({ kind: 'plugin', plugin: 'turn-review' })
    expect(request.system).toBe(REVIEW_SYSTEM)
  })

  it('runs the review on the configured route instead of the turn route', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'write', {}),
      textResponse('Wrote notes.md.'),
      textResponse(CLEAN),
    ], reviewConfig({ provider: 'review-provider', model: 'review-model' }))

    await review.turn()

    expect(review.ofType('turn-review/request')[0]!.data.route)
      .toEqual({ provider: 'review-provider', model: 'review-model' })
    expect(review.adapter.requests[2]).toMatchObject({ provider: 'review-provider', model: 'review-model' })
  })
})

describe('findings', () => {
  it('steers the agent into another step with the reviewer findings', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'write', {}),
      textResponse('Created notes.md and the build passes.'),
      textResponse(FINDING),
      textResponse('I created notes.md but did not run a build.'),
    ], reviewConfig({ maxReviewsPerTurn: 1 }))

    await review.turn()

    expect(review.adapter.requests).toHaveLength(4)
    expect(review.ofType('turn-review/verdict').map(event => event.data)).toEqual([{
      turn: 1,
      round: 1,
      complete: false,
      issues: ['The reply says the build passes, but no tool result shows a build.'],
    }])
    expect(review.injected()).toEqual([{
      text: [
        'Before you finish: a review of this turn against its tool results found these gaps.',
        '- The reply says the build passes, but no tool result shows a build.',
        'Close each one now: do what was asked, or check the result with a tool. Anything you cannot do or check, say plainly in your reply instead of calling it done.',
      ].join('\n'),
      source: { kind: 'plugin', plugin: 'turn-review' },
    }])
    expect(review.events().filter(event => event.type === 'turn/start')).toHaveLength(1)
  })

  it('reviews a second round and closes the turn once the budget is spent', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'write', {}),
      textResponse('Done and verified.'),
      textResponse(FINDING),
      textResponse('Done and verified.'),
      textResponse(FINDING),
      textResponse('Done; I did not verify it.'),
    ])

    await review.turn()

    const requests = review.ofType('turn-review/request')
    expect(requests.map(event => event.data.round)).toEqual([1, 2])
    expect(review.ofType('turn-review/verdict')).toHaveLength(2)
    expect(review.injected()).toHaveLength(2)
    // The steering message itself is the plugin's own injection, not a request to review.
    expect(JSON.stringify(transcriptOf(requests[1]!.data))).not.toContain('Before you finish')
    expect(review.adapter.requests).toHaveLength(6)
  })

  it('budgets review rounds per turn, so a later turn is reviewed again', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'write', {}),
      textResponse('Done and verified.'),
      textResponse(FINDING),
      textResponse('Done; I did not verify it.'),
      toolCallResponse('c2', 'write', {}),
      textResponse('Done and verified again.'),
      textResponse(CLEAN),
    ], reviewConfig({ maxReviewsPerTurn: 1 }))

    await review.turn()
    await review.turn('write it again')

    expect(review.ofType('turn-review/request').map(event => [event.data.turn, event.data.round]))
      .toEqual([[1, 1], [2, 1]])
  })
})
