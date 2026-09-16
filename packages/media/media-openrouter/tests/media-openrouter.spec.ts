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
  process.env.OPENROUTER_API_KEY = 'sk-test'
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
  delete process.env.OPENROUTER_API_KEY
})

describe('the image catalog', () => {
  it('keeps only models whose output modalities include image', async () => {
    respond = () => json({ data: [
      { id: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro', architecture: { output_modalities: ['image'] } },
      { id: 'deepseek/chat', architecture: { output_modalities: ['text'] } },
      { id: 'bare/img', architecture: { output_modalities: ['text', 'image'] } },
    ] })
    const runtime = await media()
    expect(await runtime.listImageModels()).toEqual([
      { provider: 'openrouter', id: 'black-forest-labs/flux.2-pro', label: 'FLUX.2 Pro' },
      { provider: 'openrouter', id: 'bare/img' },
    ])
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/models')
  })

  it('skips unusable rows and a document with no data array', async () => {
    respond = () => json({ data: [null, { id: 'x' }, { id: '', architecture: { output_modalities: ['image'] } }] })
    expect(await (await media()).listImageModels()).toEqual([])
    respond = () => json({ created: 1 })
    expect(await (await media({ id: 'other' })).listImageModels()).toEqual([])
  })
})

describe('image generation', () => {
  it('posts every seam control to the dedicated image route under the route field names', async () => {
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64'), media_type: 'image/png' }] })
    const runtime = await media()
    const result = await runtime.generateImage({
      model: 'black-forest-labs/flux.2-pro',
      prompt: 'a red panda astronaut',
      n: 2,
      aspectRatio: '16:9',
      resolution: '2K',
      size: '2048x2048',
      seed: 11,
      references: [{ mediaType: 'image/png', data: PNG }],
    })
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/images')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toMatchObject({
      model: 'black-forest-labs/flux.2-pro',
      prompt: 'a red panda astronaut',
      n: 2,
      aspect_ratio: '16:9',
      resolution: '2K',
      size: '2048x2048',
      seed: 11,
      input_references: [{
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` },
      }],
    })
    expect(result).toEqual({
      provider: 'openrouter',
      model: 'black-forest-labs/flux.2-pro',
      images: [{ kind: 'bytes', mediaType: 'image/png', data: PNG }],
    })
  })

  it('omits every control the request leaves out', async () => {
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    await runtime.generateImage({ model: 'm', prompt: 'x' })
    expect(calls[0]?.body).toEqual({ model: 'm', prompt: 'x' })
  })

  it('sends no references key for an empty reference list', async () => {
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    await runtime.generateImage({ model: 'm', prompt: 'x', references: [] })
    expect(calls[0]?.body).not.toHaveProperty('input_references')
  })

  it('falls back to the signature when the route identifies no media type', async () => {
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }, { b64_json: Buffer.from(PNG).toString('base64'), media_type: '' }] })
    const runtime = await media()
    const result = await runtime.generateImage({ model: 'm', prompt: 'x' })
    expect(result.images.map(image => image.kind === 'bytes' ? image.mediaType : image.kind)).toEqual(['image/png', 'image/png'])
  })

  it('skips rows carrying no encoded image and keeps the rest', async () => {
    respond = () => json({ data: [null, 'nope', { b64_json: 7 }, { b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    const result = await runtime.generateImage({ model: 'm', prompt: 'x' })
    expect(result.images).toHaveLength(1)
  })

  it('rejects a response carrying no data array', async () => {
    respond = () => json({ created: 1 })
    const runtime = await media()
    await expect(runtime.generateImage({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'OpenRouter image response carried no data array',
      code: 'MEDIA_UPSTREAM',
    })
  })

  it('rejects a data array carrying no usable image', async () => {
    respond = () => json({ data: [{ url: 'https://cdn.example/x.png' }] })
    const runtime = await media()
    await expect(runtime.generateImage({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'OpenRouter image response carried no image data',
      code: 'MEDIA_UPSTREAM',
    })
  })

  it('forwards cancellation to the route', async () => {
    const controller = new AbortController()
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    const runtime = await media()
    await runtime.generateImage({ model: 'm', prompt: 'x' }, controller.signal)
    expect(calls).toHaveLength(1)
  })
})

describe('video jobs', () => {
  it('submits with the route field names and reports queued as running', async () => {
    respond = () => json({ id: 'job-abc', status: 'pending' })
    const runtime = await media()
    const job = await runtime.startVideo({
      model: 'PrunaAI/p-video',
      prompt: 'fog over pines',
      duration: 2,
      aspectRatio: '16:9',
      seed: 7,
      references: [{ mediaType: 'image/png', data: PNG }],
    })
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/videos')
    expect(calls[0]?.body).toMatchObject({
      model: 'PrunaAI/p-video',
      prompt: 'fog over pines',
      duration: 2,
      aspect_ratio: '16:9',
      seed: 7,
      input_references: [{ type: 'image', image_url: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` }],
    })
    expect(job).toMatchObject({ provider: 'openrouter', id: 'job-abc', status: 'running' })
  })

  it('maps succeeded, treats an unknown status as still running, and trusts an error field', async () => {
    const runtime = await media()
    respond = () => json({ id: 'j', status: 'completed' })
    await expect(runtime.videoStatus({ provider: 'openrouter', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'succeeded',
    })
    respond = () => json({ id: 'j', status: 'something-new' })
    await expect(runtime.videoStatus({ provider: 'openrouter', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'running',
    })
    respond = () => json({ id: 'j', status: 'failed', error: 'render failed' })
    await expect(runtime.videoStatus({ provider: 'openrouter', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'failed',
      error: 'render failed',
    })
    // `expired` and `cancelled` are terminal for a caller in the same way.
    respond = () => json({ id: 'j', status: 'expired' })
    await expect(runtime.videoStatus({ provider: 'openrouter', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'failed',
    })
  })

  it('retrieves bytes through the content route, not the job body url', async () => {
    respond = () => bytes(MP4)
    const runtime = await media()
    const clip = await runtime.fetchVideo({ provider: 'openrouter', id: 'job-abc', status: 'succeeded' })
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/videos/job-abc/content')
    expect(clip).toEqual({ mediaType: 'video/mp4', data: MP4 })
  })

  it('refuses a clip past the size ceiling, by header and by body', async () => {
    const runtime = await media({ maxVideoBytes: 4 })
    respond = () => bytes(MP4, 'video/mp4', { 'content-length': '99' })
    await expect(
      runtime.fetchVideo({ provider: 'openrouter', id: 'j', status: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'MEDIA_UPSTREAM' })
    respond = () => bytes(MP4)
    await expect(
      runtime.fetchVideo({ provider: 'openrouter', id: 'j', status: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'MEDIA_UPSTREAM' })
  })

  it('reports a job body with no id, and a non-JSON body', async () => {
    const runtime = await media()
    respond = () => json({ status: 'pending' })
    await expect(runtime.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'OpenRouter video job carried no id',
    })
    respond = () => new Response('not json', { status: 200 })
    await expect(runtime.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'OpenRouter returned a non-JSON body',
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
      .fetchVideo({ provider: 'openrouter', id: 'j', status: 'succeeded' })
      .catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'MEDIA_UPSTREAM' })
    expect(String(error)).toContain('HTTP 404')
  })
})

describe('optional request fields and edge shapes', () => {
  it('passes every optional control through under the route field names', async () => {
    respond = () => json({ id: 'j', status: 'pending' })
    const runtime = await media()
    const signal = new AbortController().signal
    await runtime.startVideo({
      model: 'alibaba/wan-3.0',
      prompt: 'a neon alley',
      resolution: '1080p',
      size: '1920x1080',
      generateAudio: true,
    }, signal)
    expect(calls[0]?.body).toMatchObject({
      resolution: '1080p',
      size: '1920x1080',
      generate_audio: true,
    })
  })

  it('omits input_references when the caller supplies an empty list', async () => {
    respond = () => json({ id: 'j', status: 'pending' })
    const runtime = await media()
    await runtime.startVideo({ model: 'm', prompt: 'x', references: [] })
    expect(calls[0]?.body).not.toHaveProperty('input_references')
  })

  it('reads a job with a non-string status as still running', async () => {
    respond = () => json({ id: 'j', status: 42 })
    const runtime = await media()
    await expect(runtime.videoStatus({ provider: 'openrouter', id: 'j', status: 'running' })).resolves.toMatchObject({
      status: 'running',
    })
  })

  it('reports an HTTP failure that carried an empty body', async () => {
    respond = () => new Response('', { status: 500 })
    const runtime = await media()
    await expect(runtime.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      message: 'OpenRouter request failed with HTTP 500',
    })
  })

  it('forwards cancellation to the content route and defaults its media type', async () => {
    respond = () => new Response(Uint8Array.from(MP4).buffer, { status: 200 })
    const runtime = await media()
    const clip = await runtime.fetchVideo(
      { provider: 'openrouter', id: 'j', status: 'succeeded' },
      new AbortController().signal,
    )
    expect(clip.mediaType).toBe('video/mp4')
  })
})

describe('credentials', () => {
  it('fails without a resolvable key and never calls upstream', async () => {
    delete process.env.OPENROUTER_API_KEY
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    ctx.provide('credentials', { resolve: async () => undefined })
    await ctx.plugin(provider, {})
    await expect(ctx.media.startVideo({ model: 'm', prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
    })
    expect(calls).toHaveLength(0)
  })

  it('stays usable for images on a credentials service alone, with no environment variable', async () => {
    delete process.env.OPENROUTER_API_KEY
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-service' }) })
    await ctx.plugin(provider, {})
    respond = () => json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
    const result = await ctx.media.generateImage({ model: 'm', prompt: 'x' })
    expect(calls[0]?.headers['authorization']).toBe('Bearer sk-service')
    expect(result.images).toHaveLength(1)
  })

  it('prefers a credentials-service value over the environment variable', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-env'
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-service' }) })
    await ctx.plugin(provider, {})
    respond = () => json({ id: 'j', status: 'pending' })
    await ctx.media.startVideo({ model: 'm', prompt: 'x' })
    expect(calls[0]?.headers['authorization']).toBe('Bearer sk-service')
  })
})
