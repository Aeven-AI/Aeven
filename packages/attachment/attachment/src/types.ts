/** Durable attachment vocabulary. @module @aeven/attachment/types */

import type { AttachmentId, ImageVariantId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Durable, serializable reference to one immutable normalized image. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/**
 * Browser-submitted prompt content accepted by Host prompt endpoints; the
 * accepting Host promotes image parts to durable references and claims file
 * uploads through `admitPromptContent` before any message is created, so a
 * wire caller can never cite an attachment it did not upload.
 */
export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: ImageMediaType
    readonly data: string
    readonly name?: string
  }
  | {
    readonly type: 'file'
    /** Single-use identifier returned by the Host upload route. */
    readonly uploadId: string
  }

/** Host-admitted prompt content with each upload replaced by its durable reference. */
export type AdmittedPromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }

/** How a file's text was obtained. */
export type FileTextMethod = 'native' | 'office' | 'ocr'

/** Durable reference to the immutable text extracted from one file. */
export interface FileTextRef {
  /** Content address of the UTF-8 text object. */
  textId: AttachmentId
  /** Character count of the stored text. */
  chars: number
  method: FileTextMethod
  /** Provider and version that produced the text. */
  extractor: string
  /** Whether the text was cut at the deployment's character budget. */
  truncated: boolean
  /** Page, slide, or sheet count when the format has one. */
  pages?: number
}

/** Durable, serializable reference to one immutable uploaded file. */
export interface FileAttachmentRef {
  /** Content address of the original bytes; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Browser-declared media type, lowercased; `application/octet-stream` when none was declared. */
  mediaType: string
  /** Exact original byte length. */
  bytes: number
  /** Display name stripped of local path information. */
  name: string
  /** Extracted text the model receives in place of the original bytes. */
  extraction: FileTextRef
}

/** Deployment-resolved limits used by upload admission and prompt admission. */
export interface FileAttachmentLimits {
  /** Maximum original bytes of one uploaded file. */
  maxFileBytes: number
  /** Maximum files in one prompt. */
  maxFilesPerMessage: number
  /** Maximum aggregate original bytes of the files in one prompt. */
  maxMessageFileBytes: number
  /** Lifetime of an unclaimed upload in milliseconds. */
  uploadTtlMs: number
}

/** Request to durably commit one file and its extracted text. */
export interface SaveFileAttachment {
  data: Uint8Array
  /** Browser-declared media type, possibly empty. */
  mediaType: string
  /** Display name; it is never interpreted as a path. */
  name: string
  /** Extraction output recorded beside the original. */
  text: {
    readonly text: string
    readonly method: FileTextMethod
    readonly extractor: string
    readonly truncated: boolean
    readonly pages?: number
  }
}

/** Stored original bytes returned after reference and digest verification. */
export interface StoredFileAttachment {
  ref: FileAttachmentRef
  data: Uint8Array
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Deterministic request-image policy selected by one exact model route. */
export interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte target before base64 expansion or Files API upload; the smallest quality-ladder output is kept when no quality fits. */
  maxBytes: number
}

/** Cached request version derived from one provider-independent normalized attachment. */
export interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
