/**
 * Imagine's start page: a grid of starter prompts with example images, shown in place of a blank chat's Hero
 * while the address is `/imagine`. Choosing one opens its popup, which previews what the prompt makes and what it
 * asks the model for; `Try it` there puts the message in the composer, where it can be edited and sent like any
 * message.
 */
import { useCallback, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { Spinner } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import { IMAGINE_PROMPTS, promptClipUrl, promptImageUrl } from './prompts.ts'
import type { ImaginePromptId } from './prompts.ts'
import { PromptDialog } from './PromptDialog.tsx'
import { SketchCanvas } from './SketchCanvas.tsx'
import type {} from './locales.ts'
import css from './ImaginePrompts.module.css'

/**
 * Render the starter prompts.
 * @param props - the Session's input actions and the translator.
 * @returns the prompt grid and, while one is open, its popup.
 */
export function ImaginePrompts({ inputActions, t }: PropsRuntime<'conversation.start'> & PropsLocale<'imagine'>) {
  const [open, setOpen] = useState<ImaginePromptId | null>(null)
  const opened = IMAGINE_PROMPTS.find(prompt => prompt.id === open)
  return (
    <section className={css.root} aria-label={t('prompts.label')}>
      <div className={css.grid}>
        {IMAGINE_PROMPTS.map(({ id, image, clip }) => (
          <PromptCard
            key={id}
            id={id}
            image={image}
            clip={clip}
            title={t(`prompt.${id}.title`)}
            onOpen={() => { setOpen(id) }}
          />
        ))}
      </div>
      {opened !== undefined && (opened.id === 'sketch'
        ? (
          // The sketch starts as a drawing, not as a description: its card
          // opens the sheet the reader draws on instead of the prompt popup.
          <SketchCanvas inputActions={inputActions} t={t} onClose={() => { setOpen(null) }} />
        )
        : (
          <PromptDialog
            key={opened.id}
            prompt={opened}
            inputActions={inputActions}
            t={t}
            onClose={() => { setOpen(null) }}
          />
        ))}
    </section>
  )
}

/** What a card shows: its example still loading, its example on screen, or its title alone. */
type CardState = 'loading' | 'ready' | 'title-only'

/**
 * One starter card. While its example loads, a light surface with a spinner and the title in ink covers it; the
 * surface fades out as the first frame arrives. An example that never shipped, or fails to load, leaves the card
 * title-only. The whole card stays one click target in every state.
 * @param props - the prompt's id, example assets, translated title, and the open handler.
 * @returns the card button.
 */
function PromptCard({ id, image, clip, title, onOpen }: {
  id: ImaginePromptId
  image: string | undefined
  clip: string | undefined
  title: string
  onOpen: () => void
}) {
  // A clip that fails falls back to its still, when it has one.
  const [clipFailed, setClipFailed] = useState(false)
  const playClip = clip !== undefined && !clipFailed
  const hasMedia = playClip || image !== undefined
  const [state, setState] = useState<CardState>(hasMedia ? 'loading' : 'title-only')
  const ready = useCallback(() => { setState(current => current === 'loading' ? 'ready' : current) }, [])
  const failed = useCallback(() => {
    if (playClip && image !== undefined) {
      setClipFailed(true)
      return
    }
    setState('title-only')
  }, [image, playClip])
  // A cached asset can finish before React attaches its listener, so the element's own state is read on mount.
  const imageRef = useCallback((element: HTMLImageElement | null) => {
    if (element !== null && element.complete && element.naturalWidth > 0) ready()
  }, [ready])
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    if (element !== null && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) ready()
  }, [ready])
  return (
    <button type="button" className={css.card} data-prompt={id} data-state={state} onClick={onOpen}>
      {state !== 'title-only' && (playClip
        ? (
          // A card whose example moves plays it in place, silently and on
          // a loop, over its own still as the poster.
          <video
            ref={videoRef}
            className={css.image}
            preload="auto"
            src={promptClipUrl(clip)}
            poster={image === undefined ? undefined : promptImageUrl(image)}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
            onLoadedData={ready}
            // A card inserted after load can miss the autoplay decision, so
            // it asks for playback once its own data is there.
            onCanPlay={(event) => {
              ready()
              void event.currentTarget.play().catch(() => {})
            }}
            onError={failed}
          />
        )
        : image !== undefined && (
          <img
            ref={imageRef}
            className={css.image}
            src={promptImageUrl(image)}
            alt=""
            loading="lazy"
            onLoad={ready}
            onError={failed}
          />
        ))}
      <span className={css.shade} aria-hidden="true" />
      <span className={css.title}>{title}</span>
      {state !== 'title-only' && (
        <span className={css.preloader} aria-hidden="true">
          <Spinner />
          <span className={css.preloaderTitle}>{title}</span>
        </span>
      )}
    </button>
  )
}
