import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps, ComposerFileAttachment, DraftAttachmentId,
} from '@aeven/client-ui-conversation/client'
import { UploadTray } from '../UploadTray.tsx'
import type { UploadTrayItem } from '../UploadTray.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '@aeven/client-ui-primitives'
import type { LightboxImage } from '@aeven/client-ui-primitives'
import { isSvgAttachment } from '../svg-attachment.ts'
import { dropOverlayLabels, lightboxLabels, uploadTrayLabels } from './labels.ts'

/** Tray item retaining its browser-owned attachment for callbacks. */
type ComposerTrayItem = UploadTrayItem & { attachment: ComposerAttachment }

/** One draft the preview opens, under the identity its tile carries. */
interface DraftPreview {
  id: DraftAttachmentId
  image: LightboxImage
}

/** Open a draft file's own bytes in a new tab; the object URL outlives the navigation briefly. */
function openDraftFile(file: File): void {
  const url = URL.createObjectURL(file)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
}

/** Draft files the tray shows as pictures: an SVG original, until its upload failed. */
function pictureDrafts(attachments: readonly ComposerAttachment[]): readonly ComposerFileAttachment[] {
  return attachments.filter((attachment): attachment is ComposerFileAttachment =>
    attachment.kind === 'file'
    && attachment.status !== 'error'
    && isSvgAttachment(attachment.file.name, attachment.file.type))
}

/**
 * Object URLs of the draft pictures, one per draft: created when the draft
 * joins the rail and revoked when it leaves or the tray unmounts. A status or
 * progress update reuses the URL already created for that draft.
 */
function useDraftPictureUrls(drafts: readonly ComposerFileAttachment[]): ReadonlyMap<DraftAttachmentId, string> {
  const created = useRef(new Map<DraftAttachmentId, string>())
  const [urls, setUrls] = useState<ReadonlyMap<DraftAttachmentId, string>>(() => new Map())
  useEffect(() => {
    const live = created.current
    const draftsById = new Set(drafts.map(draft => draft.id))
    let changed = false
    for (const [id, url] of live) {
      if (draftsById.has(id)) continue
      URL.revokeObjectURL(url)
      live.delete(id)
      changed = true
    }
    for (const draft of drafts) {
      if (live.has(draft.id)) continue
      live.set(draft.id, URL.createObjectURL(draft.file))
      changed = true
    }
    if (changed) setUrls(new Map(live))
  }, [drafts])
  useEffect(() => () => {
    for (const url of created.current.values()) URL.revokeObjectURL(url)
    created.current.clear()
  }, [])
  return urls
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
  const pictures = useMemo(() => pictureDrafts(attachments), [attachments])
  const pictureUrls = useDraftPictureUrls(pictures)

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
      event.preventDefault()
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

  const trayItems = useMemo<ComposerTrayItem[]>(() => attachments.map((attachment): ComposerTrayItem => {
    if (attachment.kind === 'image') {
      return {
        kind: 'image',
        id: attachment.id,
        previewUrl: attachment.previewUrl,
        alt: attachment.file.name || t('image.pending'),
        removeLabel: t('image.remove', { name: attachment.file.name }),
        attachment,
      }
    }
    const picture = pictureUrls.get(attachment.id)
    // A stored SVG is a picture here too: its tile shows the bytes the browser
    // renders, and only once the upload that makes the draft sendable is done.
    if (picture !== undefined) {
      return {
        kind: 'image',
        id: attachment.id,
        previewUrl: attachment.status === 'ready' ? picture : null,
        alt: attachment.file.name || t('image.label'),
        removeLabel: t('image.remove', { name: attachment.file.name }),
        attachment,
      }
    }
    return {
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
    }
  }), [attachments, pictureUrls, t])

  // The preview steps through exactly the tiles that open it, in rail order.
  const previews = useMemo<DraftPreview[]>(() => trayItems.flatMap((item): DraftPreview[] => {
    if (item.kind !== 'image' || item.previewUrl === null) return []
    const { name, type, size } = item.attachment.file
    return [{
      id: item.attachment.id,
      image: {
        src: item.previewUrl,
        alt: name || t('image.original'),
        name,
        ...type === '' ? {} : { mediaType: type },
        bytes: size,
      },
    }]
  }), [trayItems, t])
  const previewIndex = previews.findIndex(entry => entry.id === preview)

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
            if (item.kind === 'image') {
              if (item.previewUrl !== null) setPreview(item.attachment.id)
              return
            }
            openDraftFile(item.attachment.file)
          }}
          onRemove={(item) => { onRemoveAttachment(item.attachment.id) }}
        />
      )}
      {previewIndex >= 0 && (
        <ImageLightbox
          images={previews.map(entry => entry.image)}
          index={previewIndex}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
