// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@aeven/attachment'
import type { SessionFace } from '@aeven/api-session-controller/client'
import { RemoteError, SlotTestRuntime } from '@aeven/client-test-runtime'
import { HistoricalImageCache } from '../src/client/conversation/historical-images.ts'

/** The durable reference every case resolves. */
const ATTACHMENT = {
  attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
} as const

/**
 * Run `body` without a browser document. The cache reads bytes through the
 * Session binding and mints an object URL only in that environment; a browser
 * reads the stored object from its own durable URL.
 * @param body - the case's work.
 */
async function withoutDocument(body: () => Promise<void>): Promise<void> {
  vi.stubGlobal('document', undefined)
  try {
    await body()
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('HistoricalImageCache', () => {
  it('serves the durable image URL in a browser without reading bytes', async () => {
    const readAttachment = vi.fn<SessionFace['readAttachment']>()
    const runtime = await SlotTestRuntime.create()
    const sessionId = await runtime.sessions.add({ id: 's1', session: { readAttachment } })
    const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)

    const url = await cache.resolve(sessionId, ATTACHMENT)
    expect(url).toContain('/api/attachment-image')
    expect(url).toContain(`id=${String(ATTACHMENT.attachmentId)}`)
    expect(url).toContain('type=image%2Fpng')
    expect(url).toContain('bytes=1')
    // The reference carries every fact the route verifies, so the page never
    // reads the bytes back through the Session binding.
    expect(readAttachment).not.toHaveBeenCalled()

    // An adopted submission preview is synchronous, and a second seed for the
    // same reference is refused: the first one owns the URL. A reference the
    // cache already resolved owns its entry and refuses a seed.
    expect(cache.seed(sessionId, ATTACHMENT, 'blob:seeded')).toBe(false)
    const preview = { ...ATTACHMENT, attachmentId: AttachmentId('image-preview') }
    expect(cache.seed(sessionId, preview, 'blob:seeded')).toBe(true)
    expect(cache.peek(sessionId, preview)).toBe('blob:seeded')
    expect(cache.seed(sessionId, preview, 'blob:duplicate')).toBe(false)

    // Releasing the Session binding drops the entry with the preview it owned.
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      await runtime.sessions.remove(sessionId)
      await Promise.resolve()
      expect(cache.peek(sessionId, ATTACHMENT)).toBeUndefined()
      expect(revoked).toHaveBeenCalledWith('blob:seeded')
    } finally {
      revoked.mockRestore()
    }
    await runtime.dispose()
  })

  it('invalidates a pending image load when its Session binding is released', async () => {
    await withoutDocument(async () => {
      const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
      const runtime = await SlotTestRuntime.create()
      const sessionId = await runtime.sessions.add({
        id: 's1',
        session: { readAttachment: () => read.promise },
      })
      const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)

      const pending = cache.resolve(sessionId, ATTACHMENT)
      await runtime.sessions.remove(sessionId)
      read.resolve({ ok: true, value: { attachment: ATTACHMENT, data: Uint8Array.of(1) } })

      await expect(pending).rejects.toThrow('ui-conversation image scope was released before loading completed')
      await runtime.dispose()
    })
  })

  it('shows a seeded URL synchronously, replaces it with canonical bytes, and revokes both', async () => {
    await withoutDocument(async () => {
      const revoked: string[] = []
      const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canonical')
      const originalRevoke = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = (url: string) => { revoked.push(url) }
      try {
        const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
        const runtime = await SlotTestRuntime.create()
        const sessionId = await runtime.sessions.add({ id: 's1', session: { readAttachment: () => read.promise } })
        const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
        const attachment = {
          attachmentId: AttachmentId('image-seeded'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
        } as const

        expect(cache.seed(sessionId, attachment, 'blob:seeded')).toBe(true)
        expect(cache.peek(sessionId, attachment)).toBe('blob:seeded')
        expect(cache.seed(sessionId, attachment, 'blob:duplicate')).toBe(false)
        const canonical = cache.resolve(sessionId, attachment)
        read.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })
        await expect(canonical).resolves.toBe('blob:canonical')
        expect(cache.peek(sessionId, attachment)).toBe('blob:canonical')
        expect(revoked).toContain('blob:seeded')

        await runtime.sessions.remove(sessionId)
        await Promise.resolve()
        expect(revoked).toContain('blob:canonical')
        await runtime.dispose()
      } finally {
        created.mockRestore()
        URL.revokeObjectURL = originalRevoke
      }
    })
  })

  it('revokes a seeded preview when canonical bytes cannot be read', async () => {
    await withoutDocument(async () => {
      const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
      try {
        const runtime = await SlotTestRuntime.create()
        const sessionId = await runtime.sessions.add({
          id: 's1',
          session: {
            readAttachment: () => Promise.resolve({
              ok: false,
              error: new RemoteError('session/attachment-invalid', 'missing', { reason: 'missing' }),
            } as never),
          },
        })
        const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
        const attachment = {
          attachmentId: AttachmentId('image-missing'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
        } as const

        expect(cache.seed(sessionId, attachment, 'blob:seeded')).toBe(true)
        await expect(cache.resolve(sessionId, attachment)).rejects.toThrow('attachment-invalid: missing')
        expect(cache.peek(sessionId, attachment)).toBeUndefined()
        expect(revoked).toHaveBeenCalledWith('blob:seeded')
        await runtime.dispose()
      } finally {
        revoked.mockRestore()
      }
    })
  })

  it('refuses to seed for an unknown session', async () => {
    const runtime = await SlotTestRuntime.create()
    const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
    const attachment = {
      attachmentId: AttachmentId('image-unknown'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } as const
    expect(cache.seed('missing' as never, attachment, 'blob:orphan')).toBe(false)
    await runtime.dispose()
  })
})
