import { memo, type ImgHTMLAttributes } from 'react'

import type { RendererHost } from './components.tsx'

interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  renderer?: RendererHost | undefined
  scrollDown?: unknown
}

/**
 * Images rendered from markdown, wrapped so a host can style loading and error
 * states around them. The host's `resolveImage` maps the authored source to
 * the URL that loads (an unresolvable source shows the alt text), and its
 * `onImageOpen` makes the image a control that opens it enlarged.
 */
function MarkdownImage(props: ImageProps) {
  const { src, alt, title, renderer } = props
  const options = renderer?.options
  const resolved = src === undefined || options?.resolveImage === undefined
    ? src
    : options.resolveImage(src)

  if (resolved === undefined) {
    return <span className="markdown-image-alt">{alt ?? ''}</span>
  }

  const open = options?.onImageOpen
  const onOpen = open === undefined
    ? undefined
    : () => { open({ src: resolved, alt: alt ?? '' }) }

  return (
    <span className="markdown-image-container">
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
          role={onOpen === undefined ? undefined : 'button'}
          tabIndex={onOpen === undefined ? undefined : 0}
          onClick={onOpen}
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
