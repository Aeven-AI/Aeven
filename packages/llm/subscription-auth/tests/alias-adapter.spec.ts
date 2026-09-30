import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@aeven/llm'
import { LlmAdapter } from '@aeven/llm'
import { describe, expect, it } from 'vitest'
import { AliasLlmAdapter, normalizeReplayForRoute } from '../src/alias-adapter.ts'
import {
  SUBSCRIPTION_USAGE_PATH_PREFIX,
  SUBSCRIPTION_USAGE_ROUTE,
  subscriptionUsagePath,
} from '../src/ids.ts'

class FakeAdapter extends LlmAdapter {
  seenProvider: string | undefined
  seenOptions: GenerateOptions | undefined

  constructor(private readonly chunks: readonly StreamChunk[] = []) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: `Native ${provider}` }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'm1', name: 'Model 1', inputModalities: ['text'] }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seenProvider = options.provider
    this.seenOptions = options
    yield* this.chunks
  }
}

describe('AliasLlmAdapter', () => {
  it('keeps the rc.2 replay envelope opaque while restoring the native provider', () => {
    const replayState = { response: { provider: 'openai-codex', opaque: { value: 1 } } }
    const sameRoute = normalizeReplayForRoute(
      { role: 'assistant', source: { kind: 'model', provider: 'codex-oauth', model: 'gpt', replayState } } as never,
      'codex-oauth',
      'openai-codex',
    ) as never as { source: { provider: string; replayState: unknown } }
    expect(sameRoute.source.provider).toBe('openai-codex')
    expect(sameRoute.source.replayState).toBe(replayState)
  })
  it('maps public route metadata while preserving native dispatch', async () => {
    const inner = new FakeAdapter()
    const adapter = new AliasLlmAdapter(inner, new Map([['codex-oauth', 'openai-codex']]))

    expect(adapter.providerInfo('codex-oauth')).toEqual({
      id: 'codex-oauth',
      name: 'Native openai-codex',
    })
    expect(await adapter.listModels('codex-oauth')).toEqual([
      {
        provider: 'codex-oauth',
        id: 'm1',
        name: 'Model 1',
        inputModalities: ['text'],
      },
    ])
    expect(await adapter.resolveModel('codex-oauth', 'm1')).toMatchObject({
      provider: 'codex-oauth',
      id: 'm1',
    })

    for await (const _chunk of adapter.stream({
      provider: 'codex-oauth',
      model: 'm1',
      messages: [],
    })) {
      // Empty fake stream.
    }
    expect(inner.seenProvider).toBe('openai-codex')
  })

  it('normalizes pi-ai replay state at both alias boundaries', async () => {
    const inner = new FakeAdapter([
      {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: { response: { provider: 'openai-codex', model: 'm1' } },
      },
    ])
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([
        ['codex-oauth', 'openai-codex'],
        ['kimi-code-oauth', 'kimi-coding'],
      ]),
    )
    const sameRouteReplay = { response: { provider: 'openai-codex', model: 'm1' } }
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'first reply' }],
        source: { kind: 'model', provider: 'codex-oauth', model: 'm1', replayState: sameRouteReplay },
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: [{ type: 'text', text: 'foreign reply' }],
        source: {
          kind: 'model',
          provider: 'kimi-code-oauth',
          model: 'k3',
          replayState: { response: { provider: 'kimi-coding', model: 'k3' } },
        },
      },
    ] as unknown as GenerateOptions['messages']

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex-oauth',
      model: 'm1',
      messages,
    }))
      chunks.push(chunk)

    expect(inner.seenProvider).toBe('openai-codex')
    expect(inner.seenOptions?.messages[0]?.source).toMatchObject({
      provider: 'openai-codex',
      replayState: sameRouteReplay,
    })
    expect(inner.seenOptions?.messages[1]?.source).not.toHaveProperty('replayState')
    expect(chunks).toMatchObject([
      {
        type: 'finish',
        replayState: sameRouteReplay,
      },
    ])
    expect(sameRouteReplay.response.provider).toBe('openai-codex')
  })

  it('filters an authenticated catalog to includeModel matches only', async () => {
    class MultiModelAdapter extends FakeAdapter {
      override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
        return Promise.resolve([
          { provider, id: 'keep', name: 'Keep', inputModalities: ['text'] },
          { provider, id: 'drop', name: 'Drop', inputModalities: ['text'] },
        ])
      }
    }
    const adapter = new AliasLlmAdapter(
      new MultiModelAdapter(),
      new Map([['codex-oauth-fast', 'codex-oauth-fast']]),
      new Map([
        [
          'codex-oauth-fast',
          {
            isAuthenticated: async () => true,
            includeModel: id => id === 'keep',
          },
        ],
      ]),
    )
    expect(await adapter.listModels('codex-oauth-fast')).toEqual([
      { provider: 'codex-oauth-fast', id: 'keep', name: 'Keep', inputModalities: ['text'] },
    ])
  })

  it('hides unauthenticated models and labels visible providers as OAuth', async () => {
    let authenticated = false
    const adapter = new AliasLlmAdapter(
      new FakeAdapter(),
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([
        [
          'codex-oauth',
          {
            displayName: 'OpenAI Codex (OAuth)',
            isAuthenticated: async () => authenticated,
          },
        ],
      ]),
    )
    expect(adapter.providerInfo('codex-oauth').name).toBe('OpenAI Codex (OAuth)')
    expect(await adapter.listModels('codex-oauth')).toEqual([])
    authenticated = true
    expect(await adapter.listModels('codex-oauth')).toMatchObject([
      {
        provider: 'codex-oauth',
        id: 'm1',
      },
    ])
  })

  it('treats credential-read failures as unauthenticated for discovery', async () => {
    const adapter = new AliasLlmAdapter(
      new FakeAdapter(),
      new Map([['claude-code-oauth', 'anthropic']]),
      new Map([
        [
          'claude-code-oauth',
          {
            isAuthenticated: async () => {
              throw new Error('corrupt credential')
            },
          },
        ],
      ]),
    )
    expect(await adapter.listModels('claude-code-oauth')).toEqual([])
  })

  it('fails loudly for an unowned route', () => {
    const adapter = new AliasLlmAdapter(new FakeAdapter(), new Map())
    expect(() => adapter.providerInfo('unknown')).toThrow(/does not own provider/)
  })

  it('invokes onAuthFailure once for an AUTH finish and passes the chunk through', async () => {
    const authFailure: StreamChunk = {
      type: 'finish',
      reason: { kind: 'error', failure: { message: '401 authentication_error', code: 'AUTH' } },
    }
    const inner = new FakeAdapter([{ type: 'text-delta', index: 0, text: 'partial' }, authFailure])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['kimi-code-oauth', 'kimi-coding']]),
      new Map([
        [
          'kimi-code-oauth',
          {
            onAuthFailure: async () => {
              calls += 1
            },
          },
        ],
      ]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'kimi-code-oauth',
      model: 'k3',
      messages: [],
    })) {
      seen.push(chunk)
    }
    expect(calls).toBe(1)
    expect(seen[seen.length - 1]).toEqual(authFailure)
  })

  it('invalidates AUTH finishes before rewriting replay state', async () => {
    const inner = new FakeAdapter([
      {
        type: 'finish',
        reason: { kind: 'error', failure: { message: '401 authentication_error', code: 'AUTH' } },
        replayState: { response: { provider: 'openai-codex', model: 'gpt' } },
      },
    ])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([
        [
          'codex-oauth',
          {
            onAuthFailure: async () => {
              calls += 1
            },
          },
        ],
      ]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex-oauth',
      model: 'gpt',
      messages: [],
    })) {
      seen.push(chunk)
    }
    expect(calls).toBe(1)
    expect(seen).toMatchObject([
      {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'AUTH' } },
        replayState: { response: { provider: 'openai-codex', model: 'gpt' } },
      },
    ])
  })

  it('remaps xAI at-capacity finish errors to RATE_LIMIT and does not invalidate the token', async () => {
    const message =
      'Error Code null: The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing'
    const inner = new FakeAdapter([
      {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message, code: 'PI_AI_ERROR' },
        },
      },
    ])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['grok-build', 'xai']]),
      new Map([
        [
          'grok-build',
          {
            onAuthFailure: async () => {
              calls += 1
            },
          },
        ],
      ]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'grok-build',
      model: 'grok-4.6',
      messages: [],
    })) {
      seen.push(chunk)
    }
    expect(calls).toBe(0)
    expect(seen).toMatchObject([
      {
        type: 'finish',
        reason: { kind: 'error', failure: { message, code: 'RATE_LIMIT' } },
      },
    ])
  })

  it('remaps a Claude credits-required finish to QUOTA so the route does not retry it', async () => {
    const message = `429 ${JSON.stringify({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: 'Usage credits are required for this model.',
        details: { error_code: 'credits_required', model: 'claude-fable-5', model_display_name: 'Fable 5' },
      },
    })}`
    const inner = new FakeAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message, code: 'RATE_LIMIT', status: 429 } } },
    ])
    const adapter = new AliasLlmAdapter(inner, new Map([['claude-code-oauth', 'anthropic']]))
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({ provider: 'claude-code-oauth', model: 'claude-fable-5', messages: [] })) {
      seen.push(chunk)
    }
    expect(seen).toEqual([
      {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message:
              'Fable 5 requires usage credits on your Claude plan. Buy usage credits or switch models to continue.',
            code: 'QUOTA',
            status: 429,
          },
        },
      },
    ])
  })

  it('does not invoke onAuthFailure when capacity was misclassified as AUTH', async () => {
    const message = 'The model is currently at capacity due to high demand.'
    const inner = new FakeAdapter([
      {
        type: 'finish',
        reason: { kind: 'error', failure: { message, code: 'AUTH' } },
      },
    ])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['grok-build', 'xai']]),
      new Map([
        [
          'grok-build',
          {
            onAuthFailure: async () => {
              calls += 1
            },
          },
        ],
      ]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'grok-build',
      model: 'grok-4.6',
      messages: [],
    })) {
      seen.push(chunk)
    }
    expect(calls).toBe(0)
    expect(seen).toMatchObject([
      {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'RATE_LIMIT' } },
      },
    ])
  })

  it('does not invoke onAuthFailure for non-AUTH finishes or other routes', async () => {
    const inner = new FakeAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message: '429 slow down', code: 'RATE_LIMIT' } } },
    ])
    let calls = 0
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['kimi-code-oauth', 'kimi-coding']]),
      new Map([
        [
          'kimi-code-oauth',
          {
            onAuthFailure: async () => {
              calls += 1
            },
          },
        ],
      ]),
    )
    for await (const _chunk of adapter.stream({
      provider: 'kimi-code-oauth',
      model: 'k3',
      messages: [],
    })) {
      // Drain the stream.
    }
    expect(calls).toBe(0)
  })

  it('swallows onAuthFailure errors so the original AUTH failure surfaces', async () => {
    const inner = new FakeAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message: '401', code: 'AUTH' } } },
    ])
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([
        [
          'codex-oauth',
          {
            onAuthFailure: async () => {
              throw new Error('store locked')
            },
          },
        ],
      ]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'codex-oauth',
      model: 'gpt',
      messages: [],
    })) {
      seen.push(chunk)
    }
    expect(seen[seen.length - 1]).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'AUTH' } },
    })
  })

  it('leaves a foreign message that carries no replay state untouched', () => {
    const message = {
      id: 'assistant-plain',
      role: 'assistant',
      content: [{ type: 'text', text: 'reply from another route' }],
      source: { kind: 'model', provider: 'kimi-code-oauth', model: 'k3' },
    } as never as GenerateOptions['messages'][number]
    expect(normalizeReplayForRoute(message, 'codex-oauth', 'openai-codex')).toBe(message)
  })

  it('restores the alias target when the route registers no replay provider', async () => {
    const inner = new FakeAdapter()
    const adapter = new AliasLlmAdapter(
      inner,
      new Map([['codex-oauth', 'openai-codex']]),
      new Map(),
      new Map(),
    )
    const replayState = { response: { provider: 'openai-codex', model: 'gpt' } }
    for await (const _chunk of adapter.stream({
      provider: 'codex-oauth',
      model: 'gpt',
      messages: [
        {
          id: 'assistant-replay',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          source: { kind: 'model', provider: 'codex-oauth', model: 'gpt', replayState },
        },
      ],
    } as never)) {
      // Drain the empty fake stream.
    }
    expect(inner.seenProvider).toBe('openai-codex')
    expect(inner.seenOptions?.messages[0]?.source).toMatchObject({ provider: 'openai-codex', replayState })
  })

  it('passes an AUTH finish through when the route registers no auth-failure hook', async () => {
    const authFailure: StreamChunk = {
      type: 'finish',
      reason: { kind: 'error', failure: { message: '401 authentication_error', code: 'AUTH' } },
    }
    const adapter = new AliasLlmAdapter(
      new FakeAdapter([authFailure]),
      new Map([['codex-oauth', 'openai-codex']]),
      new Map([['codex-oauth', { displayName: 'OpenAI Codex' }]]),
    )
    const seen: StreamChunk[] = []
    for await (const chunk of adapter.stream({ provider: 'codex-oauth', model: 'gpt', messages: [] })) {
      seen.push(chunk)
    }
    expect(seen).toEqual([authFailure])
  })
})

describe('subscriptionUsagePath', () => {
  it('builds the same-origin usage path the Settings client requests', () => {
    expect(SUBSCRIPTION_USAGE_PATH_PREFIX).toBe('/plugins/avn-grok-build/usage/')
    expect(subscriptionUsagePath('codex')).toBe(`${SUBSCRIPTION_USAGE_PATH_PREFIX}codex`)
    expect(subscriptionUsagePath('claude')).toBe('/plugins/avn-grok-build/usage/claude')
    // The registered route deliberately has no trailing slash, so the built path
    // extends the route instead of doubling the separator.
    expect(SUBSCRIPTION_USAGE_ROUTE.endsWith('/')).toBe(false)
    expect(subscriptionUsagePath('grok')).toBe(`${SUBSCRIPTION_USAGE_ROUTE}/grok`)
  })
})
