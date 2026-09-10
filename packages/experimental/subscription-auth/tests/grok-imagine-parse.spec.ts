import { describe, expect, it } from 'vitest'
import {
  clampImagineImageIds,
  detectImageMediaType,
  GrokImagineError,
  IMAGINE_IMAGE_IDS_MAX,
  IMAGINE_IMAGE_ROUTE_PREFIX,
  imagineImageDownloadHeaders,
  imagineImagePath,
  isSafeImagineAttachmentId,
  parseImagineImagePath,
  parseVideoRequestId,
} from '../src/grok-imagine.ts'

describe('grok-imagine parse helpers', () => {
  it('accepts safe attachment ids and rejects path separators', () => {
    expect(isSafeImagineAttachmentId('sha256:abcdef0123456789')).toBe(true)
    expect(isSafeImagineAttachmentId('../etc/passwd')).toBe(false)
    expect(isSafeImagineAttachmentId('a/b')).toBe(false)
    expect(isSafeImagineAttachmentId('')).toBe(false)
  })

  it('parses same-origin imagine image paths', () => {
    const id = 'sha256:abcdef0123456789'
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}${encodeURIComponent(id)}`)).toBe(id)
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}../escape`)).toBeUndefined()
    expect(parseImagineImagePath('/other/path')).toBeUndefined()
  })

  it('validates video request ids at the tool boundary', () => {
    expect(parseVideoRequestId('req_ABC-123')).toBe('req_ABC-123')
    expect(() => parseVideoRequestId('bad id')).toThrow(GrokImagineError)
    expect(() => parseVideoRequestId(42)).toThrow(GrokImagineError)
  })

  it('clamps imagine image id arrays', () => {
    expect(clampImagineImageIds(['a'])).toEqual(['a'])
    expect(() => clampImagineImageIds([])).toThrow(GrokImagineError)
    expect(() => clampImagineImageIds(Array.from({ length: IMAGINE_IMAGE_IDS_MAX + 1 }, (_, i) => `id${i}`))).toThrow(
      GrokImagineError,
    )
    expect(() => clampImagineImageIds([''])).toThrow(GrokImagineError)
  })

  it('builds an encoded same-origin route only for a safe attachment id', () => {
    const id = `sha256:${'ab'.repeat(32)}`
    expect(imagineImagePath(id)).toBe(`${IMAGINE_IMAGE_ROUTE_PREFIX}sha256%3A${'ab'.repeat(32)}`)
    expect(() => imagineImagePath('../escape')).toThrow(GrokImagineError)
    expect(() => imagineImagePath('')).toThrow(GrokImagineError)
  })

  it('rejects empty, control, over-long, and non-decodable route suffixes', () => {
    expect(parseImagineImagePath(IMAGINE_IMAGE_ROUTE_PREFIX)).toBeUndefined()
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}att\\id`)).toBeUndefined()
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}att\u0000id`)).toBeUndefined()
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}%`)).toBeUndefined()
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}%E0%A4%A`)).toBeUndefined()
    // Decodes to `/`, which the attachment-id contract rejects.
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}%2F`)).toBeUndefined()
    // 129 decoded characters is past the ceiling; 128 is exactly at it.
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}${'a'.repeat(129)}`)).toBeUndefined()
    expect(parseImagineImagePath(`${IMAGINE_IMAGE_ROUTE_PREFIX}${encodeURIComponent('a'.repeat(128))}`)).toBe(
      'a'.repeat(128),
    )
  })

  it('refuses a non-array imageIds argument', () => {
    expect(() => clampImagineImageIds('abc' as unknown as readonly unknown[])).toThrow(GrokImagineError)
    expect(() => clampImagineImageIds(undefined as unknown as readonly unknown[])).toThrow(GrokImagineError)
  })
})

describe('imagine image byte sniffing', () => {
  it('detects WebP only when the whole RIFF/WEBP signature matches', () => {
    const riff = (bytes: number[]): Uint8Array => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, ...bytes])
    expect(detectImageMediaType(riff([0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    expect(detectImageMediaType(riff([0x57, 0x45, 0x42]))).toBeUndefined()
    expect(detectImageMediaType(riff([0x00, 0x45, 0x42, 0x50]))).toBeUndefined()
    expect(detectImageMediaType(riff([0x57, 0x00, 0x42, 0x50]))).toBeUndefined()
    expect(detectImageMediaType(riff([0x57, 0x45, 0x00, 0x50]))).toBeUndefined()
    expect(detectImageMediaType(riff([0x57, 0x45, 0x42, 0x00]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x52, 0x00, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x52, 0x49, 0x00, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x52, 0x49, 0x46, 0x00, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeUndefined()
  })

  it('detects both GIF87a and GIF89a and rejects every partial signature', () => {
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe('image/gif')
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00]))).toBe('image/gif')
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x00, 0x61]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x00]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x00, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x00, 0x46, 0x38, 0x37, 0x61]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x00, 0x38, 0x37, 0x61]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x00, 0x37, 0x61]))).toBeUndefined()
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37]))).toBeUndefined()
  })
})

describe('imagine download disposition', () => {
  it('falls back to a percent-encoded filename when the legacy token would break quoting', () => {
    const header = imagineImageDownloadHeaders({
      attachmentId: 'att"q\'uote',
      mediaType: 'image/png',
      bytes: 10,
      width: 1,
      height: 1,
    })
    expect(header['Content-Disposition']).toBe(
      'inline; filename="imagine-attq\'uote.png"; filename*=UTF-8\'\'imagine-att%22q%27uote.png',
    )
    // Every byte of the rendered header stays printable ASCII, so no header
    // injection is possible through the attachment id.
    expect(header['Content-Disposition']).not.toMatch(/[^\x20-\x7e]/u)
  })

  it('encodes a non-ASCII filename instead of emitting raw bytes', () => {
    const header = imagineImageDownloadHeaders({
      attachmentId: 'atté',
      mediaType: 'image/webp',
      bytes: 10,
      width: 1,
      height: 1,
    })
    expect(header['Content-Disposition']).toBe(
      'inline; filename="imagine-att.webp"; filename*=UTF-8\'\'imagine-att%C3%A9.webp',
    )
    expect(header['Content-Length']).toBe('10')
  })

  it('refuses a download filename that no longer fits the header ceiling', () => {
    expect(() =>
      imagineImageDownloadHeaders({
        attachmentId: 'a'.repeat(250),
        mediaType: 'image/gif',
        bytes: 10,
        width: 1,
        height: 1,
      }),
    ).toThrow(GrokImagineError)
  })
})
