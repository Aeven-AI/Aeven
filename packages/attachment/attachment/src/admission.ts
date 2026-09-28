/** Wire-form admission of base64-encoded image uploads. @module @aeven/attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type {
  AdmittedPromptContentPart,
  EncodedImageAttachment,
  FileAttachmentRef,
  ImageAttachmentRef,
  PromptContentPart,
  SaveImageAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}

/**
 * Resolve one prompt's staged file uploads and enforce the deployment file
 * limits without consuming them.
 * @param attachments - the deployment attachment store owning file policy.
 * @param uploadIds - staged-upload identifiers in prompt order.
 * @returns durable references in the same order.
 * @throws AttachmentError when an upload is unknown or the batch exceeds a limit.
 */
function resolveUploads(attachments: AttachmentStore, uploadIds: readonly string[]): readonly FileAttachmentRef[] {
  const limits = attachments.fileLimits
  if (limits === undefined) throw new AttachmentError('This deployment does not accept file attachments.', 'FILES_UNSUPPORTED')
  if (uploadIds.length > limits.maxFilesPerMessage) {
    throw new AttachmentError('File batch exceeds the configured file-count limit.', 'TOO_MANY_FILES')
  }
  if (new Set(uploadIds).size !== uploadIds.length) {
    throw new AttachmentError('A file upload is cited more than once.', 'FILE_UPLOAD_UNKNOWN')
  }
  const refs = attachments.peekUploads(uploadIds)
  if (refs.reduce((sum, ref) => sum + ref.bytes, 0) > limits.maxMessageFileBytes) {
    throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
  }
  return refs
}

/**
 * Admit one browser prompt and replace each upload with its durable reference.
 * File uploads are resolved and checked first, images are admitted next, and
 * the file uploads are consumed only after every member succeeded. Text-only
 * prompts do not access the attachment store.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param content - browser prompt parts in message order.
 * @returns admitted prompt parts in the same order as `content`.
 * @throws AttachmentError when the image batch or a file upload is refused.
 */
export async function admitPromptContent(
  attachments: AttachmentStore,
  content: readonly PromptContentPart[],
): Promise<AdmittedPromptContentPart[]> {
  if (content.every(part => part.type === 'text')) {
    return content.map(part => ({ type: 'text', text: part.text }))
  }
  const uploadIds = content.flatMap(part => part.type === 'file' ? [part.uploadId] : [])
  const files = uploadIds.length === 0 ? [] : resolveUploads(attachments, uploadIds)
  const images = content.flatMap(part => part.type === 'image' ? [part] : [])
  const refs = images.length === 0 ? [] : await admitEncodedImages(attachments, images)
  attachments.claimUploads(uploadIds)
  let nextImage = 0
  let nextFile = 0
  return content.map((part): AdmittedPromptContentPart => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text }
      case 'image':
        // admitEncodedImages returns one reference per image part in order.
        return { type: 'image', attachment: refs[nextImage++] as ImageAttachmentRef }
      case 'file':
        // resolveUploads returns one reference per file part in order.
        return { type: 'file', attachment: files[nextFile++] as FileAttachmentRef }
    }
  })
}
