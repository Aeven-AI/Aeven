/**
 * Mounting the plugin: configuration that cannot describe a review is refused at
 * load, a disposed plugin stops listening at the turn boundary, and the shipped
 * defaults are the ones the package documents.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as TurnReview from '@aeven/turn-review'
import type { Config } from '@aeven/turn-review'
import { mountAgentLoopTestDependencies } from '@aeven/agent-loop-testkit'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountReview, reviewConfig } from './harness.ts'

/** Mounting this configuration must fail with the given message. */
async function expectMountRefused(config: Config, message: RegExp): Promise<void> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await expect(ctx.plugin(TurnReview, config)).rejects.toThrow(message)
}

/** A plugin configuration spelled field by field, schema unchecked. */
function rawConfig(overrides: Record<string, unknown>): Config {
  return Object.assign({}, reviewConfig(), overrides)
}

describe('configuration that cannot describe a review', () => {
  it('refuses a provider without a model', async () => {
    await expectMountRefused(rawConfig({ provider: 'review-provider' }), /provider and model must be configured together/)
  })

  it('refuses a model without a provider', async () => {
    await expectMountRefused(rawConfig({ model: 'review-model' }), /provider and model must be configured together/)
  })

  it('refuses a budget of no review rounds', async () => {
    await expectMountRefused(rawConfig({ maxReviewsPerTurn: 0 }), /maxReviewsPerTurn/)
  })

  it('refuses an entry budget below the schema minimum', async () => {
    await expectMountRefused(rawConfig({ maxEntryChars: 99 }), /maxEntryChars/)
  })

  it('refuses a transcript budget below the schema minimum', async () => {
    await expectMountRefused(rawConfig({ maxTranscriptChars: 999 }), /maxTranscriptChars/)
  })

  it('refuses an output budget below the schema minimum', async () => {
    await expectMountRefused(rawConfig({ maxOutputTokens: 63 }), /maxOutputTokens/)
  })

  it('refuses a deadline of zero', async () => {
    await expectMountRefused(rawConfig({ timeoutMs: 0 }), /timeoutMs/)
  })
})

describe('a disposed plugin', () => {
  it('no longer reviews a turn', async () => {
    const review = await mountReview([
      toolCallResponse('c1', 'write', {}),
      textResponse('Wrote notes.md.'),
      textResponse('{"complete": true, "issues": []}'),
    ])

    await review.fiber.dispose()
    await review.turn()

    expect(review.adapter.requests).toHaveLength(2)
    expect(review.ofType('turn-review/request')).toEqual([])
  })
})

describe('the shipped plugin', () => {
  it('is named for the turn boundary it reviews and injects the model runtime', () => {
    expect(TurnReview.name).toBe('turn-review')
    expect(TurnReview.inject).toEqual(['llm'])
  })

  it('reviews after the three file-changing tools with two rounds and a 90s deadline', () => {
    expect(TurnReview.Config()).toMatchObject({
      triggerTools: ['write', 'edit', 'str_replace_editor'],
      maxReviewsPerTurn: 2,
      maxEntryChars: 2000,
      maxTranscriptChars: 60000,
      maxOutputTokens: 4000,
      timeoutMs: 90000,
    })
  })
})
