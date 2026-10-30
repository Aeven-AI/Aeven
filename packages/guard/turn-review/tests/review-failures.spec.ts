/**
 * Review calls that fail: a review that reaches its output cap, requests a tool,
 * reports an error, exceeds its deadline, answers something other than the
 * requested JSON, or is cancelled with the turn. Without earlier findings,
 * failures leave the reply as written. Unresolved findings fail the turn;
 * the turn's own cancellation propagates.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, StreamChunk } from '@aeven/llm'
import { maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountReview, reviewConfig, type ReviewHarness } from './harness.ts'

/** A file-changing turn whose final reply follows the trigger call. */
const REVIEWED_TURN = [toolCallResponse('c1', 'write', {}), textResponse('Wrote notes.md.')]

/** A review answer that streamed a reasoning block before its text. */
function reasoningThenText(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'weighing the turn' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'weighing the turn' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text },
    { type: 'block-end', index: 1, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A review answer whose terminal reason this harness does not know. */
function unknownFinish(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'safety-filter' } as unknown as FinishReason },
  ]
}

/**
 * Collect the failure text the plugin logs; its `warn` format carries the turn
 * number before the text.
 */
function captureWarnings(ctx: Context): string[] {
  const warnings: string[] = []
  ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => {
      if (message.name !== 'turn-review' || message.type !== 'warn') return
      warnings.push(String(message.args.at(-1)))
    },
  })
  return warnings
}

/** Mount, capture the plugin's warnings, and record the turn. */
async function failingReview(
  script: Parameters<typeof mountReview>[0],
  config = reviewConfig(),
): Promise<{ warnings: string[]; review: ReviewHarness }> {
  const review = await mountReview(script, config)
  const warnings = captureWarnings(review.ctx)
  await review.turn()
  return { warnings, review }
}

describe('the review call itself fails', () => {
  it.each(['failure', 'budget'] as const)('fails the turn with unresolved findings after review %s', async (ending) => {
    const issue = 'The requested implementation is unfinished.'
    const review = await mountReview([
      ...REVIEWED_TURN,
      textResponse(JSON.stringify({ complete: false, issues: [issue] })),
      textResponse('The implementation is still unfinished.'),
      ...ending === 'failure' ? [maxTokensResponse('{"complete": tru')] : [],
    ], reviewConfig({ maxReviewsPerTurn: ending === 'budget' ? 1 : 2 }))
    try {
      await review.turn()
      expect(review.ofType('turn/end').map(event => event.data.reason)).toEqual([
        expect.objectContaining({ kind: 'error', error: expect.objectContaining({ message: expect.stringContaining(issue) }) }),
      ])
    } finally {
      await review.fiber.dispose()
    }
  })

  it('closes the turn when the reviewer reaches its output-token cap', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, maxTokensResponse('{"complete": tru')])

    expect(warnings).toEqual(['turn-review: review output reached maxOutputTokens'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
    expect(review.injected()).toEqual([])
  })

  it('closes the turn when the reviewer requests a tool', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, toolCallResponse('c9', 'read', {})])

    expect(warnings).toEqual(['turn-review: review model requested a tool'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('closes the turn when the review stream reports an error', async () => {
    const { warnings, review } = await failingReview([
      ...REVIEWED_TURN,
      () => { throw new Error('review transport down') },
    ])

    expect(warnings).toEqual(['turn-review: review transport down'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('closes the turn when the review exceeds its deadline', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, 'hang'], reviewConfig({ timeoutMs: 25 }))

    expect(warnings).toEqual(['TURN_REVIEW_TIMEOUT after 25ms'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
    expect(review.ofType('turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
  })

  it('closes the turn when the reviewer stops for a reason the parser does not know', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, unknownFinish('{"complete": true, "issues": []}')])

    expect(warnings).toEqual(['turn-review: unsupported finish reason "safety-filter"'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('closes the turn when the review call throws a value that is not an Error', async () => {
    const review = await mountReview([...REVIEWED_TURN, textResponse('{"complete": true, "issues": []}')])
    const warnings = captureWarnings(review.ctx)
    review.ctx.on('llm/stream', (options, next) => {
      if (options.system?.startsWith('You review the work')) throw 'provider wrapper unavailable'
      return next()
    })

    await review.turn()

    expect(warnings).toEqual(['provider wrapper unavailable'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })
})

describe('the reviewer answers something other than the requested JSON', () => {
  it('ignores a reasoning block ahead of the JSON answer', async () => {
    const review = await mountReview([...REVIEWED_TURN, reasoningThenText('{"complete": true, "issues": []}')])

    await review.turn()

    expect(review.ofType('turn-review/verdict').map(event => event.data))
      .toEqual([{ turn: 1, round: 1, complete: true, issues: [] }])
  })

  it('closes the turn when the answer holds no JSON object', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, textResponse('no findings here')])

    expect(warnings).toEqual(['turn-review: review answer holds no JSON object'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('closes the turn when the closing brace precedes the opening one', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, textResponse('} unparseable {')])

    expect(warnings).toEqual(['turn-review: review answer holds no JSON object'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('closes the turn when the braces hold invalid JSON', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, textResponse('{complete: true, issues: []}')])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/is not valid JSON|Unexpected token|Expected/)
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('closes the turn when "complete" is not a boolean', async () => {
    const { warnings, review } = await failingReview([...REVIEWED_TURN, textResponse('{"issues":["unchecked"]}')])

    expect(warnings).toEqual(['turn-review: review answer lacks a boolean "complete"'])
    expect(review.ofType('turn-review/verdict')).toEqual([])
  })

  it('reads an answer without an issues array as a clean verdict', async () => {
    const review = await mountReview([...REVIEWED_TURN, textResponse('{"complete": false}')])

    await review.turn()

    expect(review.ofType('turn-review/verdict').map(event => event.data))
      .toEqual([{ turn: 1, round: 1, complete: true, issues: [] }])
    expect(review.injected()).toEqual([])
  })
})

describe("the turn's own cancellation", () => {
  it('propagates instead of logging a failed review', async () => {
    const review = await mountReview([...REVIEWED_TURN, 'hang'])
    const warnings = captureWarnings(review.ctx)
    review.ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn-review/request') review.agent.cancel({ kind: 'user' })
    })

    await review.turn()

    expect(review.ofType('turn/end').map(event => event.data.reason))
      .toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
    expect(review.ofType('turn-review/verdict')).toEqual([])
    expect(warnings).toEqual([])
  })
})
