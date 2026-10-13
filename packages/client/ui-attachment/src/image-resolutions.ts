import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type { MessageImageLoader, MessageImageSource } from '@aeven/client-ui-conversation/client'

/** Resolution of one durable image URL. */
export type Resolution = { readonly url: string } | { readonly failed: true }

/** Identity of one durable image among the images one Turn shows. */
export function imageKey(attachment: ImageAttachmentRef): string {
  return String(attachment.attachmentId)
}

/**
 * Resolve durable image URLs through the session loader, once per attachment.
 * @param images - the image sources to resolve; a preview source needs no load.
 * @param load - session-authorized loader with its optional cache read.
 * @returns resolutions by attachment id, and a retry that re-arms one failed load.
 */
export function useImageResolutions(images: readonly MessageImageSource[], load: MessageImageLoader): {
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

/**
 * URL one image displays from, or null while its bytes are still unresolved.
 * @param image - the preview or durable source.
 * @param resolutions - resolutions already settled in this render.
 * @param load - loader whose synchronous cache read covers an earlier resolve.
 * @returns the displayable URL, or null.
 */
export function resolvedUrl(
  image: MessageImageSource,
  resolutions: ReadonlyMap<string, Resolution>,
  load: MessageImageLoader,
): string | null {
  if ('preview' in image) return image.preview.url
  const resolution = resolutions.get(imageKey(image.attachment))
  if (resolution === undefined) return load.peek?.(image.attachment) ?? null
  return 'url' in resolution ? resolution.url : null
}
