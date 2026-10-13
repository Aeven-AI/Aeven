import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  IMAGINE_IMAGE_ROUTE_PREFIX,
  type ImagineImageAttachmentRef,
  imagineImagePath,
  parseImagineImagePath,
} from '../src/grok-imagine.ts'
import {
  IMAGINE_IMAGE_ROUTE_TTL_MS,
  IMAGINE_ROUTE_MAX_ENTRIES,
  type ImagineMediaDownloadStore,
  type ImagineRouteAttachmentStore,
  registerImagineRoutes,
} from '../src/imagine-routes.ts'
import {
  IMAGINE_MEDIA_ROUTE_PREFIX,
  imagineMediaPath,
  MEDIA_STORE_MAX_BYTES,
  type MediaArtifactMeta,
  type MediaDownloadView,
  MediaStoreError,
  type MediaStoreErrorCode,
  parseImagineMediaPath,
  type TrustedImagineAuthz,
} from '../src/media-store.ts'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const VIDEO = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
const SECRET_PATH = '/home/example/.secrets/imagine-internal.png'
const SECRET_TOKEN = 'Bearer super-secret-token'

interface RegisteredRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>
}

class TestResponse {
  status = 0
  headers: Record<string, string> = {}
  chunks: Buffer[] = []
  headersSent = false

  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status
    this.headersSent = true
    this.headers = {}
    for (const [key, value] of Object.entries(headers ?? {})) {
      this.headers[key.toLowerCase()] = value
    }
    return this
  }

  end(value?: string | Buffer | Uint8Array): this {
    if (value !== undefined) {
      this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value))
    }
    return this
  }

  get body(): Buffer {
    return Buffer.concat(this.chunks)
  }

  get text(): string {
    return this.body.toString('utf8')
  }
}

/** A response whose head was already flushed before the handler ran. */
class PreSentResponse extends TestResponse {
  constructor() {
    super()
    this.headersSent = true
  }
}

/** A response that fails while writing the body, after the status was already sent. */
class ThrowingEndResponse extends TestResponse {
  override end(_value?: string | Buffer | Uint8Array): this {
    throw new Error('socket write failed')
  }
}

/** A fake store whose reads can be parked with `hold()` until `release()`. */
class HoldableFake {
  pending: Promise<void> | undefined
  releasePending: (() => void) | undefined

  hold(): void {
    this.pending = new Promise<void>((resolve) => {
      this.releasePending = resolve
    })
  }

  release(): void {
    this.releasePending?.()
    this.releasePending = undefined
    this.pending = undefined
  }
}

class FakeAttachments extends HoldableFake implements ImagineRouteAttachmentStore {
  readonly imageLimits: { maxImageBytes: number }
  readonly stored = new Map<string, { ref: ImagineImageAttachmentRef; data: Uint8Array }>()
  reads: ImagineImageAttachmentRef[] = []
  signals: Array<AbortSignal | undefined> = []
  error: unknown
  mismatchId: string | undefined
  oversized = false

  constructor(maxImageBytes = 1024) {
    super()
    this.imageLimits = { maxImageBytes }
  }


  async readImage(
    ref: ImagineImageAttachmentRef,
    signal?: AbortSignal,
  ): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }> {
    this.reads.push({ ...ref })
    this.signals.push(signal)
    if (this.pending !== undefined) await this.pending
    if (this.error !== undefined) throw this.error
    const stored = this.stored.get(ref.attachmentId)
    const data = this.oversized ? new Uint8Array(this.imageLimits.maxImageBytes + 1) : (stored?.data ?? PNG)
    return {
      ref: {
        ...ref,
        attachmentId: this.mismatchId ?? ref.attachmentId,
        bytes: data.byteLength,
      },
      data,
    }
  }
}

class FakeMedia extends HoldableFake implements ImagineMediaDownloadStore {
  readonly stored = new Map<string, MediaDownloadView>()
  reads: Array<{ artifactId: string; authz: TrustedImagineAuthz }> = []
  error: unknown
  extraHeaders: Record<string, string> = {}


  async readForDownload(artifactId: string, authz: TrustedImagineAuthz): Promise<MediaDownloadView> {
    this.reads.push({ artifactId, authz })
    if (this.pending !== undefined) await this.pending
    if (this.error !== undefined) throw this.error
    const stored = this.stored.get(artifactId)
    if (stored === undefined) throw new MediaStoreError('NOT_FOUND', 'missing')
    return {
      ...stored,
      headers: { ...stored.headers, ...this.extraHeaders },
    }
  }
}

function imageRef(id: string, overrides: Partial<ImagineImageAttachmentRef> = {}): ImagineImageAttachmentRef {
  return {
    attachmentId: id,
    mediaType: 'image/png',
    bytes: PNG.byteLength,
    width: 2,
    height: 2,
    ...overrides,
  }
}

function artifact(id: string, overrides: Partial<MediaArtifactMeta> = {}): MediaArtifactMeta {
  const createdAt = Date.now()
  return {
    artifactId: id,
    mediaType: 'video/mp4',
    bytes: VIDEO.byteLength,
    createdAt,
    expiresAt: createdAt + 60_000,
    ...overrides,
  }
}

function hexId(value: number): string {
  return value.toString(16).padStart(32, '0')
}

function request(
  method: string | undefined,
  headers: IncomingMessage['headers'] = {},
  remoteAddress = '127.0.0.1',
  url = '/',
  signal?: AbortSignal,
): IncomingMessage {
  const stream = Readable.from([]) as unknown as IncomingMessage
  Object.defineProperties(stream, {
    method: { value: method, configurable: true },
    url: { value: url, configurable: true },
    headers: {
      value: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', ...headers },
      configurable: true,
    },
    socket: { value: { remoteAddress }, configurable: true },
    signal: { value: signal, configurable: true },
  })
  return stream
}

function createHarness(
  options: {
    now?: () => number
    effect?: boolean
    maxEntries?: number
    failAt?: number
    releaseHook?: (path: string) => void
  } = {},
): {
  routes: Map<string, RegisteredRoute>
  attachments: FakeAttachments
  media: FakeMedia
  registry: ReturnType<typeof registerImagineRoutes>
  effects: Array<() => void | Promise<void>>
} {
  const routes = new Map<string, RegisteredRoute>()
  const attachments = new FakeAttachments()
  const media = new FakeMedia()
  const effects: Array<() => void | Promise<void>> = []
  let registrations = 0
  const registry = registerImagineRoutes(
    {
      webServer: {
        register(route) {
          registrations += 1
          if (options.failAt !== undefined && registrations === options.failAt) {
            throw new Error(`registration ${String(registrations)} failed`)
          }
          const recorded: RegisteredRoute = {
            kind: route.kind,
            path: route.path,
            handler: route.handler,
          }
          routes.set(route.path, recorded)
          return () => {
            routes.delete(route.path)
            options.releaseHook?.(route.path)
          }
        },
      },
      ...(options.effect === true
        ? {
          effect(setup: () => () => void | Promise<void>) {
            effects.push(setup())
          },
        }
        : {}),
    },
    {
      attachments,
      media,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
    },
  )
  return { routes, attachments, media, registry, effects }
}

async function deliver(
  route: RegisteredRoute | undefined,
  req: IncomingMessage,
  response: TestResponse,
): Promise<void> {
  if (route === undefined) throw new Error('route was not registered')
  await route.handler(req, response as unknown as ServerResponse)
}

async function invoke(
  route: RegisteredRoute | undefined,
  req: IncomingMessage,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer; text: string; json: unknown }> {
  const response = new TestResponse()
  await deliver(route, req, response)
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    parsed = undefined
  }
  return { status: response.status, headers: response.headers, body: response.body, text: response.text, json: parsed }
}

/** A stored-video view the fake media store hands back, with its own download headers. */
function mediaView(meta: MediaArtifactMeta, body: Uint8Array = VIDEO): MediaDownloadView {
  return {
    meta,
    body,
    headers: {
      'Content-Type': meta.mediaType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `attachment; filename="imagine-${meta.artifactId}.mp4"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }
}

/**
 * An input whose property reads change on every access, exactly as a caller-supplied
 * getter can, so a value validated on one read can differ from the value copied later.
 */
function shiftingReads<T extends object>(base: T, script: Partial<Record<keyof T, readonly unknown[]>>): T {
  const reads = new Map<PropertyKey, number>()
  return new Proxy(base, {
    get(target, property, receiver) {
      const queue = (script as Record<string, readonly unknown[] | undefined>)[String(property)]
      const index = reads.get(property) ?? 0
      reads.set(property, index + 1)
      if (queue === undefined) return Reflect.get(target, property, receiver)
      return queue[Math.min(index, queue.length - 1)]
    },
  })
}

/**
 * A value that is not a string yet stringifies to a safe opaque id, so every
 * coercion-based check passes while the value itself never equals that id.
 */
function stringifiableId(id: string): object {
  return {
    length: id.length,
    includes: (): boolean => false,
    toString: (): string => id,
  }
}

describe('imagine exact download routes', () => {
  it('registers one exact image path per remembered opaque id', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_local')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([
      { ...ref, url: 'https://imgen.x.ai/signed', fsPath: SECRET_PATH } as ImagineImageAttachmentRef & {
        url: string
        fsPath: string
      },
    ])
    const path = imagineImagePath(ref.attachmentId)
    expect(parseImagineImagePath(path)).toBe(ref.attachmentId)
    expect(routes.get(path)?.kind).toBe('exact')
    expect([...routes.keys()]).toEqual([path])
    expect(routes.has(IMAGINE_IMAGE_ROUTE_PREFIX)).toBe(false)
    expect(routes.has(`${path}/extra`)).toBe(false)

    const response = await invoke(routes.get(path), request('GET'))
    expect(response.status).toBe(200)
    expect(response.body.equals(Buffer.from(PNG))).toBe(true)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['content-length']).toBe(String(PNG.byteLength))
    expect(response.headers['cache-control']).toMatch(/private/u)
    expect(response.headers['cache-control']).toMatch(/no-store/u)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.text).not.toContain(SECRET_PATH)
    expect(JSON.stringify(attachments.reads[0])).not.toContain('https://imgen.x.ai/signed')
  })

  it('registers one exact media path and copies only safe headers', async () => {
    const { routes, media, registry } = createHarness()
    const meta = artifact(hexId(1))
    media.stored.set(meta.artifactId, {
      meta,
      body: VIDEO,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(VIDEO.byteLength),
        'Content-Disposition': `attachment; filename="imagine-${meta.artifactId}.mp4"`,
        'Cache-Control': 'private, max-age=0, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    media.extraHeaders = {
      'Set-Cookie': 'session=abc',
      Location: 'https://videogen.x.ai/raw',
      Authorization: SECRET_TOKEN,
    }
    registry.rememberArtifact(meta)
    const path = imagineMediaPath(meta.artifactId)
    expect(parseImagineMediaPath(path)).toBe(meta.artifactId)
    expect(routes.get(path)?.kind).toBe('exact')
    expect(path.startsWith(IMAGINE_MEDIA_ROUTE_PREFIX)).toBe(true)

    const response = await invoke(routes.get(path), request('GET'))
    expect(response.status).toBe(200)
    expect(response.body.equals(Buffer.from(VIDEO))).toBe(true)
    expect(response.headers['content-type']).toBe('video/mp4')
    expect(response.headers['content-length']).toBe(String(VIDEO.byteLength))
    expect(response.headers['cache-control']).toMatch(/no-store/u)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers.location).toBeUndefined()
    expect(response.headers.authorization).toBeUndefined()
    expect(response.text).not.toContain(SECRET_TOKEN)
    expect(media.reads).toHaveLength(1)
    expect(media.reads[0]?.artifactId).toBe(meta.artifactId)
  })

  it('rejects non-GET methods with 405', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_method')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const response = await invoke(routes.get(imagineImagePath(ref.attachmentId)), request('POST'))
    expect(response.status).toBe(405)
    expect(response.json).toEqual({ error: 'method not allowed' })
    expect(attachments.reads).toHaveLength(0)
  })

  it('authorizes only same-origin loopback and ignores bearer query or cookies', async () => {
    const { routes, attachments, media, registry } = createHarness()
    const ref = imageRef('img_auth')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const handler = routes.get(imagineImagePath(ref.attachmentId))

    const denied = [
      await invoke(handler, request('GET', {}, '10.0.0.2')),
      await invoke(handler, request('GET', { host: undefined })),
      await invoke(handler, request('GET', { 'sec-fetch-site': 'cross-site' })),
      await invoke(handler, request('GET', { origin: 'http://evil.example' })),
      await invoke(
        handler,
        request('GET', { cookie: 'authorization=Bearer leaked' }, '8.8.8.8', '/x?access_token=leaked'),
      ),
    ]
    for (const response of denied) {
      expect(response.status).toBe(403)
      expect(response.json).toEqual({ error: 'forbidden' })
      expect(response.text).not.toMatch(/Bearer|leaked|access_token/u)
    }
    expect(attachments.reads).toHaveLength(0)
    expect(media.reads).toHaveLength(0)

    const allowed = await invoke(
      handler,
      request('GET', { cookie: 'session=1' }, '127.0.0.1', `${imagineImagePath(ref.attachmentId)}?access_token=ignore`),
    )
    expect(allowed.status).toBe(200)
    expect(allowed.body.equals(Buffer.from(PNG))).toBe(true)

    const mapped = await invoke(handler, request('GET', {}, '::ffff:127.0.0.1'))
    expect(mapped.status).toBe(200)
    const v6 = await invoke(handler, request('GET', {}, '::1'))
    expect(v6.status).toBe(200)
  })

  it('does not call media download until the route is authorized', async () => {
    const { routes, media, registry } = createHarness()
    const meta = artifact(hexId(2))
    media.stored.set(meta.artifactId, {
      meta,
      body: VIDEO,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(VIDEO.byteLength),
        'Content-Disposition': `attachment; filename="imagine-${meta.artifactId}.mp4"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    registry.rememberArtifact(meta)
    const handler = routes.get(imagineMediaPath(meta.artifactId))
    await invoke(handler, request('GET', {}, '192.168.1.9'))
    expect(media.reads).toHaveLength(0)
    const allowed = await invoke(handler, request('GET'))
    expect(allowed.status).toBe(200)
    expect(media.reads).toHaveLength(1)
  })

  it('does not register traversal or multi-segment ids', () => {
    const { routes, registry } = createHarness()
    registry.rememberImages([imageRef('../etc/passwd'), imageRef('a/b'), imageRef('..')])
    registry.rememberArtifact(artifact('../not-an-id'))
    expect(routes.size).toBe(0)
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}../etc/passwd`)).toBeUndefined()
    expect(parseImagineMediaPath(`${IMAGINE_MEDIA_ROUTE_PREFIX}../x`)).toBeUndefined()
  })

  it('expires image routes within one hour and deletes the handler', async () => {
    let clock = 10_000
    const { routes, attachments, registry } = createHarness({ now: () => clock })
    const ref = imageRef('img_ttl')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const path = imagineImagePath(ref.attachmentId)
    expect(await invoke(routes.get(path), request('GET'))).toMatchObject({ status: 200 })
    clock += IMAGINE_IMAGE_ROUTE_TTL_MS + 1
    const expired = await invoke(routes.get(path), request('GET'))
    expect(expired.status).toBe(404)
    expect(expired.json).toEqual({ error: 'not found' })
    expect(routes.has(path)).toBe(false)
  })

  it('cannot keep a media route alive past artifact expiresAt', async () => {
    let clock = 5_000
    const { routes, media, registry } = createHarness({ now: () => clock })
    const meta = artifact(hexId(3), { createdAt: 1_000, expiresAt: 8_000 })
    media.stored.set(meta.artifactId, {
      meta,
      body: VIDEO,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(VIDEO.byteLength),
        'Content-Disposition': `attachment; filename="imagine-${meta.artifactId}.mp4"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    registry.rememberArtifact(meta)
    const path = imagineMediaPath(meta.artifactId)
    expect((await invoke(routes.get(path), request('GET'))).status).toBe(200)
    clock = 8_000
    const expired = await invoke(routes.get(path), request('GET'))
    expect(expired.status).toBe(404)
    expect(routes.has(path)).toBe(false)
    registry.rememberArtifact(artifact(hexId(4), { createdAt: 1_000, expiresAt: 7_000 }))
    expect(routes.has(imagineMediaPath(hexId(4)))).toBe(false)
  })

  it('evicts the oldest exact handler once capacity is reached', async () => {
    const { routes, attachments, registry } = createHarness()
    for (let index = 0; index < IMAGINE_ROUTE_MAX_ENTRIES + 1; index += 1) {
      const ref = imageRef(`img_${String(index)}`)
      attachments.stored.set(ref.attachmentId, { ref, data: PNG })
      registry.rememberImages([ref])
    }
    expect(routes.size).toBe(IMAGINE_ROUTE_MAX_ENTRIES)
    expect(routes.has(imagineImagePath('img_0'))).toBe(false)
    expect(routes.has(imagineImagePath(`img_${String(IMAGINE_ROUTE_MAX_ENTRIES)}`))).toBe(true)
    const kept = await invoke(routes.get(imagineImagePath(`img_${String(IMAGINE_ROUTE_MAX_ENTRIES)}`)), request('GET'))
    expect(kept.status).toBe(200)
  })

  it('refreshing an existing id does not consume another slot', () => {
    const { routes, registry } = createHarness()
    const first = imageRef('img_refresh')
    registry.rememberImages([first, imageRef('img_other')])
    registry.rememberImages([imageRef('img_refresh', { name: 'again' })])
    expect(routes.size).toBe(2)
    expect(routes.has(imagineImagePath('img_refresh'))).toBe(true)
  })

  it('owns route disposal and is idempotent', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_dispose')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const path = imagineImagePath(ref.attachmentId)
    const handler = routes.get(path)
    registry.dispose()
    registry.dispose()
    expect(routes.size).toBe(0)
    registry.rememberImages([ref])
    expect(routes.size).toBe(0)
    expect((await invoke(handler, request('GET'))).status).toBe(404)
  })

  it('lets ctx.effect own the combined disposer', async () => {
    const { routes, registry, effects } = createHarness({ effect: true })
    registry.rememberImages([imageRef('img_effect')])
    expect(routes.size).toBe(1)
    expect(effects).toHaveLength(1)
    await effects[0]?.()
    expect(routes.size).toBe(0)
  })

  it('keeps the first remembered image owned after a later register throws', () => {
    const { routes, registry } = createHarness({ failAt: 2 })
    const first = imageRef('img_keep')
    const second = imageRef('img_fail')
    expect(() =>{  registry.rememberImages([first, second]) }).toThrow('registration 2 failed')
    expect(routes.has(imagineImagePath(first.attachmentId))).toBe(true)
    expect(routes.has(imagineImagePath(second.attachmentId))).toBe(false)
    registry.dispose()
    expect(routes.size).toBe(0)
  })

  it('returns 404 when the stored image identity or byte ceiling fails', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_check', { bytes: 8 })
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const handler = routes.get(imagineImagePath(ref.attachmentId))

    attachments.mismatchId = 'img_other'
    expect((await invoke(handler, request('GET'))).status).toBe(404)
    attachments.mismatchId = undefined
    attachments.oversized = true
    expect((await invoke(handler, request('GET'))).status).toBe(404)
    attachments.oversized = false
    expect((await invoke(handler, request('GET'))).status).toBe(200)
    registry.rememberImages([imageRef('img_too_big', { bytes: 4096 })])
    expect(routes.has(imagineImagePath('img_too_big'))).toBe(false)
  })

  it('redacts internal paths and tokens from download errors', async () => {
    const { routes, attachments, media, registry } = createHarness()
    const ref = imageRef('img_err')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    attachments.error = new Error(`ENOENT ${SECRET_PATH} ${SECRET_TOKEN}`)
    registry.rememberImages([ref])
    const failed = await invoke(routes.get(imagineImagePath(ref.attachmentId)), request('GET'))
    expect(failed.status).toBe(500)
    expect(failed.json).toEqual({ error: 'download failed' })
    expect(failed.text).not.toContain(SECRET_PATH)
    expect(failed.text).not.toContain('ENOENT')
    expect(failed.text).not.toContain('super-secret-token')

    const meta = artifact(hexId(5))
    media.error = new MediaStoreError('NOT_FOUND', `missing ${SECRET_PATH}`)
    registry.rememberArtifact(meta)
    const missing = await invoke(routes.get(imagineMediaPath(meta.artifactId)), request('GET'))
    expect(missing.status).toBe(404)
    expect(missing.json).toEqual({ error: 'not found' })
    expect(missing.text).not.toContain(SECRET_PATH)
  })

  it('does not let a stale handler delete a replacement route for the same id', async () => {
    const { routes, attachments, registry } = createHarness({ maxEntries: 1 })
    const first = imageRef('img_reused')
    const other = imageRef('img_other')
    attachments.stored.set(first.attachmentId, { ref: first, data: PNG })
    attachments.stored.set(other.attachmentId, { ref: other, data: PNG })
    registry.rememberImages([first])
    const path = imagineImagePath(first.attachmentId)
    const stale = routes.get(path)
    registry.rememberImages([other])
    registry.rememberImages([first])
    const replacement = routes.get(path)
    expect(replacement).not.toBe(stale)
    expect((await invoke(stale, request('GET'))).status).toBe(404)
    expect(routes.get(path)).toBe(replacement)
    expect((await invoke(replacement, request('GET'))).status).toBe(200)
  })

  it('does not finish a 200 after disposal races the in-flight read', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_race')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    attachments.hold()
    registry.rememberImages([ref])
    const pending = invoke(routes.get(imagineImagePath(ref.attachmentId)), request('GET'))
    registry.dispose()
    attachments.release()
    const response = await pending
    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'not found' })
  })
})

describe('imagine route table maintenance', () => {
  it('sweeps an expired image route when a later image is remembered', () => {
    let clock = 1_000
    const { routes, registry } = createHarness({ now: () => clock })
    registry.rememberImages([imageRef('img_sweep_old')])
    clock += IMAGINE_IMAGE_ROUTE_TTL_MS + 1
    registry.rememberImages([imageRef('img_sweep_new')])
    expect(routes.has(imagineImagePath('img_sweep_old'))).toBe(false)
    expect(routes.has(imagineImagePath('img_sweep_new'))).toBe(true)
  })

  it('sweeps an expired artifact route when a later artifact is remembered', () => {
    let clock = 10_000
    const { routes, registry } = createHarness({ now: () => clock })
    const expired = artifact(hexId(44), { createdAt: 1_000, expiresAt: 15_000 })
    const fresh = artifact(hexId(45), { createdAt: 1_000, expiresAt: 90_000 })
    registry.rememberArtifact(expired)
    clock = 20_000
    registry.rememberArtifact(fresh)
    expect(routes.has(imagineMediaPath(expired.artifactId))).toBe(false)
    expect(routes.has(imagineMediaPath(fresh.artifactId))).toBe(true)
  })

  it('refreshes a remembered artifact in place instead of adding a route', async () => {
    let clock = 1_000
    const { routes, media, registry } = createHarness({ now: () => clock })
    const meta = artifact(hexId(46), { createdAt: 500, expiresAt: 2_000 })
    media.stored.set(meta.artifactId, mediaView(meta))
    registry.rememberArtifact(meta)
    const path = imagineMediaPath(meta.artifactId)
    const handler = routes.get(path)

    registry.rememberArtifact({ ...meta, name: 'renamed.mp4', expiresAt: 31_000 })

    expect(routes.size).toBe(1)
    expect(routes.get(path)).toBe(handler)
    clock = 6_000
    const response = await invoke(handler, request('GET'))
    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('renamed.mp4')
  })

  it('evicts the oldest artifact route once capacity is reached', async () => {
    const { routes, media, registry } = createHarness({ maxEntries: 1 })
    const first = artifact(hexId(47))
    const second = artifact(hexId(48))
    media.stored.set(first.artifactId, mediaView(first))
    media.stored.set(second.artifactId, mediaView(second))
    registry.rememberArtifact(first)
    registry.rememberArtifact(second)
    expect(routes.size).toBe(1)
    expect(routes.has(imagineMediaPath(first.artifactId))).toBe(false)
    expect((await invoke(routes.get(imagineMediaPath(second.artifactId)), request('GET'))).status).toBe(200)
  })

  it('ignores an artifact remembered after disposal', () => {
    const { routes, registry } = createHarness()
    registry.dispose()
    registry.rememberArtifact(artifact(hexId(49)))
    expect(routes.size).toBe(0)
  })

  it('revokes image routes without touching artifact routes', async () => {
    const { routes, media, registry } = createHarness()
    const image = imageRef('img_revoke_images')
    const meta = artifact(hexId(50))
    media.stored.set(meta.artifactId, mediaView(meta))
    registry.rememberImages([image])
    registry.rememberArtifact(meta)
    const imagePath = imagineImagePath(image.attachmentId)
    const mediaPath = imagineMediaPath(meta.artifactId)
    const staleImageHandler = routes.get(imagePath)
    expect(routes.size).toBe(2)

    registry.revokeImages()

    expect(routes.has(imagePath)).toBe(false)
    expect(routes.has(mediaPath)).toBe(true)
    expect((await invoke(staleImageHandler, request('GET'))).status).toBe(404)
    expect((await invoke(routes.get(mediaPath), request('GET'))).status).toBe(200)
  })

  it('revokes artifact routes without touching image routes', async () => {
    const { routes, attachments, media, registry } = createHarness()
    const image = imageRef('img_kept_after_revoke')
    const meta = artifact(hexId(51))
    attachments.stored.set(image.attachmentId, { ref: image, data: PNG })
    media.stored.set(meta.artifactId, mediaView(meta))
    registry.rememberImages([image])
    registry.rememberArtifact(meta)
    const imagePath = imagineImagePath(image.attachmentId)
    const mediaPath = imagineMediaPath(meta.artifactId)
    const staleMediaHandler = routes.get(mediaPath)

    registry.revokeArtifacts()

    expect(routes.has(mediaPath)).toBe(false)
    expect(routes.has(imagePath)).toBe(true)
    expect((await invoke(staleMediaHandler, request('GET'))).status).toBe(404)
    expect((await invoke(routes.get(imagePath), request('GET'))).status).toBe(200)
  })

  it('keeps sweeping when a route disposer revokes the rest of the table', async () => {
    let revokeOnRelease = false
    const harness = createHarness({
      releaseHook: () => {
        if (revokeOnRelease) harness.registry.revokeImages()
      },
    })
    const first = imageRef('img_reentrant_a')
    const second = imageRef('img_reentrant_b')
    harness.registry.rememberImages([first, second])
    const firstHandler = harness.routes.get(imagineImagePath(first.attachmentId))
    expect(harness.routes.size).toBe(2)

    revokeOnRelease = true
    harness.registry.revokeImages()

    expect(harness.routes.size).toBe(0)
    expect((await invoke(firstHandler, request('GET'))).status).toBe(404)
    harness.registry.rememberImages([imageRef('img_reentrant_c')])
    expect(harness.routes.size).toBe(1)
  })

  it('answers 404 when the staleness check loses the entry before the lookup', async () => {
    const clock = 1_000
    let revokeOnClockRead = false
    const harness = createHarness({
      now: () => {
        if (revokeOnClockRead) {
          revokeOnClockRead = false
          harness.registry.revokeImages()
        }
        return clock
      },
    })
    const ref = imageRef('img_vanished')
    harness.registry.rememberImages([ref])
    const path = imagineImagePath(ref.attachmentId)
    const handler = harness.routes.get(path)

    revokeOnClockRead = true
    const response = await invoke(handler, request('GET'))

    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'not found' })
    expect(harness.routes.has(path)).toBe(false)
  })
})

describe('imagine download response guards', () => {
  it('treats a request without a method as non-GET', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_no_method')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const response = await invoke(routes.get(imagineImagePath(ref.attachmentId)), request(undefined))
    expect(response.status).toBe(405)
    expect(response.json).toEqual({ error: 'method not allowed' })
    expect(attachments.reads).toHaveLength(0)
  })

  it('does not write a JSON error onto a response whose head was already sent', async () => {
    const { routes, registry } = createHarness()
    registry.rememberImages([imageRef('img_presend_error')])
    const response = new PreSentResponse()

    await deliver(routes.get(imagineImagePath('img_presend_error')), request('POST'), response)

    expect(response.status).toBe(0)
    expect(response.body.byteLength).toBe(0)
  })

  it('refuses an image whose remembered size exceeds the current download limit', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_limit_shrunk', { bytes: 16 })
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    attachments.imageLimits.maxImageBytes = 8

    const response = await invoke(routes.get(imagineImagePath(ref.attachmentId)), request('GET'))

    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'not found' })
    expect(attachments.reads).toHaveLength(0)
  })

  it('does not write an image body onto a response whose head was already sent', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_presend_body')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const response = new PreSentResponse()

    await deliver(routes.get(imagineImagePath(ref.attachmentId)), request('GET'), response)

    expect(attachments.reads).toHaveLength(1)
    expect(response.status).toBe(0)
    expect(response.body.byteLength).toBe(0)
  })

  it('does not answer a JSON error after the body write already failed', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_write_failed')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const response = new ThrowingEndResponse()

    await deliver(routes.get(imagineImagePath(ref.attachmentId)), request('GET'), response)

    expect(response.status).toBe(200)
    expect(response.body.byteLength).toBe(0)
  })

  it('answers 404 when the attachment read fails after the route was revoked', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_failed_after_revoke')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    attachments.hold()
    registry.rememberImages([ref])
    const pending = invoke(routes.get(imagineImagePath(ref.attachmentId)), request('GET'))
    attachments.error = new Error(`ENOENT ${SECRET_PATH}`)
    registry.dispose()
    attachments.release()

    const response = await pending

    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'not found' })
    expect(response.text).not.toContain(SECRET_PATH)
  })

  it('does not finish a 200 when disposal races an in-flight artifact read', async () => {
    const { routes, media, registry } = createHarness()
    const meta = artifact(hexId(52))
    media.stored.set(meta.artifactId, mediaView(meta))
    media.hold()
    registry.rememberArtifact(meta)
    const pending = invoke(routes.get(imagineMediaPath(meta.artifactId)), request('GET'))
    registry.dispose()
    media.release()

    const response = await pending

    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'not found' })
  })

  it('does not write a video body onto a response whose head was already sent', async () => {
    const { routes, media, registry } = createHarness()
    const meta = artifact(hexId(53))
    media.stored.set(meta.artifactId, mediaView(meta))
    registry.rememberArtifact(meta)
    const response = new PreSentResponse()

    await deliver(routes.get(imagineMediaPath(meta.artifactId)), request('GET'), response)

    expect(media.reads).toHaveLength(1)
    expect(response.status).toBe(0)
    expect(response.body.byteLength).toBe(0)
  })

  it('refuses a stored video whose view disagrees with the registered artifact', async () => {
    const { routes, media, registry } = createHarness()
    const meta = artifact(hexId(54))
    registry.rememberArtifact(meta)
    const handler = routes.get(imagineMediaPath(meta.artifactId))
    const oversizedBody = { byteLength: MEDIA_STORE_MAX_BYTES + 1 } as unknown as Uint8Array
    const disagreeing: Array<[string, MediaDownloadView]> = [
      ['names another artifact', mediaView({ ...meta, artifactId: hexId(55) })],
      ['changes the media type', mediaView({ ...meta, mediaType: 'video/webm' })],
      ['disagrees on the byte count', mediaView({ ...meta, bytes: meta.bytes + 1 })],
      ['exceeds the store ceiling', mediaView({ ...meta, bytes: MEDIA_STORE_MAX_BYTES + 1 }, oversizedBody)],
    ]

    for (const [label, view] of disagreeing) {
      media.stored.set(meta.artifactId, view)
      const response = await invoke(handler, request('GET'))
      expect(response.status, label).toBe(404)
      expect(response.json, label).toEqual({ error: 'not found' })
    }
  })
})

describe('imagine route input validation', () => {
  it('rejects image refs the download route cannot describe', () => {
    const { routes, registry } = createHarness()
    const tiff = 'image/tiff' as ImagineImageAttachmentRef['mediaType']
    const unusable: Array<[string, ImagineImageAttachmentRef]> = [
      ['unsupported media type', imageRef('img_tiff', { mediaType: tiff })],
      ['non-numeric byte count', imageRef('img_nan_bytes', { bytes: Number.NaN })],
      ['negative byte count', imageRef('img_negative_bytes', { bytes: -1 })],
      ['non-numeric width', imageRef('img_nan_width', { width: Number.NaN })],
      ['non-numeric height', imageRef('img_nan_height', { height: Number.NaN })],
    ]

    for (const [label, ref] of unusable) {
      registry.rememberImages([ref])
      expect(routes.size, label).toBe(0)
    }

    registry.rememberImages([imageRef('img_usable')])
    expect(routes.size).toBe(1)
  })

  it('rejects artifacts the download route cannot describe', () => {
    const { routes, registry } = createHarness()
    const unusable: Array<[string, MediaArtifactMeta]> = [
      ['unsupported media type', artifact(hexId(56), { mediaType: 'video/avi' as MediaArtifactMeta['mediaType'] })],
      ['zero byte count', artifact(hexId(57), { bytes: 0 })],
      ['non-numeric byte count', artifact(hexId(58), { bytes: Number.NaN })],
      ['missing creation time', artifact(hexId(59), { createdAt: 0 })],
      ['non-numeric creation time', artifact(hexId(60), { createdAt: Number.NaN })],
      ['non-numeric expiry', artifact(hexId(61), { expiresAt: Number.NaN })],
      ['expiry at creation time', artifact(hexId(62), { createdAt: 5_000, expiresAt: 5_000 })],
    ]

    for (const [label, meta] of unusable) {
      registry.rememberArtifact(meta)
      expect(routes.size, label).toBe(0)
    }

    registry.rememberArtifact(artifact(hexId(63)))
    expect(routes.size).toBe(1)
  })

  it('falls back to the built-in image ceiling when the store limit is unusable', () => {
    const { routes, attachments, registry } = createHarness()
    const limits = attachments.imageLimits as { maxImageBytes: unknown }
    const ref = imageRef('img_limit_fallback', { bytes: 4_096 })

    for (const configured of [undefined, Number.NaN, 0, -1, '4096']) {
      limits.maxImageBytes = configured
      registry.rememberImages([ref])
      expect(routes.size, String(configured)).toBe(1)
      registry.revokeImages()
    }

    limits.maxImageBytes = 8
    registry.rememberImages([ref])
    expect(routes.size).toBe(0)
  })

  it('serves a remembered artifact under the name its source supplied', async () => {
    const { routes, media, registry } = createHarness()
    const meta = artifact(hexId(64), { name: 'clip.mp4' })
    media.stored.set(meta.artifactId, mediaView(meta))
    registry.rememberArtifact(meta)

    const response = await invoke(routes.get(imagineMediaPath(meta.artifactId)), request('GET'))

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('clip.mp4')
  })

  it('forwards the request abort signal to the attachment store', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = imageRef('img_signal')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    const handler = routes.get(imagineImagePath(ref.attachmentId))
    const controller = new AbortController()

    expect((await invoke(handler, request('GET', {}, '127.0.0.1', '/', controller.signal))).status).toBe(200)
    await invoke(handler, request('GET'))

    expect(attachments.signals[0]).toBe(controller.signal)
    expect(attachments.signals[1]).toBeUndefined()
  })

  it('maps a store failure to a status and a public message', async () => {
    const cases: Array<[MediaStoreErrorCode, number, string]> = [
      ['NOT_FOUND', 404, 'not found'],
      ['EXPIRED', 404, 'not found'],
      ['INVALID_ID', 404, 'not found'],
      ['FORBIDDEN', 403, 'forbidden'],
      ['CORRUPT', 500, 'download failed'],
    ]

    for (const [code, status, message] of cases) {
      const { routes, media, registry } = createHarness()
      const meta = artifact(hexId(65))
      media.stored.set(meta.artifactId, mediaView(meta))
      media.error = new MediaStoreError(code, `internal ${SECRET_PATH}`)
      registry.rememberArtifact(meta)

      const response = await invoke(routes.get(imagineMediaPath(meta.artifactId)), request('GET'))

      expect(response.status, code).toBe(status)
      expect(response.json, code).toEqual({ error: message })
      expect(response.text, code).not.toContain(SECRET_PATH)
    }
  })

  it('never registers a route for an id that changes between validation and use', () => {
    const { routes, registry } = createHarness()
    const shiftingImage = shiftingReads(imageRef('img_shifting'), {
      attachmentId: ['img_shifting', 'img_shifting', '../escaped'],
    })
    registry.rememberImages([shiftingImage])
    expect(routes.size).toBe(0)

    const shiftingArtifact = shiftingReads(artifact(hexId(66)), {
      artifactId: [hexId(66), hexId(66), 'not-hex'],
    })
    registry.rememberArtifact(shiftingArtifact)
    expect(routes.size).toBe(0)
  })

  it('never registers a route for an id that only stringifies to a safe id', () => {
    const { routes, attachments, registry } = createHarness()
    const confusedImage = shiftingReads(imageRef('img_confused'), {
      attachmentId: ['img_confused', 'img_confused', stringifiableId('img_confused')],
    })
    registry.rememberImages([confusedImage])
    expect(routes.size).toBe(0)

    const confusedArtifact = shiftingReads(artifact(hexId(67)), {
      artifactId: [hexId(67), hexId(67), stringifiableId(hexId(67))],
    })
    registry.rememberArtifact(confusedArtifact)
    expect(routes.size).toBe(0)

    const ref = imageRef('img_confused')
    attachments.stored.set(ref.attachmentId, { ref, data: PNG })
    registry.rememberImages([ref])
    expect(routes.has(imagineImagePath(ref.attachmentId))).toBe(true)
  })

  it('never serves an image whose stored media type the store cannot re-validate', async () => {
    const { routes, attachments, registry } = createHarness()
    const ref = shiftingReads(imageRef('img_degraded'), { mediaType: ['image/png', 'image/tiff'] })
    registry.rememberImages([ref])
    const path = imagineImagePath('img_degraded')
    expect(routes.has(path)).toBe(true)

    const response = await invoke(routes.get(path), request('GET'))

    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'not found' })
    expect(attachments.reads).toHaveLength(1)
  })
})
