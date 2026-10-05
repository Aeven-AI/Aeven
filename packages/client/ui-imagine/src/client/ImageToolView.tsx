/** In-place generated images backed by the existing atomic tool-call node. @module */
import { Spinner } from '@aeven/client-ui-primitives'
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import css from './ImageToolView.module.css'

/**
 * Render a generation placeholder, its durable gallery, or the call's failure.
 * @param props - atomic call, shared image renderer and Imagine translator.
 * @returns the image lane retained at this call's transcript position.
 */
export function ImageToolView({ block, renderImages, t }: ToolCallViewProps & PropsLocale<'imagine'>) {
  const settled = 'kind' in block
  const argsRaw = settled ? block.call?.argsRaw : block.argsRaw
  let prompt = ''
  let count = 1
  try {
    const args: unknown = JSON.parse(argsRaw ?? '{}')
    if (typeof args === 'object' && args !== null) {
      if ('prompt' in args && typeof args.prompt === 'string') prompt = args.prompt
      if ('n' in args && typeof args.n === 'number' && Number.isInteger(args.n) && args.n > 0) count = args.n
    }
  } catch {
    // Invalid tool arguments have no generation caption; the failure remains visible.
  }
  const failed = settled && block.isError
  const images = settled && !failed ? block.content.flatMap(content => content.type === 'image' ? [{ attachment: content.attachment }] : []) : []
  const error = failed ? block.content.find(content => content.type === 'text') : undefined
  // One placeholder per image the call asks for, and never fewer than it
  // delivered: a two-image generation reserves two frames, each showing its own.
  const frames = Math.max(count, images.length)
  // A frame takes the shape its image is shown in, not the shape the provider
  // happened to return: landscape tiles are 3:2 and portrait tiles 2:3, and the
  // image covers whichever box it lands in.
  const orientationOf = (index: number): 'portrait' | 'landscape' => {
    const attachment = images[index]?.attachment
    return attachment !== undefined && attachment.height > attachment.width ? 'portrait' : 'landscape'
  }
  return (
    <figure className={css.root} data-generated-image-call={block.callId} data-state={failed ? 'error' : settled ? 'settled' : 'running'} data-image-count={frames}>
      <div className={css.frames} data-frames={frames}>
        {failed ? (
          <div className={css.frame}>
            <div className={css.error} role="alert">
              <span>{t('image.failed')}</span>
              {error?.type === 'text' && <span>{error.text}</span>}
            </div>
          </div>
        ) : Array.from({ length: frames }, (_, index) => (
          <div
            className={css.frame}
            key={index}
            data-generated-image-frame={index}
            data-orientation={orientationOf(index)}
          >
            {images[index] !== undefined && renderImages !== undefined
              ? renderImages({ images: [images[index]!], align: 'start', layout: 'fill' })
              : <span className={css.status}>{t('image.unavailable')}</span>}
            {!settled && (
              <span className={css.loader} role="status" aria-label={t('image.generating')}>
                <Spinner />
              </span>
            )}
          </div>
        ))}
      </div>
      {prompt !== '' && <figcaption className={css.caption}>{prompt}</figcaption>}
    </figure>
  )
}
