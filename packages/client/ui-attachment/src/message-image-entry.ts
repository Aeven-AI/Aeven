import type { ImageAttachmentRef } from '@aeven/attachment'
import type { LightboxImage } from '@aeven/client-ui-primitives'

/** One message image a lightbox entry can be built from: a durable admitted reference, or a submission echo's local preview. */
export type MessageImageEntrySource =
  | { readonly attachment: ImageAttachmentRef }
  | {
    readonly preview: {
      readonly url: string
      readonly name?: string | undefined
    }
  }

/**
 * A filename for a stored image that carries none: the first bytes of its
 * content digest and the extension its media type names. The lightbox titles
 * the image with it and a download is saved under it, so an unnamed attachment
 * is never reported as `unknown`.
 * @param attachment - the durable reference, which has an id and a media type.
 * @returns the file name to show.
 */
export function derivedFileName(attachment: { attachmentId: string; mediaType: string }): string {
  const digest = attachment.attachmentId.replace(/^sha256:/, '').slice(0, 12)
  const extension = attachment.mediaType === 'image/jpeg' ? 'jpg' : (attachment.mediaType.split('/')[1] ?? 'img')
  return `${digest}.${extension}`
}

/**
 * One lightbox entry of one message image, with the metadata its source
 * carries: a durable reference reports its media type and byte size, and its
 * file name is derived while it stores none. A submission echo's preview has
 * only the URL and name its submitter knew, so its type and size stay unknown
 * until the durable record replaces it.
 *
 * @param image - the durable reference or the echo preview.
 * @param src - resolved URL the entry shows.
 * @param fallbackAlt - accessible text of an image that carries no name.
 * @returns the lightbox entry.
 */
export function messageImageEntry(image: MessageImageEntrySource, src: string, fallbackAlt: string): LightboxImage {
  if ('preview' in image) return { src, alt: image.preview.name ?? fallbackAlt, name: image.preview.name }
  const name = image.attachment.name ?? derivedFileName(image.attachment)
  return { src, alt: name, name, mediaType: image.attachment.mediaType, bytes: image.attachment.bytes }
}
