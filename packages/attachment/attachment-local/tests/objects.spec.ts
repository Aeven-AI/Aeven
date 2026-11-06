/**
 * Object-level access moves stored attachments between stores byte for byte: an imported object reads back
 * unchanged under its address, and bytes that do not match their address are refused.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentId } from '@aeven/attachment'
import LocalAttachmentStore from '../src/index.ts'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }) })

async function store(ctx = new Context()): Promise<LocalAttachmentStore> {
  const avnHome = await mkdtemp(join(tmpdir(), 'avn-attachment-objects-'))
  homes.push(avnHome)
  return new LocalAttachmentStore(ctx, { avnHome })
}

const addressOf = (data: Uint8Array): AttachmentId => AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`)

describe('attachment objects', () => {
  it('retrieves a missing object through the registered handler before reading it', async () => {
    const ctx = new Context()
    const target = await store(ctx)
    const data = new Uint8Array([6, 7, 8])
    const id = addressOf(data)
    const dispose = ctx.on('attachment/missing', async (missing, _signal, next) => {
      if (missing !== id) return next()
      await target.importObject(id, data)
      return true
    })
    try {
      expect(await target.readObject(id)).toEqual(data)
    } finally {
      dispose()
    }
  })

  it('retrieves extracted text independently of the original video', async () => {
    const source = await store()
    const ctx = new Context()
    const target = await store(ctx)
    const saved = await source.saveFile({ data: new Uint8Array([9]), mediaType: 'video/mp4', name: 'video.mp4', text: { text: 'Video description', method: 'native', extractor: 'video@2', truncated: false } })
    const dispose = ctx.on('attachment/missing', async (id) => {
      expect(id).toBe(saved.extraction.textId)
      await target.importObject(id, await source.readObject(id))
      return true
    })
    try {
      expect(await target.readFileText(saved)).toBe('Video description')
      expect(await target.hasObject(saved.attachmentId)).toBe(false)
    } finally {
      dispose()
    }
  })

  it('imports an object under its address and reads it back unchanged', async () => {
    const source = await store()
    const target = await store()
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const id = addressOf(data)
    expect(await target.hasObject(id)).toBe(false)
    await source.importObject(id, data)
    const copied = await source.readObject(id)
    await target.importObject(id, copied)
    expect(await target.hasObject(id)).toBe(true)
    expect(await target.readObject(id)).toEqual(data)
  })

  it('refuses bytes that do not match their address and a malformed address', async () => {
    const target = await store()
    await expect(target.importObject(addressOf(new Uint8Array([1])), new Uint8Array([2]))).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await expect(target.hasObject(AttachmentId('sha256:nope'))).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
    await expect(target.readObject(addressOf(new Uint8Array([9])))).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
  })
})
