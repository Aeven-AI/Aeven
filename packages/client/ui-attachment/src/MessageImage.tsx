import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@aeven/client-ui-primitives'
import type { ImageAttachmentRef } from '@aeven/attachment'
import { ImageLightbox, type ImageLightboxLabels, type LightboxImage } from '@aeven/client-ui-primitives'
import { resolvedUrl, useImageResolutions } from './image-resolutions.ts'
import { messageImageEntry } from './message-image-entry.ts'
import css from './MessageImage.module.css'

/** Loads a session-authorized durable image URL and may expose a cached URL synchronously. */
export type ImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined
}

/** One gallery entry: a durable admitted reference, or a submission echo's local preview. */
export type MessageImageSpec =
  | { readonly attachment: ImageAttachmentRef }
  | {
    readonly preview: {
      readonly url: string
      readonly name?: string
      readonly width?: number
      readonly height?: number
    }
  }

/** Message-image strings the owner resolves from its own locale namespace. */
export interface MessageImageLabels {
  /** Fallback display name for an unnamed image. */
  image: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible thumbnail label; receives the image's display name. */
  openNamed: (label: string) => string
  /** Loading placeholder shown until bytes resolve. */
  loading: string
  /** Retry-control label shown when the load fails. */
  loadFailed: string
  /** Lightbox strings forwarded to the opened preview. */
  lightbox: ImageLightboxLabels
}

/** Display box for a lone image (DeepSeek Chat rule): long edge 240px with
 * the rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(
  dimensions: { readonly width: number; readonly height: number },
): { width: number; height: number; objectPosition: string } {
  const natural = dimensions.width / dimensions.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/** Intrinsic dimensions of one gallery entry; a preview's stay unknown until its intake probe resolved. */
function dimensionsOf(image: MessageImageSpec): { readonly width: number; readonly height: number } | undefined {
  if ('attachment' in image) return image.attachment
  return image.preview.width !== undefined && image.preview.height !== undefined
    ? { width: image.preview.width, height: image.preview.height }
    : undefined
}

/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile. The preview arm displays its
 * local URL directly — no loader round-trip, no failure/retry surface.
 *
 * @param props.image - the durable reference to load, or the local preview to display.
 * @param props.load - session-authorized URL loader for the durable arm.
 * @param props.variant - `single` for a message's lone image, `tile` otherwise.
 * @param props.labels - resolved strings (tooltip, loading, retry, lightbox).
 * @param props.onOpen - opens the group's preview on this image's resolved URL.
 * @returns the bounded thumbnail button, or the retry control on failure.
 */
export function MessageImage({ image, load, variant, labels, onOpen }: {
  image: MessageImageSpec
  load: ImageLoader
  variant: 'single' | 'tile' | 'fill'
  labels: MessageImageLabels
  onOpen: (src: string) => void
}) {
  const preview = 'preview' in image ? image.preview : undefined
  const attachment = 'attachment' in image ? image.attachment : undefined
  const [loaded, setLoaded] = useState<string | null>(() =>
    attachment === undefined ? null : (load.peek?.(attachment) ?? null))
  const [error, setError] = useState(false)
  // Retry re-arms the one load effect below, so every attempt — first load or
  // retry — runs under the same liveness guard and the same reset.
  const [attempt, setAttempt] = useState(0)
  const request = useCallback(() => { setAttempt(a => a + 1) }, [])
  const dimensions = useMemo(() => dimensionsOf(image), [image])
  const fit = useMemo(
    () => {
      if (variant !== 'single') return undefined
      // A preview whose intake probe has not resolved sizes as a square crop;
      // the durable replacement restores the exact fit.
      return dimensions === undefined
        ? { width: 240, height: 240, objectPosition: 'center' }
        : singleFit(dimensions)
    },
    [dimensions, variant],
  )

  useEffect(() => {
    if (attachment === undefined) return
    let live = true
    setError(false)
    setLoaded(load.peek?.(attachment) ?? null)
    void load(attachment).then((url) => { if (live) setLoaded(url) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [attachment, load, attempt])

  const src = preview?.url ?? loaded
  const label = (preview?.name ?? attachment?.name) ?? labels.image
  if (error) return <button type="button" className={css.error} data-variant={variant} onClick={request}>{labels.loadFailed}</button>
  return (
    <>
      <button
        type="button"
        className={variant === 'fill' ? css.fill : css.frame}
        data-variant={variant}
        style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={() => { if (src !== null) onOpen(src) }}
      >
        {src !== null && <img src={src} alt={label} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />}
        <span className={css.loader} data-loaded={src === null ? undefined : ''} aria-hidden="true">
          <Spinner />
        </span>
      </button>
    </>
  )
}

/**
 * Wrapping image group shared by user and assistant history: a lone image
 * renders large, several render as 64px square tiles (DeepSeek Chat rule).
 *
 * The tiles this group shows are the record's own images, but its preview
 * navigates the whole Turn's: `turnImages` is the scope the composition
 * resolved, so previous/next reach an image in another row of the same Turn
 * instead of stopping at this row's edge.
 */
export function ImageGallery({ images, turnImages, load, align, labels, variant: filled }: {
  images: readonly MessageImageSpec[]
  /** Every image the Turn shows, in log order; absent keeps the preview on `images`. */
  turnImages?: readonly MessageImageSpec[] | undefined
  load: ImageLoader
  align: 'start' | 'end'
  labels: MessageImageLabels
  /** `fill` when the owner owns the box; absent sizes images by count. */
  variant?: 'fill' | undefined
}) {
  const scope = turnImages === undefined || turnImages.length === 0 ? images : turnImages
  const { resolutions } = useImageResolutions(scope, load)
  const [openSrc, setOpenSrc] = useState<string | null>(null)
  const entries: LightboxImage[] = []
  for (const image of scope) {
    const src = resolvedUrl(image, resolutions, load)
    if (src !== null) entries.push(messageImageEntry(image, src, labels.image))
  }
  const openIndex = openSrc === null ? -1 : entries.findIndex(entry => entry.src === openSrc)
  if (images.length === 0) return null
  const variant = filled ?? (images.length === 1 ? 'single' : 'tile')
  return (
    <>
      <div className={filled === 'fill' ? css.fillRow : css.gallery} data-align={align}>
        {images.map((image, index) => (
          <MessageImage
            key={`${'attachment' in image ? image.attachment.attachmentId : image.preview.url}:${index}`}
            image={image}
            load={load}
            variant={variant}
            labels={labels}
            onOpen={setOpenSrc}
          />
        ))}
      </div>
      {openIndex >= 0 && (
        <ImageLightbox
          images={entries}
          index={openIndex}
          labels={labels.lightbox}
          onClose={() => { setOpenSrc(null) }}
        />
      )}
    </>
  )
}
