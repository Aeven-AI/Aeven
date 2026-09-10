import { ProviderRequestId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { remapClaudeCreditsFailure } from '../src/claude-errors.ts'

/** The body Anthropic returned for `claude-fable-5` on a Pro plan without usage credits. */
function creditsRequiredMessage(details: Record<string, unknown>): string {
  return `429 ${JSON.stringify({
    type: 'error',
    error: { type: 'rate_limit_error', message: 'Usage credits are required for this model.', details },
    request_id: 'req_test',
  })}`
}

const FABLE_DETAILS = {
  error_code: 'credits_required',
  can_user_purchase_credits: true,
  has_chargeable_saved_payment_method: true,
  disabled_reason: 'org_level_disabled',
  exhausted_included_allowance: false,
  model: 'claude-fable-5',
  model_display_name: 'Fable 5',
  notice: {
    title: 'Fable 5 requires usage credits',
    text: 'Buy usage credits to keep using Fable 5 or switch models to continue this chat.',
    cta: { copy: 'Buy credits', intent: 'buy_credit', redirect_hint: null },
    is_dismissible: true,
  },
}

describe('remapClaudeCreditsFailure', () => {
  it('turns a credits-required 429 into a non-retryable QUOTA failure with an actionable message', () => {
    const requestId = ProviderRequestId('req_test')
    expect(
      remapClaudeCreditsFailure({
        message: creditsRequiredMessage(FABLE_DETAILS),
        code: 'RATE_LIMIT',
        status: 429,
        requestId,
      }),
    ).toEqual({
      message: 'Fable 5 requires usage credits on your Claude plan. Buy usage credits or switch models to continue.',
      code: 'QUOTA',
      status: 429,
      requestId,
    })
  })

  it('names the model id, then a generic subject, when the display name is absent', () => {
    const { model_display_name: _name, ...withoutName } = FABLE_DETAILS
    expect(remapClaudeCreditsFailure({ message: creditsRequiredMessage(withoutName), code: 'RATE_LIMIT' }).message)
      .toBe('claude-fable-5 requires usage credits on your Claude plan. Buy usage credits or switch models to continue.')
    expect(
      remapClaudeCreditsFailure({
        message: creditsRequiredMessage({ error_code: 'credits_required' }),
        code: 'RATE_LIMIT',
      }).message,
    ).toBe('This model requires usage credits on your Claude plan. Buy usage credits or switch models to continue.')
  })

  it('leaves transient rate limits and unrelated failures unchanged', () => {
    const rateLimited = {
      message: `429 ${JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit.' } })}`,
      code: 'RATE_LIMIT',
    }
    expect(remapClaudeCreditsFailure(rateLimited)).toBe(rateLimited)
    const otherCode = { message: creditsRequiredMessage({ ...FABLE_DETAILS, error_code: 'other' }), code: 'RATE_LIMIT' }
    expect(remapClaudeCreditsFailure(otherCode)).toBe(otherCode)
    const plain = { message: '429 slow down', code: 'RATE_LIMIT' }
    expect(remapClaudeCreditsFailure(plain)).toBe(plain)
    const malformed = { message: '429 {"type":"error","error":', code: 'RATE_LIMIT' }
    expect(remapClaudeCreditsFailure(malformed)).toBe(malformed)
  })
})
