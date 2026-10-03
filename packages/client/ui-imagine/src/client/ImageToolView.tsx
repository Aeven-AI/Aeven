/** In-place generated images backed by the existing atomic tool-call node. @module */
import { useEffect, useState } from 'react'
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
  const started = settled ? block.callTime : block.time
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (settled) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [settled])
  const failed = settled && block.isError
  const images = settled && !failed ? block.content.flatMap(content => content.type === 'image' ? [{ attachment: content.attachment }] : []) : []
  const error = failed ? block.content.find(content => content.type === 'text') : undefined
  const elapsed = started == null ? 0 : Math.max(0, Math.floor(((settled ? block.time : now) - started) / 1000))
  return (
    <figure className={css.root} data-generated-image-call={block.callId} data-state={failed ? 'error' : settled ? 'settled' : 'running'}>
      <div className={css.frame} style={{ minHeight: Math.max(240, Math.ceil(count / 3) * 72) }}>
        {!settled ? (
          <div className={css.status} role="status">
            <Spinner />
            <span>{t('image.generating')}</span>
            <span>{t('image.elapsed', { seconds: String(elapsed) })}</span>
          </div>
        ) : failed ? (
          <div className={css.error} role="alert">
            <span>{t('image.failed')}</span>
            {error?.type === 'text' && <span>{error.text}</span>}
          </div>
        ) : renderImages === undefined || images.length === 0 ? (
          <span className={css.status}>{t('image.unavailable')}</span>
        ) : renderImages({ images, align: 'start', layout: 'gallery' })}
      </div>
      {prompt !== '' && <figcaption className={css.caption}>{prompt}</figcaption>}
    </figure>
  )
}
