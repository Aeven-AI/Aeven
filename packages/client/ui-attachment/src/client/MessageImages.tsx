import { useMemo } from 'react'
import type { FileAttachmentRef } from '@aeven/attachment'
import type { MessageImagesProps } from '@aeven/client-ui-chat/client'
import { ImageGallery } from '../MessageImage.tsx'
import { UploadTray } from '../UploadTray.tsx'
import type { UploadTrayFileItem } from '../UploadTray.tsx'
import { messageImageLabels, uploadTrayLabels } from './labels.ts'

/** Tray item retaining its durable reference for the open action. */
type MessageFileItem = UploadTrayFileItem & { file: FileAttachmentRef }

/** Historical message attachments: the image gallery, then read-only file tiles. */
export function MessageImages({ images, files, loadImage, fileUrl, align, t }: MessageImagesProps) {
  const fileItems = useMemo<MessageFileItem[]>(() => (files ?? []).map((file, index) => ({
    kind: 'file',
    id: `${String(file.attachmentId)}:${index}`,
    name: file.name,
    mediaType: file.mediaType,
    status: 'ready',
    openLabel: t('file.open', { name: file.name }),
    removeLabel: '',
    file,
  })), [files, t])
  return (
    <>
      <ImageGallery images={images} load={loadImage} align={align} labels={messageImageLabels(t)} />
      {fileItems.length > 0 && fileUrl !== undefined && (
        <UploadTray
          items={fileItems}
          labels={uploadTrayLabels(t, 'message')}
          align={align}
          variant="message"
          onOpen={(item) => { window.open(fileUrl(item.file), '_blank', 'noopener') }}
        />
      )}
    </>
  )
}
