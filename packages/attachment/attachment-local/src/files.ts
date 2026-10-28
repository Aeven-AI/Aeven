/** Content-addressed storage of uploaded files and their extracted text. */

import { AttachmentError, AttachmentId } from '@aeven/attachment'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  SaveFileAttachment,
  StoredFileAttachment,
} from '@aeven/attachment'
import { cleanDisplayName, objectDigest, objectPath, publishObject, readObject } from './store.ts'

const ID_PATTERN = /^sha256:([a-f0-9]{64})$/

/**
 * The hex digest of a content address.
 * @param id - `sha256:<hex>` content address.
 * @returns the lowercase hex digest.
 * @throws {AttachmentError} when the address is malformed.
 */
export function addressOf(id: AttachmentId): string {
  const match = ID_PATTERN.exec(String(id))
  if (match?.[1] === undefined) throw new AttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  return match[1]
}

/**
 * Validate, then durably publish one file and its extracted text as two
 * immutable objects; the reference is returned only after both are durable.
 * @param root - absolute `AVN_HOME/attachments/v1` root.
 * @param input - original bytes, display facts, and extraction output.
 * @param limits - deployment file policy.
 * @returns the durable reference.
 */
export async function saveFileObjects(
  root: string,
  input: SaveFileAttachment,
  limits: FileAttachmentLimits,
): Promise<FileAttachmentRef> {
  if (input.data.byteLength === 0) throw new AttachmentError('File is empty.', 'FILE_EMPTY')
  if (input.data.byteLength > limits.maxFileBytes) {
    throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
  }
  const textBytes = new TextEncoder().encode(input.text.text)
  const originalSha = objectDigest(input.data)
  const textSha = objectDigest(textBytes)
  await publishObject(root, originalSha, input.data)
  await publishObject(root, textSha, textBytes)
  const mediaType = input.mediaType.trim().toLowerCase()
  return {
    attachmentId: AttachmentId(`sha256:${originalSha}`),
    mediaType: mediaType === '' ? 'application/octet-stream' : mediaType,
    bytes: input.data.byteLength,
    name: cleanDisplayName(input.name) ?? 'file',
    extraction: {
      textId: AttachmentId(`sha256:${textSha}`),
      chars: input.text.text.length,
      method: input.text.method,
      extractor: input.text.extractor,
      truncated: input.text.truncated,
      ...input.text.pages === undefined ? {} : { pages: input.text.pages },
    },
  }
}

/**
 * Read one stored original and verify digest and length.
 * @param root - absolute `AVN_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation.
 * @returns verified bytes and reference.
 */
export async function readFileObject(root: string, ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachment> {
  const data = await readObject(root, addressOf(ref.attachmentId), signal)
  if (data.byteLength !== ref.bytes) throw new AttachmentError('Stored file does not match its reference.', 'ATTACHMENT_CORRUPT')
  return { ref, data }
}

/**
 * Read one stored text object and verify digest and length.
 * @param root - absolute `AVN_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation.
 * @returns the extracted text.
 */
export async function readFileTextObject(root: string, ref: FileAttachmentRef, signal?: AbortSignal): Promise<string> {
  const data = await readObject(root, addressOf(ref.extraction.textId), signal)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  if (text.length !== ref.extraction.chars) throw new AttachmentError('Stored file text does not match its reference.', 'ATTACHMENT_CORRUPT')
  return text
}

/**
 * Derive the host path of one stored original.
 * @param root - absolute `AVN_HOME/attachments/v1` root.
 * @param ref - durable file reference.
 * @returns absolute path without reading the object.
 */
export function fileObjectPath(root: string, ref: FileAttachmentRef): string {
  return objectPath(root, addressOf(ref.attachmentId))
}
