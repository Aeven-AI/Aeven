import type { ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { CodexFetch } from '../src/codex-http.ts'
import {
  CODEX_IMAGE_EDIT_URL,
  CODEX_IMAGE_GENERATION_URL,
  CODEX_IMAGE_MODEL,
  CODEX_IMAGE_RESPONSE_FORMAT,
  collectCanonicalImageRefs,
  createCodexImageController,
  decodeImageBase64,
  detectImageMediaType,
  estimateDecodedBase64Bytes,
  isCodexImageCapableRoute,
  resolveSessionImageRefs,
} from '../src/codex-images.ts'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Raw bytes of a short ASCII tag, for header-sniffing inputs. */
function asciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** A 12-byte RIFF container tagged with the given form type (WEBP, or WEBX to be rejected). */
function riffHeader(tag: string): Uint8Array {
  const data = new Uint8Array(12)
  data.set(asciiBytes('RIFF'), 0)
  data.set(asciiBytes(tag), 8)
  return data
}

function jwtWithAccount(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockFetch(impl?: CodexFetch): Mock<CodexFetch> {
  return impl === undefined ? vi.fn<CodexFetch>() : vi.fn(impl)
}

function imageRef(id: string): ImageAttachmentRef {
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: PNG.byteLength,
    width: 1,
    height: 1,
  }
}

function memoryAttachments(overrides?: { maxImageBytes?: number }) {
  const saved: ImageAttachmentRef[] = []
  return {
    imageLimits: {
      maxImageBytes: overrides?.maxImageBytes ?? 1024 * 1024,
      maxImagesPerMessage: 6,
      maxMessageImageBytes: 4 * 1024 * 1024,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
    },
    validateImage: vi.fn(async (_input: SaveImageAttachment) => {}),
    saveImage: vi.fn(async (input: SaveImageAttachment) => {
      const ref = imageRef(`saved-${String(saved.length + 1)}`)
      saved.push(ref)
      expect(input.mediaType).toBe('image/png')
      return ref
    }),
    readImage: vi.fn(
      async (ref: ImageAttachmentRef): Promise<StoredImageAttachment> => ({ ref, data: new Uint8Array(PNG) }),
    ),
    saved,
  }
}

/** Controller wired to the Codex image test route, with per-case overrides. */
function imageController(
  fetchImpl: Mock<CodexFetch>,
  overrides: Partial<Parameters<typeof createCodexImageController>[0]> = {},
): ReturnType<typeof createCodexImageController> {
  return createCodexImageController({
    auth: {
      resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
      invalidate: async () => {},
    },
    attachments: memoryAttachments(),
    session: {
      deriveMessages: () => [],
      route: { provider: 'codex-oauth', inputModalities: ['image'] },
    },
    fetchImpl,
    sleep: async () => {},
    ...overrides,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('unexpected real network')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isCodexImageCapableRoute', () => {
  it('requires a Codex OAuth provider that declares image input', () => {
    expect(isCodexImageCapableRoute({ provider: 'codex-oauth', inputModalities: ['text', 'image'] })).toBe(true)
    expect(isCodexImageCapableRoute({ provider: 'openai-codex', inputModalities: ['image'] })).toBe(true)
    expect(isCodexImageCapableRoute({ provider: 'codex-oauth-fast', inputModalities: ['image'] })).toBe(true)
    expect(isCodexImageCapableRoute({ provider: 'codex-oauth', inputModalities: ['text'] })).toBe(false)
    expect(isCodexImageCapableRoute({ provider: 'codex-oauth' })).toBe(false)
    expect(isCodexImageCapableRoute(undefined)).toBe(false)
    expect(isCodexImageCapableRoute({ provider: 'grok-build', inputModalities: ['image'] })).toBe(false)
  })
})

describe('resolveSessionImageRefs', () => {
  const messages = [
    {
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', attachment: imageRef('att-1') },
        {
          type: 'tool-result',
          content: [{ type: 'image', attachment: imageRef('att-nested') }],
        },
        {
          type: 'random',
          nested: { type: 'image', attachment: imageRef('att-sneaky') },
        },
      ],
    },
  ]

  it('resolves only canonical refs visibly present in current session message content', () => {
    expect(collectCanonicalImageRefs(messages).has('att-1')).toBe(true)
    expect(collectCanonicalImageRefs(messages).has('att-nested')).toBe(false)
    expect(collectCanonicalImageRefs(messages).has('att-sneaky')).toBe(false)
    const refs = resolveSessionImageRefs(() => messages, ['image:att-1'])
    expect(refs.map(ref => String(ref.attachmentId))).toEqual(['att-1'])
  })

  it('rejects nested-only ids, unknown ids, HTTP URLs, and more than five references', () => {
    expect(() => resolveSessionImageRefs(() => messages, ['att-nested'])).toThrow(/not a canonical attachment/)
    expect(() => resolveSessionImageRefs(() => messages, ['att-missing'])).toThrow(/not a canonical attachment/)
    expect(() => resolveSessionImageRefs(() => messages, ['https://example.com/x.png'])).toThrow(/HTTP/)
    expect(() => resolveSessionImageRefs(() => messages, ['a', 'b', 'c', 'd', 'e', 'f'])).toThrow(/at most 5/)
  })

  it('requires at least one image id and rejects an empty id', () => {
    expect(() => resolveSessionImageRefs(() => messages, [])).toThrow(/at least one session image id/)
    expect(() => resolveSessionImageRefs(() => messages, ['   '])).toThrow(/empty image id/)
  })

  it('resolves a repeated id only once', () => {
    const refs = resolveSessionImageRefs(() => messages, ['att-1', 'image:att-1'])
    expect(refs.map(ref => String(ref.attachmentId))).toEqual(['att-1'])
  })

  it('ignores messages without a content array and keeps the first ref for a repeated id', () => {
    const refs = collectCanonicalImageRefs([
      {},
      { content: 'not-an-array' },
      {
        content: [
          { type: 'image', attachment: imageRef('att-dup') },
          { type: 'image', attachment: { ...imageRef('att-dup'), width: 99 } },
          { type: 'image', attachment: { attachmentId: 'att-incomplete' } },
        ],
      },
    ] as unknown as Parameters<typeof collectCanonicalImageRefs>[0])
    expect([...refs.keys()]).toEqual(['att-dup'])
    expect(refs.get('att-dup')?.width).toBe(1)
  })
})

describe('detectImageMediaType', () => {
  it('detects png, jpeg, webp and both gif headers', () => {
    expect(detectImageMediaType(new Uint8Array(PNG))).toBe('image/png')
    expect(detectImageMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectImageMediaType(riffHeader('WEBP'))).toBe('image/webp')
    expect(detectImageMediaType(asciiBytes('GIF87a'))).toBe('image/gif')
    expect(detectImageMediaType(asciiBytes('GIF89a'))).toBe('image/gif')
  })

  it('returns undefined for anything that is not a known raster header', () => {
    expect(detectImageMediaType(new Uint8Array(0))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x89, 0x50, 0x4e]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0xff]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x00, 0xd8, 0xff]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0xff, 0xd8, 0x00]))).toBeUndefined()
    expect(detectImageMediaType(asciiBytes('RIFX'))).toBeUndefined()
    expect(detectImageMediaType(riffHeader('WEBX'))).toBeUndefined()
    expect(detectImageMediaType(asciiBytes('GIF87'))).toBeUndefined()
    expect(detectImageMediaType(asciiBytes('GIF00a'))).toBeUndefined()
    expect(detectImageMediaType(asciiBytes('not-an-image'))).toBeUndefined()
  })
})

describe('decodeImageBase64', () => {
  it('decodes standard base64 and base64url and prechecks encoded size', () => {
    const standard = PNG.toString('base64')
    const url = PNG.toString('base64url')
    expect(Buffer.from(decodeImageBase64(standard) ?? new Uint8Array()).equals(PNG)).toBe(true)
    expect(Buffer.from(decodeImageBase64(url) ?? new Uint8Array()).equals(PNG)).toBe(true)
    expect(estimateDecodedBase64Bytes(standard)).toBe(PNG.byteLength)
    expect(estimateDecodedBase64Bytes('====')).toBeUndefined()
    expect(decodeImageBase64('not base64!!!')).toBeUndefined()
  })

  it('accepts a data URL payload and rejects unusable payloads', () => {
    const standard = PNG.toString('base64')
    const fromDataUrl = decodeImageBase64(`data:image/png;base64,${standard}`)
    expect(Buffer.from(fromDataUrl ?? new Uint8Array()).equals(PNG)).toBe(true)
    expect(decodeImageBase64('data:image/png;base64')).toBeUndefined()
    expect(decodeImageBase64('data:image/png;base64,')).toBeUndefined()
    expect(decodeImageBase64('AAAAA')).toBeUndefined()
    expect(estimateDecodedBase64Bytes('AAAAA')).toBeUndefined()
  })
})

describe('createCodexImageController', () => {
  it('generates with gpt-image-2 auto defaults and saves only b64_json rasters', async () => {
    const attachments = memoryAttachments()
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        created: 1,
        data: [{ b64_json: PNG.toString('base64') }, { url: 'https://cdn.example/signed' }],
      }),
    )
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments,
      session: {
        deriveMessages: () => [],
        route: { provider: 'codex-oauth', model: 'gpt-5.4', inputModalities: ['text', 'image'] },
      },
      fetchImpl,
      sleep: async () => {},
      now: () => 1_700_000_000_000,
    })
    const result = await controller.generate({ prompt: 'a red cube' })
    expect(result.operation).toBe('generate')
    expect(result.model).toBe(CODEX_IMAGE_MODEL)
    expect(result.images).toHaveLength(1)
    expect(result.warnings.some(warning => warning.code === 'IMAGE_DATA_MISSING')).toBe(true)
    expect(attachments.validateImage).toHaveBeenCalledOnce()
    expect(attachments.saveImage).toHaveBeenCalledOnce()
    const [url, init = {}] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(CODEX_IMAGE_GENERATION_URL)
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: 'a red cube',
      model: 'gpt-image-2',
      n: 1,
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      response_format: CODEX_IMAGE_RESPONSE_FORMAT,
    })
  })

  it('decodes a base64url b64_json item', async () => {
    const attachments = memoryAttachments()
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64url') }] }))
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments,
      session: {
        deriveMessages: () => [],
        route: { provider: 'codex-oauth', inputModalities: ['image'] },
      },
      fetchImpl,
      sleep: async () => {},
    })
    const result = await controller.generate({ prompt: 'url-safe' })
    expect(result.images).toHaveLength(1)
    expect(attachments.saveImage).toHaveBeenCalledOnce()
  })

  it('prechecks encoded size and does not save an oversized item', async () => {
    const attachments = memoryAttachments({ maxImageBytes: 8 })
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments,
      session: {
        deriveMessages: () => [],
        route: { provider: 'codex-oauth', inputModalities: ['image'] },
      },
      fetchImpl,
      sleep: async () => {},
    })
    await expect(controller.generate({ prompt: 'too big' })).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('edits only session-owned images and posts to the edits endpoint', async () => {
    const attachments = memoryAttachments()
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments,
      session: {
        deriveMessages: () => [{ content: [{ type: 'image', attachment: imageRef('owned') }] }],
        route: { provider: 'openai-codex', inputModalities: ['image'] },
      },
      fetchImpl,
      sleep: async () => {},
    })
    const result = await controller.edit({ prompt: 'make it blue', imageIds: ['image:owned'] })
    expect(result.operation).toBe('edit')
    expect(result.references.map(ref => String(ref.attachmentId))).toEqual(['owned'])
    expect(attachments.readImage).toHaveBeenCalledOnce()
    const [url, init = {}] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(CODEX_IMAGE_EDIT_URL)
    const body = JSON.parse(init.body as string) as {
      images: Array<{ image_url: string }>
      model: string
      response_format: string
    }
    expect(body.model).toBe('gpt-image-2')
    expect(body.response_format).toBe('b64_json')
    expect(body.images[0]?.image_url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('gates generation on an image-capable route', async () => {
    const fetchImpl = mockFetch()
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments: memoryAttachments(),
      session: {
        deriveMessages: () => [],
        route: { provider: 'codex-oauth', inputModalities: ['text'] },
      },
      fetchImpl,
    })
    await expect(controller.generate({ prompt: 'nope' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when the session route is missing or has no modalities', async () => {
    const fetchImpl = mockFetch()
    const auth = {
      resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
      invalidate: async () => {},
    }
    const missing = createCodexImageController({
      auth,
      attachments: memoryAttachments(),
      session: { deriveMessages: () => [] },
      fetchImpl,
    })
    const identityOnly = createCodexImageController({
      auth,
      attachments: memoryAttachments(),
      session: { deriveMessages: () => [], route: { provider: 'codex-oauth', model: 'gpt-5.4' } },
      fetchImpl,
    })
    await expect(missing.generate({ prompt: 'nope' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(identityOnly.generate({ prompt: 'nope' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows any route when routePolicy is any', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments: memoryAttachments(),
      session: {
        deriveMessages: () => [],
        route: { provider: 'deepseek', model: 'deepseek-v4-flash', inputModalities: ['text'] },
      },
      routePolicy: 'any',
      fetchImpl,
      sleep: async () => {},
    })
    const result = await controller.generate({ prompt: 'works' })
    expect(result.images).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('keeps auth mandatory and session attachment ownership isolated under the any-route policy', async () => {
    const attachments = memoryAttachments()
    const fetchImpl = mockFetch()
    const unsigned = createCodexImageController({
      auth: { resolve: async () => undefined, invalidate: async () => {} },
      attachments,
      session: {
        deriveMessages: () => [{ content: [{ type: 'image', attachment: imageRef('owned') }] }],
        route: { provider: 'deepseek', model: 'deepseek-v4', inputModalities: ['text'] },
      },
      routePolicy: 'any',
      fetchImpl,
    })
    await expect(unsigned.generate({ prompt: 'no login' })).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await expect(unsigned.edit({ prompt: 'no login', imageIds: ['owned'] })).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
    })
    expect(attachments.readImage).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()

    const crossSession = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments,
      session: {
        deriveMessages: () => [{ content: [{ type: 'image', attachment: imageRef('other-session') }] }],
        route: { provider: 'deepseek', model: 'deepseek-v4', inputModalities: ['text'] },
      },
      routePolicy: 'any',
      fetchImpl,
    })
    await expect(crossSession.edit({ prompt: 'steal', imageIds: ['owned'] })).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    })
    expect(attachments.readImage).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('edits a current-session attachment from a non-Codex route when enabled', async () => {
    const attachments = memoryAttachments()
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments,
      session: {
        deriveMessages: () => [{ content: [{ type: 'image', attachment: imageRef('owned') }] }],
        route: { provider: 'deepseek', model: 'deepseek-v4', inputModalities: ['text'] },
      },
      routePolicy: 'any',
      fetchImpl,
      sleep: async () => {},
    })
    const result = await controller.edit({ prompt: 'blue', imageIds: ['image:owned'] })
    expect(result.operation).toBe('edit')
    expect(result.references.map(ref => String(ref.attachmentId))).toEqual(['owned'])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(CODEX_IMAGE_EDIT_URL)
    expect(attachments.readImage).toHaveBeenCalledOnce()
    expect(attachments.saveImage).toHaveBeenCalledOnce()
  })

  it('keeps the codex-capable gate when routePolicy is codex-capable or absent', async () => {
    const fetchImpl = mockFetch()
    const base = {
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments: memoryAttachments(),
      session: {
        deriveMessages: () => [],
        route: { provider: 'openai', inputModalities: ['image'] },
      },
      fetchImpl,
    }
    const explicit = createCodexImageController({ ...base, routePolicy: 'codex-capable' })
    const absent = createCodexImageController(base)
    await expect(explicit.generate({ prompt: 'nope' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(absent.generate({ prompt: 'nope' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an empty, oversized, or unknown-shaped request', async () => {
    const fetchImpl = mockFetch()
    const controller = imageController(fetchImpl)
    await expect(controller.generate({ prompt: '   ' })).rejects.toThrow(/non-empty prompt/)
    await expect(controller.generate({ prompt: 'x'.repeat(4001) })).rejects.toThrow(/4000 characters or fewer/)
    await expect(controller.generate({ prompt: 'ok', n: 0 })).rejects.toThrow(/integer from 1 through 4/)
    await expect(controller.generate({ prompt: 'ok', n: 5 })).rejects.toThrow(/integer from 1 through 4/)
    await expect(controller.generate({ prompt: 'ok', size: 'huge' as never })).rejects.toThrow(/size must be one of/)
    await expect(controller.generate({ prompt: 'ok', quality: 'ultra' as never })).rejects.toThrow(
      /quality must be one of/,
    )
    await expect(controller.generate({ prompt: 'ok', background: 'plaid' as never })).rejects.toThrow(
      /background must be one of/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the explicit count, size, quality and background choices', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    const controller = imageController(fetchImpl)
    await controller.generate({
      prompt: 'two',
      n: 2,
      size: '1536x1024',
      quality: 'high',
      background: 'transparent',
    })
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ n: 2, size: '1536x1024', quality: 'high', background: 'transparent' })
  })

  it('enforces the deployment image-count and byte limits on an edit', async () => {
    const fetchImpl = mockFetch()
    const attachments = memoryAttachments()
    const session = {
      deriveMessages: () => [
        {
          content: [
            { type: 'image', attachment: imageRef('a') },
            { type: 'image', attachment: imageRef('b') },
          ],
        },
      ],
      route: { provider: 'codex-oauth', inputModalities: ['image'] },
    }
    const countLimited = imageController(fetchImpl, {
      attachments: { ...attachments, imageLimits: { ...attachments.imageLimits, maxImagesPerMessage: 1 } },
      session,
    })
    await expect(countLimited.edit({ prompt: 'x', imageIds: ['a', 'b'] })).rejects.toThrow(/image-count limit/)

    const byteLimited = imageController(fetchImpl, {
      attachments: { ...attachments, imageLimits: { ...attachments.imageLimits, maxMessageImageBytes: 8 } },
      session,
    })
    await expect(byteLimited.edit({ prompt: 'x', imageIds: ['a'] })).rejects.toThrow(/total image-byte limit/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a response without a data array', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { created: 1 }))
    await expect(imageController(fetchImpl).generate({ prompt: 'x' })).rejects.toMatchObject({ code: 'SERVER' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('warns instead of saving past the deployment image-count limit', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }],
      }),
    )
    const attachments = memoryAttachments()
    const controller = imageController(fetchImpl, {
      attachments: { ...attachments, imageLimits: { ...attachments.imageLimits, maxImagesPerMessage: 1 } },
    })
    const result = await controller.generate({ prompt: 'x' })
    expect(result.images).toHaveLength(1)
    expect(result.warnings).toEqual([
      {
        index: 1,
        code: 'IMAGE_POLICY_REJECTED',
        message: 'The item exceeded the deployment image-count limit.',
      },
    ])
  })

  it('warns instead of saving an item past the deployment total byte limit', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }],
      }),
    )
    const attachments = memoryAttachments()
    const controller = imageController(fetchImpl, {
      attachments: { ...attachments, imageLimits: { ...attachments.imageLimits, maxMessageImageBytes: 70 } },
    })
    const result = await controller.generate({ prompt: 'x' })
    expect(result.images).toHaveLength(1)
    expect(result.warnings).toEqual([
      {
        index: 1,
        code: 'IMAGE_POLICY_REJECTED',
        message: 'The item exceeded the deployment total image-byte limit.',
      },
    ])
  })

  it('warns instead of saving an item that is not a supported raster image', async () => {
    const generated = (b64: string) =>
      jsonResponse(200, { data: [{ b64_json: b64 }, { b64_json: PNG.toString('base64') }] })
    const notAnImage = imageController(
      mockFetch(async () => generated(Buffer.from('not an image at all').toString('base64'))),
    )
    const first = await notAnImage.generate({ prompt: 'x' })
    expect(first.images).toHaveLength(1)
    expect(first.warnings).toEqual([
      {
        index: 0,
        code: 'IMAGE_MEDIA_INVALID',
        message: 'The decoded item was not a supported raster image.',
      },
    ])

    const attachments = memoryAttachments()
    const pngOnly = imageController(
      mockFetch(async () => generated(Buffer.from('GIF89a').toString('base64'))),
      { attachments: { ...attachments, imageLimits: { ...attachments.imageLimits, mediaTypes: ['image/png'] } } },
    )
    const second = await pngOnly.generate({ prompt: 'x' })
    expect(second.images).toHaveLength(1)
    expect(second.warnings).toEqual([
      {
        index: 0,
        code: 'IMAGE_MEDIA_INVALID',
        message: 'The decoded item was not a supported raster image.',
      },
    ])
  })

  it('warns instead of saving an image the deployment media policy rejects', async () => {
    const attachments = memoryAttachments()
    attachments.validateImage.mockRejectedValueOnce(new Error('policy says no'))
    const controller = imageController(
      mockFetch(async () =>
        jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }] }),
      ),
      { attachments },
    )
    const result = await controller.generate({ prompt: 'x' })
    expect(result.images).toHaveLength(1)
    expect(attachments.saveImage).toHaveBeenCalledOnce()
    expect(result.warnings).toEqual([
      {
        index: 0,
        code: 'IMAGE_POLICY_REJECTED',
        message: 'The decoded image failed the deployment media policy.',
      },
    ])
  })

  it('defaults to the global fetch when no fetch and no client identity are given', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    vi.stubGlobal('fetch', fetchImpl)
    const controller = createCodexImageController({
      auth: {
        resolve: async () => ({ accessToken: jwtWithAccount('acct-img') }),
        invalidate: async () => {},
      },
      attachments: memoryAttachments(),
      session: { deriveMessages: () => [], route: { provider: 'codex-oauth', inputModalities: ['image'] } },
    })
    const result = await controller.generate({ prompt: 'global fetch' })
    expect(result.images).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('names a saved jpeg with the jpg extension and sends the client identity', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { data: [{ b64_json: Buffer.from(jpeg).toString('base64') }] }),
    )
    const attachments = memoryAttachments()
    const store = {
      ...attachments,
      saveImage: vi.fn(async (input: SaveImageAttachment) => {
        expect(input.mediaType).toBe('image/jpeg')
        return imageRef('saved-jpeg')
      }),
    }
    const controller = imageController(fetchImpl, {
      attachments: store,
      originator: 'dsh-image-test',
      userAgent: 'dsh-image-test',
      now: () => 1_700_000_000_000,
    })
    const result = await controller.generate({ prompt: 'jpeg' })
    expect(result.images.map(ref => String(ref.attachmentId))).toEqual(['saved-jpeg'])
    expect(store.saveImage.mock.calls[0]?.[0].name).toBe('codex-image-1700000000000-1.jpg')
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(headers.get('originator')).toBe('dsh-image-test')
    expect(headers.get('user-agent')).toBe('dsh-image-test')
  })

  it('forwards the caller abort signal into the image request', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(200, { data: [{ b64_json: PNG.toString('base64') }] }))
    const controller = imageController(fetchImpl)
    const abort = new AbortController()
    await controller.generate({ prompt: 'with signal' }, abort.signal)
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    abort.abort()
    await expect(controller.generate({ prompt: 'aborted' }, abort.signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
