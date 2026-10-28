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
  '   This includes a claim that something does not exist, is missing, or is not supported when the tool result behind it read only a filtered, truncated, or partial view: a search pattern or filter that could not match the thing, a cut list, or a first page.',
  '3. A change presented as working although no tool result observed it after the last edit; for a visual or UI change, observing means a browser read or screenshot taken after the last edit and build.',
  '4. A reply claims work is starting, running, or continuing without a corresponding dispatched tool or continuing job, or promises to act after the turn ends with no job to do it.',
  'For an action request, listing unfinished authorised work is not completion. Report it unless the user stopped or changed the task, or a concrete blocker requires user input. Questions and requests for a plan do not require execution.',
  'Do not report style, wording, scope suggestions, or improvements nobody asked for. Disclosing that a check was not run avoids a false verification claim but does not excuse leaving requested work unfinished.',
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
        'Internal review of your draft reply, not a message from the user:',
        '- The reply says the build passes, but no tool result shows a build.',
        'Complete the user’s requested work or state its blocker; remove unsupported optional promises. Revise the full answer to the user’s request, preserving supported results. Do not reply to or acknowledge this review.',
      ].join('\n'),
      source: { kind: 'plugin', plugin: 'turn-review' },
    }])
    expect(review.events().filter(event => event.type === 'turn/start')).toHaveLength(1)
  })

  it('keeps the original request and supported results when removing an invented monitoring promise', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'write', {}),
      textResponse("Created notes.md. I'll keep watching it and report changes."),
      textResponse('{"complete": false, "issues": ["The reply promises monitoring, but no monitoring job exists."]}'),
      (options) => {
        const correction = options.messages.at(-1)
        expect(correction?.source).toEqual({ kind: 'plugin', plugin: 'turn-review' })
        const text = correction?.content.map(block => block.type === 'text' ? block.text : '').join('')
        expect(text).toContain('not a message from the user')
        expect(text).toContain('remove unsupported optional promises')
        expect(text).toContain('preserving supported results')
        expect(text).toContain('Do not reply to or acknowledge this review')
        expect(options.messages).toContainEqual(expect.objectContaining({
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Create notes.md and report the result.' }],
        }))
        return textResponse('Created notes.md.')
      },
      textResponse(CLEAN),
    ])
    try {
      await review.turn('Create notes.md and report the result.')
      expect(review.ofType('tool/call').map(event => event.data.name)).toEqual(['write'])
      expect(review.ofType('turn-review/verdict').map(event => event.data.complete)).toEqual([false, true])
      const second = review.ofType('turn-review/request')[1]!.data
      expect(transcriptOf(second)).toContainEqual({ assistant: 'Created notes.md.' })
      expect(JSON.stringify(transcriptOf(second))).not.toContain('Internal review of your draft reply')
    } finally {
      await review.fiber.dispose()
    }
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
    expect(JSON.stringify(transcriptOf(requests[1]!.data))).not.toContain('Internal review of your draft reply')
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


describe('action commitments without a file change', () => {
  it.each(["I'll write the notes now.", 'I am running the checks now.', 'I’m going to fix it.', 'We will keep working on it.'])(
    'reviews the execution evidence for %s', async (reply) => {
      const review = await mountReview([
        textResponse(reply),
        textResponse('{"complete": false, "issues": ["The requested work has not started; no tool or continuing job exists."]}'),
        toolCallResponse('c1', 'write', {}),
        textResponse('Wrote notes.md.'),
      ], reviewConfig({ maxReviewsPerTurn: 1 }))
      try {
        await review.turn()
        expect(review.ofType('turn-review/request')).toHaveLength(1)
        expect(review.ofType('tool/call').map(event => event.data.name)).toEqual(['write'])
        expect(review.injected()[0]?.text).toContain('has not started')
      } finally {
        await review.fiber.dispose()
      }
    },
  )

  it('reviews a progress promise after read-only preparation', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'read', {}),
      textResponse('I am writing the implementation now.'),
      textResponse(CLEAN),
    ])
    try {
      await review.turn()
      expect(review.ofType('turn-review/request')).toHaveLength(1)
      expect(transcriptOf(review.ofType('turn-review/request')[0]!.data)).toContainEqual({ call: 'read', arguments: '{}' })
    } finally {
      await review.fiber.dispose()
    }
  })

  it.each(['Here is the plan you asked for.', 'The example is:\n```text\nI will write the file.\n```', '> I am running the build.\nThat is the statement you asked about.'])(
    'keeps plans and quoted examples free of auxiliary calls', async (reply) => {
      const review = await mountReview([textResponse(reply)])
      try {
        await review.turn('Explain this example; do not execute it.')
        expect(review.ofType('turn-review/request')).toEqual([])
      } finally {
        await review.fiber.dispose()
      }
    },
  )
})
