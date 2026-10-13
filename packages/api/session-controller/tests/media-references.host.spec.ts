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
        stat: async () => ({ type: 'file', size: bytes.byteLength }),
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
})
