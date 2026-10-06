/** MemOS host-LLM bridge that sends auxiliary memory calls through `ctx.llm` on the owning session's route. */
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  BlockAssembler,
  createAssistantMessage,
  createUserMessage,
  isHarnessError,
  ReasoningEffortId,
  type FinishReason,
  type GenerateOptions,
  type LlmCallConfig,
  type LlmFailure,
  type LlmRuntime,
  type PreparedLlmCall,
} from '@aeven/llm'
import { deadline, timeoutOf } from '@aeven/timeout'
import type { MemoryLlmRoute } from '@aeven/memory'
import { ERROR_CODES, MemosError } from '@memtensor/memos-local-plugin/dist/agent-contract/errors.js'
import type { HostLlmBridge, HostLlmCompleteInput, HostLlmCompletion } from '@memtensor/memos-local-plugin/dist/core/llm/host-bridge.js'
import { detectDominantLanguage } from '@memtensor/memos-local-plugin/dist/core/llm/prompts/index.js'
import type { LlmMessage, LlmUsage } from '@memtensor/memos-local-plugin/dist/core/llm/types.js'
import type { TurnJudgeContext } from './domain.ts'

const BRIDGE_ID = 'aeven.host.v1'
const TIMEOUT_CODE = 'MEMORY_HOST_LLM_TIMEOUT'
const MESSAGE_SOURCE = 'memory-memos'
const NO_REASONING_EFFORT = ReasoningEffortId('off')
const UNSUPPORTED_REASONING_EFFORT = 'UNSUPPORTED_REASONING_EFFORT'

/** The `ctx.llm` operations the bridge calls. */
export type HostLlm = Pick<LlmRuntime, 'resolveModelInfo' | 'prepareCall'>

/** Async-local route scope: concurrent sessions each run MemOS work on their own provider and model. */
export class LlmRouteContext {
  private readonly storage = new AsyncLocalStorage<MemoryLlmRoute>()

  /**
   * Run an operation with a route bound to every MemOS LLM call it makes.
   * @param route - owning session's provider and model.
   * @param operation - MemOS work to run.
   * @returns the operation's result.
   */
  run<T>(route: MemoryLlmRoute, operation: () => T): T {
    return this.storage.run(Object.freeze({ ...route }), operation)
  }

  /**
   * Read the route bound to the current async context.
   * @returns the route, or undefined outside {@link run}.
   */
  current(): MemoryLlmRoute | undefined {
    return this.storage.getStore()
  }
}

/** Natural language MemOS writes stored memory in; `auto` follows the language of the captured user text. */
export type MemoryLanguage = 'auto' | 'en' | 'zh'

/**
 * Closing system-prompt rule that fixes the output language. MemOS prompts only ask for "the user's
 * original language" next to Chinese examples, which models follow inconsistently, so `auto` resolves
 * to one explicit language from the request's own text.
 */
const LANGUAGE_RULE: Readonly<Record<Exclude<MemoryLanguage, 'auto'>, string>> = {
  en: 'Write every natural-language value in English.',
  zh: 'Write every natural-language value in Simplified Chinese (zh-CN).',
}

function languageRule(language: MemoryLanguage, messages: readonly LlmMessage[]): string {
  if (language !== 'auto') return LANGUAGE_RULE[language]
  const detected = detectDominantLanguage(messages.filter(message => message.role !== 'system').map(message => message.content))
  return LANGUAGE_RULE[detected === 'zh' ? 'zh' : 'en']
}

/** MemOS host bridge whose cached model capabilities can be dropped after an adapter change. */
export interface AevenHostLlmBridge extends HostLlmBridge {
  /** Forget cached per-route reasoning capabilities. */
  invalidateModelCapabilities(): void
}

type AuxiliaryReasoning = 'off' | 'plain'

interface CapabilityCache {
  readonly entries: Map<string, { readonly expiresAt: number; readonly value: Promise<AuxiliaryReasoning> }>
  generation: number
}

/**
 * Create the MemOS host bridge. Credentials stay inside the `ctx.llm` adapter; the bridge only passes a route.
 * @param llm - Host LLM runtime.
 * @param routes - route scope set by the provider around each session's MemOS work.
 * @param capabilityTtlMs - how long one route's reasoning capability stays cached.
 * @param language - output language rule appended to every MemOS system prompt.
 * @param judges - turn-capture scope whose final-reply summarize request also judges the turn; undefined sends every request unchanged.
 * @returns bridge registered with MemOS at bootstrap.
 */
export function createHostLlmBridge(
  llm: HostLlm,
  routes: LlmRouteContext,
  capabilityTtlMs: number,
  language: MemoryLanguage,
  judges: TurnJudgeContext | undefined,
): AevenHostLlmBridge {
  const cache: CapabilityCache = { entries: new Map(), generation: 0 }
  return {
    id: BRIDGE_ID,
    invalidateModelCapabilities() {
      cache.generation++
      cache.entries.clear()
    },
    async complete(sent: HostLlmCompleteInput): Promise<HostLlmCompletion> {
      const judged = judges?.extend(sent)
      const input = judged?.input ?? sent
      const route = routes.current()
      if (!route) {
        throw new MemosError(ERROR_CODES.LLM_UNAVAILABLE, 'no active Aeven LLM route for this memory operation', { aevenCode: 'NO_ACTIVE_ROUTE' })
      }
      const startedAt = Date.now()
      const callDeadline = deadline(input.signal, input.timeoutMs ?? 0, TIMEOUT_CODE)
      try {
        callDeadline.signal.throwIfAborted()
        const prepared = await prepareAuxiliaryCall(llm, input, route, callDeadline.signal, cache, capabilityTtlMs)
        const request: GenerateOptions = { ...generateOptions(input, route, prepared.config, languageRule(language, input.messages)), signal: callDeadline.signal }
        const assembler = new BlockAssembler()
        for await (const chunk of prepared.stream(request)) {
          callDeadline.signal.throwIfAborted()
          assembler.push(chunk)
        }
        callDeadline.signal.throwIfAborted()
        assertSuccessfulFinish(assembler.finish)
        const blocks = assembler.blocks()
        if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) {
          throw outputError('Aeven host LLM returned non-text content for a text-only memory request', 'UNSUPPORTED_CONTENT')
        }
        const text = blocks.map(block => block.type === 'text' ? block.text : '').join('')
        if (!text.trim()) throw outputError('Aeven host LLM produced no text content', 'EMPTY_TEXT')
        judged?.read(text)
        return {
          text,
          model: route.model,
          ...assembler.usage === undefined ? {} : { usage: mapUsage(assembler.usage) },
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        const timeout = timeoutOf(callDeadline.signal, TIMEOUT_CODE)
        if (timeout) throw new MemosError(ERROR_CODES.LLM_TIMEOUT, timeout.message, { aevenCode: timeout.code, timeoutMs: timeout.timeoutMs })
        throw error
      } finally {
        callDeadline[Symbol.dispose]()
      }
    },
  }
}

/**
 * Build the request without a session id: auxiliary memory calls are not conversation turns and must
 * not trigger the owning session's durability checkpoints.
 */
function generateOptions(input: HostLlmCompleteInput, route: MemoryLlmRoute, config: LlmCallConfig, languageRule: string): GenerateOptions {
  const system = [...input.messages.filter(message => message.role === 'system').map(message => message.content), languageRule].join('\n\n')
  const messages = input.messages.flatMap(message => message.role === 'system' ? [] : [toMessage(message, route)])
  return { ...config, messages, system }
}

/**
 * Prepare one bounded helper call with reasoning off when the route supports it: MemOS filters and JSON
 * extractors use small output caps that conversation-level reasoning would exhaust. `prepareCall` stays
 * the final authority; an unsupported-effort rejection retries with the adapter default.
 */
async function prepareAuxiliaryCall(
  llm: HostLlm,
  input: HostLlmCompleteInput,
  route: MemoryLlmRoute,
  signal: AbortSignal,
  cache: CapabilityCache,
  ttlMs: number,
): Promise<PreparedLlmCall> {
  const config: LlmCallConfig = {
    provider: route.provider,
    model: route.model,
    ...input.temperature === undefined ? {} : { temperature: input.temperature },
    ...input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens },
  }
  if (await reasoningCapability(llm, route, signal, cache, ttlMs) === 'plain') return llm.prepareCall(config, signal)
  const generation = cache.generation
  try {
    return await llm.prepareCall({ ...config, reasoningEffort: NO_REASONING_EFFORT }, signal)
  } catch (error) {
    if (!isHarnessError(error) || error.code !== UNSUPPORTED_REASONING_EFFORT) throw error
    if (cache.generation === generation) {
      cache.entries.set(routeKey(route), { expiresAt: Date.now() + ttlMs, value: Promise.resolve('plain') })
    }
    return llm.prepareCall(config, signal)
  }
}

function routeKey(route: MemoryLlmRoute): string {
  return JSON.stringify([route.provider, route.model])
}

function reasoningCapability(
  llm: HostLlm,
  route: MemoryLlmRoute,
  signal: AbortSignal,
  cache: CapabilityCache,
  ttlMs: number,
): Promise<AuxiliaryReasoning> {
  const key = routeKey(route)
  const cached = cache.entries.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = llm.resolveModelInfo(route.provider, route.model, signal)
    .then((info): AuxiliaryReasoning => info.reasoning?.efforts.some(effort => effort.id === NO_REASONING_EFFORT) ? 'off' : 'plain')
  const entry = { expiresAt: Date.now() + ttlMs, value }
  cache.entries.set(key, entry)
  value.catch(() => {
    if (cache.entries.get(key) === entry) cache.entries.delete(key)
  })
  return value
}

function toMessage(message: Exclude<LlmMessage, { role: 'system' }>, route: MemoryLlmRoute) {
  const content = [{ type: 'text' as const, text: message.content }]
  if (message.role === 'user') return createUserMessage({ content, source: { kind: 'plugin', plugin: MESSAGE_SOURCE } })
  return createAssistantMessage({ content, source: { provider: route.provider, model: route.model } })
}

function assertSuccessfulFinish(finish: FinishReason): void {
  switch (finish.kind) {
    case 'stop':
      return
    case 'error':
    case 'aborted':
      throw failureError(finish.failure)
    case 'max-tokens':
      throw outputError('Aeven host LLM reached the token cap before completing', 'MAX_TOKENS')
    case 'tool-calls':
      throw outputError('Aeven host LLM requested tool calls for a text-only memory request', 'TOOL_CALLS')
    default:
      // FinishReason is merge-extensible; an unknown finish is not a usable completion.
      throw outputError('Aeven host LLM returned an unsupported finish reason', 'UNSUPPORTED_FINISH')
  }
}

function mapUsage(usage: NonNullable<BlockAssembler['usage']>): LlmUsage {
  const promptTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  // outputTokens already includes reasoning output; reasoningTokens is an informational subset.
  return { promptTokens, completionTokens: usage.outputTokens, totalTokens: promptTokens + usage.outputTokens }
}

function failureError(failure: LlmFailure): MemosError {
  const code = failure.code === 'RATE_LIMIT'
    ? ERROR_CODES.LLM_RATE_LIMITED
    : failure.code === 'TIMEOUT' ? ERROR_CODES.LLM_TIMEOUT : ERROR_CODES.LLM_UNAVAILABLE
  return new MemosError(code, failure.message, {
    aevenCode: failure.code,
    ...failure.status === undefined ? {} : { status: failure.status },
    ...failure.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: failure.providerRetryAfterMs },
    ...failure.requestId === undefined ? {} : { requestId: failure.requestId },
  })
}

function outputError(message: string, code: string): MemosError {
  return new MemosError(ERROR_CODES.LLM_OUTPUT_MALFORMED, message, { aevenCode: code })
}
