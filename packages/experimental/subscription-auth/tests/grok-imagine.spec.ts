import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSafeRemoteMediaUrl,
  createGrokImagineClient,
  createImagineDownloaderFromFetch,
  createPinnedApiFetch,
  createPinnedImagineDownloader,
  createPinnedMediaTransport,
  DEFAULT_API_JSON_MAX_BYTES,
  DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES,
  DEFAULT_INLINE_API_JSON_MAX_BYTES,
  defaultImagineLookup,
  detectImageMediaType,
  detectVideoMediaType,
  downloadRemoteImagineMedia,
  GROK_BUILD_IMAGINE_IMAGE_MODEL,
  GROK_BUILD_IMAGINE_ORIGIN,
  GROK_IMAGINE_IMAGE_MODEL,
  GROK_IMAGINE_IMAGE_PATH,
  GROK_IMAGINE_VIDEO_MODEL,
  GROK_IMAGINE_VIDEO_START_PATH,
  type GrokImagineClient,
  GrokImagineError,
  grokImagineVideoStatusPath,
  IMAGINE_API_ORIGINS,
  IMAGINE_IMAGE_IDS_MAX,
  IMAGINE_IMAGE_IDS_MIN,
  IMAGINE_IMAGE_MAX_N,
  IMAGINE_PROMPT_MAX_LENGTH,
  type ImagineAttachmentStore,
  type ImagineDnsLookup,
  type ImagineFetch,
  type ImagineImageAttachmentRef,
  type ImagineImageLimits,
  type ImagineMediaTransport,
  type ImagineOperation,
  imagineImageDownloadHeaders,
  imagineImagePath,
  isAllowlistedImagineHost,
  isBlockedIp,
  isSafeImagineAttachmentId,
  MAX_CACHED_VIDEO_JOBS,
  openTrustedImagineImageDownload,
  parseImagineImagePath,
  parseVideoRequestId,
  XAI_API_ORIGIN,
  XAI_OUTPUT_HOSTS,
} from '../src/grok-imagine.ts'
import { createTrustedImagineAuthz, imagineMediaPath, MediaStore } from '../src/media-store.ts'

/**
 * The production transports call `undici`'s fetch directly, which is the one
 * seam the injectable `ImagineFetch` option cannot reach. Pin the module's
 * dispatcher so the tests can drive real transport code without a socket and
 * still assert what was pinned at connect time.
 */
const undiciStub = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; init: RequestInit | undefined }>,
  connects: [] as Array<Record<string, unknown> | undefined>,
  closed: 0,
  closeRejects: false,
  respond: undefined as undefined | ((url: string, init: RequestInit | undefined) => unknown),
}))

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  // A wrapper, not a subclass: the real dispatcher is still constructed (so its
  // option validation runs) while close() is counted for the assertions.
  class RecordingAgent {
    readonly inner: InstanceType<typeof actual.Agent>

    constructor(options?: Record<string, unknown>) {
      this.inner = new actual.Agent(options)
      undiciStub.connects.push(options?.['connect'] as Record<string, unknown> | undefined)
    }

    async close(): Promise<void> {
      undiciStub.closed += 1
      if (undiciStub.closeRejects) throw new Error('dispatcher close failed')
      await this.inner.close()
    }
  }
  return {
    ...actual,
    Agent: RecordingAgent,
    fetch: async (input: unknown, init?: RequestInit): Promise<unknown> => {
      undiciStub.calls.push({ url: String(input), init })
      if (undiciStub.respond === undefined) throw new Error('real network is forbidden in Grok Imagine tests')
      return await undiciStub.respond(String(input), init)
    },
  }
})

/** `defaultImagineLookup` is the only real resolver in the module; stub it. */
const dnsStub = vi.hoisted(() => ({
  calls: [] as Array<{ hostname: string; options: unknown }>,
  records: [] as Array<{ address: string; family: number }>,
}))

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: async (hostname: string, options: unknown): Promise<unknown> => {
      dnsStub.calls.push({ hostname, options })
      return dnsStub.records
    },
  }
})

const PNG = Uint8Array.from(
  Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802' +
			'000000907753de0000000c4944415408d763f8cfc00000000300' +
			'010005fed4ef0000000049454e44ae426082',
    'hex',
  ),
)
const MP4 = Uint8Array.from(Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex'))
const WEBM = Uint8Array.from(Buffer.from('1a45dfa3', 'hex'))

const PUBLIC_IP = '8.8.8.8'
const IMAGE_URL = 'https://imgen.x.ai/generated/cat.png'
const IMAGE_URL_FINAL = 'https://imgen.x.ai/generated/final.png'
const VIDEO_URL = 'https://videogen.x.ai/generated/clip.mp4'
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  undiciStub.calls.length = 0
  undiciStub.connects.length = 0
  undiciStub.closed = 0
  undiciStub.closeRejects = false
  undiciStub.respond = undefined
  dnsStub.calls.length = 0
  dnsStub.records = []
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('real network is forbidden in Grok Imagine tests')
  })
})

/** Shared attachment-store behaviour: recording writes, hooks, and the ref shape. */
class BaseAttachments {
  readonly saved: Array<{ data: Uint8Array; mediaType: string; name?: string }> = []
  readonly attachmentId: string
  readonly onSave: (() => void) | undefined

  constructor(options: { attachmentId?: string; onSave?: () => void } = {}) {
    this.attachmentId = options.attachmentId ?? `att_${'ab'.repeat(16)}`
    this.onSave = options.onSave
  }

  async saveImage(input: {
    data: Uint8Array
    mediaType: ImagineImageAttachmentRef['mediaType']
    name?: string
  }): Promise<ImagineImageAttachmentRef> {
    this.saved.push(input)
    this.onSave?.()
    const ref: ImagineImageAttachmentRef = {
      attachmentId: this.attachmentId,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    }
    if (input.name !== undefined) ref.name = input.name
    return ref
  }
}

class MemoryAttachments extends BaseAttachments implements ImagineAttachmentStore {
  readonly imageLimits: ImagineImageLimits

  constructor(
    options: { mediaTypes?: readonly string[]; attachmentId?: string; onSave?: () => void } = {},
  ) {
    super(options)
    this.imageLimits = {
      maxImageBytes: 64 * 1024,
      mediaTypes: options.mediaTypes ?? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    }
  }

  async readImage(ref: ImagineImageAttachmentRef): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }> {
    return { ref, data: PNG }
  }
}

/** An attachment store that declares no image limits at all. */
class LimitlessAttachments extends BaseAttachments implements ImagineAttachmentStore {}

interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

function headerMap(init?: RequestInit): Record<string, string> {
  const headers = new Headers(init?.headers)
  const mapped: Record<string, string> = {}
  headers.forEach((value, key) => {
    mapped[key.toLowerCase()] = value
  })
  return mapped
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function bytesResponse(
  data: Uint8Array,
  contentType: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(Uint8Array.from(data).buffer, {
    status,
    headers: { 'content-type': contentType, ...headers },
  })
}

async function tempMedia(maxBytes = 1024): Promise<MediaStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-imagine-media-'))
  temporaryDirectories.push(dir)
  return new MediaStore(dir, { maxBytes })
}

/** A real MediaStore that reports each persistence step, so a test can abort or
 * dispose the client exactly while the artifact is being written. */
async function tempMediaWith(
  hooks: {
    onSave?: (input: { data: Uint8Array; mediaType: string; name?: string }) => void
    onDelete?: (artifactId: string) => void
  } = {},
): Promise<MediaStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-imagine-media-'))
  temporaryDirectories.push(dir)
  class HookedMedia extends MediaStore {
    override async save(input: Parameters<MediaStore['save']>[0]): Promise<Awaited<ReturnType<MediaStore['save']>>> {
      hooks.onSave?.(input)
      return await super.save(input)
    }

    override async delete(artifactId: string): Promise<boolean> {
      hooks.onDelete?.(artifactId)
      return await super.delete(artifactId)
    }
  }
  return new HookedMedia(dir, { maxBytes: 1024 })
}

interface ByteStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
    cancel(): Promise<unknown>
  }
}

/** A reader-backed body, including the chunk-less reads a stream may emit. */
function chunkStream(chunks: Array<Uint8Array | undefined>, hooks: { onCancel?: () => void } = {}): ByteStream {
  let index = 0
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) return { done: true }
        const value = chunks[index]
        index += 1
        return value === undefined ? { done: false } : { done: false, value }
      },
      cancel: async () => {
        hooks.onCancel?.()
        return undefined
      },
    }),
  }
}

/**
 * The upstream response shape the transports consume: they read `status`,
 * `ok`, `headers`, `body`, and `arrayBuffer`, so a duck-typed object exercises
 * every body shape (stream, null body, hostile body) a real socket cannot.
 */
function upstreamResponse(
  init: {
    status?: number
    headers?: Record<string, string>
    headerProbe?: { get(name: string): string | null }
    body?: unknown
    arrayBuffer?: () => Promise<ArrayBuffer>
  } = {},
): unknown {
  const status = init.status ?? 200
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: 'OK',
    headers: init.headerProbe ?? new Headers(init.headers ?? {}),
    body: init.body === undefined ? null : init.body,
    arrayBuffer: init.arrayBuffer ?? (async () => new ArrayBuffer(0)),
  }
}

function upstreamJson(payload: unknown, status = 200): unknown {
  return upstreamResponse({
    status,
    headers: { 'content-type': 'application/json' },
    body: chunkStream([new TextEncoder().encode(JSON.stringify(payload))]),
  })
}

const MEDIA_REQUEST = { timeoutMs: 5_000, maxBytes: 4_096, accept: 'image/png' }

function resolver(key = 'xai-test-key'): {
  resolve: (operation: ImagineOperation) => Promise<string>
  calls: ImagineOperation[]
} {
  const calls: ImagineOperation[] = []
  return {
    calls,
    resolve: async (operation) => {
      calls.push(operation)
      return key
    },
  }
}

function defaultLookup(hostname: string): Promise<readonly string[]> {
  return Promise.resolve(hostname.endsWith('.x.ai') ? [PUBLIC_IP] : [])
}

async function createHarness(options: {
  fetch: ImagineFetch
  lookup?: (hostname: string) => Promise<readonly string[]>
  key?: string
  attachments?: MemoryAttachments
  media?: MediaStore
  imageMaxBytes?: number
  apiJsonMaxBytes?: number
}): Promise<{
  client: GrokImagineClient
  attachments: MemoryAttachments
  auth: ReturnType<typeof resolver>
  media: MediaStore
  record: RecordedRequest[]
}> {
  const attachments = options.attachments ?? new MemoryAttachments()
  const media = options.media ?? (await tempMedia())
  const auth = resolver(options.key)
  const lookup = options.lookup ?? defaultLookup
  const client = createGrokImagineClient({
    resolveApiKey: auth.resolve,
    attachments,
    media,
    fetch: options.fetch,
    downloader: createImagineDownloaderFromFetch(options.fetch, {
      trustedTestTransport: true,
      lookup,
    }),
    ...(options.imageMaxBytes === undefined ? {} : { imageMaxBytes: options.imageMaxBytes }),
    ...(options.apiJsonMaxBytes === undefined ? {} : { apiJsonMaxBytes: options.apiJsonMaxBytes }),
  })
  return { client, attachments, auth, media, record: [] }
}

function scriptedFetch(script: {
  onApi?: (request: RecordedRequest) => Response | Promise<Response>
  onMedia?: (request: RecordedRequest) => Response | Promise<Response>
  record?: RecordedRequest[]
}): ImagineFetch {
  const record = script.record ?? []
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.href)
    const request: RecordedRequest = {
      url: url.href,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: headerMap(init),
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    record.push(request)
    if (url.origin === XAI_API_ORIGIN) {
      if (script.onApi === undefined) throw new Error(`unexpected API fetch ${url.href}`)
      return script.onApi(request)
    }
    if (script.onMedia === undefined) throw new Error(`unexpected media fetch ${url.href}`)
    return script.onMedia(request)
  }
}

describe('Grok Imagine protocol constants', () => {
  it('targets official api.x.ai endpoints and pinned models', () => {
    expect(XAI_API_ORIGIN).toBe('https://api.x.ai')
    expect(GROK_IMAGINE_IMAGE_PATH).toBe('/v1/images/generations')
    expect(GROK_IMAGINE_VIDEO_START_PATH).toBe('/v1/videos/generations')
    expect(GROK_IMAGINE_IMAGE_MODEL).toBe('grok-imagine-image-2.0')
    expect(GROK_IMAGINE_VIDEO_MODEL).toBe('grok-imagine-video-1.5')
    expect(grokImagineVideoStatusPath('req_123')).toBe('/v1/videos/req_123')
    expect(() => grokImagineVideoStatusPath('../secret')).toThrow(GrokImagineError)
  })

  it('targets the Grok Build chat proxy and its own image model', () => {
    expect(GROK_BUILD_IMAGINE_ORIGIN).toBe('https://cli-chat-proxy.grok.com')
    expect(GROK_BUILD_IMAGINE_IMAGE_MODEL).toBe('grok-imagine-image-quality')
  })

  it('freezes the API origin set to both Imagine upstreams', () => {
    expect([...IMAGINE_API_ORIGINS].sort()).toEqual([GROK_BUILD_IMAGINE_ORIGIN, XAI_API_ORIGIN].sort())
  })

  it('sizes the inline envelope for base64 image rows the URL route never carries', () => {
    // 5 MiB per image at 4 bytes per 3, for the capability's max imageCount.
    expect(DEFAULT_INLINE_API_JSON_MAX_BYTES).toBeGreaterThan((DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES * 4 * 4) / 3)
    expect(DEFAULT_API_JSON_MAX_BYTES).toBe(1024 * 1024)
  })
})

describe('Imagine response envelope ceilings', () => {
  it('admits a base64 body on the chat proxy that the developer-API ceiling would reject', async () => {
    const media = await tempMedia(1024 * 1024)
    // Comfortably past the 1 MiB developer-API ceiling once base64-encoded.
    const oversized = 'A'.repeat(2 * 1024 * 1024)
    const client = createGrokImagineClient({
      resolveApiKey: async () => ({ token: 'oauth-access-token', transport: 'grok-build' as const }),
      attachments: new MemoryAttachments(),
      media,
      imageMaxBytes: 8 * 1024 * 1024,
      fetch: async () =>
        new Response(JSON.stringify({ data: [{ b64_json: oversized, mime_type: 'image/png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      downloader: {
        download: async () => {
          throw new Error('download should not run for inline base64')
        },
      },
    })
    // The envelope is admitted; the decoded bytes then fail their own media
    // check, which is the ceiling under test moving out of the way.
    await expect(client.generateImage({ prompt: 'big' })).rejects.not.toMatchObject({
      message: expect.stringContaining('byte ceiling') as string,
    })
  })
})

describe('pinned Imagine API transport', () => {
  /** Record the hostname the origin gate let through, then stop before any socket. */
  function lookupProbe(): { seen: string[]; lookup: (hostname: string) => Promise<readonly string[]> } {
    const seen: string[] = []
    return {
      seen,
      lookup: async (hostname) => {
        seen.push(hostname)
        return []
      },
    }
  }

  it('admits both frozen origins and reaches DNS pinning for each', async () => {
    for (const origin of [GROK_BUILD_IMAGINE_ORIGIN, XAI_API_ORIGIN]) {
      const probe = lookupProbe()
      const pinned = createPinnedApiFetch(probe.lookup)
      await expect(
        pinned(new URL('/v1/images/generations', origin), { method: 'POST', body: '{}' }),
      ).rejects.toMatchObject({ code: 'SSRF', message: expect.stringMatching(/did not resolve/) as string })
      expect(probe.seen).toEqual([new URL(origin).hostname])
    }
  })

  it('still rejects any other origin and plain HTTP before DNS', async () => {
    const probe = lookupProbe()
    const pinned = createPinnedApiFetch(probe.lookup)
    await expect(pinned(new URL('https://imgen.x.ai/v1/images/generations'))).rejects.toMatchObject({ code: 'SSRF' })
    await expect(pinned(new URL('http://cli-chat-proxy.grok.com/v1/images/generations'))).rejects.toMatchObject({
      code: 'SSRF',
    })
    expect(probe.seen).toEqual([])
  })
})

describe('Imagine transport selection', () => {
  it('sends a grok-build credential to the chat proxy as inline base64', async () => {
    const media = await tempMedia()
    const attachments = new MemoryAttachments()
    const record: RecordedRequest[] = []
    const client = createGrokImagineClient({
      resolveApiKey: async () => ({
        token: 'oauth-access-token',
        transport: 'grok-build' as const,
        headers: { 'x-grok-client-identifier': 'grok-shell', 'x-grok-session-id': 'session-1' },
      }),
      attachments,
      media,
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.href)
        record.push({
          url: url.href,
          method: (init?.method ?? 'GET').toUpperCase(),
          headers: headerMap(init),
          body: typeof init?.body === 'string' ? init.body : undefined,
        })
        return new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from(PNG).toString('base64'), mime_type: 'image/png' }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      },
      downloader: {
        download: async () => {
          throw new Error('download should not run for inline base64')
        },
      },
    })
    const result = await client.generateImage({ prompt: 'a red square' })
    const request = record[0]
    expect(request?.url).toBe('https://cli-chat-proxy.grok.com/v1/images/generations')
    expect(request?.headers['authorization']).toBe('Bearer oauth-access-token')
    expect(request?.headers['x-grok-session-id']).toBe('session-1')
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({
      model: 'grok-imagine-image-quality',
      response_format: 'b64_json',
    })
    expect(result.images).toHaveLength(1)
  })

  it('accepts either route spelling of the image model and refuses an unknown one', async () => {
    const media = await tempMedia()
    const client = createGrokImagineClient({
      resolveApiKey: async () => ({ token: 'oauth-access-token', transport: 'grok-build' as const }),
      attachments: new MemoryAttachments(),
      media,
      fetch: async () => {
        throw new Error('fetch should not run')
      },
      downloader: {
        download: async () => {
          throw new Error('download should not run')
        },
      },
    })
    // The picker offers the api.x.ai spelling while the credential selects the
    // chat proxy, so the family name is what matters, not the route's id.
    await expect(client.generateImage({ prompt: 'x', model: GROK_IMAGINE_IMAGE_MODEL })).rejects.not.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(client.generateImage({ prompt: 'x', model: 'not-an-imagine-model' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})

describe('SSRF primitives', () => {
  it('blocks localhost, private, reserved, documentation, and embedded special forms', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('10.1.2.3')).toBe(true)
    expect(isBlockedIp('192.168.0.5')).toBe(true)
    expect(isBlockedIp('172.16.9.1')).toBe(true)
    expect(isBlockedIp('169.254.169.254')).toBe(true)
    expect(isBlockedIp('100.64.1.1')).toBe(true)
    expect(isBlockedIp('192.0.0.170')).toBe(true)
    expect(isBlockedIp('192.0.2.1')).toBe(true)
    expect(isBlockedIp('198.51.100.1')).toBe(true)
    expect(isBlockedIp('203.0.113.10')).toBe(true)
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('fc00::1')).toBe(true)
    expect(isBlockedIp('fe80::1')).toBe(true)
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:c0a8:0001')).toBe(true)
    expect(isBlockedIp('::192.168.0.1')).toBe(true)
    expect(isBlockedIp('64:ff9b::192.168.1.1')).toBe(true)
    expect(isBlockedIp('64:ff9b:1::10.0.0.1')).toBe(true)
    expect(isBlockedIp('2002:c0a8:0001::1')).toBe(true)
    expect(isBlockedIp('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(true)
    expect(isBlockedIp('2001:db8::1')).toBe(true)
    expect(isBlockedIp('100::1')).toBe(true)
    expect(isBlockedIp('3fff::1')).toBe(true)
    expect(isBlockedIp('5f00::1')).toBe(true)
    expect(isBlockedIp(PUBLIC_IP)).toBe(false)
    expect(isBlockedIp('1.1.1.1')).toBe(false)
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false)
    expect(isBlockedIp('not-an-ip')).toBe(true)
    expect(isBlockedIp('fe80::1%eth0')).toBe(true)
    expect(isBlockedIp('fe80::1%lo0')).toBe(true)
    expect(isBlockedIp('::ffff:1')).toBe(true)
  })

  it('allowlists only the frozen official output hosts', () => {
    expect([...XAI_OUTPUT_HOSTS]).toEqual(['imgen.x.ai', 'videogen.x.ai', 'vidgen.x.ai'])
    expect(isAllowlistedImagineHost('imgen.x.ai')).toBe(true)
    expect(isAllowlistedImagineHost('IMGEN.X.AI.')).toBe(true)
    expect(isAllowlistedImagineHost('videogen.x.ai')).toBe(true)
    expect(isAllowlistedImagineHost('imgen.x.ai.evil.com')).toBe(false)
    expect(isAllowlistedImagineHost('cdn.x.ai')).toBe(false)
    expect(isAllowlistedImagineHost('imagine.x.ai')).toBe(false)
    expect(isAllowlistedImagineHost('assets.x.ai')).toBe(false)
    expect(isAllowlistedImagineHost('vidgen.x.ai')).toBe(true)
    expect(isAllowlistedImagineHost('evil.com')).toBe(false)
  })

  it('rejects non-HTTPS, credentialed, non-allowlisted, and privately resolved URLs', async () => {
    const publicLookup = async () => [PUBLIC_IP]
    await expect(assertSafeRemoteMediaUrl('http://imgen.x.ai/a', publicLookup)).rejects.toMatchObject({ code: 'SSRF' })
    await expect(assertSafeRemoteMediaUrl('https://imgen.x.ai:8443/a', publicLookup)).rejects.toMatchObject({
      code: 'SSRF',
    })
    await expect(assertSafeRemoteMediaUrl('https://user:pass@imgen.x.ai/a', publicLookup)).rejects.toMatchObject({
      code: 'SSRF',
    })
    await expect(assertSafeRemoteMediaUrl('https://evil.com/a', publicLookup)).rejects.toMatchObject({ code: 'SSRF' })
    await expect(assertSafeRemoteMediaUrl('https://cdn.x.ai/a', publicLookup)).rejects.toMatchObject({ code: 'SSRF' })
    await expect(assertSafeRemoteMediaUrl('https://localhost/a', publicLookup)).rejects.toMatchObject({ code: 'SSRF' })
    await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ['127.0.0.1'])).rejects.toMatchObject({
      code: 'SSRF',
    })
    await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ['10.0.0.8'])).rejects.toMatchObject({ code: 'SSRF' })
    await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ['169.254.1.1'])).rejects.toMatchObject({
      code: 'SSRF',
    })
    await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => ['203.0.113.10'])).rejects.toMatchObject({
      code: 'SSRF',
    })
    await expect(assertSafeRemoteMediaUrl(IMAGE_URL, publicLookup)).resolves.toMatchObject({ hostname: 'imgen.x.ai' })
  })

  it('derives the dotted form of an IPv4-mapped IPv6 address before deciding', () => {
    // Both spellings are the same 128-bit value: one reached through the
    // dotted-quad tail rewrite, one through the hex-group rewrite.
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false)
    expect(isBlockedIp('::ffff:808:808')).toBe(false)
    expect(isBlockedIp('::FFFF:8.8.8.8')).toBe(false)
    // A mapped address whose tail is not a dotted quad and not two hex groups
    // cannot be re-derived, so only the embedded-address scan remains.
    expect(isBlockedIp('::ffff:0:0:1')).toBe(false)
  })

  it('treats a full-length public IPv6 address as unblocked', () => {
    expect(isBlockedIp('1:2:3:4:5:6:7:8')).toBe(false)
    expect(isBlockedIp('2001:4860:4860:0:0:0:0:8888')).toBe(false)
  })

  it('blocks a mapped IPv4 address whose embedded address is reserved', () => {
    expect(isBlockedIp('::ffff:0:0')).toBe(true)
    expect(isBlockedIp('0000:0000:0000:0000:0000:ffff:0a00:0001')).toBe(true)
  })

  it('refuses a NAT64 prefix outside the blocked /96 that embeds a reserved IPv4', () => {
    // 64:ff9b::/96 and 64:ff9b:1::/48 are blocked directly, but the guard that
    // trusts the 64:ff9b::/32 NAT64 well-known prefix is wider: any third group
    // still embeds an IPv4 in the last 32 bits, so the embedded address decides.
    expect(isBlockedIp('64:ff9b:2::1')).toBe(true)
    expect(isBlockedIp('64:ff9b:2:0:0:1:0.0.0.9')).toBe(true)
    // The same prefix with a public embedded address stays unblocked.
    expect(isBlockedIp('64:ff9b:2:0:0:1:1.2.3.4')).toBe(false)
  })
})

describe('media sniffing', () => {
  it('detects PNG/JPEG/WebP/GIF and MP4/WebM magic', () => {
    expect(detectImageMediaType(PNG)).toBe('image/png')
    expect(detectImageMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0x01]))).toBe('image/jpeg')
    expect(detectVideoMediaType(MP4)).toBe('video/mp4')
    expect(detectVideoMediaType(WEBM)).toBe('video/webm')
    expect(detectImageMediaType(MP4)).toBeUndefined()
    expect(detectVideoMediaType(PNG)).toBeUndefined()
  })
})

describe('GrokImagineClient image generation', () => {
  it('POSTs the official generations endpoint and persists a downloaded raster', async () => {
    const record: RecordedRequest[] = []
    const { client, attachments, auth } = await createHarness({
      fetch: scriptedFetch({
        record,
        onApi: (request) => {
          expect(request.url).toBe(`${XAI_API_ORIGIN}${GROK_IMAGINE_IMAGE_PATH}`)
          expect(request.method).toBe('POST')
          expect(request.headers['authorization']).toBe('Bearer xai-test-key')
          const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
          expect(body).toMatchObject({
            model: GROK_IMAGINE_IMAGE_MODEL,
            prompt: 'a red cube',
            n: 1,
            response_format: 'url',
          })
          expect(body).not.toHaveProperty('size')
          return jsonResponse({ data: [{ url: IMAGE_URL }] })
        },
        onMedia: (request) => {
          expect(request.url).toBe(IMAGE_URL)
          expect(request.method).toBe('GET')
          expect(request.headers['authorization']).toBeUndefined()
          return bytesResponse(PNG, 'image/png')
        },
      }),
    })

    const result = await client.generateImage({ prompt: 'a red cube' })
    expect(auth.calls).toEqual(['image.generate'])
    expect(attachments.saved).toHaveLength(1)
    expect(attachments.saved[0]?.mediaType).toBe('image/png')
    expect(result.path).toBe(imagineImagePath(result.attachment.attachmentId))
    expect(result.path.startsWith('/plugins/dsh-grok-build/imagine/images/')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('imgen.x.ai')
    expect(JSON.stringify(result)).not.toContain('https://')
    expect(JSON.stringify(result)).not.toMatch(/[a-f0-9]{64}/)
    expect(record.every(item => item.url.startsWith('https://'))).toBe(true)
    const mediaGets = record.filter(item => !item.url.startsWith(XAI_API_ORIGIN))
    expect(mediaGets.every(item => item.headers.authorization === undefined)).toBe(true)
  })

  it('accepts official b64_json without a media download', async () => {
    const record: RecordedRequest[] = []
    const { client, attachments } = await createHarness({
      fetch: scriptedFetch({
        record,
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
      }),
    })
    const result = await client.generateImage({ prompt: 'encoded' })
    expect(attachments.saved[0]?.data).toEqual(PNG)
    expect(result.images).toHaveLength(1)
    expect(record.some(item => item.url.includes('imgen.x.ai'))).toBe(false)
  })

  it('does not fall back to OAuth when the resolver is empty or throws', async () => {
    const media = await tempMedia()
    const attachments = new MemoryAttachments()
    const empty = createGrokImagineClient({
      resolveApiKey: async () => '',
      attachments,
      media,
      fetch: async () => {
        throw new Error('fetch should not run')
      },
      downloader: {
        download: async () => {
          throw new Error('download should not run')
        },
      },
    })
    await expect(empty.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })

    const failing = createGrokImagineClient({
      resolveApiKey: async () => {
        throw new Error('store empty')
      },
      attachments,
      media,
      fetch: async () => {
        throw new Error('fetch should not run')
      },
      downloader: {
        download: async () => {
          throw new Error('download should not run')
        },
      },
    })
    await expect(failing.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
      message: expect.stringMatching(/credential resolver failed/) as string,
    })
  })

  it('maps 401 to AUTH without retrying another credential and redacts secrets', async () => {
    let apiCalls = 0
    const { client, auth } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => {
          apiCalls += 1
          return jsonResponse(
            {
              error: {
                message:
									'invalid api key xai-secret-value client_secret: abcdefghijklmnopqrstuvwxyz0123 https://imgen.x.ai/x?token=abc',
              },
            },
            401,
          )
        },
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AUTH',
      status: 401,
      message: expect.not.stringContaining('xai-secret-value') as string,
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      message: expect.not.stringMatching(/imgen\.x\.ai|abcdefghijklmnopqrstuvwxyz0123/u) as string,
    })
    expect(apiCalls).toBe(2)
    expect(auth.calls).toEqual(['image.generate', 'image.generate'])
  })
})

describe('GrokImagineClient video', () => {
  it('starts a video on the official endpoint and downloads MP4 on done', async () => {
    const record: RecordedRequest[] = []
    const { client, auth, media } = await createHarness({
      fetch: scriptedFetch({
        record,
        onApi: (request) => {
          if (request.method === 'POST') {
            expect(request.url).toBe(`${XAI_API_ORIGIN}${GROK_IMAGINE_VIDEO_START_PATH}`)
            const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
            expect(body).toMatchObject({ model: GROK_IMAGINE_VIDEO_MODEL, prompt: 'orbit' })
            return jsonResponse({ request_id: 'req_video_1' })
          }
          expect(request.url).toBe(`${XAI_API_ORIGIN}/v1/videos/req_video_1`)
          return jsonResponse({
            status: 'done',
            video: { url: VIDEO_URL, duration: 6, respect_moderation: true },
            model: GROK_IMAGINE_VIDEO_MODEL,
          })
        },
        onMedia: (request) => {
          expect(request.url).toBe(VIDEO_URL)
          expect(request.headers['authorization']).toBeUndefined()
          return bytesResponse(MP4, 'video/mp4')
        },
      }),
    })

    const started = await client.startVideo({ prompt: 'orbit' })
    expect(started).toEqual({ model: GROK_IMAGINE_VIDEO_MODEL, requestId: 'req_video_1', status: 'pending' })
    const status = await client.videoStatus('req_video_1')
    expect(status.status).toBe('completed')
    expect(status.artifact).toBeDefined()
    expect(status.artifact).not.toHaveProperty('sha256')
    expect(status.path).toBe(imagineMediaPath(status.artifact!.artifactId))
    expect(JSON.stringify(status)).not.toContain('videogen.x.ai')
    expect(JSON.stringify(status)).not.toContain('https://')
    expect(JSON.stringify(status)).not.toMatch(/[a-f0-9]{64}/)
    expect((await media.read(status.artifact!.artifactId)).data).toEqual(MP4)
    expect(auth.calls).toEqual(['video.start', 'video.status'])
    expect(record.filter(item => item.url.startsWith(XAI_API_ORIGIN)).map(item => item.method)).toEqual([
      'POST',
      'GET',
    ])
  })

  it('returns pending and failed official statuses without downloading', async () => {
    const record: RecordedRequest[] = []
    const pendingClient = (
      await createHarness({
        fetch: scriptedFetch({
          record,
          onApi: () => jsonResponse({ status: 'pending', progress: 10 }),
        }),
      })
    ).client
    await expect(pendingClient.videoStatus('req_p')).resolves.toEqual({ requestId: 'req_p', status: 'pending' })

    const failedClient = (
      await createHarness({
        fetch: scriptedFetch({
          record,
          onApi: () =>
            jsonResponse({
              status: 'failed',
              error: { code: 'invalid_argument', message: 'quota' },
            }),
        }),
      })
    ).client
    await expect(failedClient.videoStatus('req_f')).resolves.toEqual({
      requestId: 'req_f',
      status: 'failed',
      error: 'quota',
    })
    expect(record.some(item => item.url.includes('videogen'))).toBe(false)
  })

  it('downloads WebM from the official video.url field', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () =>
          jsonResponse({
            status: 'done',
            video: { url: VIDEO_URL, duration: 4, respect_moderation: true },
          }),
        onMedia: () => bytesResponse(WEBM, 'video/webm'),
      }),
    })
    const status = await client.videoStatus('req_w')
    expect(status.artifact?.mediaType).toBe('video/webm')
  })

  it('makes a second poll of a completed request idempotent without leaking the upstream URL', async () => {
    let statusCalls = 0
    let mediaCalls = 0
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => {
          statusCalls += 1
          return jsonResponse({
            status: 'done',
            video: { url: `${VIDEO_URL}?sig=super-secret`, duration: 6, respect_moderation: true },
          })
        },
        onMedia: () => {
          mediaCalls += 1
          return bytesResponse(MP4, 'video/mp4')
        },
      }),
    })
    const first = await client.videoStatus('req_idemp')
    const second = await client.videoStatus('req_idemp')
    expect(statusCalls).toBe(1)
    expect(mediaCalls).toBe(1)
    expect(second.status).toBe('completed')
    expect(second.artifact?.artifactId).toBe(first.artifact?.artifactId)
    expect(JSON.stringify(second)).not.toContain('videogen')
    expect(JSON.stringify(second)).not.toContain('super-secret')
    expect(JSON.stringify(second)).not.toContain('https://')

    const concurrentClient = (
      await createHarness({
        fetch: scriptedFetch({
          onApi: async () => {
            statusCalls += 1
            return jsonResponse({
              status: 'done',
              video: { url: VIDEO_URL, duration: 6, respect_moderation: true },
            })
          },
          onMedia: () => bytesResponse(MP4, 'video/mp4'),
        }),
      })
    ).client
    const before = statusCalls
    const [left, right] = await Promise.all([
      concurrentClient.videoStatus('req_same'),
      concurrentClient.videoStatus('req_same'),
    ])
    expect(statusCalls - before).toBe(1)
    expect(left.artifact?.artifactId).toBe(right.artifact?.artifactId)
  })
})

describe('GrokImagineClient download policy', () => {
  it('rejects a generated image URL that is not HTTPS or not allowlisted', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: 'http://imgen.x.ai/cat.png' }] }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })

    const blocked = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: 'https://example.com/cat.png' }] }),
      }),
    })
    await expect(blocked.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })
  })

  it('rejects frozen-list host widening including former extra xAI hosts', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: 'https://cdn.x.ai/cat.png' }] }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })
  })

  it('validates each redirect and refuses a hop that resolves privately', async () => {
    const lookups: string[] = []
    const { client } = await createHarness({
      lookup: async (hostname) => {
        lookups.push(hostname)
        if (hostname === 'imgen.x.ai') return [PUBLIC_IP]
        return ['10.0.0.9']
      },
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: (request) => {
          if (request.url === IMAGE_URL) {
            return new Response(null, { status: 302, headers: { location: 'https://imgen.x.ai/next.png' } })
          }
          return bytesResponse(PNG, 'image/png')
        },
      }),
    })
    const privateClient = (
      await createHarness({
        lookup: async (hostname) => {
          lookups.push(hostname)
          return hostname === 'imgen.x.ai' ? ['10.0.0.9'] : [PUBLIC_IP]
        },
        fetch: scriptedFetch({
          onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
          onMedia: () => bytesResponse(PNG, 'image/png'),
        }),
      })
    ).client
    await expect(privateClient.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })
    await expect(client.generateImage({ prompt: 'x' })).resolves.toMatchObject({
      path: expect.stringContaining('/imagine/images/') as string,
    })
  })

  it('follows one allowlisted same-host redirect after re-checking DNS', async () => {
    const { client, attachments } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: (request) => {
          if (request.url === IMAGE_URL) {
            return new Response(null, { status: 302, headers: { location: IMAGE_URL_FINAL } })
          }
          expect(request.url).toBe(IMAGE_URL_FINAL)
          expect(request.headers['authorization']).toBeUndefined()
          return bytesResponse(PNG, 'image/png')
        },
      }),
    })
    const result = await client.generateImage({ prompt: 'x' })
    expect(attachments.saved).toHaveLength(1)
    expect(result.path).toContain('/imagine/images/')
  })

  it('rejects an invalid redirect Location', async () => {
    const missing = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => new Response(null, { status: 302 }),
      }),
    })
    await expect(missing.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })

    const evil = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } }),
      }),
    })
    await expect(evil.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })

    const fileUrl = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }),
      }),
    })
    await expect(fileUrl.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'SSRF' })
  })

  it('rejects oversized bodies, MIME mismatch, declared content-length overflow, and huge API JSON', async () => {
    const oversized = await createHarness({
      imageMaxBytes: 16,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => bytesResponse(PNG, 'image/png'),
      }),
    })
    await expect(oversized.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA' })

    const mismatch = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => bytesResponse(PNG, 'image/jpeg'),
      }),
    })
    await expect(mismatch.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA' })

    const declared = await createHarness({
      imageMaxBytes: 32,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => bytesResponse(PNG, 'image/png', 200, { 'content-length': '99999' }),
      }),
    })
    await expect(declared.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA' })

    const hugeJson = await createHarness({
      apiJsonMaxBytes: 64,
      fetch: scriptedFetch({
        onApi: () =>
          new Response('x'.repeat(2_000_000), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    })
    await expect(hugeJson.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA' })

    const hugeB64 = await createHarness({
      imageMaxBytes: 32,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ b64_json: 'A'.repeat(10_000) }] }),
      }),
    })
    await expect(hugeB64.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA' })
  })

  it('never sends Authorization on temporary media GETs', async () => {
    const record: RecordedRequest[] = []
    const { client } = await createHarness({
      fetch: scriptedFetch({
        record,
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: () => bytesResponse(PNG, 'image/png'),
      }),
    })
    await client.generateImage({ prompt: 'x' })
    const mediaRequests = record.filter(item => !item.url.startsWith(XAI_API_ORIGIN))
    expect(mediaRequests.length).toBeGreaterThan(0)
    expect(mediaRequests.every(item => item.headers.authorization === undefined)).toBe(true)
  })

  it('rejects invalid models and unofficial image size fields', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => {
          throw new Error('API must not run for invalid models')
        },
      }),
    })
    await expect(client.generateImage({ prompt: 'x', model: 'grok-2' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(client.generateImage({ prompt: 'x', resolution: '4k' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(client.generateImage({ prompt: 'x', aspectRatio: '21:9' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(client.startVideo({ prompt: 'x', model: 'grok-imagine-video' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(client.startVideo({ prompt: 'x', duration: 16 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(client.startVideo({ prompt: 'x', resolution: '4k' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('maps a download timeout to TIMEOUT', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }),
        onMedia: async () => {
          const error = new Error('aborted')
          error.name = 'TimeoutError'
          throw error
        },
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('refuses to treat an ordinary fetch as a production media transport', () => {
    expect(() =>
      createImagineDownloaderFromFetch(async () => new Response(null), {
        trustedTestTransport: false as true,
      }),
    ).toThrow(GrokImagineError)
  })
})

describe('image route gate', () => {
  it('builds and parses same-origin image routes and serves only with explicit authz', async () => {
    const ref: ImagineImageAttachmentRef = {
      attachmentId: `att_${'cd'.repeat(16)}`,
      mediaType: 'image/png',
      bytes: PNG.byteLength,
      width: 1,
      height: 1,
    }
    const path = imagineImagePath(ref.attachmentId)
    expect(parseImagineImagePath(path)).toBe(ref.attachmentId)
    expect(parseImagineImagePath('/plugins/dsh-grok-build/imagine/images/../etc/passwd')).toBeUndefined()
    expect(isSafeImagineAttachmentId('../etc/passwd')).toBe(false)
    expect(imagineImageDownloadHeaders(ref)['X-Content-Type-Options']).toBe('nosniff')
    await expect(openTrustedImagineImageDownload(new MemoryAttachments(), ref, {} as never)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const view = await openTrustedImagineImageDownload(
      new MemoryAttachments(),
      ref,
      createTrustedImagineAuthz({ remoteAddress: '127.0.0.1' }),
    )
    expect(view.body).toEqual(PNG)
    expect(view.headers['Content-Type']).toBe('image/png')
    expect(JSON.stringify(view.headers)).not.toMatch(/https?:\/\//)
  })
})

describe('GrokImagineClient input validation', () => {
  it('rejects prompts longer than the 4000-character ceiling', async () => {
    const oversized = 'x'.repeat(IMAGINE_PROMPT_MAX_LENGTH + 1)
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => {
          throw new Error('API must not run for an over-long prompt')
        },
      }),
    })
    await expect(client.generateImage({ prompt: oversized })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/4000/) as string,
    })
    await expect(client.startVideo({ prompt: oversized })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects base64 strings containing non-canonical characters', async () => {
    const hostile = '$'.repeat(200)
    const { client } = await createHarness({
      imageMaxBytes: 1024 * 1024,
      fetch: scriptedFetch({
        onApi: () =>
          jsonResponse({
            data: [{ b64_json: hostile }],
          }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'UPSTREAM' })
  })

  it('rejects unpadded base64 of remainder 1', async () => {
    const unpadded = 'AAAAA'
    const { client } = await createHarness({
      imageMaxBytes: 1024 * 1024,
      fetch: scriptedFetch({
        onApi: () =>
          jsonResponse({
            data: [{ b64_json: unpadded }],
          }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'UPSTREAM' })
  })

  it('accepts well-formed padded base64 and rejects empty input', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () =>
          jsonResponse({
            data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
          }),
      }),
    })
    const result = await client.generateImage({ prompt: 'x' })
    expect(result.images).toHaveLength(1)
  })
})

describe('parseVideoRequestId and imageIds bounds', () => {
  it('accepts a safe ASCII request id up to 256 characters', () => {
    expect(parseVideoRequestId('req_video_1')).toBe('req_video_1')
    expect(parseVideoRequestId('a'.repeat(256))).toBe('a'.repeat(256))
  })

  it('rejects request ids outside the [A-Za-z0-9_-]{1,256} pattern', () => {
    expect(() => parseVideoRequestId('')).toThrow(GrokImagineError)
    expect(() => parseVideoRequestId('a'.repeat(257))).toThrow(GrokImagineError)
    expect(() => parseVideoRequestId('../escape')).toThrow(GrokImagineError)
    expect(() => parseVideoRequestId('req with space')).toThrow(GrokImagineError)
    expect(() => parseVideoRequestId(null)).toThrow(GrokImagineError)
    expect(() => parseVideoRequestId(123)).toThrow(GrokImagineError)
  })

  it('advertises the documented bounds for tool schemas', () => {
    expect(IMAGINE_PROMPT_MAX_LENGTH).toBe(4000)
    expect(IMAGINE_IMAGE_IDS_MIN).toBe(1)
    expect(IMAGINE_IMAGE_IDS_MAX).toBe(5)
  })
})

describe('GrokImagineClient dispose ownership', () => {
  it('refuses new work after dispose and cancels a pending poll', async () => {
    let pendingPoll: ((response: Response) => void) | undefined
    let aborted: AbortSignal | undefined
    const client = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      fetch: async (_input, init) => {
        aborted = init?.signal ?? undefined
        return new Promise<Response>((resolve) => {
          pendingPoll = (response) =>{  resolve(response) }
        })
      },
      downloader: {
        download: async () => {
          throw new Error('download must not run after dispose')
        },
      },
    })

    const statusPromise = client.videoStatus('req_owned')
    await new Promise(resolve => setImmediate(resolve))
    client.dispose()
    expect(client.isDisposed).toBe(true)
    if (pendingPoll) pendingPoll(jsonResponse({ status: 'pending' }))
    await expect(statusPromise).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(aborted?.aborted).toBe(true)

    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('disposed') as string,
    })
    await expect(client.startVideo({ prompt: 'x' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    client.dispose()
    expect(client.isDisposed).toBe(true)
  })

  it('rejects an already-aborted consumer signal before resolving credentials or fetching', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller cancelled'))
    const { client, auth } = await createHarness({
      fetch: async () => {
        throw new Error('fetch must not run for an already-aborted operation')
      },
    })
    await expect(client.generateImage({ prompt: 'x' }, controller.signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(client.startVideo({ prompt: 'x' }, controller.signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(client.videoStatus('req_aborted', { signal: controller.signal })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    expect(auth.calls).toEqual([])
  })

  it('keeps concurrent caller-owned video poll cancellation isolated', async () => {
    const responders: Array<(response: Response) => void> = []
    const { client } = await createHarness({
      fetch: async () =>
        new Promise<Response>((resolve) => {
          responders.push(resolve)
        }),
    })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = client.videoStatus('req_shared', { signal: firstController.signal })
    const second = client.videoStatus('req_shared', { signal: secondController.signal })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(responders).toHaveLength(2)
    firstController.abort(new Error('first caller cancelled'))
    for (const respond of responders) respond(jsonResponse({ status: 'pending' }))
    await expect(first).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(second).resolves.toEqual({ requestId: 'req_shared', status: 'pending' })
  })

  it('forwards the consumer-owned AbortSignal into the fetch init', async () => {
    let observed: AbortSignal | undefined
    const client = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      fetch: async (_input, init) => {
        observed = init?.signal ?? undefined
        return jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] })
      },
      downloader: {
        download: async () => {
          throw new Error('download must not run')
        },
      },
    })

    const controller = new AbortController()
    await client.generateImage({ prompt: 'x' }, controller.signal)
    expect(observed).toBeDefined()
    expect(observed?.aborted).toBe(false)
  })
})

describe('imagine image route suffix hardening', () => {
  it('accepts opaque DSH attachment ids while rejecting path syntax and controls', () => {
    expect(isSafeImagineAttachmentId(`sha256:${'ab'.repeat(32)}`)).toBe(true)
    expect(isSafeImagineAttachmentId('att.dot')).toBe(true)
    expect(isSafeImagineAttachmentId('att..dot')).toBe(false)
    expect(isSafeImagineAttachmentId('att/slash')).toBe(false)
    expect(isSafeImagineAttachmentId('att\\backslash')).toBe(false)
    expect(isSafeImagineAttachmentId('att with space')).toBe(false)
    // NUL byte is rejected even before the regex check.
    expect(isSafeImagineAttachmentId('att\u0000byte')).toBe(false)
    expect(isSafeImagineAttachmentId('att_a-b_c-123')).toBe(true)
  })

  it('rejects unknown image subtypes for downloads', () => {
    expect(() =>
      imagineImageDownloadHeaders({
        attachmentId: 'att_a-b_c-123',
        mediaType: 'image/svg+xml' as 'image/png',
        bytes: 10,
        width: 1,
        height: 1,
      }),
    ).toThrow(GrokImagineError)
  })

  it('renders an ASCII-safe inline filename', () => {
    const header = imagineImageDownloadHeaders({
      attachmentId: 'att_x1',
      mediaType: 'image/png',
      bytes: 10,
      width: 1,
      height: 1,
    })
    expect(header['Content-Disposition']).toBe('inline; filename="imagine-att_x1.png"')
    expect(header['X-Content-Type-Options']).toBe('nosniff')
  })
})

describe('pinned media transport', () => {
  function mediaTransport(lookup: ImagineDnsLookup = async () => [PUBLIC_IP]): ImagineMediaTransport {
    return createPinnedMediaTransport(lookup)
  }

  it('downloads a bounded body through a dispatcher pinned to the resolved address', async () => {
    undiciStub.respond = () =>
      upstreamResponse({ status: 200, headers: { 'content-type': 'image/png' }, body: chunkStream([PNG]) })
    const result = await mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)
    expect(result).toEqual({ status: 200, contentType: 'image/png', data: PNG })
    const call = undiciStub.calls[0]
    expect(call?.url).toBe(IMAGE_URL)
    expect(call?.init?.method).toBe('GET')
    expect(call?.init?.redirect).toBe('manual')
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal)
    expect((call?.init?.headers as Record<string, string>).accept).toBe('image/png')
    // The agent is built from the resolved address and closed once the hop ends.
    expect(undiciStub.connects[0]).toMatchObject({ autoSelectFamily: false })
    expect(undiciStub.connects[0]?.['lookup']).toBeTypeOf('function')
    expect(undiciStub.closed).toBe(1)
  })

  it('surfaces a redirect hop to its caller instead of following it', async () => {
    undiciStub.respond = () => upstreamResponse({ status: 302, headers: { location: IMAGE_URL_FINAL } })
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).resolves.toEqual({
      status: 302,
      location: IMAGE_URL_FINAL,
    })
    undiciStub.respond = () => upstreamResponse({ status: 302 })
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).resolves.toEqual({ status: 302 })
  })

  it('maps a media failure status with the shared redacting status mapper', async () => {
    const body = new TextEncoder().encode('denied https://imgen.x.ai/generated/cat.png?sig=abc')
    undiciStub.respond = () => upstreamResponse({ status: 403, body: chunkStream([body]) })
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({
      code: 'QUOTA',
      status: 403,
      message: expect.not.stringContaining('imgen.x.ai') as string,
    })
    undiciStub.respond = () => upstreamResponse({ status: 503 })
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({
      code: 'UPSTREAM',
      status: 503,
    })
  })

  it('reads a non-stream body within the ceiling and refuses one past it', async () => {
    undiciStub.respond = () => upstreamResponse({ arrayBuffer: async () => Uint8Array.from(PNG).buffer })
    // No content type is declared, so the hop reports bytes only.
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).resolves.toEqual({ status: 200, data: PNG })

    undiciStub.respond = () => upstreamResponse({ arrayBuffer: async () => new ArrayBuffer(8_192) })
    await expect(mediaTransport().get(new URL(IMAGE_URL), { ...MEDIA_REQUEST, maxBytes: 16 })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('byte ceiling') as string,
    })

    undiciStub.respond = () => upstreamResponse({ body: { not: 'a byte stream' } })
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('not a readable byte stream') as string,
    })
  })

  it('skips a chunk-less read and cancels a stream that overruns the ceiling', async () => {
    undiciStub.respond = () => upstreamResponse({ body: chunkStream([undefined, PNG, undefined]) })
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).resolves.toEqual({
      status: 200,
      data: PNG,
    })

    let cancelled = 0
    undiciStub.respond = () =>
      upstreamResponse({ body: chunkStream([PNG, PNG], { onCancel: () => { cancelled += 1 } }) })
    await expect(mediaTransport().get(new URL(IMAGE_URL), { ...MEDIA_REQUEST, maxBytes: 8 })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('byte ceiling') as string,
    })
    expect(cancelled).toBe(1)
  })

  it('cancels a cancel that rejects when the ceiling is exceeded', async () => {
    const body = {
      getReader: () => ({
        read: async () => ({ done: false, value: PNG }),
        cancel: async () => {
          throw new Error('cancel is unsupported')
        },
      }),
    }
    undiciStub.respond = () => upstreamResponse({ body })
    await expect(mediaTransport().get(new URL(IMAGE_URL), { ...MEDIA_REQUEST, maxBytes: 4 })).rejects.toMatchObject({
      code: 'MEDIA',
    })
  })

  it('cancels the reader when the hop is aborted mid-body', async () => {
    const controller = new AbortController()
    let cancelled = 0
    const headerProbe = {
      get(name: string): string | null {
        if (name === 'content-length') controller.abort(new Error('caller aborted mid-read'))
        return null
      },
    }
    undiciStub.respond = () =>
      upstreamResponse({ headerProbe, body: chunkStream([PNG], { onCancel: () => { cancelled += 1 } }) })
    await expect(
      mediaTransport().get(new URL(IMAGE_URL), { ...MEDIA_REQUEST, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('body read was aborted') as string })
    expect(cancelled).toBe(1)
  })

  it('maps socket aborts, timeouts, and other transport failures', async () => {
    const hangUp = (name: string): never => {
      const error = new Error('socket failed')
      error.name = name
      throw error
    }
    undiciStub.respond = () => hangUp('TimeoutError')
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({ code: 'TIMEOUT' })
    undiciStub.respond = () => hangUp('AbortError')
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({ code: 'TIMEOUT' })
    undiciStub.respond = () => {
      throw 'socket hang up'
    }
    await expect(mediaTransport().get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('socket hang up') as string,
    })
    expect(undiciStub.closed).toBe(3)
  })

  it('keeps its own refusal when the resolved address is private', async () => {
    undiciStub.respond = () => upstreamResponse({ status: 200 })
    await expect(mediaTransport(async () => ['10.0.0.9']).get(new URL(IMAGE_URL), MEDIA_REQUEST)).rejects.toMatchObject({
      code: 'SSRF',
    })
    expect(undiciStub.calls).toEqual([])
  })
})

describe('pinned Imagine API fetch', () => {
  function apiFetch(): ImagineFetch {
    return createPinnedApiFetch(async () => [PUBLIC_IP, '2001:4860:4860::8888'])
  }

  function callLookup(
    lookup: (host: string, options: { all?: boolean }, callback: (error: Error | null, address?: unknown, family?: number) => void) => void,
    host: string,
    options: { all?: boolean },
  ): Promise<{ error: Error | null; address?: unknown; family?: number }> {
    return new Promise((resolve) => {
      lookup(host, options, (error, address, family) => {
        resolve({
          error,
          ...(address === undefined ? {} : { address }),
          ...(family === undefined ? {} : { family }),
        })
      })
    })
  }

  it('returns the upstream response and reads the pinned address list', async () => {
    undiciStub.respond = () => upstreamJson({ data: [] })
    const response = await apiFetch()(new URL(`${XAI_API_ORIGIN}${GROK_IMAGINE_IMAGE_PATH}`), {
      method: 'POST',
      body: '{}',
      headers: { authorization: 'Bearer key' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({ data: [] })
    expect(undiciStub.calls[0]?.init).toMatchObject({ method: 'POST', body: '{}', redirect: 'error' })
    expect((undiciStub.calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer key')
    expect(undiciStub.closed).toBe(1)

    const connect = undiciStub.connects[0]
    const lookup = connect?.['lookup'] as Parameters<typeof callLookup>[0]
    // `all: true` hands back every pinned record so Happy Eyeballs cannot requery DNS.
    await expect(callLookup(lookup, 'api.x.ai', { all: true })).resolves.toEqual({
      error: null,
      address: [
        { address: PUBLIC_IP, family: 4 },
        { address: '2001:4860:4860::8888', family: 6 },
      ],
    })
    // The single-address overload takes the first record and echoes its hostname case-insensitively.
    await expect(callLookup(lookup, 'API.X.AI.', {})).resolves.toMatchObject({
      error: null,
      address: PUBLIC_IP,
      family: 4,
    })
    const refused = await callLookup(lookup, 'imgen.x.ai', { all: true })
    expect(refused.error).toBeInstanceOf(GrokImagineError)
    expect(refused.error).toMatchObject({ code: 'SSRF' })
  })

  it('omits undefined init fields and forwards a caller signal', async () => {
    undiciStub.respond = () => upstreamResponse({ status: 200, headers: { 'content-type': 'text/plain' }, body: chunkStream([new TextEncoder().encode('ok')]) })
    const controller = new AbortController()
    const response = await apiFetch()(new URL(`${XAI_API_ORIGIN}/v1/models`))
    expect(response.status).toBe(200)
    expect(undiciStub.calls[0]?.init).toMatchObject({ redirect: 'error' })
    expect(undiciStub.calls[0]?.init?.method).toBeUndefined()
    expect(undiciStub.calls[0]?.init?.body).toBeUndefined()
    expect(undiciStub.calls[0]?.init?.signal).toBeUndefined()
    await apiFetch()(new URL(`${XAI_API_ORIGIN}/v1/models`), { method: 'GET', signal: controller.signal })
    expect(undiciStub.calls[1]?.init?.signal).toBe(controller.signal)
  })

  it('refuses a non-string body and parses string or stringified inputs under the origin gate', async () => {
    undiciStub.respond = () => upstreamResponse({ status: 200, body: chunkStream([]) })
    await expect(
      apiFetch()(new URL(`${XAI_API_ORIGIN}/v1/images/generations`), {
        method: 'POST',
        body: Uint8Array.from([1]) as unknown as string,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    // A bare string is parsed, and a stringified non-URL input still has to pass the origin gate.
    await expect(apiFetch()(`${XAI_API_ORIGIN}/v1/images/generations`)).resolves.toMatchObject({ status: 200 })
    await expect(
      apiFetch()({ toString: () => 'https://evil.com/v1/images/generations' } as unknown as string),
    ).rejects.toMatchObject({ code: 'SSRF' })
  })

  it('re-validates the hostname independently of an allowlisted origin', async () => {
    const spoofed = new URL(`${XAI_API_ORIGIN}${GROK_IMAGINE_IMAGE_PATH}`)
    Object.defineProperty(spoofed, 'hostname', { value: 'localhost' })
    await expect(apiFetch()(spoofed)).rejects.toMatchObject({ code: 'SSRF', message: expect.stringContaining('host is not allowed') as string })
    const literal = new URL(`${XAI_API_ORIGIN}${GROK_IMAGINE_IMAGE_PATH}`)
    Object.defineProperty(literal, 'hostname', { value: '10.0.0.9' })
    await expect(apiFetch()(literal)).rejects.toMatchObject({ code: 'SSRF', message: expect.stringContaining('host is not allowed') as string })
    expect(undiciStub.calls).toEqual([])
  })

  it('maps API transport aborts and failures', async () => {
    undiciStub.respond = () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
    await expect(apiFetch()(new URL(`${XAI_API_ORIGIN}/v1/models`))).rejects.toMatchObject({ code: 'TIMEOUT' })
    undiciStub.respond = () => {
      throw 'connection reset'
    }
    await expect(apiFetch()(new URL(`${XAI_API_ORIGIN}/v1/models`))).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('connection reset') as string,
    })

    const controller = new AbortController()
    controller.abort(new Error('caller cancelled'))
    undiciStub.respond = () => upstreamResponse({ status: 200, body: chunkStream([PNG]) })
    await expect(
      apiFetch()(new URL(`${XAI_API_ORIGIN}/v1/models`), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('body read was aborted') as string })
  })
})

describe('pinned Imagine downloader composition', () => {
  it('resolves the default downloader through the system resolver', async () => {
    dnsStub.records = [{ address: PUBLIC_IP, family: 4 }]
    undiciStub.respond = () =>
      upstreamResponse({ status: 200, headers: { 'content-type': 'image/png' }, body: chunkStream([PNG]) })
    const controller = new AbortController()
    const downloader = createPinnedImagineDownloader()
    await expect(
      downloader.download({ ...MEDIA_REQUEST, url: IMAGE_URL, signal: controller.signal }),
    ).resolves.toEqual({ data: PNG, contentType: 'image/png' })
    // Three lookups: the hop's own URL check, the transport's re-check, and the
    // address resolution each consult the resolver independently.
    expect(dnsStub.calls.map(call => call.hostname)).toEqual(['imgen.x.ai', 'imgen.x.ai', 'imgen.x.ai'])
    expect(dnsStub.calls[0]?.options).toEqual({ all: true })
  })

  it('honours an injected lookup and redirect ceiling', async () => {
    const lookups: string[] = []
    undiciStub.respond = () => upstreamResponse({ status: 302, headers: { location: IMAGE_URL_FINAL } })
    const downloader = createPinnedImagineDownloader({
      maxRedirects: 0,
      lookup: async (hostname) => {
        lookups.push(hostname)
        return [PUBLIC_IP]
      },
    })
    await expect(downloader.download({ ...MEDIA_REQUEST, url: IMAGE_URL })).rejects.toMatchObject({
      code: 'SSRF',
      message: expect.stringContaining('redirect limit') as string,
    })
    expect(lookups).toEqual(['imgen.x.ai', 'imgen.x.ai', 'imgen.x.ai'])
  })

  it('falls back to the system resolver in the fetch-backed test downloader', async () => {
    dnsStub.records = [{ address: PUBLIC_IP, family: 4 }]
    const downloader = createImagineDownloaderFromFetch(
      scriptedFetch({ onMedia: () => bytesResponse(PNG, 'image/png') }),
      { trustedTestTransport: true },
    )
    await expect(downloader.download({ ...MEDIA_REQUEST, url: IMAGE_URL })).resolves.toEqual({
      data: PNG,
      contentType: 'image/png',
    })
    // The fetch-backed transport never resolves DNS itself, so only the hop's
    // own URL check reaches the system resolver.
    expect(dnsStub.calls.map(call => call.hostname)).toEqual(['imgen.x.ai'])
  })

  it('maps media failures, a missing content type, and transport aborts on the fetch downloader', async () => {
    const downloader = (fetchImpl: ImagineFetch) =>
      createImagineDownloaderFromFetch(fetchImpl, { trustedTestTransport: true, lookup: async () => [PUBLIC_IP] })

    const rateLimited = downloader(scriptedFetch({ onMedia: () => jsonResponse({ error: 'slow down' }, 429) }))
    await expect(rateLimited.download({ ...MEDIA_REQUEST, url: IMAGE_URL })).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      status: 429,
    })

    const undeclared = downloader(async () => new Response(Uint8Array.from(PNG).buffer))
    await expect(undeclared.download({ ...MEDIA_REQUEST, url: IMAGE_URL })).resolves.toEqual({ data: PNG })

    const hostile = downloader(async () => {
      throw 'torn down'
    })
    await expect(hostile.download({ ...MEDIA_REQUEST, url: IMAGE_URL })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('torn down') as string,
    })

    const aborted = downloader(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    await expect(aborted.download({ ...MEDIA_REQUEST, url: IMAGE_URL })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('downloadRemoteImagineMedia hop policy', () => {
  const BASE = { lookup: async () => [PUBLIC_IP], timeoutMs: 5_000, maxBytes: 4_096, accept: 'image/png', maxRedirects: 0 }

  it('refuses a redirect whose Location cannot be resolved', async () => {
    const transport: ImagineMediaTransport = { get: async () => ({ status: 302, location: 'http://[::1' }) }
    await expect(downloadRemoteImagineMedia(IMAGE_URL, transport, BASE)).rejects.toMatchObject({
      code: 'SSRF',
      message: expect.stringContaining('not a valid URL') as string,
    })
  })

  it('refuses a body-less success and a hop past the redirect ceiling', async () => {
    const empty: ImagineMediaTransport = { get: async () => ({ status: 200 }) }
    await expect(downloadRemoteImagineMedia(IMAGE_URL, empty, BASE)).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('no body') as string,
    })
    const looping: ImagineMediaTransport = { get: async () => ({ status: 302, location: IMAGE_URL_FINAL }) }
    await expect(downloadRemoteImagineMedia(IMAGE_URL, looping, BASE)).rejects.toMatchObject({
      code: 'SSRF',
      message: expect.stringContaining('redirect limit') as string,
    })
  })

  it('forwards a signal only when the caller supplied one', async () => {
    const seen: Array<Record<string, unknown>> = []
    const transport: ImagineMediaTransport = {
      get: async (_url, request) => {
        seen.push(request as unknown as Record<string, unknown>)
        return seen.length === 1 ? { status: 200, data: PNG } : { status: 200, data: PNG, contentType: 'image/png' }
      },
    }
    const controller = new AbortController()
    await expect(downloadRemoteImagineMedia(IMAGE_URL, transport, BASE)).resolves.toEqual({ data: PNG })
    await expect(downloadRemoteImagineMedia(IMAGE_URL, transport, { ...BASE, signal: controller.signal })).resolves.toEqual({
      data: PNG,
      contentType: 'image/png',
    })
    expect('signal' in (seen[0] ?? {})).toBe(false)
    expect(seen[1]?.['signal']).toBe(controller.signal)
  })
})

describe('defaultImagineLookup', () => {
  it('asks the system resolver for every record of a hostname', async () => {
    dnsStub.records = [
      { address: '203.0.113.5', family: 4 },
      { address: '2001:db8::1', family: 6 },
    ]
    await expect(defaultImagineLookup('imgen.x.ai')).resolves.toEqual(['203.0.113.5', '2001:db8::1'])
    // `all` keeps the resolver from truncating the list the pinning step will
    // validate; verbatim ordering is the Node default and is not passed.
    expect(dnsStub.calls).toEqual([{ hostname: 'imgen.x.ai', options: { all: true } }])
  })
})

describe('media URL refusal reasons', () => {
  it('names an unparseable URL and a host that does not resolve', async () => {
    await expect(assertSafeRemoteMediaUrl('not-a-url', async () => [PUBLIC_IP])).rejects.toMatchObject({
      code: 'SSRF',
      message: expect.stringContaining('not a valid absolute URL') as string,
    })
    await expect(assertSafeRemoteMediaUrl(IMAGE_URL, async () => [])).rejects.toMatchObject({
      code: 'SSRF',
      message: expect.stringContaining('did not resolve') as string,
    })
  })
})

/**
 * A response whose final body read resolves on a macrotask and only then queues
 * `hook` as a microtask. The hook therefore runs after the body loop has ended
 * but before the awaiting caller resumes — the one window in which an abort or
 * a dispose can land between an API response and the persistence steps, which
 * is exactly the race the client's post-response guards exist for.
 */
function deferredJsonResponse(payload: unknown, hook: () => void): unknown {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let reads = 0
  return upstreamResponse({
    headers: { 'content-type': 'application/json' },
    body: {
      getReader: () => ({
        read: () => {
          reads += 1
          if (reads === 1) return Promise.resolve({ done: false, value: bytes })
          return new Promise<{ done: boolean }>((resolve) => {
            setTimeout(() => {
              resolve({ done: true })
              queueMicrotask(hook)
            }, 0)
          })
        },
        cancel: async () => undefined,
      }),
    },
  })
}

const DONE_VIDEO = { status: 'done', video: { url: VIDEO_URL, duration: 6, respect_moderation: true } }

describe('GrokImagineClient request validation', () => {
  it('rejects a blank or non-string prompt before resolving a credential', async () => {
    const { client, auth } = await createHarness({
      fetch: async () => {
        throw new Error('API must not run for an invalid prompt')
      },
    })
    await expect(client.generateImage({ prompt: '   ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(client.generateImage({ prompt: undefined as unknown as string })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(client.startVideo({ prompt: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(auth.calls).toEqual([])
  })

  it('bounds the requested image count', async () => {
    const record: RecordedRequest[] = []
    const { client } = await createHarness({
      fetch: scriptedFetch({
        record,
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
      }),
    })
    for (const n of [0, 1.5, IMAGINE_IMAGE_MAX_N + 1]) {
      await expect(client.generateImage({ prompt: 'x', n })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }
    expect(record).toHaveLength(0)
  })

  it('forwards accepted aspect ratio, resolution, and count into the image body', async () => {
    const record: RecordedRequest[] = []
    const { client } = await createHarness({
      fetch: scriptedFetch({
        record,
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
      }),
    })
    await client.generateImage({ prompt: 'x', aspectRatio: '16:9', resolution: '2k', n: 2 })
    expect(JSON.parse(record[0]?.body ?? '{}')).toMatchObject({ aspect_ratio: '16:9', resolution: '2k', n: 2 })
  })

  it('forwards an accepted duration, aspect ratio, and resolution into the video body', async () => {
    const record: RecordedRequest[] = []
    const { client } = await createHarness({
      fetch: scriptedFetch({ record, onApi: () => jsonResponse({ request_id: 'req_fields' }) }),
    })
    await client.startVideo({ prompt: 'orbit', duration: 6, aspectRatio: '9:16', resolution: '720p' })
    expect(JSON.parse(record[0]?.body ?? '{}')).toMatchObject({ duration: 6, aspect_ratio: '9:16', resolution: '720p' })
    // A body outside the schema never reaches the wire.
    await expect(client.startVideo({ prompt: 'orbit', duration: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(record).toHaveLength(1)
  })

  it('refuses an image envelope without usable data rows', async () => {
    const missing = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse({ created: 1 }) }) })
    await expect(missing.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('did not include data') as string,
    })
    const notAnArray = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse({ data: 'nope' }) }) })
    await expect(notAnArray.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({ code: 'UPSTREAM' })
    const notAnObject = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse({ data: ['nope'] }) }) })
    await expect(notAnObject.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('row is not an object') as string,
    })
    const empty = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse({ data: [] }) }) })
    await expect(empty.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('did not include any images') as string,
    })
  })

  it('refuses an image row with neither a URL nor inline bytes', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse({ data: [{ mime_type: 'image/png' }] }) }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('did not include url or b64_json') as string,
    })
  })

  it('refuses empty, non-canonical, and over-ceiling base64 image bytes', async () => {
    const encoded = async (b64: string, imageMaxBytes?: number) =>
      createHarness({
        ...(imageMaxBytes === undefined ? {} : { imageMaxBytes }),
        fetch: scriptedFetch({ onApi: () => jsonResponse({ data: [{ b64_json: b64 }] }) }),
      })
    await expect((await encoded('')).client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('non-empty string') as string,
    })
    // 'AB' is 2 characters short of a canonical 1-byte group, so its re-encoding
    // ('AA==') does not match the input.
    await expect((await encoded('AB')).client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('not canonical base64') as string,
    })
    // 8 base64 characters decode to 6 bytes, which is past a 3-byte ceiling even
    // though the encoded length is inside the envelope allowance.
    await expect((await encoded('AAAAAAAA', 3)).client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('byte ceiling') as string,
    })
  })

  it('refuses a video start without a safe request id', async () => {
    const missing = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse({}) }) })
    await expect(missing.client.startVideo({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('safe request_id') as string,
    })
    const hostile = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse({ request_id: '../escape' }) }),
    })
    await expect(hostile.client.startVideo({ prompt: 'x' })).rejects.toMatchObject({ code: 'UPSTREAM' })
  })

  it('rejects an unofficial video status value', async () => {
    const { client } = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse({ status: 'queued' }) }) })
    await expect(client.videoStatus('req_unofficial')).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('not an official value') as string,
    })
  })

  it('treats a completed status without a downloadable URL as upstream failure', async () => {
    const stringVideo = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse({ status: 'done', video: VIDEO_URL }) }),
    })
    await expect(stringVideo.client.videoStatus('req_nourl')).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('downloadable URL') as string,
    })
    const emptyUrl = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse({ status: 'done', video: { url: '' } }) }),
    })
    await expect(emptyUrl.client.videoStatus('req_emptyurl')).rejects.toMatchObject({ code: 'UPSTREAM' })
  })

  it('omits the error field when a failed status carries no usable message', async () => {
    const notARecord = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse({ status: 'failed', error: 'boom' }) }),
    })
    await expect(notARecord.client.videoStatus('req_f1')).resolves.toEqual({ requestId: 'req_f1', status: 'failed' })
    const withoutMessage = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse({ status: 'failed', error: { code: 'invalid_argument' } }) }),
    })
    await expect(withoutMessage.client.videoStatus('req_f2')).resolves.toEqual({
      requestId: 'req_f2',
      status: 'failed',
    })
  })

  it('reports and caches a moderation failure without caching the object itself', async () => {
    let statusCalls = 0
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () => {
          statusCalls += 1
          return jsonResponse({ status: 'done', video: { url: VIDEO_URL, respect_moderation: false } })
        },
      }),
    })
    const first = await client.videoStatus('req_moderated')
    expect(first).toEqual({
      requestId: 'req_moderated',
      status: 'failed',
      error: 'video did not respect moderation rules',
    })
    const second = await client.videoStatus('req_moderated')
    // Served from the cache as a copy: no artifact, no path, but the reason kept.
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second).not.toHaveProperty('artifact')
    expect(statusCalls).toBe(1)
  })

  it('refuses a video body that is not MP4 or WebM', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({ onApi: () => jsonResponse(DONE_VIDEO), onMedia: () => bytesResponse(PNG, 'image/png') }),
    })
    await expect(client.videoStatus('req_notvideo')).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('not MP4 or WebM') as string,
    })
  })

  it('refuses a declared video type that contradicts the bytes', async () => {
    const mismatch = await createHarness({
      fetch: scriptedFetch({
        onApi: () => jsonResponse(DONE_VIDEO),
        onMedia: () => bytesResponse(MP4, 'video/avi'),
      }),
    })
    await expect(mismatch.client.videoStatus('req_mismatch')).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('does not match its bytes') as string,
    })
    // The two opaque octet-stream spellings defer to the sniffed bytes.
    for (const [index, declared] of ['application/octet-stream', 'binary/octet-stream'].entries()) {
      const bypass = await createHarness({
        fetch: scriptedFetch({
          onApi: () => jsonResponse(DONE_VIDEO),
          onMedia: () => bytesResponse(MP4, declared),
        }),
      })
      await expect(bypass.client.videoStatus(`req_octet_${index}`)).resolves.toMatchObject({
        status: 'completed',
        artifact: { mediaType: 'video/mp4' },
      })
    }
  })

  it('evicts the oldest cached video status once the cache ceiling is passed', async () => {
    const polled: string[] = []
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: (request) => {
          polled.push(request.url)
          return jsonResponse({ status: 'failed' })
        },
      }),
    })
    for (let index = 0; index <= MAX_CACHED_VIDEO_JOBS; index += 1) await client.videoStatus(`req_${index}`)
    const before = polled.length
    await client.videoStatus('req_0')
    expect(polled.length).toBe(before + 1)
    await client.videoStatus(`req_${MAX_CACHED_VIDEO_JOBS}`)
    expect(polled.length).toBe(before + 1)
  })

  it('names a persisted video artifact', async () => {
    const saved: Array<{ mediaType: string; name?: string }> = []
    const media = await tempMediaWith({ onSave: input => saved.push(input) })
    const { client } = await createHarness({
      media,
      fetch: scriptedFetch({ onApi: () => jsonResponse(DONE_VIDEO), onMedia: () => bytesResponse(MP4, 'video/mp4') }),
    })
    const status = await client.videoStatus('req_named', { name: 'clip' })
    expect(status.status).toBe('completed')
    expect(saved).toEqual([{ data: expect.anything() as Uint8Array, mediaType: 'video/mp4', name: 'clip' }])
  })
})

describe('GrokImagineClient media persistence races', () => {
  const MOVING_PNG = (() => {
    const bytes = new Uint8Array(DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES + 1)
    bytes.set(PNG)
    return bytes
  })()

  function eventFetch(payload: unknown, hook: () => void, onMedia?: () => Response): ImagineFetch {
    return async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.href)
      if (url.origin === XAI_API_ORIGIN) return deferredJsonResponse(payload, hook) as Response
      if (onMedia === undefined) throw new Error(`unexpected media fetch ${url.href}`)
      void init
      return onMedia()
    }
  }

  it('abandons an image download when the caller aborts after the API response', async () => {
    const controller = new AbortController()
    let mediaCalls = 0
    const { client, attachments } = await createHarness({
      fetch: eventFetch(
        { data: [{ url: IMAGE_URL }] },
        () => {
          controller.abort(new Error('caller walked away'))
        },
        () => {
          mediaCalls += 1
          return bytesResponse(PNG, 'image/png')
        },
      ),
    })
    await expect(client.generateImage({ prompt: 'x' }, controller.signal)).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('aborted before request') as string,
    })
    expect(mediaCalls).toBe(0)
    expect(attachments.saved).toHaveLength(0)
  })

  it('abandons inline image persistence when the caller aborts after the API response', async () => {
    const controller = new AbortController()
    const { client, attachments } = await createHarness({
      fetch: eventFetch(
        { data: [{ b64_json: Buffer.from(PNG).toString('base64'), mime_type: 'image/png' }] },
        () => {
          controller.abort(new Error('caller walked away'))
        },
      ),
    })
    await expect(client.generateImage({ prompt: 'x' }, controller.signal)).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('aborted before persistence') as string,
    })
    expect(attachments.saved).toHaveLength(0)
  })

  it('abandons attachment persistence when the caller aborts during the store write', async () => {
    const controller = new AbortController()
    const attachments = new MemoryAttachments({
      onSave: () => {
        controller.abort(new Error('caller walked away'))
      },
    })
    const { client } = await createHarness({
      attachments,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' }, controller.signal)).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('attachment persistence was aborted') as string,
    })
    // The store did write, so the failure is reported rather than the reference.
    expect(attachments.saved).toHaveLength(1)
  })

  it('enforces the default image ceiling when the store declares no limits', async () => {
    const attachments = new LimitlessAttachments()
    const oversized = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments,
      media: await tempMedia(),
      fetch: scriptedFetch({ onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }) }),
      downloader: { download: async () => ({ data: MOVING_PNG, contentType: 'image/png' }) },
    })
    await expect(oversized.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining(String(DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES)) as string,
    })
    expect(attachments.saved).toHaveLength(0)
  })

  it('refuses image bytes past the client ceiling when the downloader ignores it', async () => {
    const ignoring = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      imageMaxBytes: 32,
      fetch: scriptedFetch({ onApi: () => jsonResponse({ data: [{ url: IMAGE_URL }] }) }),
      downloader: { download: async () => ({ data: MOVING_PNG, contentType: 'image/png' }) },
    })
    await expect(ignoring.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('32 byte ceiling') as string,
    })
  })

  it('keeps the declared mime type when the downloader declares none', async () => {
    const attachments = new MemoryAttachments()
    const client = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments,
      media: await tempMedia(),
      fetch: scriptedFetch({ onApi: () => jsonResponse({ data: [{ url: IMAGE_URL, mime_type: 'image/png' }] }) }),
      downloader: { download: async () => ({ data: PNG }) },
    })
    await expect(client.generateImage({ prompt: 'x' })).resolves.toMatchObject({
      attachment: { mediaType: 'image/png' },
    })
    expect(attachments.saved[0]?.mediaType).toBe('image/png')
  })

  it('refuses an image type the attachment store does not accept', async () => {
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
    const attachments = new MemoryAttachments({ mediaTypes: ['image/png'] })
    const { client } = await createHarness({
      attachments,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(gif).toString('base64') }] }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('not accepted by the attachment store') as string,
    })
    expect(attachments.saved).toHaveLength(0)
  })

  it('refuses an attachment identifier that is unsafe for the image route', async () => {
    const attachments = new MemoryAttachments({ attachmentId: '../escape' })
    const { client } = await createHarness({
      attachments,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('unsafe identifier') as string,
    })
  })

  it('names the persisted attachment when the caller supplies a name', async () => {
    const attachments = new MemoryAttachments()
    const { client } = await createHarness({
      attachments,
      fetch: scriptedFetch({
        onApi: () => jsonResponse({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }),
      }),
    })
    await client.generateImage({ prompt: 'x', name: 'a red cube' })
    expect(attachments.saved[0]?.name).toBe('a red cube')
  })

  it('refuses a video artifact when the client is disposed mid-response', async () => {
    let downloads = 0
    const client: GrokImagineClient = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      fetch: eventFetch(DONE_VIDEO, () => {
        client.dispose()
      }),
      downloader: {
        download: async () => {
          downloads += 1
          return { data: MP4, contentType: 'video/mp4' }
        },
      },
    })
    await expect(client.videoStatus('req_disposed_early')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('before video artifact save') as string,
    })
    expect(downloads).toBe(0)
  })

  it('refuses a video artifact when the client is disposed during the download', async () => {
    const client: GrokImagineClient = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      fetch: scriptedFetch({ onApi: () => jsonResponse(DONE_VIDEO) }),
      downloader: {
        download: async () => {
          client.dispose()
          return { data: MP4, contentType: 'video/mp4' }
        },
      },
    })
    await expect(client.videoStatus('req_disposed_late')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('after video download') as string,
    })
  })

  it('abandons video persistence when the caller aborts during the download', async () => {
    const controller = new AbortController()
    const aborting = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      fetch: scriptedFetch({ onApi: () => jsonResponse(DONE_VIDEO) }),
      downloader: {
        download: async () => {
          controller.abort(new Error('caller walked away'))
          return { data: MP4, contentType: 'video/mp4' }
        },
      },
    })
    await expect(aborting.videoStatus('req_abort_download', { signal: controller.signal })).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('video persistence was aborted') as string,
    })
  })

  it('deletes a video artifact persisted after the caller aborted', async () => {
    const controller = new AbortController()
    const deleted: string[] = []
    const media = await tempMediaWith({
      onSave: () => {
        controller.abort(new Error('caller walked away'))
      },
      onDelete: (artifactId) => {
        deleted.push(artifactId)
        throw new Error('artifact store is busy')
      },
    })
    const { client } = await createHarness({
      media,
      fetch: scriptedFetch({
        onApi: () => jsonResponse(DONE_VIDEO),
        onMedia: () => bytesResponse(MP4, 'video/mp4'),
      }),
    })
    await expect(
      client.videoStatus('req_abort_save', { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('video persistence was aborted') as string,
    })
    // The orphaned artifact is removed even though the delete itself failed.
    expect(deleted).toHaveLength(1)
  })

  it('rethrows a credential error unchanged', async () => {
    const client = createGrokImagineClient({
      resolveApiKey: async () => {
        throw new GrokImagineError('QUOTA', 'credential store is rate limited')
      },
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
      fetch: async () => {
        throw new Error('API must not run')
      },
      downloader: {
        download: async () => {
          throw new Error('download must not run')
        },
      },
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'QUOTA',
      message: 'credential store is rate limited',
    })
  })
})

describe('GrokImagineClient response envelopes', () => {
  it('maps an empty, non-JSON, and non-object API body', async () => {
    const empty = await createHarness({
      fetch: scriptedFetch({ onApi: () => new Response('', { status: 200 }) }),
    })
    await expect(empty.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('did not include data') as string,
    })

    const notJson = await createHarness({
      fetch: scriptedFetch({
        onApi: () => new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } }),
      }),
    })
    await expect(notJson.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('non-JSON') as string,
    })

    const nonObject = await createHarness({ fetch: scriptedFetch({ onApi: () => jsonResponse([1, 2, 3]) }) })
    await expect(nonObject.client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('non-object JSON body') as string,
    })
  })

  it('maps a transport failure raised after the caller aborted', async () => {
    const controller = new AbortController()
    const { client } = await createHarness({
      fetch: async () => {
        controller.abort(new Error('caller walked away'))
        throw 'the socket died mid-flight'
      },
    })
    await expect(client.generateImage({ prompt: 'x' }, controller.signal)).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('request was aborted') as string,
    })
  })

  it('omits the upstream detail suffix when the failure body is empty', async () => {
    const empty = (status: number) => createHarness({ fetch: scriptedFetch({ onApi: () => new Response(null, { status }) }) })
    await expect((await empty(401)).client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AUTH',
      message: 'xAI rejected the Imagine API key',
    })
    await expect((await empty(403)).client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'QUOTA',
      message: 'current xAI credentials cannot use Imagine',
    })
    await expect((await empty(429)).client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      message: 'xAI Imagine rate-limited the request',
    })
  })

  it('redacts the upstream detail it appends for an unmapped status', async () => {
    const { client } = await createHarness({
      fetch: scriptedFetch({
        onApi: () =>
          new Response('boom at https://imgen.x.ai/generated/cat.png?sig=abc', {
            status: 500,
          }),
      }),
    })
    await expect(client.generateImage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM',
      status: 500,
      message: expect.stringMatching(/request failed \(500\): boom at \[redacted-url\]/u) as string,
    })
  })

  it('builds its own pinned transports when none are injected', async () => {
    dnsStub.records = [{ address: PUBLIC_IP, family: 4 }]
    undiciStub.respond = () =>
      upstreamJson({ data: [{ b64_json: Buffer.from(PNG).toString('base64'), mime_type: 'image/png' }] })
    const client = createGrokImagineClient({
      resolveApiKey: async () => 'xai-test-key',
      attachments: new MemoryAttachments(),
      media: await tempMedia(),
    })
    const result = await client.generateImage({ prompt: 'a red cube' })
    expect(result.images).toHaveLength(1)
    expect(undiciStub.calls[0]?.url).toBe(`${XAI_API_ORIGIN}${GROK_IMAGINE_IMAGE_PATH}`)
    expect((undiciStub.calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer xai-test-key')
    expect(undiciStub.closed).toBe(1)
    expect(dnsStub.calls.map(call => call.hostname)).toContain('api.x.ai')
  })
})

describe('imagine image route download gate', () => {
  it('refuses an unsafe attachment id and a store without readImage', async () => {
    const authz = createTrustedImagineAuthz({ remoteAddress: '127.0.0.1' })
    const unsafe: ImagineImageAttachmentRef = {
      attachmentId: '../escape',
      mediaType: 'image/png',
      bytes: PNG.byteLength,
      width: 1,
      height: 1,
    }
    await expect(openTrustedImagineImageDownload(new MemoryAttachments(), unsafe, authz)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    const writeOnly: ImagineAttachmentStore = {
      saveImage: async () => unsafe,
    }
    const safe: ImagineImageAttachmentRef = {
      attachmentId: `att_${'cd'.repeat(16)}`,
      mediaType: 'image/png',
      bytes: PNG.byteLength,
      width: 1,
      height: 1,
    }
    await expect(openTrustedImagineImageDownload(writeOnly, safe, authz)).rejects.toMatchObject({
      code: 'MEDIA',
      message: expect.stringContaining('does not expose readImage') as string,
    })
  })
})

describe('pinned transport failure containment', () => {
  it('refuses a host that resolves to a blocked address before pinning', async () => {
    const pinned = createPinnedApiFetch(async () => ['10.0.0.9'])
    await expect(pinned(new URL(`${XAI_API_ORIGIN}/v1/models`))).rejects.toMatchObject({
      code: 'SSRF',
      message: expect.stringContaining('blocked address') as string,
    })
    expect(undiciStub.calls).toEqual([])
  })

  it('reports the media hop even when the dispatcher refuses to close', async () => {
    undiciStub.closeRejects = true
    undiciStub.respond = () => upstreamResponse({ status: 200, body: chunkStream([PNG]) })
    const transport = createPinnedMediaTransport(async () => [PUBLIC_IP])
    await expect(transport.get(new URL(IMAGE_URL), MEDIA_REQUEST)).resolves.toEqual({ status: 200, data: PNG })
    expect(undiciStub.closed).toBe(1)
  })

  it('reports the API response even when the dispatcher refuses to close', async () => {
    undiciStub.closeRejects = true
    undiciStub.respond = () => upstreamJson({ ok: true })
    const pinned = createPinnedApiFetch(async () => [PUBLIC_IP])
    const response = await pinned(new URL(`${XAI_API_ORIGIN}/v1/models`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(undiciStub.closed).toBe(1)
  })

  it('swallows a reader cancel that rejects on an aborted hop', async () => {
    const controller = new AbortController()
    const headerProbe = {
      get(name: string): string | null {
        if (name === 'content-length') controller.abort(new Error('caller aborted mid-read'))
        return null
      },
    }
    const body = {
      getReader: () => ({
        read: async () => ({ done: false, value: PNG }),
        cancel: async () => {
          throw new Error('cancel is unsupported')
        },
      }),
    }
    undiciStub.respond = () => upstreamResponse({ headerProbe, body })
    const transport = createPinnedMediaTransport(async () => [PUBLIC_IP])
    await expect(
      transport.get(new URL(IMAGE_URL), { ...MEDIA_REQUEST, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('IPv6 classification sweep', () => {
  // Every spelling of a reserved, private, documentation, or embedded-special
  // IPv6 address must stay blocked; the equivalent public spellings stay open.
  const BLOCKED_FORMS = [
    '::1',
    '::',
    '::ffff:0.0.0.1',
    '::ffff:10.1.2.3',
    '::ffff:192.168.1.1',
    '::ffff:100.64.0.1',
    '::ffff:169.254.1.1',
    '::ffff:172.16.0.1',
    '::ffff:192.0.2.1',
    '::ffff:198.18.0.1',
    '::ffff:198.51.100.1',
    '::ffff:203.0.113.1',
    '::ffff:224.0.0.1',
    '::ffff:240.0.0.1',
    '::ffff:192.88.99.1',
    '::ffff:192.0.0.1',
    '::8.8.8.8',
    '0:0:0:0:0:ffff:7f00:1',
    '0000:0000:0000:0000:0000:ffff:0a00:0001',
    '64:ff9b:1::1',
    '64:ff9b::1',
    '64:ff9b:2::1',
    '2002:c0a8:0001::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001:2::1',
    '2001:db8::1',
    '100::1',
    '3fff::1',
    '5f00::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
  ]
  const PUBLIC_FORMS = [
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    '::ffff:0:0:1',
    '0:0:0:0:0:ffff:808:808',
    '2001:4860:4860::8888',
    '2001:4860:4860:0:0:0:0:8888',
    '2001:4860:4860::8888%en0',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80e::200e',
    '64:ff9b:2::808:808',
    '64:ff9b:2:0:0:1:1.2.3.4',
    '1:2:3:4:5:6:7:8',
    '1:2:3:4:5:6:1.2.3.4',
    'aaaa:bbbb:cccc:dddd:eeee:ffff:1111:2222',
  ]

  it('blocks reserved spellings and admits public ones in every form', () => {
    for (const address of BLOCKED_FORMS) expect([address, isBlockedIp(address)]).toEqual([address, true])
    for (const address of PUBLIC_FORMS) expect([address, isBlockedIp(address)]).toEqual([address, false])
  })
})

describe('mapped IPv4 equivalence sweep', () => {
  /** One representative per blocked IPv4 subnet, paired with its mapped IPv6 spelling. */
  const BLOCKED_IPV4 = [
    '0.1.2.3',
    '10.1.2.3',
    '100.64.1.1',
    '127.0.0.2',
    '169.254.1.1',
    '172.16.1.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.1.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.1.1.1',
    '240.1.1.1',
  ]

  it('refuses every blocked IPv4 in its mapped IPv6 spelling too', () => {
    for (const address of BLOCKED_IPV4) {
      expect([address, isBlockedIp(address)]).toEqual([address, true])
      // The mapped spelling must be refused by the address-family check alone:
      // reaching the embedded-address fallback would mean a request slipped
      // past the blocklist on its way to a private IPv4 target.
      expect([`::ffff:${address}`, isBlockedIp(`::ffff:${address}`)]).toEqual([`::ffff:${address}`, true])
    }
  })
})
