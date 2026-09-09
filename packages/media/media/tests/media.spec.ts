import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  MediaError,
  MediaRuntime,
  type GeneratedMedia,
  type MediaImageProvider,
  type MediaImageResult,
  type MediaVideoJob,
  type MediaVideoProvider,
} from '../src/index.ts'

const CLIP: GeneratedMedia = { mediaType: 'video/mp4', data: Uint8Array.of(0, 0, 0, 32) }

function imageProvider(id: string, usable = true): MediaImageProvider {
  return {
    id,
    available: () => usable,
    generateImage: vi.fn<MediaImageProvider['generateImage']>(
      async (request): Promise<MediaImageResult> => ({
        provider: id,
        model: request.model,
        images: [{ kind: 'bytes' as const, mediaType: 'image/png', data: Uint8Array.of(137, 80, 78, 71) }],
      }),
    ),
  }
}

/** The provider plus its own mocks, so assertions never read a method off it. */
function videoProvider(id: string, usable = true) {
  const startVideo = vi.fn<MediaVideoProvider['startVideo']>(
    async (): Promise<MediaVideoJob> => ({ provider: id, id: 'job-1', status: 'running' }),
  )
  const videoStatus = vi.fn<MediaVideoProvider['videoStatus']>(
    async (jobId): Promise<MediaVideoJob> => ({ provider: id, id: jobId, status: 'succeeded' }),
  )
  const fetchVideo = vi.fn<MediaVideoProvider['fetchVideo']>(async (): Promise<GeneratedMedia> => CLIP)
  const provider: MediaVideoProvider = { id, available: () => usable, startVideo, videoStatus, fetchVideo }
  return { provider, startVideo, videoStatus, fetchVideo }
}

async function runtime(config?: ConstructorParameters<typeof MediaRuntime>[1]): Promise<MediaRuntime> {
  const ctx = new Context()
  await ctx.plugin(MediaRuntime, config)
  return ctx.media
}

describe('the aggregated image catalog', () => {
  it('lists every provider that publishes one, in registration order', async () => {
    const ctx = new Context()
    await ctx.plugin(MediaRuntime, {})
    ctx.media.registerImageProvider({
      id: 'a', available: () => true,
      generateImage: async () => ({ provider: 'a', model: 'm', images: [] }),
      listImageModels: async () => [{ provider: 'a', id: 'a1' }],
    })
    ctx.media.registerImageProvider({
      id: 'b', available: () => true,
      generateImage: async () => ({ provider: 'b', model: 'm', images: [] }),
      listImageModels: async () => [{ provider: 'b', id: 'b1' }],
    })
    expect(await ctx.media.listImageModels()).toEqual([
      { provider: 'a', id: 'a1' },
      { provider: 'b', id: 'b1' },
    ])
  })

  it('skips a provider that publishes no catalog and one whose route failed', async () => {
    const ctx = new Context()
    await ctx.plugin(MediaRuntime, {})
    ctx.media.registerImageProvider({
      id: 'silent', available: () => true,
      generateImage: async () => ({ provider: 'silent', model: 'm', images: [] }),
    })
    ctx.media.registerImageProvider({
      id: 'broken', available: () => true,
      generateImage: async () => ({ provider: 'broken', model: 'm', images: [] }),
      listImageModels: async () => { throw new Error('unreachable') },
    })
    ctx.media.registerImageProvider({
      id: 'ok', available: () => true,
      generateImage: async () => ({ provider: 'ok', model: 'm', images: [] }),
      listImageModels: async () => [{ provider: 'ok', id: 'ok1' }],
    })
    expect(await ctx.media.listImageModels()).toEqual([{ provider: 'ok', id: 'ok1' }])
  })
})


describe('provider registration', () => {
  it('rejects a duplicate id per kind and disposes registrations with the fiber', async () => {
    const media = await runtime()
    const dispose = media.registerImageProvider(imageProvider('openrouter'))
    expect(() => media.registerImageProvider(imageProvider('openrouter'))).toThrow(MediaError)
    // The kinds are separate registries: the same id may serve both.
    expect(() => media.registerVideoProvider(videoProvider('openrouter').provider)).not.toThrow()
    dispose()
    expect(() => media.registerImageProvider(imageProvider('openrouter'))).not.toThrow()
  })
})

describe('provider selection', () => {
  it('takes the only usable provider when nothing is pinned', async () => {
    const media = await runtime()
    media.registerImageProvider(imageProvider('openrouter'))
    await expect(media.generateImage({ model: 'flux', prompt: 'a fox' })).resolves.toMatchObject({
      provider: 'openrouter',
      model: 'flux',
    })
  })

  it('refuses to guess between several usable providers', async () => {
    const media = await runtime()
    media.registerImageProvider(imageProvider('openrouter'))
    media.registerImageProvider(imageProvider('deepinfra'))
    await expect(media.generateImage({ model: 'flux', prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_AMBIGUOUS',
    })
  })

  it('reports no usable provider when none is registered or none is available', async () => {
    const empty = await runtime()
    await expect(empty.generateImage({ model: 'flux', prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_UNAVAILABLE',
    })
    const unusable = await runtime()
    unusable.registerImageProvider(imageProvider('openrouter', false))
    await expect(unusable.generateImage({ model: 'flux', prompt: 'a fox' })).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_UNAVAILABLE',
    })
  })

  it('lets the request outrank config, and config outrank the single usable provider', async () => {
    const media = await runtime({ imageProvider: 'deepinfra' })
    media.registerImageProvider(imageProvider('openrouter'))
    media.registerImageProvider(imageProvider('deepinfra'))
    await expect(media.generateImage({ model: 'flux', prompt: 'a fox' })).resolves.toMatchObject({
      provider: 'deepinfra',
    })
    await expect(
      media.generateImage({ provider: 'openrouter', model: 'flux', prompt: 'a fox' }),
    ).resolves.toMatchObject({ provider: 'openrouter' })
  })

  it('distinguishes a pinned provider that is missing from one that is unusable', async () => {
    const media = await runtime()
    media.registerImageProvider(imageProvider('openrouter', false))
    await expect(
      media.generateImage({ provider: 'absent', model: 'flux', prompt: 'a fox' }),
    ).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_CONFIGURED_MISSING' })
    await expect(
      media.generateImage({ provider: 'openrouter', model: 'flux', prompt: 'a fox' }),
    ).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })
})

describe('video jobs', () => {
  it('starts a job and polls and fetches through the provider the job names', async () => {
    const media = await runtime()
    const { provider, videoStatus } = videoProvider('openrouter')
    media.registerVideoProvider(provider)
    // A second usable provider would make a fresh selection ambiguous, which
    // proves polling routes by the job rather than re-resolving.
    media.registerVideoProvider(videoProvider('deepinfra').provider)
    const job = await media.startVideo({ provider: 'openrouter', model: 'wan-3.0', prompt: 'fog' })
    expect(job).toMatchObject({ provider: 'openrouter', status: 'running' })
    await expect(media.videoStatus(job)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(media.fetchVideo(job)).resolves.toBe(CLIP)
    expect(videoStatus).toHaveBeenCalledWith('job-1', undefined)
  })

  it('honors a config-pinned video provider', async () => {
    const media = await runtime({ videoProvider: 'deepinfra' })
    media.registerVideoProvider(videoProvider('openrouter').provider)
    media.registerVideoProvider(videoProvider('deepinfra').provider)
    await expect(media.startVideo({ model: 'wan-3.0', prompt: 'fog' })).resolves.toMatchObject({
      provider: 'deepinfra',
    })
  })

  it('forwards cancellation to the provider', async () => {
    const media = await runtime()
    const { provider, startVideo, fetchVideo } = videoProvider('openrouter')
    media.registerVideoProvider(provider)
    const signal = new AbortController().signal
    const job = await media.startVideo({ model: 'wan-3.0', prompt: 'fog' }, signal)
    await media.videoStatus(job, signal)
    await media.fetchVideo(job, signal)
    expect(startVideo).toHaveBeenCalledWith(expect.objectContaining({ model: 'wan-3.0' }), signal)
    expect(fetchVideo).toHaveBeenCalledWith('job-1', signal)
  })

  it('fails loudly when a job names a provider that is gone', async () => {
    const media = await runtime()
    const dispose = media.registerVideoProvider(videoProvider('openrouter').provider)
    const job = await media.startVideo({ model: 'wan-3.0', prompt: 'fog' })
    dispose()
    await expect(media.videoStatus(job)).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_CONFIGURED_MISSING',
    })
    await expect(media.fetchVideo(job)).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_CONFIGURED_MISSING',
    })
  })
})
