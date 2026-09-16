import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MediaRuntime } from '@aeven/media'
import type { AssistantImages } from '@earendil-works/pi-ai'
import * as provider from '../src/index.ts'

const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const PNG_BASE64 = Buffer.from(PNG).toString('base64')
/** A model id the real OpenRouter images catalog carries. */
const MODEL = 'black-forest-labs/flux.2-flex'

const generateImages = vi.fn<
  (model: unknown, context: { input: unknown[] }, options: { apiKey: string; signal?: AbortSignal }) =>
  Promise<AssistantImages>
>()

vi.mock('@earendil-works/pi-ai/providers/openrouter-images', () => ({
  openrouterImagesProvider: () => ({
    id: 'openrouter',
    name: 'OpenRouter',
    getModels: () => [{ id: MODEL, api: 'openrouter-images', provider: 'openrouter', output: ['image'] }],
    generateImages,
  }),
}))

function answer(over: Partial<AssistantImages> = {}): AssistantImages {
  return {
    api: 'openrouter-images',
    provider: 'openrouter',
    model: MODEL,
    output: [{ type: 'image', mimeType: 'image/png', data: PNG_BASE64 }],
    stopReason: 'stop',
    timestamp: 1,
    ...over,
  }
}

async function media(
  config?: provider.Config,
  options: { env?: string | null; credentials?: { resolve: () => Promise<{ value: string } | undefined> } } = {},
): Promise<MediaRuntime> {
  const env = options.env === undefined ? 'sk-test' : options.env
  if (env === null) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = env
  const ctx = new Context()
  await ctx.plugin(MediaRuntime)
  if (options.credentials !== undefined) ctx.provide('credentials', options.credentials)
  await ctx.plugin(provider, config)
  return ctx.media
}

beforeEach(() => {
  generateImages.mockReset()
  generateImages.mockResolvedValue(answer())
})

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
})

describe('registration', () => {
  it('registers under the upstream provider id by default', async () => {
    const runtime = await media()
    await expect(runtime.generateImage({ model: MODEL, prompt: 'a fox' })).resolves.toMatchObject({
      provider: 'openrouter',
      model: MODEL,
    })
  })

  it('registers under a configured id so two deployments can differ', async () => {
    const runtime = await media({ id: 'images', apiKeyEnv: 'OPENROUTER_API_KEY' })
    await expect(
      runtime.generateImage({ provider: 'images', model: MODEL, prompt: 'a fox' }),
    ).resolves.toMatchObject({ provider: 'images' })
  })
})

describe('generation', () => {
  it('decodes base64 output into bytes', async () => {
    const runtime = await media()
    const result = await runtime.generateImage({ model: MODEL, prompt: 'a fox' })
    expect(result.images).toEqual([{ kind: 'bytes', mediaType: 'image/png', data: PNG }])
  })

  it('sends the prompt first and reference images after it, as inline base64', async () => {
    const runtime = await media()
    await runtime.generateImage({
      model: MODEL,
      prompt: 'a fox',
      references: [{ mediaType: 'image/png', data: PNG }],
    })
    expect(generateImages.mock.calls[0]?.[1]).toEqual({
      input: [
        { type: 'text', text: 'a fox' },
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      ],
    })
  })

  it('forwards cancellation and the resolved credential', async () => {
    const runtime = await media()
    const signal = new AbortController().signal
    await runtime.generateImage({ model: MODEL, prompt: 'a fox' }, signal)
    expect(generateImages.mock.calls[0]?.[2]).toEqual({ apiKey: 'sk-test', signal })
  })

  it('omits the signal when the caller passes none', async () => {
    const runtime = await media()
    await runtime.generateImage({ model: MODEL, prompt: 'a fox' })
    expect(generateImages.mock.calls[0]?.[2]).toEqual({ apiKey: 'sk-test' })
  })
})

describe('failures', () => {
  it('rejects a model this provider does not serve, before spending a call', async () => {
    const runtime = await media()
    await expect(runtime.generateImage({ model: 'nope/not-a-model', prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_INVALID_REQUEST',
    })
    expect(generateImages).not.toHaveBeenCalled()
  })

  it('reports an upstream error result as a failure rather than an empty success', async () => {
    generateImages.mockResolvedValue(answer({ stopReason: 'error', errorMessage: 'model overloaded', output: [] }))
    const runtime = await media()
    await expect(runtime.generateImage({ model: MODEL, prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_UPSTREAM',
      message: 'model overloaded',
    })
  })

  it('falls back to a generic message when the upstream error carries none', async () => {
    generateImages.mockResolvedValue(answer({ stopReason: 'error', output: [] }))
    const runtime = await media()
    await expect(runtime.generateImage({ model: MODEL, prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_UPSTREAM',
      message: 'image generation failed',
    })
  })

  it('rejects a stopped result that carried only text', async () => {
    generateImages.mockResolvedValue(answer({ output: [{ type: 'text', text: 'I cannot draw that' }] }))
    const runtime = await media()
    await expect(runtime.generateImage({ model: MODEL, prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_UPSTREAM',
      message: 'image generation returned no image content',
    })
  })

  it('is unusable to the seam when neither a key nor a credentials service exists', async () => {
    const runtime = await media(undefined, { env: null })
    await expect(runtime.generateImage({ model: MODEL, prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_UNAVAILABLE',
    })
    expect(generateImages).not.toHaveBeenCalled()
  })

  it('reports a credentials service that resolves nothing, without calling upstream', async () => {
    // Available (a credentials service is mounted) but the reference resolves
    // to no value, which is the provider's own branch rather than the seam's.
    const runtime = await media(undefined, {
      env: null,
      credentials: { resolve: async () => undefined },
    })
    await expect(runtime.generateImage({ model: MODEL, prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
    })
    expect(generateImages).not.toHaveBeenCalled()
  })

  it('prefers a credentials-service value over the environment variable', async () => {
    const runtime = await media(undefined, {
      env: 'sk-from-env',
      credentials: { resolve: async () => ({ value: 'sk-from-service' }) },
    })
    await runtime.generateImage({ model: MODEL, prompt: 'a fox' })
    expect(generateImages.mock.calls[0]?.[2]).toEqual({ apiKey: 'sk-from-service' })
  })
})
