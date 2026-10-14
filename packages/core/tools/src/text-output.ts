/**
 * The `{ text }` output declaration and lossless JSON normalization shared by
 * tools whose canonical value carries one block of model-facing text. A tool
 * declares the extra fields it reports beside that text; only `text` is
 * required, and the render emits it alone so the model reads the text rather
 * than the JSON envelope around it.
 * @module @aeven/tools/src/text-output
 */

import type { JsonValue } from '@aeven/util-values'

/** A tool result: the model-facing text plus the fields the tool reports beside it. */
export type TextResult = { text: string } & Record<string, JsonValue>

const TEXT_OUTPUT = {
  schema: {
    type: 'object' as const,
    additionalProperties: true,
    properties: { text: { type: 'string' as const, required: true } },
  },
  render: (_args: unknown, value: Record<string, unknown>) => [{
    type: 'text' as const,
    text: typeof value['text'] === 'string' ? value['text'] : JSON.stringify(value),
  }],
} as const

/**
 * The output declaration of a tool that returns {@link TextResult}.
 * @returns an open object schema requiring `text`, plus the render that emits
 * that text as the single block the model reads, or the whole value as JSON
 * where `text` is not a string.
 */
export function textOutput(): typeof TEXT_OUTPUT {
  return TEXT_OUTPUT
}

/**
 * Detach a tool result into lossless JSON, dropping absent optional fields.
 * @param value - the result, whose `text` is what the model reads.
 * @returns the same fields as {@link TextResult}.
 */
export function textResult(value: { text: string } & Record<string, unknown>): TextResult {
  return JSON.parse(JSON.stringify(value)) as TextResult
}
