import { describe, expect, it, vi } from 'vitest'
import {
  createCodexImageProvider,
  createImagineImageProvider,
  IMAGINE_MEDIA_PROVIDER_ID,
  type SeamImageRequest,
  toImagineInput,
} from '../src/media-provider.ts'

const REF = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 8, height: 8 } as never

/** An Imagine client that records its input and answers with one stored image. */
function imagine(images = [{ attachment: REF, path: '/plugins/dsh-grok-build/imagine/att-1.png' }]) {
  const seen: unknown[] = []
  return {
    seen,
    client: {
      generateImage: vi.fn(async (input: unknown) => {
        seen.push(input)
        return { model: 'grok-imagine-image-2.0', images, attachment: REF, path: 'p' }
      }),
    },
  }
}

describe('toImagineInput', () => {
  it('passes the named model verbatim so the client validates it by name', () => {
    expect(toImagineInput({ model: 'grok-imagine-image-quality', prompt: 'a cat' })).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'a cat',
    })
  })

  it('falls back to the subscription image model when the request names none', () => {
    expect(toImagineInput({ model: '', prompt: 'a cat' }).model).toBe('grok-imagine-image-2.0')
  })

  it('forwards only the controls the request set', () => {
    expect(toImagineInput({ model: 'm', prompt: 'p', n: 2, aspectRatio: '16:9', resolution: '2k' })).toEqual({
      model: 'm',
      prompt: 'p',
      n: 2,
      aspectRatio: '16:9',
      resolution: '2k',
    })
  })
})

describe('the Imagine media provider', () => {
  it('claims its own registry key and reports itself usable', () => {
    const provider = createImagineImageProvider({ imagine: imagine().client })
    expect(provider.id).toBe(IMAGINE_MEDIA_PROVIDER_ID)
    expect(provider.available()).toBe(true)
  })

  it('takes a registry key from its options', () => {
    expect(createImagineImageProvider({ id: 'grok', imagine: imagine().client }).id).toBe('grok')
  })

  it('yields the stored reference rather than bytes, so nothing is copied', async () => {
    const { client, seen } = imagine()
    const provider = createImagineImageProvider({ imagine: client })
    const result = await provider.generateImage({ model: 'grok-imagine-image-2.0', prompt: 'a cat' })
    expect(seen[0]).toMatchObject({ prompt: 'a cat', model: 'grok-imagine-image-2.0' })
    expect(result).toEqual({
      provider: IMAGINE_MEDIA_PROVIDER_ID,
      model: 'grok-imagine-image-2.0',
      images: [{ kind: 'attachment', attachment: REF }],
    })
  })

  it('forwards cancellation to the client', async () => {
    const { client } = imagine()
    const signal = new AbortController().signal
    await createImagineImageProvider({ imagine: client }).generateImage(
			{ model: 'm', prompt: 'p' } satisfies SeamImageRequest,
			signal,
    )
    expect(client.generateImage).toHaveBeenCalledWith(expect.anything(), signal)
  })

  it('reports a generation that produced no image rather than an empty success', async () => {
    const provider = createImagineImageProvider({ imagine: imagine([]).client })
    await expect(provider.generateImage({ model: 'm', prompt: 'p' })).rejects.toThrow(/returned no image/)
  })
})

describe('the published catalogs', () => {
  it('lists both Imagine ids, stamped with the provider', async () => {
    const models = await createImagineImageProvider({ imagine: imagine().client }).listImageModels!()
    expect(models.map(m => m.id)).toEqual(['grok-imagine-image-2.0', 'grok-imagine-image-quality'])
    expect(models.every(m => m.provider === IMAGINE_MEDIA_PROVIDER_ID)).toBe(true)
  })

  it('lists the one model the Codex subscription serves', async () => {
    const provider = createCodexImageProvider({
      createController: () => ({ generate: vi.fn(), edit: vi.fn() }),
      imageCount: () => 1,
    })
    expect(await provider.listImageModels!()).toEqual([
      { provider: 'codex', id: 'gpt-image-2', label: 'GPT Image', description: 'Your Codex subscription' },
    ])
  })
})

describe('the Codex media provider', () => {
  it('generates through a controller built per call and yields stored references', async () => {
    const generate = vi.fn(async () => ({ model: 'gpt-image-2', images: [REF], references: [], warnings: [] }))
    const provider = createCodexImageProvider({
      createController: () => ({ generate, edit: vi.fn() }) as never,
      imageCount: () => 3,
    })
    const result = await provider.generateImage({ model: 'gpt-image-2', prompt: 'a cat' })
    expect(generate).toHaveBeenCalledWith({ prompt: 'a cat', n: 3 }, undefined)
    expect(result).toEqual({
      provider: 'codex',
      model: 'gpt-image-2',
      images: [{ kind: 'attachment', attachment: REF }],
    })
  })

  it('prefers the request count over the live setting', async () => {
    const generate = vi.fn(async () => ({ model: 'gpt-image-2', images: [REF], references: [], warnings: [] }))
    const provider = createCodexImageProvider({
      createController: () => ({ generate, edit: vi.fn() }) as never,
      imageCount: () => 3,
    })
    await provider.generateImage({ model: 'gpt-image-2', prompt: 'p', n: 1 })
    expect(generate).toHaveBeenCalledWith({ prompt: 'p', n: 1 }, undefined)
  })

  it('reports a generation that produced no image', async () => {
    const provider = createCodexImageProvider({
      createController: () =>
        ({
          generate: async () => ({ model: 'gpt-image-2', images: [], references: [], warnings: [] }),
          edit: vi.fn(),
        }) as never,
      imageCount: () => 1,
    })
    await expect(provider.generateImage({ model: 'gpt-image-2', prompt: 'p' })).rejects.toThrow(/no image/)
  })
})
