/**
 * The Inspiration start page, shown in place of a blank chat's Hero while the address is `/inspiration`: category
 * pills over a grid of cards. `Image & video` cards are starter prompts with example images; choosing one opens its
 * popup, which previews what the prompt makes, and `Try it` there puts the message in the composer. `Slides` cards
 * are presentation templates and `Resumes` cards are CV templates, shown by their full-page cover; choosing one
 * opens its slides or pages, and `Use template` puts a request for a deck or a CV in that template in the composer.
 * Every message is edited and sent like any other.
 *
 * Every card is a link to its popup's own address, so a card opens in a new tab like any link, and Back closes
 * the popup it opened.
 */
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { Spinner, useNarrowerThan } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import { IMAGINE_PROMPTS, promptClipUrl, promptImageUrl } from './prompts.ts'
import type { ImaginePromptId } from './prompts.ts'
import { PromptDialog } from './PromptDialog.tsx'
import { TemplateDialog } from './TemplateDialog.tsx'
import type { OpenTemplate } from './TemplateDialog.tsx'
import { SLIDE_TEMPLATES, slideAssetUrl, slideFile, type SlideTemplateId } from './slides.ts'
import { RESUME_TEMPLATES, resumeAssetUrl, type ResumeTemplateId } from './resumes.ts'
import { SketchCanvas } from './SketchCanvas.tsx'
import type {} from './locales.ts'
import { CATEGORIES, cardPath, openedCard } from './categories.ts'
import type { InspirationInjected } from './categories.ts'
import css from './ImaginePrompts.module.css'

/**
 * Content widths under which the grids drop to three cards and then two, read
 * from the page itself so a conversation narrowed by the right sidebar counts
 * its cards as a phone window does: a 768px and a 480px window, inclusive, less
 * the page inset on each side (24px and 16px).
 */
const THREE_CARDS_BELOW_PX = 721
const TWO_CARDS_BELOW_PX = 449


/**
 * Render the category pills and the shown category's content; a pill opens its category's own address.
 * @param props - the Session's input actions, the address's category and its navigation, and the translator.
 * @returns the pills, the prompt grid and, while one is open, its popup.
 */
export function ImaginePrompts({ inputActions, category, showCategory, openCard, useAddress, t }:
  PropsRuntime<'conversation.start'> & InjectFace<InspirationInjected> & PropsLocale<'imagine'>) {
  const card = openedCard(category, useAddress(value => value))
  const opened = category === 'image-video' ? IMAGINE_PROMPTS.find(prompt => prompt.id === card) : undefined
  const openTemplate: OpenTemplate | null = category === 'slides' && SLIDE_TEMPLATES.some(template => template.id === card)
    ? { kind: 'slides', id: card as SlideTemplateId }
    : category === 'resumes' && RESUME_TEMPLATES.some(template => template.id === card)
      ? { kind: 'resumes', id: card as ResumeTemplateId }
      : null
  const close = (): void => { showCategory(category) }
  const root = useRef<HTMLElement>(null)
  const three = useNarrowerThan(root, THREE_CARDS_BELOW_PX)
  const two = useNarrowerThan(root, TWO_CARDS_BELOW_PX)
  return (
    <section ref={root} className={css.root} data-cards={two ? '2' : three ? '3' : undefined} aria-label={t('title')}>
      <div className={css.content}>
        <nav className={css.tabs} aria-label={t('categories.label')}>
          {CATEGORIES.map(id => (
            <button key={id} type="button" className={css.tab} aria-pressed={category === id} onClick={() => { showCategory(id) }}>
              {t(`category.${id}`)}
            </button>
          ))}
        </nav>
        {category === 'image-video' && (
          <div className={css.grid} role="group" aria-label={t('prompts.label')}>
            {IMAGINE_PROMPTS.map(({ id, image, clip }) => (
              <PromptCard
                key={id}
                id={id}
                image={image}
                clip={clip}
                title={t(`prompt.${id}.title`)}
                href={cardPath(category, id)}
                onOpen={() => { openCard(cardPath(category, id)) }}
              />
            ))}
          </div>
        )}
        {category === 'slides' && (
          <div className={css.wideGrid} role="group" aria-label={t('slides.label')}>
            {SLIDE_TEMPLATES.map(({ id }) => (
              <TemplateCard
                key={id}
                id={id}
                className={css.slideCard}
                image={slideAssetUrl(id, slideFile(0))}
                title={t(`slides.${id}.title`)}
                href={cardPath(category, id)}
                onOpen={() => { openCard(cardPath(category, id)) }}
              />
            ))}
          </div>
        )}
        {category === 'resumes' && (
          <div className={css.grid} role="group" aria-label={t('resumes.label')}>
            {RESUME_TEMPLATES.map(({ id }) => (
              <TemplateCard
                key={id}
                id={id}
                className={css.docCard}
                image={resumeAssetUrl(id, 0)}
                title={t(`resumes.${id}.title`)}
                href={cardPath(category, id)}
                onOpen={() => { openCard(cardPath(category, id)) }}
              />
            ))}
          </div>
        )}
      </div>
      {openTemplate !== null && (
        <TemplateDialog key={`${openTemplate.kind}:${openTemplate.id}`} template={openTemplate} inputActions={inputActions} t={t} onClose={close} />
      )}
      {opened !== undefined && (opened.id === 'sketch'
        ? (
          // The sketch starts as a drawing, not as a description: its card
          // opens the sheet the reader draws on instead of the prompt popup.
          <SketchCanvas inputActions={inputActions} t={t} onClose={close} />
        )
        : (
          <PromptDialog
            key={opened.id}
            prompt={opened}
            inputActions={inputActions}
            t={t}
            onClose={close}
          />
        ))}
    </section>
  )
}

/**
 * Click handler of a card link: a plain primary click opens the popup in place; a modified or middle click is
 * left to the browser, which opens the card's address in a new tab.
 * @param onOpen - opens the popup in place.
 * @returns the handler.
 */
function cardClick(onOpen: () => void): (event: ReactMouseEvent) => void {
  return (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen()
  }
}

/**
 * One template card: its first slide or page as the picture, with the shade and the title over it.
 * @param props - the template id, the card's shape class, the picture URL, the translated title, its address and the open handler.
 * @returns the card link.
 */
function TemplateCard({ id, className, image, title, href, onOpen }: {
  id: string
  className: string | undefined
  image: string
  title: string
  href: string
  onOpen: () => void
}) {
  return (
    <a href={href} className={clsx(css.card, className)} data-template={id} data-state="ready" onClick={cardClick(onOpen)}>
      <img className={css.image} src={image} alt="" loading="lazy" />
      <span className={css.shade} aria-hidden="true" />
      <span className={css.title}>{title}</span>
    </a>
  )
}

/** What a card shows: its example still loading, its example on screen, or its title alone. */
type CardState = 'loading' | 'ready' | 'title-only'

/**
 * One starter card. While its example loads, a light surface with a spinner and the title in ink covers it; the
 * surface fades out as the first frame arrives. An example that never shipped, or fails to load, leaves the card
 * title-only. The whole card stays one click target in every state.
 * @param props - the prompt's id, example assets, translated title, its address and the open handler.
 * @returns the card link.
 */
function PromptCard({ id, image, clip, title, href, onOpen }: {
  id: ImaginePromptId
  image: string | undefined
  clip: string | undefined
  title: string
  href: string
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
    <a href={href} className={css.card} data-prompt={id} data-state={state} onClick={cardClick(onOpen)}>
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
    </a>
  )
}
