/** In-place generated images backed by the existing atomic tool-call node. @module */
import { useState } from 'react'
import { CopyIconButton, IconCloseOutline16, IconLucideTerminal, Modal, Spinner, Tooltip } from '@aeven/client-ui-primitives'
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import css from './ImageToolView.module.css'

/**
 * The prompt control over one generated image: a round trigger in the image's
 * lower-left corner opening the prompt that produced it in the app's dialog.
 * @param props.prompt - the generation prompt the call carried.
 * @param props.t - the Imagine translator.
 * @returns the trigger and, while open, the prompt dialog.
 */
export function ImagePromptControl({ prompt, t }: { prompt: string; t: PropsLocale<'imagine'>['t'] }) {
  const [open, setOpen] = useState(false)
  const close = (): void => { setOpen(false) }
  return (
    <>
      <Tooltip label={t('image.prompt.show')} side="top">
        <button
          type="button"
          className={css.promptTrigger}
          data-image-prompt=""
          aria-label={t('image.prompt.show')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          <IconLucideTerminal />
        </button>
      </Tooltip>
      <Modal open={open} headless onClose={close} title={t('image.prompt.title')} className={css.promptDialog as string}>
        <header className={css.promptHeader}>
          <h2 className={css.promptTitle}>{t('image.prompt.title')}</h2>
          <span className={css.promptActions}>
            <CopyIconButton text={prompt} label={t('image.prompt.copy')} copiedLabel={t('image.prompt.copied')} />
            <button type="button" className={css.promptClose} aria-label={t('image.prompt.close')} onClick={close}>
              <IconCloseOutline16 size={14} />
            </button>
          </span>
        </header>
        <div className={css.promptBody} data-image-prompt-card="">
          <p className={css.promptText}>{prompt}</p>
        </div>
      </Modal>
    </>
  )
}

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
    // Invalid tool arguments have no generation prompt; the failure remains visible.
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
            {prompt !== '' && <ImagePromptControl prompt={prompt} t={t} />}
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
            {prompt !== '' && <ImagePromptControl prompt={prompt} t={t} />}
            {!settled && (
              <span className={css.loader} role="status" aria-label={t('image.generating')}>
                <Spinner />
              </span>
            )}
          </div>
        ))}
      </div>
    </figure>
  )
}
