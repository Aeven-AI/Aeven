import { useCallback, useMemo, useState } from 'react'
import type { MessageImagesProps } from '@aeven/client-ui-chat/client'
import type { MessageFileSource, MessageImageSource } from '@aeven/client-ui-conversation/client'
import { ImageLightbox } from '@aeven/client-ui-primitives'
import type { LightboxImage } from '@aeven/client-ui-primitives'
import { imageKey, resolvedUrl, useImageResolutions } from '../image-resolutions.ts'
import { ImageGallery } from '../MessageImage.tsx'
import { UploadTray } from '../UploadTray.tsx'
import type { UploadTrayFileItem, UploadTrayImageItem } from '../UploadTray.tsx'
import { lightboxLabels, messageImageLabels, uploadTrayLabels } from './labels.ts'

/** Sent-message tray tile retaining what its open action needs. */
type MessageTrayItem =
  | UploadTrayImageItem & { image: MessageImageSource }
  | UploadTrayFileItem & { file: MessageFileSource }

/** Lightbox entry of one resolved message image, with the metadata its source carries. */
function lightboxImage(image: MessageImageSource, src: string, alt: string): LightboxImage {
  if ('preview' in image) return { src, alt, name: image.preview.name }
  return { src, alt, name: image.attachment.name, mediaType: image.attachment.mediaType, bytes: image.attachment.bytes }
}

/**
 * Sent-message tile grid: images then files in one wrapping tray, the
 * counterpart of the composer tray. An image opens the lightbox and a file
 * opens its stored original in a new tab.
 */
function MessageAttachmentTray({ images, files, turnImages, loadImage, fileUrl, align, t }: MessageImagesProps) {
  // The tray shows this record's images; its preview navigates the Turn's.
  const scope = turnImages === undefined || turnImages.length === 0 ? images : turnImages
  const { resolutions, retry } = useImageResolutions(scope, loadImage)
  const [preview, setPreview] = useState<string | null>(null)
  const closePreview = useCallback(() => { setPreview(null) }, [])
  const items = useMemo<MessageTrayItem[]>(() => [
    ...images.map((image, index): MessageTrayItem => {
      if ('preview' in image) {
        const name = image.preview.name ?? t('image.label')
        return {
          kind: 'image', id: `preview:${image.preview.url}:${index}`, previewUrl: image.preview.url,
          alt: t('image.openOriginalLabel', { label: name }), removeLabel: '', image,
        }
      }
      const resolution = resolutions.get(imageKey(image.attachment))
      const name = image.attachment.name ?? t('image.label')
      return {
        kind: 'image',
        id: `image:${imageKey(image.attachment)}:${index}`,
        previewUrl: resolution !== undefined && 'url' in resolution
          ? resolution.url
          : (loadImage.peek?.(image.attachment) ?? null),
        failed: resolution !== undefined && 'failed' in resolution,
        alt: t('image.openOriginalLabel', { label: name }),
        removeLabel: '',
        image,
      }
    }),
    ...(files ?? []).map((file, index): MessageTrayItem => {
      const { name, mediaType } = 'attachment' in file ? file.attachment : file.preview
      return {
        kind: 'file',
        id: 'attachment' in file ? `file:${String(file.attachment.attachmentId)}:${index}` : `file-preview:${name}:${index}`,
        name,
        mediaType,
        status: 'ready',
        openLabel: t('file.open', { name }),
        removeLabel: '',
        file,
      }
    }),
  ], [images, files, fileUrl, loadImage, resolutions, t])
  const entries: LightboxImage[] = []
  for (const image of scope) {
    const src = resolvedUrl(image, resolutions, loadImage)
    if (src === null) continue
    const name = ('attachment' in image ? image.attachment.name : image.preview.name) ?? t('image.label')
    entries.push(lightboxImage(image, src, t('image.openOriginalLabel', { label: name })))
  }
  const previewIndex = preview === null ? -1 : entries.findIndex(entry => entry.src === preview)
  if (items.length === 0) return null
  return (
    <>
      <UploadTray
        items={items}
        labels={uploadTrayLabels(t, 'message')}
        align={align}
        variant="message"
        onOpen={(item) => {
          if (item.kind === 'file') {
            // A submission echo's file has no stored original to open until admission.
            if (fileUrl !== undefined && 'attachment' in item.file) window.open(fileUrl(item.file.attachment), '_blank', 'noopener')
            return
          }
          if (item.failed === true && 'attachment' in item.image) {
            retry(item.image.attachment)
            return
          }
          if (item.previewUrl !== null) setPreview(item.id)
        }}
      />
      {previewIndex >= 0 && (
        <ImageLightbox
          images={entries}
          index={previewIndex}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}

/** Message attachments in the owner's layout: the count-sized image gallery, or the sent-message tile tray. */
export function MessageImages(props: MessageImagesProps) {
  if (props.layout === 'tray') return <MessageAttachmentTray {...props} />
  return (
    <ImageGallery
      images={props.images}
      turnImages={props.turnImages}
      load={props.loadImage}
      align={props.align}
      labels={messageImageLabels(props.t)}
    />
  )
}
