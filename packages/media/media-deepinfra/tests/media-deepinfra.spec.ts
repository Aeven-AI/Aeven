import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MediaRuntime } from '@aeven/media'
import * as provider from '../src/index.ts'

const PNG = Uint8Array.of(137, 80, 78, 71)
const MP4 = Uint8Array.of(0, 0, 0, 32, 102, 116, 121, 112)

interface Call { url: string; method: string; body: unknown; headers: Record<string, string> }

const calls: Call[] = []
let respond: (call: Call) => Response

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function bytes(data: Uint8Array, type = 'video/mp4', extra: Record<string, string> = {}): Response {
  return new Response(Uint8Array.from(data).buffer, { status: 200, headers: { 'content-type': type, ...extra } })
}

async function media(config?: provider.Config): Promise<MediaRuntime> {
  process.env.DEEPINFRA_API_KEY = 'sk-test'
  const ctx = new Context()
  await ctx.plugin(MediaRuntime)
  await ctx.plugin(provider, config)
  return ctx.media
}

beforeEach(() => {
  calls.length = 0
  respond = () => json({})
  vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    }
    calls.push(call)
    return respond(call)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DEEPINFRA_API_KEY
})

describe('the image catalog', () => {
  it('takes image models from the vendor catalog and stamps the provider', async () => {
    respond = () => json({ data: [
      { model_name: 'black-forest-labs/FLUX-1.1-pro', type: 'text-to-image', description: 'fast' },
      { model_name: 'meta/llama', type: 'text-generation' },
      { model_name: 'ByteDance/Seedream-5.0-Pro', type: 'text-to-image', description: 'flagship' },
      { model_name: 'quiet/img', type: 'text-to-image', description: '' },
      { model_name: 'retired/img', type: 'text-to-image', deprecated: true },
    ] })
    const runtime = await media()
    expect(await runtime.listImageModels()).toEqual([
      { provider: 'deepinfra', id: 'black-forest-labs/FLUX-1.1-pro', description: 'fast' },
      { provider: 'deepinfra', id: 'ByteDance/Seedream-5.0-Pro', description: 'flagship' },
      { provider: 'deepinfra', id: 'quiet/img' },
    ])
    expect(calls[0]?.url).toBe('https://api.deepinfra.com/models/list')
  })

  it('skips rows with no usable id and answers [] when the document carries no rows', async () => {
    respond = () => json([null, 'nope', { model_name: '' }, { model_name: 'untagged' }, { model_name: 'a', type: 'chat' }])
    const runtime = await media()
    expect(await runtime.listImageModels()).toEqual([])
    respond = () => json({ models: 'elsewhere' })
    expect(await (await media({ id: 'other' })).listImageModels()).toEqual([])
  })
})

describe('images', () => {
  it('asks the OpenAI-compatible route for base64 and decodes it', async () => {
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    const result = await runtime.generateImage({ model: 'black-forest-labs/FLUX-1-schnell', prompt: 'a fox', n: 2 })
    expect(calls[0]?.url).toBe('https://api.deepinfra.com/v1/openai/images/generations')
    expect(calls[0]?.body).toEqual({
      model: 'black-forest-labs/FLUX-1-schnell',
      prompt: 'a fox',
      response_format: 'b64_json',
      n: 2,
    })
    expect(calls[0]?.headers['authorization']).toBe('Bearer sk-test')
    expect(result.images).toEqual([{ kind: 'bytes', mediaType: 'image/png', data: PNG }])
  })

  it('sends one reference image as a data URI and passes the background choice', async () => {
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    await runtime.generateImage({
      model: 'ByteDance/Seedream-4',
      prompt: 'a fox',
      size: '1024x1024',
      background: 'transparent',
      references: [{ mediaType: 'image/png', data: Uint8Array.of(1, 2, 3) }],
    })
    expect(calls[0]?.body).toEqual({
      model: 'ByteDance/Seedream-4',
      prompt: 'a fox',
      response_format: 'b64_json',
      size: '1024x1024',
      background: 'transparent',
      image: 'data:image/png;base64,AQID',
    })
  })

  it('refuses a resolution tier and more than one reference image instead of dropping them', async () => {
    const runtime = await media()
    await expect(runtime.generateImage({ model: 'm', prompt: 'x', resolution: '2K' }))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID_REQUEST' })
    await expect(runtime.generateImage({
      model: 'm',
      prompt: 'x',
      references: [
        { mediaType: 'image/png', data: Uint8Array.of(1) },
        { mediaType: 'image/png', data: Uint8Array.of(2) },
      ],
    })).rejects.toThrow(/multi-reference/u)
    expect(calls).toHaveLength(0)
  })

  it('labels each image by its actual bytes, not by a fixed type', async () => {
    // The route answers a PNG-defaulted request with JPEG, which is how the
    // hardcoded type this replaces was caught.
    const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)
    const GIF = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
    const WEBP = Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)
    const ODD = Uint8Array.of(1, 2, 3, 4)
    respond = () => json({
      data: [PNG, JPEG, GIF, WEBP, ODD].map(bytes => ({ b64_json: Buffer.from(bytes).toString('base64') })),
    })
    const runtime = await media()
    const result = await runtime.generateImage({ model: 'm', prompt: 'x' })
    expect(result.images.map(image => image.kind === 'bytes' ? image.mediaType : image.kind)).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/octet-stream',
    ])
  })

  it('rejects a response carrying no data array or no image rows', async () => {
    const runtime = await media()
    respond = () => json({})
    await expect(runtime.generateImage({ model: 'm', prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA_UPSTREAM' })
    respond = () => json({ data: [{ url: 'https://example.invalid/x.png' }] })
    await expect(runtime.generateImage({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA_UPSTREAM',
      message: 'DeepInfra image response carried no image data',
    })
  })
})

describe('video jobs', () => {
  it('submits with the route field names and reports queued as running', async () => {
    respond = () => json({ id: 'videos_abc', status: 'queued', data: null, error: null })
    const runtime = await media()
    const job = await runtime.startVideo({
      model: 'PrunaAI/p-video',
      prompt: 'fog over pines',
      duration: 2,
      aspectRatio: '16:9',
      seed: 7,
      references: [{ mediaType: 'image/png', data: PNG }],
    })
    expect(calls[0]?.url).toBe('https://api.deepinfra.com/v1/videos')
    expect(calls[0]?.body).toMatchObject({
      model: 'PrunaAI/p-video',
      prompt: 'fog over pines',
      seconds: 2,
      aspect_ratio: '16:9',
      seed: 7,
      image_url: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    })
    // `queued` is an actively rendering job here, not one that has not started.
    expect(job).toMatchObject({ provider: 'deepinfra', id: 'videos_abc', status: 'running' })
  })

  it('maps succeeded, treats an unknown status as still running, and trusts an error field', async () => {
    const runtime = await media()
    respond = () => json({ id: 'j', status: 'succeeded' })
    await expect(runtime.videoStatus({ provider: 'deepinfra', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'succeeded',
    })
    respond = () => json({ id: 'j', status: 'something-new' })
    await expect(runtime.videoStatus({ provider: 'deepinfra', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'running',
    })
    respond = () => json({ id: 'j', status: 'succeeded', error: 'render failed' })
    await expect(runtime.videoStatus({ provider: 'deepinfra', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'failed',
      error: 'render failed',
    })
  })

  it('retrieves bytes through the content route, not the job body url', async () => {
    respond = () => bytes(MP4)
    const runtime = await media()
    const clip = await runtime.fetchVideo({ provider: 'deepinfra', id: 'videos_abc', status: 'succeeded' })
    expect(calls[0]?.url).toBe('https://api.deepinfra.com/v1/videos/videos_abc/content')
    expect(clip).toEqual({ mediaType: 'video/mp4', data: MP4 })
  })

  it('refuses a clip past the size ceiling, by header and by body', async () => {
    const runtime = await media({ maxVideoBytes: 4 })
    respond = () => bytes(MP4, 'video/mp4', { 'content-length': '99' })
    await expect(
      runtime.fetchVideo({ provider: 'deepinfra', id: 'j', status: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'MEDIA_UPSTREAM' })
    respond = () => bytes(MP4)
    await expect(
      runtime.fetchVideo({ provider: 'deepinfra', id: 'j', status: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'MEDIA_UPSTREAM' })
  })

  it('reports a job body with no id, and a non-JSON body', async () => {
    const runtime = await media()
    respond = () => json({ status: 'queued' })
    await expect(runtime.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'DeepInfra video job carried no id',
    })
    respond = () => new Response('not json', { status: 200 })
    await expect(runtime.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'DeepInfra returned a non-JSON body',
    })
  })

  it('surfaces an upstream HTTP failure with its status and body', async () => {
    respond = () => json({ detail: 'nope' }, 402)
    const runtime = await media()
    const error = await runtime.startVideo({ model: 'm', prompt: 'x' }).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'MEDIA_UPSTREAM' })
    expect(String(error)).toContain('HTTP 402')
  })

  it('reports a failing content fetch', async () => {
    respond = () => new Response('', { status: 404 })
    const runtime = await media()
    const error = await runtime
      .fetchVideo({ provider: 'deepinfra', id: 'j', status: 'succeeded' })
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'MEDIA_UPSTREAM' })
    expect(String(error)).toContain('HTTP 404')
  })
})

describe('optional request fields and edge shapes', () => {
  it('passes size through on both media and forwards cancellation', async () => {
    const runtime = await media()
    const signal = new AbortController().signal
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    await runtime.generateImage({ model: 'm', prompt: 'x', size: '1024x1024' }, signal)
    expect(calls[0]?.body).toMatchObject({ size: '1024x1024' })
    respond = () => json({ id: 'j', status: 'queued' })
    await runtime.startVideo({ model: 'm', prompt: 'x', size: '1280x720' }, signal)
    expect(calls[1]?.body).toMatchObject({ size: '1280x720' })
    respond = () => bytes(MP4)
    await runtime.fetchVideo({ provider: 'deepinfra', id: 'j', status: 'succeeded' }, signal)
    expect(calls).toHaveLength(3)
  })

  it('reads a job with a non-string status and an empty error as still running', async () => {
    respond = () => json({ id: 'j', status: 42, error: '' })
    const runtime = await media()
    await expect(runtime.videoStatus({ provider: 'deepinfra', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'running',
    })
  })

  it('names the raw status when a failure carries no error text', async () => {
    respond = () => json({ id: 'j', status: 'cancelled' })
    const runtime = await media()
    await expect(runtime.videoStatus({ provider: 'deepinfra', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'failed',
      error: 'DeepInfra reported video status "cancelled"',
    })
  })

  it('reports an HTTP failure that carried an empty body', async () => {
    respond = () => new Response('', { status: 500 })
    const runtime = await media()
    await expect(runtime.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'DeepInfra request failed with HTTP 500',
    })
  })

  it('skips image rows that are not objects', async () => {
    respond = () => json({ data: [null, 'nope', { b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    const result = await runtime.generateImage({ model: 'm', prompt: 'x' })
    expect(result.images).toHaveLength(1)
  })

  it('defaults the clip media type when the response declares none', async () => {
    respond = () => new Response(Uint8Array.from(MP4).buffer, { status: 200 })
    const runtime = await media()
    const clip = await runtime.fetchVideo({ provider: 'deepinfra', id: 'j', status: 'succeeded' })
    expect(clip.mediaType).toBe('video/mp4')
  })
})

describe('credentials', () => {
  it('fails without a resolvable key and never calls upstream', async () => {
    delete process.env.DEEPINFRA_API_KEY
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    ctx.provide('credentials', { resolve: async () => undefined })
    await ctx.plugin(provider, {})
    await expect(ctx.media.generateImage({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
    })
    expect(calls).toHaveLength(0)
  })

  it('is usable for video through a credentials service alone', async () => {
    delete process.env.DEEPINFRA_API_KEY
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-service' }) })
    await ctx.plugin(provider, {})
    respond = () => json({ id: 'j', status: 'queued' })
    await expect(ctx.media.startVideo({ model: 'm', prompt: 'x' })).resolves.toMatchObject({ status: 'running' })
  })

  it('prefers a credentials-service value over the environment variable', async () => {
    process.env.DEEPINFRA_API_KEY = 'sk-env'
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-service' }) })
    await ctx.plugin(provider, {})
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    await ctx.media.generateImage({ model: 'm', prompt: 'x' })
    expect(calls[0]?.headers['authorization']).toBe('Bearer sk-service')
  })
})
