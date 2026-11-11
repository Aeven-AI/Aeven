import { memo, useCallback, useState, useSyncExternalStore, type ImgHTMLAttributes } from 'react'

import type { RendererHost } from './components.tsx'

interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  renderer?: RendererHost | undefined
  scrollDown?: unknown
}

/**
 * Images rendered from markdown, wrapped so a host can style loading and error
 * states around them. The host's `resolveImage` maps the authored source to
 * the URL that loads; a source it cannot resolve shows the host's
 * `imageUnavailableLabel` and the source it failed to load, or the alt text
 * alone when the host supplies no label or suppressed the source itself. Its `onImageOpen` makes the image a
 * control that opens it enlarged.
 *
 * A loaded image also reports its own orientation, which is what lets a host
 * lay a row of images out in the shape each one actually has. Until the bytes
 * arrive nothing is stamped, so the host's own default holds.
 */
function MarkdownImage(props: ImageProps) {
  const { src, alt, title, renderer } = props
  // A host resolver that changes after this image rendered (cached blocks never re-render) re-resolves it.
  const subscribe = useCallback(
    (listener: () => void) => renderer?.subscribeImages(listener) ?? (() => undefined),
    [renderer],
  )
  useSyncExternalStore(subscribe, () => renderer?.imageRevision ?? 0, () => renderer?.imageRevision ?? 0)
  const options = renderer?.options
  const resolved = src === undefined || options?.resolveImage === undefined
    ? src
    : options.resolveImage(src)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape' | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  if (resolved === undefined) {
    const unavailable = options?.imageUnavailableLabel
    // The host may have dropped the source on purpose, showing the same image
    // elsewhere; that is not a failure and must not read as one.
    const suppressed = src !== undefined && options?.imageVisible?.(src) === false

    // Without copy from the host this renderer has no language to speak, so
    // the older alt-only rendering stands rather than inventing English.
    if (unavailable === undefined || suppressed) {
      return <span className="markdown-image-alt">{alt ?? ''}</span>
    }

    return (
      <span className="markdown-image-unavailable" role="note" title={src}>
        <span className="markdown-image-unavailable-label">{unavailable}</span>
        {src === undefined ? null : <span className="markdown-image-unavailable-source">{src}</span>}
        {alt === undefined || alt === '' ? null : <span className="markdown-image-unavailable-alt">{alt}</span>}
      </span>
    )
  }

  const open = options?.onImageOpen
  const onOpen = open === undefined
    ? undefined
    : () => { open({ src: resolved, alt: alt ?? '' }) }

  return (
    <span className="markdown-image-container" data-orientation={orientation} data-loaded={loaded ? true : undefined}>
      <span className="markdown-image">
        <span className="image-error" />
        <span className="image-loader" />
        {/*
          Defaults for images a document author does not control: deferred and
          off-thread decoding keep a long answer's images from blocking the
          render, and no referrer is sent, so the page a reader is on is not
          disclosed to whatever host the markdown pointed at.
        */}
        <img
          className="image"
          src={resolved}
          alt={alt ?? ''}
          title={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          data-openable={onOpen === undefined ? undefined : true}
          data-orientation={orientation}
          role={onOpen === undefined ? undefined : 'button'}
          tabIndex={onOpen === undefined ? undefined : 0}
          onClick={onOpen}
          onLoad={(event) => {
            const image = event.currentTarget
            setOrientation(image.naturalHeight > image.naturalWidth ? 'portrait' : 'landscape')
            setLoaded(true)
          }}
          onKeyDown={onOpen === undefined ? undefined : (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onOpen()
          }}
        />
      </span>
    </span>
  )
}

// Re-renders only when the source changes, as the class did.
const MemoMarkdownImage = memo(
  MarkdownImage,
  (prev, next) => prev.src === next.src,
)

MemoMarkdownImage.displayName = 'MarkdownImage'

export default MemoMarkdownImage
