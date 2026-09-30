/**
 * Claude subscription error remapping.
 * @module @aeven/subscription-auth/claude-errors
 */

import { type LlmFailure, QUOTA_EXCEEDED_CODE } from '@aeven/llm'

/** Anthropic's structured refusal for a model the plan serves only against usage credits. */
const CREDITS_REQUIRED = 'credits_required'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read `error.details` from a pi-ai failure message, which is the HTTP status
 * followed by Anthropic's JSON error body (`429 {"type":"error",...}`).
 * @param message - the failure message pi-ai flattened from the response.
 * @returns the details object, or undefined when the message carries no JSON body.
 */
function anthropicErrorDetails(message: string): Record<string, unknown> | undefined {
  const start = message.indexOf('{')
  if (start < 0) return undefined
  let body: unknown
  try {
    body = JSON.parse(message.slice(start))
  } catch {
    // A non-JSON tail is some other provider or transport wording; it keeps
    // its original classification.
    return undefined
  }
  return record(record(record(body)?.['error'])?.['details'])
}

/**
 * Anthropic answers a request for a model the Claude plan serves only against
 * usage credits (for example Fable on Pro) with HTTP 429 `rate_limit_error`,
 * which pi-ai classifies as `RATE_LIMIT`. Buying credits is an account action,
 * so repeating the request cannot succeed: remap it to `QUOTA`, which the
 * route's retry policy excludes, and replace the raw JSON body with an
 * actionable message. Every other failure is returned unchanged.
 * @param failure - a terminal stream failure from the Claude route.
 * @returns the remapped failure, or `failure` itself when it is not a credits refusal.
 */
export function remapClaudeCreditsFailure(failure: LlmFailure): LlmFailure {
  const details = anthropicErrorDetails(failure.message)
  if (details?.['error_code'] !== CREDITS_REQUIRED) return failure
  const model = nonEmptyString(details['model_display_name']) ?? nonEmptyString(details['model']) ?? 'This model'
  return {
    ...failure,
    code: QUOTA_EXCEEDED_CODE,
    message: `${model} requires usage credits on your Claude plan. Buy usage credits or switch models to continue.`,
  }
}
