import { useCallback, useMemo, useState } from 'react'
import type { MessageImagesProps } from '@aeven/client-ui-chat/client'
import type { MessageFileSource, MessageImageSource } from '@aeven/client-ui-conversation/client'
import { ImageLightbox } from '@aeven/client-ui-primitives'
import type { LightboxImage } from '@aeven/client-ui-primitives'
import { imageKey, resolvedUrl, useImageResolutions } from '../image-resolutions.ts'
import { ImageGallery } from '../MessageImage.tsx'
import { UploadTray } from '../UploadTray.tsx'
import type { UploadTrayFileItem, UploadTrayImageItem } from '../UploadTray.tsx'
import { messageImageEntry } from '../message-image-entry.ts'
import { isSvgAttachment } from '../svg-attachment.ts'
import { lightboxLabels, messageImageLabels, uploadTrayLabels } from './labels.ts'

/** Sent-message tray tile retaining what its open action needs. */
type MessageTrayItem =
  | UploadTrayImageItem & { image: MessageImageSource }
  | UploadTrayImageItem & { picture: MessageFileSource }
  | UploadTrayFileItem & { file: MessageFileSource }

/**
 * One sent file as the tray presents it. An SVG original is a picture the
 * browser renders even though the harness stores it as a file, so its tile
 * shows the bytes and opens the preview; a file the tray keeps as a file
 * reports no URL.
 */
interface SentFile {
  readonly file: MessageFileSource
  readonly name: string
  readonly mediaType: string
  /** Picture URL, or null while a submission echo's original is not yet stored. */
  readonly url: string | null | undefined
}

/** Classify the record's files: the stored original's URL for a picture, nothing for a file. */
function sentFiles(
  files: readonly MessageFileSource[] | undefined,
  fileUrl: MessageImagesProps['fileUrl'],
): readonly SentFile[] {
  return (files ?? []).map((file) => {
    const { name, mediaType } = 'attachment' in file ? file.attachment : file.preview
    if (!isSvgAttachment(name, mediaType)) return { file, name, mediaType, url: undefined }
    return {
      file,
      name,
      mediaType,
      url: 'attachment' in file && fileUrl !== undefined ? fileUrl(file.attachment) : null,
    }
  })
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
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const closePreview = useCallback(() => { setPreviewSrc(null) }, [])
  const pictures = useMemo(() => sentFiles(files, fileUrl), [files, fileUrl])
  const items = useMemo<MessageTrayItem[]>(() => [
    ...images.map((image, index): MessageTrayItem => {
      if ('preview' in image) {
        const name = image.preview.name ?? t('image.label')
        return {
          kind: 'image', id: `image:${index}`, previewUrl: image.preview.url,
          alt: t('image.openOriginalLabel', { label: name }), removeLabel: '', image,
        }
      }
      const resolution = resolutions.get(imageKey(image.attachment))
      const name = image.attachment.name ?? t('image.label')
      return {
        kind: 'image',
        id: `image:${index}`,
        previewUrl: resolution !== undefined && 'url' in resolution
          ? resolution.url
          : (loadImage.peek?.(image.attachment) ?? null),
        failed: resolution !== undefined && 'failed' in resolution,
        alt: t('image.openOriginalLabel', { label: name }),
        removeLabel: '',
        image,
      }
    }),
    ...pictures.map((picture, index): MessageTrayItem => {
      if (picture.url === undefined) {
        return {
          kind: 'file',
          id: 'attachment' in picture.file
            ? `file:${String(picture.file.attachment.attachmentId)}:${index}`
            : `file-preview:${picture.name}:${index}`,
          name: picture.name,
          mediaType: picture.mediaType,
          status: 'ready',
          openLabel: t('file.open', { name: picture.name }),
          removeLabel: '',
          file: picture.file,
        }
      }
      return {
        kind: 'image',
        id: `picture:${picture.name}:${index}`,
        previewUrl: picture.url,
        alt: t('image.openOriginalLabel', { label: picture.name }),
        removeLabel: '',
        picture: picture.file,
      }
    }),
  ], [images, pictures, resolutions, loadImage, t])
  const entries: LightboxImage[] = []
  for (const image of scope) {
    const src = resolvedUrl(image, resolutions, loadImage)
    if (src === null) continue
    entries.push(messageImageEntry(image, src, t('image.label')))
  }
  for (const picture of pictures) {
    if (picture.url === undefined || picture.url === null) continue
    entries.push({
      src: picture.url,
      alt: picture.name,
      name: picture.name,
      mediaType: picture.mediaType,
      ...'attachment' in picture.file ? { bytes: picture.file.attachment.bytes } : {},
    })
  }
  const previewIndex = previewSrc === null ? -1 : entries.findIndex(entry => entry.src === previewSrc)
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
          if ('image' in item && item.failed === true && 'attachment' in item.image) {
            retry(item.image.attachment)
            return
          }
          if (item.previewUrl !== null) setPreviewSrc(item.previewUrl)
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
      {...props.layout === 'fill' ? { variant: 'fill' as const } : {}}
    />
  )
}
