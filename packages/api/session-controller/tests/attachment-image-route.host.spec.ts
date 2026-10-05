import type { Context } from '@deepseek-ai/cordis'
import type { StoredImageAttachment } from '@aeven/attachment'
import { describe, expect, it } from 'vitest'
import { registerImageReadRoute } from '../src/file-uploads.ts'

const DIGEST = '32ba8f838f435b2b82263400de869cb6a9b415ce1829e34c0ed701dbeac44c22'
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

/** One stored image as the attachment seam returns it. */
function stored(name?: string): StoredImageAttachment {
  return {
    ref: {
      attachmentId: `sha256:${DIGEST}`,
      mediaType: 'image/jpeg',
      bytes: BYTES.byteLength,
      width: 1536,
      height: 1024,
      ...(name === undefined ? {} : { name }),
    },
    data: BYTES,
  } as unknown as StoredImageAttachment
}

/**
 * Mount the route over a double reader and return it.
 * @param read - the session-authorized reader the route calls.
 * @returns the registered request handler.
 */
function routeFor(
  read: (sessionId: string, attachmentId: string) => Promise<StoredImageAttachment | undefined>,
  readDirect: (ref: { attachmentId: string }) => Promise<StoredImageAttachment> = async () => stored(),
) {
  let route: ((request: Request) => Promise<Response>) | undefined
  registerImageReadRoute({
    connection: {
      fetch: {
        register: (entry: { fetch: (request: Request) => Promise<Response> }) => {
          route = entry.fetch
          return () => {}
        },
      },
    },
    effect: (register: () => void) => { register() },
  } as unknown as Context, read as never, readDirect as never)
  if (route === undefined) throw new Error('Image route was not registered')
  return route
}

const URL_INLINE = `http://localhost/api/attachment-image?sessionId=s-1&id=sha256:${DIGEST}`

describe('the stored-image route', () => {
  it('serves the image inline under the name its reference carries', async () => {
    const route = routeFor(async () => stored('Aeven-1.0-Image-Flash-1.jpg'))
    const response = await route(new Request(URL_INLINE))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('Content-Length')).toBe(String(BYTES.byteLength))
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="Aeven-1.0-Image-Flash-1.jpg"; filename*=UTF-8\'\'Aeven-1.0-Image-Flash-1.jpg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  it('serves the image as a download when the request asks for one', async () => {
    const route = routeFor(async () => stored('Aeven-1.0-Image-Flash-1.jpg'))
    const response = await route(new Request(`${URL_INLINE}&download=1`))

    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="Aeven-1.0-Image-Flash-1.jpg"')
  })

  it('derives a name from the content digest for an image stored without one', async () => {
    const route = routeFor(async () => stored())
    const response = await route(new Request(URL_INLINE))

    expect(response.headers.get('Content-Disposition')).toContain('filename="32ba8f838f43.jpg"')
  })

  it('answers HEAD with the same headers and no body', async () => {
    const route = routeFor(async () => stored('named.jpg'))
    const response = await route(new Request(URL_INLINE, { method: 'HEAD' }))

    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await response.text()).toBe('')
  })

  it('refuses an image the addressed session does not cite', async () => {
    const route = routeFor(async () => undefined)
    const response = await route(new Request(URL_INLINE))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'ATTACHMENT_NOT_REFERENCED' })
  })

  it('serves the image a request describes by reference, cached as immutable bytes', async () => {
    let seen: { attachmentId: string } | undefined
    const route = routeFor(async () => undefined, async (ref) => {
      seen = ref
      return stored()
    })
    const url = `http://localhost/api/attachment-image?id=sha256:${DIGEST}&type=image/jpeg&bytes=${String(BYTES.byteLength)}&width=1536&height=1024`
    const response = await route(new Request(url))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('Content-Disposition')).toContain('filename="32ba8f838f43.jpg"')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    expect(seen?.attachmentId).toBe(`sha256:${DIGEST}`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  it('refuses a by-reference request that omits a fact, or names a malformed id', async () => {
    const route = routeFor(async () => undefined)
    const partial = await route(new Request(`http://localhost/api/attachment-image?id=sha256:${DIGEST}&type=image/jpeg`))
    const malformed = await route(new Request('http://localhost/api/attachment-image?id=nope&type=image/jpeg&bytes=4&width=1&height=1'))

    expect(partial.status).toBe(400)
    expect(malformed.status).toBe(400)
  })

  it('refuses a request that names no image', async () => {
    const route = routeFor(async () => stored('named.jpg'))

    await expect(route(new Request('http://localhost/api/attachment-image')).then(response => response.status)).resolves.toBe(400)
  })
})
