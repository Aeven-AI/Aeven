/**
 * Translate DeepSeek SSE payloads with one stateful harness block per content, reasoning, or tool
 * call index. An empty initial reasoning delta does not open a block. Finish reason and the latest
 * usage are deferred until `[DONE]`, covering both finish-attached and trailing usage-only shapes
 * while ensuring no chunk follows `finish`.
 *
 * A gateway that fails after the response began sends an `error` frame instead of a chunk and then
 * closes without `[DONE]`; that frame becomes a named failure rather than being skipped.
 *
 * Translate DeepSeek wire chunks into the harness `StreamChunk` protocol.
 * @module avn-llm-deepseek/translate
 */

import { brandString } from '@aeven/brand'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  isContextWindowExceededError,
  isMessageCountExceededError,
  isQuotaExceededError,
  LlmError,
  MESSAGE_COUNT_EXCEEDED_CODE,
  QUOTA_EXCEEDED_CODE,
} from '@aeven/llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@aeven/llm'
import { DONE } from './sse.ts'
import type { WireFrame, WireUsage, WireError } from './types.ts'

/** One open block under assembly. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only, absent until a delta carries a non-empty value. */
  callId?: string | undefined
  name?: string | undefined
}

/**
 * Map the wire finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @returns the mapped reason; unrecognized values (content_filter, …) become `{kind: 'error'}` with the uppercased value as `code`.
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      // content_filter, insufficient_system_resource, future additions.
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map wire usage fields. DeepSeek's `prompt_tokens` INCLUDES cache hits
 * (`prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens`,
 * api/create-chat-completion); the harness TokenUsage convention is
 * DISJOINT counts, so cache reads are subtracted out of `inputTokens`.
 * @param usage - wire usage from the finish chunk or the trailing usage-only chunk.
 * @returns disjoint harness counts; an exact total is present only when the
 *   aggregate prompt/completion counters are valid and agree with any wire total.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const combined = usage.prompt_tokens + usage.completion_tokens
  const hasExactTotal = Number.isSafeInteger(usage.prompt_tokens)
    && usage.prompt_tokens >= 0
    && Number.isSafeInteger(usage.completion_tokens)
    && usage.completion_tokens >= 0
    && Number.isSafeInteger(combined)
    && (usage.total_tokens === undefined || usage.total_tokens === combined)
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...hasExactTotal ? { totalTokens: combined } : {},
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}

/**
 * Accept one streamed identity field for a tool call. `id` and `name` are
 * identity, not accumulation: the wire sends each once, on the call's first
 * delta. A continuation delta that re-sends the field empty — or `null`, which
 * some OpenAI-compatible gateways fill in — means "no update", never "clear".
 * @param current - the identity established by an earlier delta of this call.
 * @param incoming - the field as parsed from this delta. The wire type is a
 *   claim about a remote encoder, so anything but a non-empty string leaves the
 *   established value alone rather than overwriting it.
 * @returns the identity in force after this delta.
 */
function acceptIdentity(current: string | undefined, incoming: unknown): string | undefined {
  return typeof incoming === 'string' && incoming.length > 0 ? incoming : current
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: brandString<ToolCallId>(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

/**
 * Classify an in-band error body into a harness failure.
 *
 * The gateway's own vocabulary is what a caller routes on, so its code is passed
 * through upper-cased rather than flattened into `SERVER` — except for the classes
 * the harness already recognizes by wording: an exhausted account quota, a request
 * that outgrew the model context, and a request carrying more message entries than
 * the endpoint admits are bounds on every route, and none of them arrives here with
 * a status code to say so. Those run through the same recognizers the non-2xx path
 * uses, so one failure classifies identically however it was delivered.
 * @param error - the parsed `error` member of an in-band error frame.
 * @returns the message a reader is shown and the stable code shown beside it.
 */
export function mapStreamError(error: WireError['error']): { message: string; code: string } {
  const detail = [error?.code, error?.type, error?.message]
    .filter(part => typeof part === 'string' && part.length > 0)
    .join(' ')
  const code = isQuotaExceededError(detail)
    ? QUOTA_EXCEEDED_CODE
    : isMessageCountExceededError(detail)
      ? MESSAGE_COUNT_EXCEEDED_CODE
      : isContextWindowExceededError(detail)
        ? CONTEXT_WINDOW_EXCEEDED_CODE
        // The provider's own code, when it gave one. The wire type is a claim about
        // a remote encoder, so anything but a non-empty string is treated as absent
        // rather than read as a string that happens to be there.
        : typeof error?.code === 'string' && error.code.length > 0 ? error.code.toUpperCase() : 'SERVER'
  // The provider's own wording wins; when it sent none, the code and type it did
  // send are the only thing left to show, and a body carrying neither is said to
  // be exactly that rather than left dangling after a colon.
  const stated = typeof error?.message === 'string' && error.message.length > 0 ? error.message : detail
  // Named as a failure *after the response began*, because that is what the
  // reader is looking at: an answer that stopped, not a request that never started.
  return {
    message: stated.length > 0
      ? `the provider failed after the response began: ${stated}`
      : 'the provider failed after the response began, and sent no reason',
    code,
  }
}

/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield StreamChunks.
 * Malformed JSON payloads abort the stream with `MALFORMED_RESPONSE`.
 * @param payloads - SSE data payloads from {@link parseSse}, `[DONE]`-terminated.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` are all deferred to the `[DONE]` sentinel.
 *   A `stop` (or absent) finish with no opened blocks is a degenerate provider completion and maps to an
 *   `EMPTY_RESPONSE` error finish instead of a successful empty message.
 * @throws {LlmError} `MALFORMED_RESPONSE` for an unparsable payload, and whatever {@link mapStreamError}
 *   makes of an in-band `error` frame — the failure the gateway could no longer report as a status.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  function open(kind: OpenBlock['kind']): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? {
            kind: 'error',
            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          }
          : reason,
      }
      return
    }

    let chunk: WireFrame
    try {
      chunk = JSON.parse(payload) as WireFrame
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    // A failure the gateway could no longer report as a status arrives in place
    // of the next chunk. Skipping it — which reading only `choices` amounts to —
    // turns a named provider failure into the truncation error the end of the
    // stream would have raised anyway, so the caller cannot tell an upstream
    // outage from a connection that simply broke.
    if (chunk.error !== undefined && chunk.error !== null) {
      const failure = mapStreamError(chunk.error)
      throw new LlmError(failure.message, failure.code)
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta

      // Reasoning first: thinking mode interleaves it before text. The
      // empty-string first chunk must not open a block.
      const reasoning = delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        if (!textBlock) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }

      for (const call of delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(call.index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        block.callId = acceptIdentity(block.callId, call.id)
        block.name = acceptIdentity(block.name, call.function?.name)
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: brandString<ToolCallId>(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: fragment,
        }
      }

      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    // Usage may arrive attached to the finish chunk or as a trailing
    // usage-only chunk — keep the latest.
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage)
  }

  // parseSse guarantees the [DONE] sentinel (or throws); reaching here means
  // the payload source violated that contract.
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}
