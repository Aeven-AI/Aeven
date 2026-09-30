import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type { MessageImagesProps } from '@aeven/client-ui-chat/client'
import type { MessageFileSource, MessageImageLoader, MessageImageSource } from '@aeven/client-ui-conversation/client'
import { ImageLightbox } from '@aeven/client-ui-primitives'
import type { LightboxImage } from '@aeven/client-ui-primitives'
import { ImageGallery } from '../MessageImage.tsx'
import { UploadTray } from '../UploadTray.tsx'
import type { UploadTrayFileItem, UploadTrayImageItem } from '../UploadTray.tsx'
import { lightboxLabels, messageImageLabels, uploadTrayLabels } from './labels.ts'

/** Sent-message tray tile retaining what its open action needs. */
type MessageTrayItem =
  | UploadTrayImageItem & { image: MessageImageSource }
  | UploadTrayFileItem & { file: MessageFileSource }

/** Resolution of one durable image URL. */
type Resolution = { readonly url: string } | { readonly failed: true }

function imageKey(attachment: ImageAttachmentRef): string {
  return String(attachment.attachmentId)
}

/**
 * Resolve durable image URLs through the session loader, once per attachment.
 * @param images - the message's image sources; preview sources need no load.
 * @param load - session-authorized loader with its optional cache read.
 * @returns resolutions by attachment id, and a retry that re-arms one failed load.
 */
function useImageResolutions(images: readonly MessageImageSource[], load: MessageImageLoader): {
  resolutions: ReadonlyMap<string, Resolution>
  retry: (attachment: ImageAttachmentRef) => void
} {
  const [resolutions, setResolutions] = useState<ReadonlyMap<string, Resolution>>(() => new Map())
  const inFlight = useRef(new Set<string>())
  useEffect(() => {
    for (const image of images) {
      if (!('attachment' in image)) continue
      const { attachment } = image
      const key = imageKey(attachment)
      if (resolutions.has(key) || inFlight.current.has(key) || load.peek?.(attachment) !== undefined) continue
      inFlight.current.add(key)
      const settle = (resolution: Resolution): void => {
        inFlight.current.delete(key)
        setResolutions(previous => new Map(previous).set(key, resolution))
      }
      void load(attachment).then((url) => { settle({ url }) }, () => { settle({ failed: true }) })
    }
  }, [images, load, resolutions])
  const retry = useCallback((attachment: ImageAttachmentRef) => {
    setResolutions((previous) => {
      const next = new Map(previous)
      next.delete(imageKey(attachment))
      return next
    })
  }, [])
  return { resolutions, retry }
}

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
function MessageAttachmentTray({ images, files, loadImage, fileUrl, align, t }: MessageImagesProps) {
  const { resolutions, retry } = useImageResolutions(images, loadImage)
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
  const viewable = items.filter((item): item is Extract<MessageTrayItem, { kind: 'image' }> & { previewUrl: string } =>
    item.kind === 'image' && item.previewUrl !== null && item.failed !== true)
  const previewIndex = viewable.findIndex(item => item.id === preview)
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
          images={viewable.map(item => lightboxImage(item.image, item.previewUrl, item.alt))}
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
  return <ImageGallery images={props.images} load={props.loadImage} align={props.align} labels={messageImageLabels(props.t)} />
}
