import type { Context } from '@deepseek-ai/cordis'
import type { StoredFileAttachment, StoredImageAttachment } from '@aeven/attachment'
import type { SessionEvent } from '@aeven/session'
import { describe, expect, it } from 'vitest'
import { registerFileReadRoute } from '../src/file-uploads.ts'
import { producedCopyName, producedMediaType } from '../src/produced-copies.ts'

const DIGEST = '2abf4a2f07dfbed60e7930cdbda278b33583587ef42616851e8109f333815503'
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
const URL_INLINE = `http://localhost/api/attachment-file?sessionId=s-1&id=sha256:${DIGEST}`

/** A produced image's copy as a tool result shares it: an image block, not a file block. */
function image(name?: string): StoredImageAttachment {
  return {
    ref: {
      attachmentId: `sha256:${DIGEST}`, mediaType: 'image/jpeg', bytes: BYTES.byteLength, width: 1736, height: 1830,
      ...(name === undefined ? {} : { name }),
    },
    data: BYTES,
  } as unknown as StoredImageAttachment
}

/** A stored original a user message or tool result cites as a file. */
function file(name: string): StoredFileAttachment {
  return {
    ref: { attachmentId: `sha256:${DIGEST}`, mediaType: 'application/pdf', bytes: BYTES.byteLength, name },
    data: BYTES,
  } as unknown as StoredFileAttachment
}

/**
 * Mount the route over double readers and return it.
 * @param readFile - the reader of a copy the session cites as a file.
 * @param readImage - the reader of a copy the session cites as an image.
 * @returns the registered request handler.
 */
function routeFor(
  readFile: () => Promise<StoredFileAttachment | undefined>,
  readImage: () => Promise<StoredImageAttachment | undefined>,
) {
  let route: ((request: Request) => Promise<Response>) | undefined
  registerFileReadRoute({
    connection: {
      fetch: {
        register: (entry: { fetch: (request: Request) => Promise<Response> }) => {
          route = entry.fetch
          return () => {}
        },
      },
    },
    effect: (register: () => void) => { register() },
  } as unknown as Context, readFile, readImage)
  if (route === undefined) throw new Error('File route was not registered')
  return route
}

describe('the stored-original route', () => {
  it('serves a copy the session cites as a file', async () => {
    const response = await routeFor(async () => file('report.pdf'), async () => undefined)(new Request(URL_INLINE))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain('filename="report.pdf"')
  })

  it('serves a produced image whose copy the session cites as an image, for its row, its link, and its download', async () => {
    const route = routeFor(async () => undefined, async () => image('Rainbow_High_Set_of_6_Dolls.jpg'))
    const inline = await route(new Request(URL_INLINE))
    const download = await route(new Request(`${URL_INLINE}&download=1`))

    expect(inline.status).toBe(200)
    expect(inline.headers.get('Content-Type')).toBe('image/jpeg')
    expect(new Uint8Array(await inline.arrayBuffer())).toEqual(BYTES)
    expect(download.headers.get('Content-Disposition')).toContain('attachment; filename="Rainbow_High_Set_of_6_Dolls.jpg"')
  })

  it('names an image copy stored without a name after its digest', async () => {
    const response = await routeFor(async () => undefined, async () => image())(new Request(URL_INLINE))

    expect(response.headers.get('Content-Disposition')).toContain('filename="2abf4a2f07df.jpg"')
  })

  it('refuses a copy the session cites neither as a file nor as an image', async () => {
    const response = await routeFor(async () => undefined, async () => undefined)(new Request(URL_INLINE))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'ATTACHMENT_NOT_REFERENCED' })
  })
})

describe('copies named only in produced files', () => {
  /** A tool result whose produced files name a copy, as a desktop records an image it wrote without sharing it. */
  function result(path: string, attachmentId: string): SessionEvent {
    const meta = { producedFiles: [{ path, created: true, attachmentId }] }
    return { type: 'tool/result', seq: 1, time: 0, data: { meta } } as unknown as SessionEvent
  }

  it('finds the produced file a copy belongs to, by its base name, from the latest result naming it', () => {
    const events = [
      result('/Users/elizabethtrejo/.aeven/chats/draft.jpg', 'sha256:3cd4'),
      result('/Users/elizabethtrejo/.aeven/chats/Rainbow_High_Set_of_6_Dolls_preview.jpg', 'sha256:3cd4'),
      result('C:\\Users\\e\\other.png', 'sha256:9eb1'),
    ]

    expect(producedCopyName(events, 'sha256:3cd4')).toBe('Rainbow_High_Set_of_6_Dolls_preview.jpg')
    expect(producedCopyName(events, 'sha256:9eb1')).toBe('other.png')
    expect(producedCopyName(events, 'sha256:none')).toBeUndefined()
  })

  it('takes the media type the produced name declares, bytes for an unknown one', () => {
    expect(producedMediaType('Rainbow.JPG')).toBe('image/jpeg')
    expect(producedMediaType('deck.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(producedMediaType('notes')).toBe('application/octet-stream')
    expect(producedMediaType('model.blend')).toBe('application/octet-stream')
  })
})
