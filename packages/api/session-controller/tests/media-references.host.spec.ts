import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SessionMediaReferences } from '../src/media-references.ts'

describe('Session file images', () => {
  it('serves an extensionless stored WebP as an image for GET and HEAD', async () => {
    let bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    let route: ((request: Request) => Promise<Response>) | undefined
    SessionMediaReferences.apply({
      attachments: { imageLimits: { maxImageBytes: 1024 } },
      fs: {
        resolve: async (path: string) => ({ displayPath: path }),
        readBytes: async () => bytes,
        stat: async () => ({ type: 'file', size: bytes.byteLength, version: 'v1' }),
      },
      connection: { fetch: { register: (entry: { fetch: (request: Request) => Promise<Response> }) => {
        route = entry.fetch
        return () => {}
      } } },
      effect: (register: () => void) => { register() },
    } as unknown as Context)
    if (route === undefined) throw new Error('File route was not registered')

    const url = 'http://localhost/api/file?path=/home/attachments/v1/objects/4f/4f65'
    const get = await route(new Request(url))
    expect(get.status).toBe(200)
    expect(get.headers.get('Content-Type')).toBe('image/webp')
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes)

    const head = await route(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Type')).toBe('image/webp')
    expect(await head.text()).toBe('')

    const named = await route(new Request('http://localhost/api/file?path=/home/image.unsupported'))
    expect(named.headers.get('Content-Type')).toBe('application/octet-stream')

    bytes = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e])
    const unknown = await route(new Request('http://localhost/api/file?path=/home/unknown'))
    expect(unknown.headers.get('Content-Type')).toBe('application/octet-stream')
  })

  it('revalidates by file version and answers an unchanged file with an empty 304', async () => {
    let version = 'v1'
    let reads = 0
    let route: ((request: Request) => Promise<Response>) | undefined
    SessionMediaReferences.apply({
      attachments: { imageLimits: { maxImageBytes: 1024 } },
      fs: {
        resolve: async (path: string) => ({ displayPath: path }),
        readBytes: async () => { reads += 1; return new Uint8Array([1, 2, 3]) },
        stat: async () => ({ type: 'file', size: 3, version }),
      },
      connection: { fetch: { register: (entry: { fetch: (request: Request) => Promise<Response> }) => {
        route = entry.fetch
        return () => {}
      } } },
      effect: (register: () => void) => { register() },
    } as unknown as Context)
    if (route === undefined) throw new Error('File route was not registered')
    const url = 'http://localhost/api/file?path=/home/chart.png'

    const first = await route(new Request(url))
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('private, no-cache')
    const etag = first.headers.get('ETag')
    expect(etag).toBe('"v1"')

    const unchanged = await route(new Request(url, { headers: { 'If-None-Match': `W/"other", ${etag ?? ''}` } }))
    expect(unchanged.status).toBe(304)
    expect(await unchanged.text()).toBe('')
    expect(reads).toBe(1)

    version = 'v2'
    const changed = await route(new Request(url, { headers: { 'If-None-Match': etag ?? '' } }))
    expect(changed.status).toBe(200)
    expect(changed.headers.get('ETag')).toBe('"v2"')
    expect(reads).toBe(2)

    const missing = await route(new Request('http://localhost/api/file?path=relative'))
    expect(missing.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
