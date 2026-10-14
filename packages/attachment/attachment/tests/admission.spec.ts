import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '@aeven/attachment'
import { AttachmentError, admitEncodedImages, admitPromptContent } from '@aeven/attachment'
import type { FileAttachmentRef, ImageAttachmentRef, SaveImageAttachment } from '@aeven/attachment/types'

const PNG = 'AAAA' // canonical base64, 3 bytes

/** Delegation double: records the exact saveImages batch and answers ordered refs. */
function storeOf() {
  const store = {
    saveImages: vi.fn((inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map((input, index): ImageAttachmentRef => ({
      attachmentId: `att-${index + 1}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })))),
    claimUploads: vi.fn(),
  }
  return { store: store as unknown as AttachmentStore, mocks: store }
}

/** One staged file upload as the store hands it out. */
function uploadRef(attachmentId: string, bytes: number): FileAttachmentRef {
  return {
    attachmentId: attachmentId as FileAttachmentRef['attachmentId'],
    mediaType: 'text/plain',
    bytes,
    name: `${attachmentId}.txt`,
    extraction: {
      textId: `${attachmentId}-text` as FileAttachmentRef['attachmentId'],
      chars: 4,
      method: 'native',
      extractor: 'test',
      truncated: false,
    },
  }
}

/** Store double over one staged-upload set, so file admission and its claim are observable. */
function fileStoreOf(uploads: Readonly<Record<string, FileAttachmentRef>>) {
  const base = storeOf()
  const peekUploads = vi.fn((ids: readonly string[]) =>
    ids.map(id => uploads[id] as FileAttachmentRef))
  const store = {
    ...base.mocks,
    fileLimits: { maxFileBytes: 64, maxFilesPerMessage: 2, maxMessageFileBytes: 100, uploadTtlMs: 60_000 },
    peekUploads,
  }
  return { store: store as unknown as AttachmentStore, mocks: store }
}

describe('admitEncodedImages', () => {
  it('decodes every member and delegates one ordered batch to saveImages', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [
      { mediaType: 'image/png', data: PNG, name: 'first.png' },
      { mediaType: 'image/jpeg', data: PNG, name: 'second.jpg' },
    ])
    expect(mocks.saveImages).toHaveBeenCalledTimes(1)
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect(batch.map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['first.png', 'image/png', 3], ['second.jpg', 'image/jpeg', 3]])
    expect(refs.map(ref => ref.attachmentId)).toEqual(['att-1', 'att-2'])
  })

  it('omits the name from store inputs when the upload has none', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [{ mediaType: 'image/webp', data: PNG }])
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect('name' in (batch[0] as object)).toBe(false)
    expect(refs[0]?.name).toBeUndefined()
  })

  it('delegates an empty batch unchanged', async () => {
    const { store, mocks } = storeOf()
    await expect(admitEncodedImages(store, [])).resolves.toEqual([])
    expect(mocks.saveImages).toHaveBeenCalledWith([])
  })

  it('rejects non-canonical and empty base64 payloads before any store call', async () => {
    const { store, mocks } = storeOf()
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data }]))
        .rejects.toMatchObject({ name: 'AttachmentError', code: 'INVALID_IMAGE_BASE64' })
    }
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it('propagates the store batch rejection unchanged', async () => {
    const { store, mocks } = storeOf()
    const refused = Object.assign(new Error('Image batch exceeds the configured image-count limit.'), { code: 'TOO_MANY_IMAGES' })
    mocks.saveImages.mockRejectedValueOnce(refused)
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: PNG }])).rejects.toBe(refused)
  })
})

describe('admitPromptContent', () => {
  it('converts text-only prompts without touching the attachment store', async () => {
    const store = { saveImages: () => { throw new Error('text-only prompts must not reach the store') } }
    await expect(admitPromptContent(store as unknown as AttachmentStore, [
      { type: 'text', text: 'hello' },
    ])).resolves.toEqual([{ type: 'text', text: 'hello' }])
  })

  it('replaces image parts with admitted references in part order', async () => {
    const { store, mocks } = storeOf()
    await expect(admitPromptContent(store, [
      { type: 'image', mediaType: 'image/png', data: 'AQ==' },
      { type: 'text', text: 'between' },
      { type: 'image', mediaType: 'image/png', data: 'Ag==' },
    ])).resolves.toEqual([
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
      { type: 'text', text: 'between' },
      { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
    ])
    expect(mocks.claimUploads).toHaveBeenCalledWith([])
  })

  it('resolves staged uploads in prompt order and claims them once the prompt is admitted', async () => {
    const { store, mocks } = fileStoreOf({ 'upl-1': uploadRef('file-1', 3), 'upl-2': uploadRef('file-2', 4) })

    await expect(admitPromptContent(store, [
      { type: 'file', uploadId: 'upl-2' },
      { type: 'text', text: 'between' },
      { type: 'file', uploadId: 'upl-1' },
    ])).resolves.toEqual([
      { type: 'file', attachment: uploadRef('file-2', 4) },
      { type: 'text', text: 'between' },
      { type: 'file', attachment: uploadRef('file-1', 3) },
    ])
    expect(mocks.peekUploads).toHaveBeenCalledWith(['upl-2', 'upl-1'])
    expect(mocks.claimUploads).toHaveBeenCalledTimes(1)
    expect(mocks.claimUploads).toHaveBeenCalledWith(['upl-2', 'upl-1'])
  })

  it('leaves staged uploads unclaimed when the image batch is refused', async () => {
    const { store, mocks } = fileStoreOf({ 'upl-1': uploadRef('file-1', 3) })
    mocks.saveImages.mockRejectedValueOnce(
      new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES'),
    )

    await expect(admitPromptContent(store, [
      { type: 'file', uploadId: 'upl-1' },
      { type: 'image', mediaType: 'image/png', data: 'AQ==' },
    ])).rejects.toMatchObject({ code: 'TOO_MANY_IMAGES' })
    expect(mocks.claimUploads).not.toHaveBeenCalled()
  })
})
