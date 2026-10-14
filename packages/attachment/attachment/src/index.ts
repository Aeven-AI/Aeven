/** Durable attachment storage seam (`ctx.attachments`). @module @aeven/attachment */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { UploadId } from './brand.ts'
import { AttachmentError } from './error.ts'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  SaveFileAttachment,
  StoredFileAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId, UploadId } from './brand.ts'
export { AttachmentError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedImages, admitPromptContent } from './admission.ts'
export { requestImageDimensions } from './request-projection.ts'
export type { UploadId as UploadIdType } from './brand.ts'
export type {
  AttachmentId as AttachmentIdType,
  AdmittedPromptContentPart,
  EncodedImageAttachment,
  FileAttachmentLimits,
  FileAttachmentRef,
  FileTextMethod,
  FileTextRef,
  SaveFileAttachment,
  StoredFileAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  PromptContentPart,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Validate and durably commit one ordered image batch.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * The returned reference describes the persisted normalized image. When
   * normalization reduces the raster, its `originalDimensions` records the
   * orientation-applied input dimensions.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed normalized image reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and normalized attachment reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Locate the provider-owned normalized object in the harness host filesystem.
   * @param ref - durable normalized attachment reference.
   * @returns an absolute host path, or undefined when this backend is not host-file-backed.
   * @throws an AttachmentError when the durable reference is invalid.
   */
  imageHostPath(ref: ImageAttachmentRef): string | undefined {
    void ref
    return undefined
  }

  /**
   * Generate or read one deterministic model-request version from the stored normalized image.
   * @param ref - durable provider-independent normalized attachment reference.
   * @param policy - exact route pixel budget and encoded-byte target; a target no ladder quality meets yields the smallest ladder output.
   * @param signal - optional cancellation.
   * @returns request bytes and the cache/upload identity covering every transform input.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

  /** Deployment file policy; undefined when this backend stores no files. */
  get fileLimits(): FileAttachmentLimits | undefined {
    return undefined
  }

  /**
   * Durably commit one file and its extracted text.
   * @param input - original bytes, display facts, and extraction output.
   * @returns the durable reference covering both objects.
   */
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    void input
    return Promise.reject(new AttachmentError('The mounted attachment provider stores no files.', 'FILES_UNSUPPORTED'))
  }

  /**
   * Read one file's original bytes and verify them against the reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation.
   * @returns the verified bytes and reference.
   */
  readFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachment> {
    void ref
    return this.filesUnsupported(signal)
  }

  /**
   * Read one file's extracted text and verify it against the reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation.
   * @returns the stored text.
   */
  readFileText(ref: FileAttachmentRef, signal?: AbortSignal): Promise<string> {
    void ref
    return this.filesUnsupported(signal)
  }

  /**
   * Reject a file read on a backend that stores no files.
   * @param signal - optional cancellation; its reason is thrown before the rejection.
   * @returns a rejection carrying the unsupported-files error.
   */
  private filesUnsupported(signal?: AbortSignal): Promise<never> {
    signal?.throwIfAborted()
    return Promise.reject(new AttachmentError('The mounted attachment provider stores no files.', 'FILES_UNSUPPORTED'))
  }

  /**
   * Locate the stored original in the harness host filesystem.
   * @param ref - durable file reference.
   * @returns an absolute host path, or undefined when this backend is not host-file-backed.
   */
  fileHostPath(ref: FileAttachmentRef): string | undefined {
    void ref
    return undefined
  }

  private readonly uploads = new Map<UploadId, { readonly ref: FileAttachmentRef; readonly expiresAt: number }>()

  private sweepUploads(now: number): void {
    for (const [id, upload] of this.uploads) if (upload.expiresAt <= now) this.uploads.delete(id)
  }

  /**
   * Stage one committed file for a later prompt. The returned id is an
   * unguessable single-use capability: only the authenticated uploader
   * receives it, and admission consumes it.
   * @param ref - durable reference already committed through {@link saveFile}.
   * @returns the staged-upload identifier.
   */
  stageUpload(ref: FileAttachmentRef): UploadId {
    const limits = this.fileLimits
    if (limits === undefined) throw new AttachmentError('The mounted attachment provider stores no files.', 'FILES_UNSUPPORTED')
    const now = Date.now()
    this.sweepUploads(now)
    const id = UploadId(`upload-${randomUUID()}`)
    this.uploads.set(id, { ref, expiresAt: now + limits.uploadTtlMs })
    return id
  }

  /**
   * Resolve staged uploads without consuming them.
   * @param ids - staged-upload identifiers in prompt order.
   * @returns durable references in the same order.
   * @throws AttachmentError when any id is unknown or expired.
   */
  peekUploads(ids: readonly string[]): readonly FileAttachmentRef[] {
    this.sweepUploads(Date.now())
    return ids.map((id) => {
      const upload = this.uploads.get(UploadId(id))
      if (upload === undefined) throw new AttachmentError('File upload is unknown or expired; attach the file again.', 'FILE_UPLOAD_UNKNOWN')
      return upload.ref
    })
  }

  /**
   * Consume staged uploads after their owning prompt is admitted.
   * @param ids - staged-upload identifiers.
   */
  claimUploads(ids: readonly string[]): void {
    for (const id of ids) this.uploads.delete(UploadId(id))
  }

  /**
   * Drop one staged upload the user removed before sending. The committed
   * objects stay: they are content-addressed and may be shared.
   * @param id - staged-upload identifier.
   * @returns whether the id was staged.
   */
  discardUpload(id: string): boolean {
    return this.uploads.delete(UploadId(id))
  }

}

export default AttachmentStore
