import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps, ComposerImageAttachment, DraftAttachmentId,
} from '@aeven/client-ui-conversation/client'
import { UploadTray } from '../UploadTray.tsx'
import type { UploadTrayItem } from '../UploadTray.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '@aeven/client-ui-primitives'
import { dropOverlayLabels, lightboxLabels, uploadTrayLabels } from './labels.ts'

/** Tray item retaining its browser-owned attachment for callbacks. */
type ComposerTrayItem = UploadTrayItem & { attachment: ComposerAttachment }

/** Open a draft file's own bytes in a new tab; the object URL outlives the navigation briefly. */
function openDraftFile(file: File): void {
  const url = URL.createObjectURL(file)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
}

/** Draft attachment tray, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddFiles, onRemoveAttachment, dropLimits, t,
}: ComposerAttachmentsProps) {
  const [preview, setPreview] = useState<DraftAttachmentId | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview)) setPreview(null)
  }, [attachments, preview])
  const images = useMemo(
    () => attachments.filter((attachment): attachment is ComposerImageAttachment => attachment.kind === 'image'),
    [attachments],
  )
  const previewIndex = images.findIndex(image => image.id === preview)

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) onAddFiles([...dataTransfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddFiles])

  const trayItems = useMemo<ComposerTrayItem[]>(() => attachments.map((attachment): ComposerTrayItem => attachment.kind === 'image'
    ? {
      kind: 'image',
      id: attachment.id,
      previewUrl: attachment.previewUrl,
      alt: attachment.file.name || t('image.pending'),
      removeLabel: t('image.remove', { name: attachment.file.name }),
      attachment,
    }
    : {
      kind: 'file',
      id: attachment.id,
      name: attachment.file.name,
      mediaType: attachment.file.type,
      status: attachment.status,
      openLabel: attachment.status === 'uploading'
        ? t('file.uploading', { name: attachment.file.name })
        : t('file.open', { name: attachment.file.name }),
      removeLabel: t('file.removeLabel', { name: attachment.file.name }),
      attachment,
    }), [attachments, t])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {trayItems.length > 0 && (
        <UploadTray
          items={trayItems}
          labels={uploadTrayLabels(t, 'draft')}
          onOpen={(item) => {
            if (item.attachment.kind === 'image') setPreview(item.attachment.id)
            else openDraftFile(item.attachment.file)
          }}
          onRemove={(item) => { onRemoveAttachment(item.attachment.id) }}
        />
      )}
      {previewIndex >= 0 && (
        <ImageLightbox
          images={images.map(image => ({
            src: image.previewUrl,
            alt: image.file.name || t('image.original'),
            name: image.file.name,
            mediaType: image.file.type,
            bytes: image.file.size,
          }))}
          index={previewIndex}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
