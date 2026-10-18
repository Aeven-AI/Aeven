import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { MediaRuntime } from '@aeven/media'
import * as provider from '../src/index.ts'
import { AEVEN_IMAGE_MODELS, DEFAULT_IMAGE_MODEL, DEFAULT_MAX_VIDEO_BYTES, gatewayError, requestBody, resolveConfig } from '../src/index.ts'

const PNG = Uint8Array.of(137, 80, 78, 71)

interface Call { url: string; method: string; body: unknown; headers: Record<string, string>; redirect?: string }

const calls: Call[] = []
let respond: (call: Call) => Response

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

/** A credentials double that answers one token per user, recording who asked. */
class Credentials extends Service {
  readonly asked: Array<{ ref: string; user: string | undefined }> = []

  constructor(ctx: Context, private readonly tokens: Record<string, string>) {
    super(ctx, 'credentials')
  }

  resolve(ref: string, user?: string): Promise<{ value: string } | undefined> {
    this.asked.push({ ref, user })
    const value = this.tokens[user ?? '']
    return Promise.resolve(value === undefined ? undefined : { value })
  }
}

async function media(options: {
  config?: provider.Config
  tokens?: Record<string, string>
  actingUser?: string
} = {}): Promise<{ runtime: MediaRuntime; credentials: Credentials | undefined }> {
  const ctx = new Context()
  await ctx.plugin(MediaRuntime)
  const credentials = options.tokens === undefined ? undefined : new Credentials(ctx, options.tokens)
  if (options.actingUser !== undefined) {
    ctx.provide('identityUsers', { actingUser: () => ({ id: options.actingUser }) })
  }
  await ctx.plugin(provider, options.config ?? {})
  return { runtime: ctx.media, credentials }
}

beforeEach(() => {
  calls.length = 0
  respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
  vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...init?.redirect === undefined ? {} : { redirect: init.redirect },
    }
    calls.push(call)
    return respond(call)
  })
  process.env.AEVEN_TOKEN = 'ambient-token'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.AEVEN_TOKEN
})

describe('the shipped catalog', () => {
  it('offers exactly Flash and Pro, Flash first and the default', async () => {
    expect(AEVEN_IMAGE_MODELS.map(model => model.id)).toEqual(['Aeven-1.0-Image-Flash', 'Aeven-1.0-Image-Pro'])
    expect(DEFAULT_IMAGE_MODEL).toBe('Aeven-1.0-Image-Flash')
    const { runtime } = await media()
    expect(await runtime.listImageModels()).toEqual([
      { provider: 'aeven', id: 'Aeven-1.0-Image-Flash', label: 'Aeven Image Flash', description: AEVEN_IMAGE_MODELS[0]!.description },
      { provider: 'aeven', id: 'Aeven-1.0-Image-Pro', label: 'Aeven Image Pro', description: AEVEN_IMAGE_MODELS[1]!.description },
    ])
    // Shipped, not fetched: listing makes no request.
    expect(calls).toEqual([])
  })

  it('gives only Pro a background option', () => {
    expect(AEVEN_IMAGE_MODELS.map(model => [model.id, model.backgrounds])).toEqual([
      ['Aeven-1.0-Image-Flash', []],
      ['Aeven-1.0-Image-Pro', ['transparent', 'opaque']],
    ])
  })

  it('states each model\'s per-call image count in the text a tool publishes for it', () => {
    for (const model of AEVEN_IMAGE_MODELS) {
      expect(model.description).toContain(`up to ${String(model.maxImages)} images per call`)
    }
  })

  it('is listed under the configured registry key', async () => {
    const { runtime } = await media({ config: { id: 'cloud' } })
    expect((await runtime.listImageModels()).every(model => model.provider === 'cloud')).toBe(true)
  })
})

describe('resolveConfig', () => {
  it('defaults the key, the development origin, and the session credential', () => {
    expect(resolveConfig({})).toEqual({
      id: 'aeven',
      endpoint: 'http://localhost:9000/v1/images/generations',
      videoEndpoint: 'http://localhost:9000/v1/videos',
      apiKeyEnv: 'AEVEN_TOKEN',
      maxVideoBytes: DEFAULT_MAX_VIDEO_BYTES,
    })
  })

  it('appends the route to the configured origin without doubling a slash', () => {
    expect(resolveConfig({ apiUrl: 'https://api.aeven.ai//', apiKeyEnv: 'OTHER' })).toMatchObject({
      endpoint: 'https://api.aeven.ai/v1/images/generations',
      apiKeyEnv: 'OTHER',
    })
  })
})

describe('requestBody', () => {
  it('asks for base64 and sends only what the request states', () => {
    expect(requestBody({ model: 'Aeven-1.0-Image-Flash', prompt: 'a fox' })).toEqual({
      model: 'Aeven-1.0-Image-Flash',
      prompt: 'a fox',
      response_format: 'b64_json',
    })
  })

  it('forwards n, size, background, and references as data URLs in order', () => {
    expect(requestBody({
      model: 'Aeven-1.0-Image-Pro',
      prompt: 'the logo on a mug',
      n: 2,
      size: '2K',
      background: 'transparent',
      references: [{ mediaType: 'image/png', data: PNG }, { mediaType: 'image/jpeg', data: Uint8Array.of(1) }],
    })).toEqual({
      model: 'Aeven-1.0-Image-Pro',
      prompt: 'the logo on a mug',
      response_format: 'b64_json',
      n: 2,
      size: '2K',
      background: 'transparent',
      image: [`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`, 'data:image/jpeg;base64,AQ=='],
    })
  })

  it('takes up to four reference images on Flash', () => {
    const references = Array.from({ length: 4 }, () => ({ mediaType: 'image/png', data: PNG }))
    expect(requestBody({ model: 'Aeven-1.0-Image-Flash', prompt: 'x', references }).image).toHaveLength(4)
  })

  it('refuses a model Aeven does not serve, naming the two it does', () => {
    expect(() => requestBody({ model: 'black-forest-labs/FLUX-1.1-pro', prompt: 'x' })).toThrow(
      '"black-forest-labs/FLUX-1.1-pro" is not an Aeven image model; use one of Aeven-1.0-Image-Flash, Aeven-1.0-Image-Pro',
    )
  })

  it('refuses a background on Flash and names the model that has one', () => {
    expect(() => requestBody({ model: 'Aeven-1.0-Image-Flash', prompt: 'x', background: 'transparent' })).toThrow(
      'Aeven-1.0-Image-Flash has no background option; a transparent background needs Aeven-1.0-Image-Pro',
    )
  })

  it('refuses aspectRatio, which the gateway has no field for', () => {
    expect(() => requestBody({ model: 'Aeven-1.0-Image-Pro', prompt: 'x', aspectRatio: '16:9' }))
      .toThrow('aspectRatio is not supported by Aeven-1.0-Image-Pro')
  })

  it('sends resolution as the gateway size field and forwards seed', () => {
    expect(requestBody({ model: 'Aeven-1.0-Image-Pro', prompt: 'x', resolution: '2K', seed: 4 })).toEqual({
      model: 'Aeven-1.0-Image-Pro',
      prompt: 'x',
      response_format: 'b64_json',
      size: '2K',
      seed: 4,
    })
    expect(() => requestBody({ model: 'Aeven-1.0-Image-Pro', prompt: 'x', size: '2K', resolution: '1K' }))
      .toThrow('Pass either size or resolution, not both')
  })

  it.each([0, 5])('refuses n of %i', (n) => {
    expect(() => requestBody({ model: 'Aeven-1.0-Image-Pro', prompt: 'x', n }))
      .toThrow('Aeven-1.0-Image-Pro generates 1 to 4 images per call')
  })

  it('refuses a fifth reference image', () => {
    const references = Array.from({ length: 5 }, () => ({ mediaType: 'image/png', data: PNG }))
    expect(() => requestBody({ model: 'Aeven-1.0-Image-Pro', prompt: 'x', references }))
      .toThrow('Aeven-1.0-Image-Pro accepts at most 4 reference images')
  })
})

describe('gatewayError', () => {
  it.each([
    [400, 'MEDIA_INVALID_REQUEST'],
    [404, 'MEDIA_INVALID_REQUEST'],
    [413, 'MEDIA_INVALID_REQUEST'],
    [422, 'MEDIA_INVALID_REQUEST'],
    [401, 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE'],
    [402, 'MEDIA_UPSTREAM'],
    [502, 'MEDIA_UPSTREAM'],
  ])('maps HTTP %i to %s and carries the gateway message', (status, code) => {
    expect(gatewayError(status, JSON.stringify({ error: { message: 'nope' } }))).toMatchObject({
      code,
      message: `Aeven image request failed with HTTP ${String(status)}: nope`,
    })
  })

  it('reports a body that is not JSON as it came, and an empty one as nothing', () => {
    expect(gatewayError(502, '<html>bad gateway</html>').message).toBe('Aeven image request failed with HTTP 502: <html>bad gateway</html>')
    expect(gatewayError(502, '').message).toBe('Aeven image request failed with HTTP 502')
    expect(gatewayError(500, JSON.stringify({ error: 'flat' })).message).toBe('Aeven image request failed with HTTP 500: {"error":"flat"}')
  })
})

describe('generating', () => {
  it('posts to the gateway with the session bearer and returns the decoded bytes', async () => {
    const { runtime } = await media({ config: { apiUrl: 'https://api.aeven.ai' } })
    const result = await runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'a fox' })
    expect(calls).toEqual([{
      url: 'https://api.aeven.ai/v1/images/generations',
      method: 'POST',
      body: { model: 'Aeven-1.0-Image-Flash', prompt: 'a fox', response_format: 'b64_json' },
      headers: {
        'authorization': 'Bearer ambient-token',
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      redirect: 'error',
    }])
    expect(result).toEqual({
      provider: 'aeven',
      model: 'Aeven-1.0-Image-Flash',
      images: [{ kind: 'bytes', mediaType: 'image/png', data: PNG }],
    })
  })

  it("forwards the caller's cancellation signal", async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    })
    const controller = new AbortController()
    const { runtime } = await media()
    await runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'x' }, controller.signal)
    expect(seen).toBe(controller.signal)
  })

  it('is selected by the seam with no configured pin as the only provider', async () => {
    const { runtime } = await media()
    await expect(runtime.generateImage({ model: 'Aeven-1.0-Image-Pro', prompt: 'x' })).resolves.toMatchObject({ provider: 'aeven' })
  })

  it('refuses an invalid request before contacting the gateway', async () => {
    const { runtime } = await media()
    await expect(runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'x', background: 'opaque' }))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID_REQUEST' })
    expect(calls).toEqual([])
  })

  it("presents the acting user's own session through the credentials service", async () => {
    const { runtime, credentials } = await media({ tokens: { alice: 'alice-token' }, actingUser: 'alice' })
    await runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'x' })
    expect(credentials!.asked).toEqual([{ ref: 'AEVEN_TOKEN', user: 'alice' }])
    expect(calls[0]!.headers.authorization).toBe('Bearer alice-token')
  })

  it('falls back to the launching environment when the credentials service holds no session', async () => {
    const { runtime } = await media({ tokens: {} })
    await runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'x' })
    expect(calls[0]!.headers.authorization).toBe('Bearer ambient-token')
  })

  it('names signing in as the remedy when no session exists anywhere', async () => {
    delete process.env.AEVEN_TOKEN
    const { runtime } = await media({ tokens: { alice: '' }, actingUser: 'alice' })
    await expect(runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
      message: 'media-aeven: no Aeven session for media provider "aeven"; sign in, or store AEVEN_TOKEN through the credentials service when running headless',
    })
    expect(calls).toEqual([])
  })

  it("surfaces the gateway's refusal", async () => {
    respond = () => json({ error: { message: '`size` must be one of 1K, 1.5K, 2K' } }, 400)
    const { runtime } = await media()
    await expect(runtime.generateImage({ model: 'Aeven-1.0-Image-Pro', prompt: 'x', size: '8K' })).rejects.toMatchObject({
      code: 'MEDIA_INVALID_REQUEST',
      message: 'Aeven image request failed with HTTP 400: `size` must be one of 1K, 1.5K, 2K',
    })
  })

  it.each([
    ['a body that is not JSON', () => new Response('not json', { status: 200 }), 'Aeven image response was not JSON'],
    ['no data array', () => json({}), 'Aeven image response carried no data array'],
    ['a JSON body that is not an object', () => json(null), 'Aeven image response carried no data array'],
    ['no image data', () => json({ data: [null, { url: 'https://x' }] }), 'Aeven image response carried no image data'],
  ])('reports %s as an upstream failure', async (_case, answer, message) => {
    respond = answer
    const { runtime } = await media()
    await expect(runtime.generateImage({ model: 'Aeven-1.0-Image-Flash', prompt: 'x' }))
      .rejects.toMatchObject({ code: 'MEDIA_UPSTREAM', message })
  })

  it('withdraws the provider when the plugin is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    const fiber = ctx.plugin(provider, {})
    await fiber
    expect(await ctx.media.listImageModels()).toHaveLength(2)
    await fiber.dispose()
    expect(await ctx.media.listImageModels()).toEqual([])
  })
})

describe('Aeven video tiers', () => {
  it('offers the same Veo options on both tiers and rejects Seedance-only requests', () => {
    for (const model of provider.AEVEN_VIDEO_MODELS) {
      const duration = 8
      expect(provider.videoRequestBody({ model: model.id, prompt: 'A slow ocean wave', duration, resolution: '1080p', aspectRatio: '16:9' }))
        .toMatchObject({ model: model.id, duration, resolution: '1080p', aspect_ratio: '16:9' })
      for (const duration of [-1, 4, 5, 6, 15]) {
        expect(() => provider.videoRequestBody({ model: model.id, prompt: 'x', duration })).toThrow('renders only 8 seconds')
      }
      expect(() => provider.videoRequestBody({ model: model.id, prompt: 'x', aspectRatio: '1:1' })).toThrow('renders aspect ratios 16:9, 9:16')
      expect(() => provider.videoRequestBody({ model: model.id, prompt: 'x', references: [{ mediaType: 'image/png', data: PNG }, { mediaType: 'image/png', data: PNG }] })).toThrow('takes at most one starting image')
      expect(() => provider.videoRequestBody({ model: model.id, prompt: 'x', resolution: '480p' })).toThrow('renders 720p, 1080p')
    }
    expect(provider.AEVEN_VIDEO_MODELS.map(model => ({ id: model.id, description: model.description }))).toMatchSnapshot()
  })
})
