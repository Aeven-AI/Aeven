import type { AuthContext } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODEX_ROUTING_HINT_HEADER,
  type CodexFastStreamOptions,
  type CodexStreamModel,
  codexRoutingHint,
  withCodexFastRouting,
} from '../src/codex-model-capabilities.ts'
import {
  CODEX_OAUTH_FAST_ROUTE,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
  CODING_OAUTH_OPTIONAL_ROUTES,
  CODING_OAUTH_ROUTES,
} from '../src/ids.ts'
import {
  CODEX_OAUTH_PROVIDER,
  oauthProviderDefinition,
} from '../src/oauth-providers.ts'

const ctx: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OAuth request providers', () => {
  it('bridges a Codex OAuth token through the apiKey override seam', async () => {
    const provider = CODEX_OAUTH_PROVIDER.requestProvider(CODEX_OAUTH_PROVIDER.providerFactory().getModels())
    const auth = await provider.auth.apiKey?.resolve({
      ctx,
      credential: { type: 'api_key', key: 'codex-token' },
      signal: new AbortController().signal,
    })
    expect(provider.id).toBe(CODEX_PI_PROVIDER)
    expect(provider.getModels().every(model => model.provider === CODEX_PI_PROVIDER)).toBe(true)
    expect(auth?.auth).toEqual({ apiKey: 'codex-token' })
  })

  it('serves exactly the models it is given, including ids the shipped catalog lacks', () => {
    const catalog = CODEX_OAUTH_PROVIDER.providerFactory().getModels()
    expect(catalog.length).toBeGreaterThan(1)
    const chosen = { ...catalog[0]!, id: 'gpt-next', name: 'GPT Next' }
    const provider = CODEX_OAUTH_PROVIDER.requestProvider([chosen])
    expect(provider.id).toBe(CODEX_PI_PROVIDER)
    expect(provider.getModels().map(model => model.id)).toEqual(['gpt-next'])
  })

  it('uses the collision-free Aeven route alias', () => {
    expect(CODEX_OAUTH_PROVIDER.route).toBe(CODEX_OAUTH_ROUTE)
  })

  it('keeps ordinary Codex native and Fast outside the default route list', () => {
    const provider = CODEX_OAUTH_PROVIDER.requestProvider(CODEX_OAUTH_PROVIDER.providerFactory().getModels())
    expect(provider.id).toBe(CODEX_PI_PROVIDER)
    expect(provider.getModels().every(model => model.provider === CODEX_PI_PROVIDER)).toBe(true)
    expect(CODING_OAUTH_ROUTES).not.toContain(CODEX_OAUTH_FAST_ROUTE)
    expect(CODING_OAUTH_OPTIONAL_ROUTES).toEqual([CODEX_OAUTH_FAST_ROUTE])
  })

  it('injects Fast hint and service_tier only on the wrapped provider', async () => {
    const seen: Array<{ model: CodexStreamModel; options?: CodexFastStreamOptions }> = []
    const base = {
      ...CODEX_OAUTH_PROVIDER.requestProvider([]),
      id: CODEX_PI_PROVIDER,
      stream: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
        seen.push({ model, ...(options === undefined ? {} : { options }) })
        return 'stream'
      },
      streamSimple: (model: CodexStreamModel, _context: unknown, options?: CodexFastStreamOptions) => {
        seen.push({ model, ...(options === undefined ? {} : { options }) })
        return 'simple'
      },
    }
    base.streamSimple({ id: 'gpt-5.4', provider: CODEX_PI_PROVIDER }, {}, { onPayload: payload => payload })
    expect(seen[0]?.model.provider).toBe(CODEX_PI_PROVIDER)
    expect(seen[0]?.options?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBeUndefined()
    expect(await seen[0]?.options?.onPayload?.({ model: 'gpt-5.4' }, { id: 'gpt-5.4' })).toEqual({ model: 'gpt-5.4' })

    const wrapped = withCodexFastRouting(base, {
      isEligible: id => id === 'gpt-5.4',
      profileProviderId: CODEX_OAUTH_FAST_ROUTE,
      nativeProviderId: CODEX_PI_PROVIDER,
    })
    expect(wrapped.id).toBe(CODEX_OAUTH_FAST_ROUTE)
    wrapped.streamSimple({ id: 'gpt-5.4', provider: CODEX_OAUTH_FAST_ROUTE }, {}, { onPayload: payload => payload })
    const fast = seen[1]
    expect(fast?.model).toEqual({ id: 'gpt-5.4', provider: CODEX_PI_PROVIDER })
    expect(fast?.options?.headers?.[CODEX_ROUTING_HINT_HEADER]).toBe(codexRoutingHint('gpt-5.4'))
    await expect(fast?.options?.onPayload?.({ model: 'gpt-5.4' }, { id: 'gpt-5.4' })).resolves.toMatchObject({
      model: 'gpt-5.4',
      service_tier: 'priority',
    })
  })

  it('bridges nothing when the stored key is blank or absent', async () => {
    const auth = CODEX_OAUTH_PROVIDER.requestProvider([]).auth.apiKey!
    const signal = new AbortController().signal
    await expect(auth.resolve({ ctx, credential: { type: 'api_key', key: '   ' }, signal })).resolves.toBeUndefined()
    await expect(auth.resolve({ ctx, signal })).resolves.toBeUndefined()
  })

  it('resolves a definition by slug and reports an unknown slug as absent', () => {
    expect(oauthProviderDefinition(CODEX_OAUTH_PROVIDER.slug)).toBe(CODEX_OAUTH_PROVIDER)
    expect(oauthProviderDefinition('claude')).toBeUndefined()
    expect(oauthProviderDefinition('antigravity')).toBeUndefined()
  })
})
