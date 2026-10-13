/** The registry routes documents to providers by format and priority and applies the text budget. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentExtract, { DocumentExtractError, documentExtension } from '../src/index.ts'
import type { DocumentExtractProvider, DocumentExtractProviderId, ExtractedDocument } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

function registry(maxTextChars = 400_000): DocumentExtract {
  const ctx = new Context()
  roots.push(ctx)
  return new DocumentExtract(ctx, DocumentExtract.Config({ maxTextChars }))
}

function provider(
  id: string,
  priority: number,
  extensions: readonly string[],
  extract: DocumentExtractProvider['extract'],
  mediaTypes: readonly string[] = [],
): DocumentExtractProvider {
  return { info: { id: id as DocumentExtractProviderId, version: '1', formats: { extensions, mediaTypes }, priority }, extract }
}

const text = (value: string): ExtractedDocument => ({ text: value, method: 'native' })
const bytes = new Uint8Array([1])
const signal = new AbortController().signal

describe('document registry', () => {
  it('advertises the union of registered formats until each provider is disposed', () => {
    const service = registry()
    const disposeFirst = service.register(provider('a', 0, ['pdf', 'txt'], async () => text('')))
    const disposeSecond = service.register(provider('b', 1, ['doc', 'pdf'], async () => text(''), ['application/msword']))
    expect(service.accepted()).toEqual({ extensions: ['doc', 'pdf', 'txt'], mediaTypes: ['application/msword'] })
    expect(service.accepts('notes', 'application/msword')).toBe(true)
    expect(service.accepts('file.pages', '')).toBe(false)
    disposeSecond()
    disposeSecond()
    expect(service.accepted().extensions).toEqual(['pdf', 'txt'])
    disposeFirst()
    expect(service.accepted()).toEqual({ extensions: [], mediaTypes: [] })
  })

  it('rejects a duplicate id without replacing the original provider', () => {
    const service = registry()
    service.register(provider('a', 0, ['pdf'], async () => text('')))
    expect(() => service.register(provider('a', 0, ['doc'], async () => text('')))).toThrow('already registered: a')
    expect(service.accepted().extensions).toEqual(['pdf'])
  })

  it('falls through to the next provider when an earlier one returns no text or fails', async () => {
    const service = registry()
    const fails = vi.fn(async () => { throw new Error('broken') })
    service.register(provider('late', 20, ['doc'], async () => ({ text: 'from late', method: 'office', pages: 2 })))
    service.register(provider('empty', 0, ['doc'], async () => text('  ')))
    service.register(provider('fails', 10, ['doc'], fails))
    const result = await service.extract({ data: bytes, name: 'Report.DOC', mediaType: '' }, signal)
    expect(result).toEqual({ text: 'from late', method: 'office', pages: 2, providerId: 'late', extractor: 'late@1', truncated: false })
    expect(fails).toHaveBeenCalledWith(expect.objectContaining({ extension: 'doc' }), signal)
  })

  it('returns the first empty result when no provider finds text', async () => {
    const service = registry()
    service.register(provider('empty', 0, ['pdf'], async () => text('')))
    service.register(provider('fails', 1, ['pdf'], async () => { throw new Error('broken') }))
    expect(await service.extract({ data: bytes, name: 'scan.pdf', mediaType: '' }, signal)).toMatchObject({ text: '', providerId: 'empty' })
  })

  it('reports unsupported formats and failures with stable codes', async () => {
    const service = registry()
    const cause = new Error('broken')
    service.register(provider('fails', 0, ['doc'], async () => { throw cause }))
    await expect(service.extract({ data: bytes, name: 'deck.key', mediaType: '' }, signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: 'No document reader accepts "key" files.' })
    await expect(service.extract({ data: bytes, name: 'blob', mediaType: '' }, signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: 'No document reader accepts "unknown" files.' })
    const failure = await service.extract({ data: bytes, name: 'a.doc', mediaType: '' }, signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DocumentExtractError)
    expect(failure).toMatchObject({ code: 'EXTRACTION_FAILED', cause })
  })

  it('stops at caller cancellation instead of trying later providers', async () => {
    const service = registry()
    const controller = new AbortController()
    const later = vi.fn(async () => text('later'))
    service.register(provider('aborts', 0, ['doc'], async () => { controller.abort(new Error('stop')); throw new Error('aborted') }))
    service.register(provider('later', 1, ['doc'], later))
    await expect(service.extract({ data: bytes, name: 'a.doc', mediaType: '' }, controller.signal)).rejects.toThrow('stop')
    expect(later).not.toHaveBeenCalled()
  })

  it('cuts text at the configured budget and marks it truncated', async () => {
    const service = registry(4)
    service.register(provider('a', 0, ['txt'], async () => text('abcdef')))
    expect(await service.extract({ data: bytes, name: 'a.txt', mediaType: '' }, signal)).toMatchObject({ text: 'abcd', truncated: true })
  })
})

describe('documentExtension', () => {
  it('prefers the file name and falls back to the media type', () => {
    expect(documentExtension('Deck.PPT', 'application/pdf')).toBe('ppt')
    expect(documentExtension('.hidden', 'application/msword')).toBe('doc')
    expect(documentExtension('trailing.', 'APPLICATION/PDF')).toBe('pdf')
    expect(documentExtension('blob', 'application/unknown')).toBe('')
  })
})
