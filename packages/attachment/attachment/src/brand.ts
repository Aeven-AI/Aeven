/** Attachment identifier brand. @module @aeven/attachment/brand */

import type { Branded } from '@aeven/brand'

/** Opaque content-addressed identifier for one immutable attachment object. */
export type AttachmentId = Branded<'AttachmentId'>

/**
 * Brand a validated storage identifier.
 * @param value - backend-produced opaque identifier.
 * @returns the branded identifier.
 */
export function AttachmentId(value: string): AttachmentId {
  return value as AttachmentId
}

/** Opaque deterministic identity for one request-image transformation. */
export type ImageVariantId = Branded<'ImageVariantId'>

/**
 * Brand a validated request-image transformation identifier.
 * @param value - attachment-provider-produced opaque identifier.
 * @returns the branded identifier.
 */
export function ImageVariantId(value: string): ImageVariantId {
  return value as ImageVariantId
}

/** Single-use identifier of one staged file upload awaiting prompt admission. */
export type UploadId = Branded<'UploadId'>

/**
 * Brand a staged-upload identifier.
 * @param value - store-minted identifier.
 * @returns the branded identifier.
 */
export function UploadId(value: string): UploadId {
  return value as UploadId
}
