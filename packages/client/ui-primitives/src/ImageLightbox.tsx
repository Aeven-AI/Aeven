import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
  /** Accessible label of the previous-image control. */
  previous: string
  /** Accessible label of the next-image control. */
  next: string
  /** Accessible label of the download control. */
  download: string
  /** Accessible label of the image-info control. */
  info: string
  /** Info-popover caption of the media type. */
  infoType: string
  /** Info-popover caption of the byte size. */
  infoSize: string
  /** Info-popover caption of the file name. */
  infoName: string
  /** Info-popover value for a field the image does not report. */
  unknown: string
  /** Byte size in megabytes; receives the value with two decimals. */
  megabytes: (value: string) => string
}

/** One image the lightbox can show. */
export interface LightboxImage {
  /** Original image URL; also the download source. */
  src: string
  alt: string
  /** File name shown in the info popover and used for the download. */
  name?: string | undefined
  /** Media type shown in the info popover. */
  mediaType?: string | undefined
  /** Byte size shown in the info popover. */
  bytes?: number | undefined
}

/** Download name: the image's own name, else the URL's last path segment. */
function downloadName(image: LightboxImage): string {
  if (image.name !== undefined && image.name !== '') return image.name
  const segment = image.src.split(/[?#]/)[0]?.split('/').pop()
  return segment === undefined || segment === '' ? 'image' : segment
}

/** Largest magnification the gallery offers, and the lowest (never below fit). */
const MAX_ZOOM = 8
const MIN_ZOOM = 1
/** Scale a double-click asks for, before the second one returns to fit. */
const DOUBLE_CLICK_ZOOM = 2
/** A trackpad pinch arrives as ctrl+wheel; this is the exponent per wheel delta unit. */
const PINCH_STEP = 0.01
/** A pinch released this close to fit settles at fit rather than a hair above it. */
const SETTLE_EPSILON = 1.02
/** How long the settle transition runs, in ms — the transform transition in the module sheet. */
const SETTLE_MS = 200

/** Where the image is drawn: magnification and its offset from the stage centre. */
interface ViewTransform {
  scale: number
  x: number
  y: number
}

/**
 * Save one image through a blob link so a cross-origin or object URL keeps its
 * file name. A fetch the browser refuses opens the original in a new tab instead.
 */
async function saveImage(image: LightboxImage): Promise<void> {
  try {
    const response = await fetch(image.src, { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = downloadName(image)
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch {
    // A CORS-blocked or failed fetch cannot produce a named file; the new tab
    // still gives the user the original to save.
    window.open(image.src, '_blank', 'noopener')
  }
}

function LightboxIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/**
 * Document-level image gallery (the Aeven web client's Gallery): the selected
 * image fills the viewport over the page surface, with an info popover,
 * download, and close at the top and previous/next at the sides when there is
 * more than one image. Escape closes; ArrowLeft and ArrowRight wrap through
 * the images. Focus moves to the close control and returns to the opener on
 * unmount. Rendered through a body portal: an opener inside a transformed or
 * filtered ancestor would otherwise trap the fixed layer in that ancestor's box.
 *
 * @param props.images - the images in display order.
 * @param props.index - the image shown first.
 * @param props.labels - control, info, and dialog strings.
 * @param props.onClose - dismiss callback owned by the opener; runs after the fade-out.
 * @returns the modal gallery dialog.
 */
export function ImageLightbox({ images, index: startIndex, labels, onClose }: {
  images: readonly LightboxImage[]
  index: number
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const count = images.length
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)))
  const [closing, setClosing] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const infoRef = useRef<HTMLDivElement | null>(null)
  const galleryRef = useRef<HTMLDivElement | null>(null)
  /** The image's own transform, held outside React so a pinch does not re-render per frame. */
  const view = useRef<ViewTransform>({ scale: MIN_ZOOM, x: 0, y: 0 })
  const selected = images[Math.min(index, count - 1)]

  const close = useCallback(() => { setClosing(true) }, [])
  const step = useCallback((delta: 1 | -1) => {
    if (count > 1) setIndex(current => (current + delta + count) % count)
  }, [count])

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => { restoreRef.current?.focus() }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close()
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [close, step])

  useEffect(() => {
    if (!infoOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || infoRef.current?.contains(event.target) !== true) setInfoOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [infoOpen])

  // Pinch, wheel, drag, and double-click magnify the IMAGE and never the layout:
  // an unprevented trackpad pinch is the browser's own ctrl+wheel page zoom, so
  // this layer cancels it, and `.stack` claims touch gestures with
  // `touch-action: none`. Listeners are attached by hand because React registers
  // `wheel` passively, where `preventDefault` is ignored.
  useEffect(() => {
    const gallery = galleryRef.current
    if (gallery === null) return
    // The transform is drawn on the selected image, and `offsetWidth` is its
    // unscaled box, so the clamp keeps the frame inside the stage's bounds.
    const paint = (settle: boolean): void => {
      const image = gallery.querySelector<HTMLImageElement>('[data-selected] img')
      if (image === null) return
      const { scale, x, y } = view.current
      if (settle) {
        image.setAttribute('data-settling', '')
        window.setTimeout(() => { image.removeAttribute('data-settling') }, SETTLE_MS)
      } else {
        image.removeAttribute('data-settling')
      }
      image.toggleAttribute('data-zoomed', scale > MIN_ZOOM)
      image.style.transform = scale === MIN_ZOOM && x === 0 && y === 0
        ? ''
        : `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`
    }
    const clamp = (): void => {
      const image = gallery.querySelector<HTMLImageElement>('[data-selected] img')
      const box = gallery.getBoundingClientRect()
      if (image === null) return
      const { scale } = view.current
      const maxX = Math.max(0, (image.offsetWidth * scale - box.width) / 2)
      const maxY = Math.max(0, (image.offsetHeight * scale - box.height) / 2)
      view.current.x = Math.min(maxX, Math.max(-maxX, view.current.x))
      view.current.y = Math.min(maxY, Math.max(-maxY, view.current.y))
    }
    // Magnify to `target` with the point under the pointer left where it is.
    const scaleAt = (clientX: number, clientY: number, target: number, settle: boolean): void => {
      const box = gallery.getBoundingClientRect()
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target))
      view.current.x -= (clientX - (box.left + box.width / 2)) * (next - view.current.scale)
      view.current.y -= (clientY - (box.top + box.height / 2)) * (next - view.current.scale)
      view.current.scale = next
      clamp()
      paint(settle)
    }
    const fit = (settle: boolean): void => {
      view.current = { scale: MIN_ZOOM, x: 0, y: 0 }
      paint(settle)
    }
    /** Controls keep their own pointer and wheel behaviour. */
    const onControl = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('button') !== null
    const onWheel = (event: WheelEvent): void => {
      if (onControl(event.target)) return
      if (event.ctrlKey) {
        event.preventDefault()
        scaleAt(event.clientX, event.clientY, view.current.scale * Math.exp(-event.deltaY * PINCH_STEP), false)
        return
      }
      if (view.current.scale <= MIN_ZOOM) return
      event.preventDefault()
      view.current.x -= event.deltaX
      view.current.y -= event.deltaY
      clamp()
      paint(false)
    }
    const onDoubleClick = (event: MouseEvent): void => {
      if (onControl(event.target)) return
      event.preventDefault()
      if (view.current.scale > MIN_ZOOM) fit(true)
      else scaleAt(event.clientX, event.clientY, DOUBLE_CLICK_ZOOM, true)
    }
    const pointers = new Map<number, { readonly x: number; readonly y: number }>()
    let pinch: { readonly distance: number; readonly scale: number } | undefined
    let drag: { readonly x: number; readonly y: number } | undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (onControl(event.target)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        if (a === undefined || b === undefined) return
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale }
        drag = undefined
        return
      }
      if (pointers.size === 1 && view.current.scale > MIN_ZOOM) {
        drag = { x: event.clientX, y: event.clientY }
        gallery.setPointerCapture(event.pointerId)
      }
    }
    const onPointerMove = (event: PointerEvent): void => {
      const previous = pointers.get(event.pointerId)
      if (previous === undefined) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinch !== undefined && pointers.size >= 2 && pinch.distance > 0) {
        const [a, b] = [...pointers.values()]
        if (a === undefined || b === undefined) return
        event.preventDefault()
        scaleAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), false)
        return
      }
      if (drag === undefined) return
      event.preventDefault()
      view.current.x += event.clientX - drag.x
      view.current.y += event.clientY - drag.y
      drag = { x: event.clientX, y: event.clientY }
      clamp()
      paint(false)
    }
    const onPointerUp = (event: PointerEvent): void => {
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinch = undefined
      if (pointers.size > 0) return
      drag = undefined
      // A pinch released at almost fit settles at fit instead of a hair above it.
      if (view.current.scale < SETTLE_EPSILON) fit(view.current.scale !== MIN_ZOOM)
    }
    const stop = (event: Event): void => { event.preventDefault() }
    gallery.addEventListener('wheel', onWheel, { passive: false })
    gallery.addEventListener('dblclick', onDoubleClick)
    gallery.addEventListener('pointerdown', onPointerDown)
    gallery.addEventListener('pointermove', onPointerMove)
    gallery.addEventListener('pointerup', onPointerUp)
    gallery.addEventListener('pointercancel', onPointerUp)
    // Safari reports a pinch as its own gesture events; they zoom the page too.
    gallery.addEventListener('gesturestart', stop)
    gallery.addEventListener('gesturechange', stop)
    return () => {
      gallery.removeEventListener('wheel', onWheel)
      gallery.removeEventListener('dblclick', onDoubleClick)
      gallery.removeEventListener('pointerdown', onPointerDown)
      gallery.removeEventListener('pointermove', onPointerMove)
      gallery.removeEventListener('pointerup', onPointerUp)
      gallery.removeEventListener('pointercancel', onPointerUp)
      gallery.removeEventListener('gesturestart', stop)
      gallery.removeEventListener('gesturechange', stop)
    }
  }, [])

  // The magnification belongs to the image it was made on: a step to the next one
  // opens at fit.
  useEffect(() => {
    const image = galleryRef.current?.querySelector<HTMLImageElement>('[data-selected] img')
    view.current = { scale: MIN_ZOOM, x: 0, y: 0 }
    if (image === null || image === undefined) return
    image.removeAttribute('data-zoomed')
    image.removeAttribute('data-settling')
    image.style.transform = ''
  }, [index])

  if (selected === undefined) return null
  const size = selected.bytes === undefined ? labels.unknown : labels.megabytes((selected.bytes / 1_000_000).toFixed(2))

  return createPortal(
    <div
      ref={galleryRef}
      className={css.gallery}
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      onAnimationEnd={(event) => { if (closing && event.target === event.currentTarget) onClose() }}
    >
      <div className={css.stack}>
        {images.map((image, i) => (
          <div key={`${image.src}:${i}`} className={css.imageBox} data-selected={i === index || undefined}>
            <img
              className={css.image}
              data-loaded={loaded.has(image.src) || undefined}
              src={image.src}
              alt={i === index ? image.alt : ''}
              draggable={false}
              onLoad={() => { setLoaded(previous => new Set(previous).add(image.src)) }}
            />
          </div>
        ))}
      </div>

      {count > 1 && <>
        <button type="button" className={`${css.button} ${css.side} ${css.prev}`} aria-label={labels.previous} onClick={() => { step(-1) }}>
          <LightboxIcon><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></LightboxIcon>
        </button>
        <button type="button" className={`${css.button} ${css.side} ${css.next}`} aria-label={labels.next} onClick={() => { step(1) }}>
          <LightboxIcon><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></LightboxIcon>
        </button>
      </>}

      <div ref={infoRef} className={css.infoCorner}>
        <button
          type="button"
          className={css.button}
          aria-label={labels.info}
          aria-expanded={infoOpen}
          onClick={() => { setInfoOpen(open => !open) }}
        >
          <LightboxIcon><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></LightboxIcon>
        </button>
        {infoOpen && (
          <div className={css.info} role="status">
            <span className={css.infoItem}>
              <span className={css.infoCaption}>{labels.infoType}</span>
              <span className={css.infoValue}>{selected.mediaType ?? labels.unknown}</span>
            </span>
            <span className={css.infoItem}>
              <span className={css.infoCaption}>{labels.infoSize}</span>
              <span className={css.infoValue}>{size}</span>
            </span>
            <span className={css.infoItem}>
              <span className={css.infoCaption}>{labels.infoName}</span>
              <span className={css.infoValue}>{selected.name ?? labels.unknown}</span>
            </span>
          </div>
        )}
      </div>

      <div className={css.actions}>
        <button type="button" className={css.button} aria-label={labels.download} onClick={() => { void saveImage(selected) }}>
          <LightboxIcon><path d="M12 17V3" /><path d="m6 11 6 6 6-6" /><path d="M19 21H5" /></LightboxIcon>
        </button>
        <button ref={closeRef} type="button" className={css.button} aria-label={labels.close} onClick={close}>
          <LightboxIcon><path d="M18 6 6 18" /><path d="m6 6 12 12" /></LightboxIcon>
        </button>
      </div>
    </div>,
    document.body,
  )
}
