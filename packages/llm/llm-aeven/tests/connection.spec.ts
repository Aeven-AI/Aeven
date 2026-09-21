/**
 * What one resolution puts on the wire: the origin reached, the request
 * defaults attached, the catalog discovery answers, and the retry policy the
 * registry captured.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@aeven/llm'
import { DEFAULT_MAX_TOKENS } from '@aeven/llm-deepseek'
import * as LlmAeven from '../src/index.ts'
import { apply, DEFAULT_API_KEY_ENV, DEFAULT_API_URL, NS, PROVIDER } from '../src/index.ts'
import { stubChatCompletions } from './chat-double.ts'
import { cleanupTempHomes, generate, tempHome } from './harness.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await cleanupTempHomes()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('connection resolution', () => {
  it('applies the shipped defaults when the entry supplies no configuration', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const calls = stubChatCompletions()

    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    // The type keeps every field optional so a user-settings section can
    // supply a subset; this is that subset's resolution.
    apply(ctx, {})

    const result = await generate(ctx, 'Aeven-1.0-Flash')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${DEFAULT_API_URL}/v1/chat/completions`)
    expect(calls[0]?.headers.authorization).toBe('Bearer ambient-token')
    // Exact equality is the documented request contract: this route
    // contributes no plugin-owned top-level request fields, so the shipped
    // thinking default and output cap are the whole body.
    expect(calls[0]?.body).toEqual({
      model: 'Aeven-1.0-Flash',
      messages: [],
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
      max_tokens: DEFAULT_MAX_TOKENS,
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1, totalTokens: 4 })
  })

  it('takes the configured origin, catalog, request defaults, and retry policy', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    vi.stubEnv('AEVEN_TEST_SESSION', 'configured-token')
    const calls = stubChatCompletions()

    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmAeven, {
      // Two trailing slashes: the origin is normalized so only `/v1` and the
      // route path are appended.
      apiUrl: 'https://gateway.test//',
      apiKeyEnv: 'AEVEN_TEST_SESSION',
      models: [{ id: 'acme-small', name: 'Acme Small', contextWindow: 65_536, maxTokens: 4_096 }],
      thinking: 'disabled',
      reasoningEffort: 'off',
      maxTokens: 1_234,
      defaultContextWindow: 8_192,
      streamIdleTimeoutMs: 5_000,
      maxRequestFilesBytes: 1_048_576,
      maxInlineRequestImageBytes: 524_288,
      maxImagesPerRequest: 8,
      imageOffloadByteQuantum: 262_144,
      inlineImageOffloadByteQuantum: 131_072,
      imageOffloadCountQuantum: 2,
      filesApiTimeoutMs: 2_000,
      fileExpiresAfterSeconds: 7_200,
      fileRefreshMarginSeconds: 60,
      fileQuotaCleanupBatch: 5,
      retryPolicy: { mode: 'always', backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 } },
    })

    const result = await generate(ctx, 'acme-small')

    expect(calls[0]?.url).toBe('https://gateway.test/v1/chat/completions')
    // The configured reference, not the shipped default, names the credential.
    expect(calls[0]?.headers.authorization).toBe('Bearer configured-token')
    // `off` reaches the wire as a disabled thinking mode rather than as an
    // effort value, and the catalogued model's own output cap wins.
    expect(calls[0]?.body).toEqual({
      model: 'acme-small',
      messages: [],
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'disabled' },
      max_tokens: 4_096,
    })
    expect(result.finish).toEqual({ kind: 'stop' })

    // The configured cap is the fallback for a model the catalog does not
    // describe.
    await generate(ctx, 'unlisted-model')
    expect(calls[1]?.body).toMatchObject({ model: 'unlisted-model', max_tokens: 1_234 })

    // The configured catalog replaces the shipped one, for discovery and for
    // the limits a selector reads.
    expect(await ctx.llm.discoverModels(NS, { provider: PROVIDER })).toEqual([
      { id: 'acme-small', name: 'Acme Small', contextWindow: 65_536, maxTokens: 4_096 },
    ])
    expect(await ctx.llm.resolveModelInfo(PROVIDER, 'acme-small')).toMatchObject({
      context: { contextWindow: 65_536 },
      defaultMaxTokens: 4_096,
    })
    // A model the catalog does not describe falls back to the configured
    // context capacity and output cap instead of the shipped ones.
    expect(await ctx.llm.resolveModelInfo(PROVIDER, 'unlisted-model')).toMatchObject({
      context: { contextWindow: 8_192 },
      defaultMaxTokens: 1_234,
    })
    expect(ctx.llm.providerRetryPolicy(PROVIDER)).toEqual({
      mode: 'always',
      initialDelayMs: 25,
      maxDelayMs: 100,
      jitterRatio: 0.2,
    })
  })
})
