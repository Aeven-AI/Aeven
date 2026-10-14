/**
 * One starter prompt's popup: what the prompt makes (its example, or the before
 * and the after of a retouch), what it does, the frame and the photo the reader
 * chooses, and the exact message the composer receives.
 *
 * Choosing never generates on its own: `Try it` writes the message into the
 * composer and stages the chosen photos as that draft's images, and the reader
 * sends it like any other message.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, CopyIconButton, IconCloseOutline16, IconPlusOutline20, IconRefreshOutline16, Modal,
} from '@aeven/client-ui-primitives'
import type { InputActions } from '@aeven/client-ui-conversation/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import { promptDefaultRatio, promptDraft, promptImageUrl, promptRatios, promptVaries } from './prompts.ts'
import type { ImaginePrompt, ImagineRatio } from './prompts.ts'
import { variationAt } from './scenes.ts'
import css from './PromptDialog.module.css'

/** Media types the upload accepts, as the composer's own image intake does. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/** A description this long is worth clamping to three lines behind a toggle. */
const CLAMP_ABOVE = 140

/** One photo staged in the popup, with the preview URL its tile renders. */
interface StagedPhoto {
  readonly file: File
  readonly url: string
}

/**
 * Render one starter prompt's popup.
 * @param props.prompt - the starter prompt the card opened.
 * @param props.inputActions - the Session's composer input face.
 * @param props.t - the Imagine translator.
 * @param props.onClose - dismiss the popup.
 * @returns the popup.
 */
export function PromptDialog({ prompt, inputActions, t, onClose }: {
  prompt: ImaginePrompt
  inputActions: InputActions
  t: TranslateNS<'imagine'>
  onClose: () => void
}) {
  const [ratio, setRatio] = useState<ImagineRatio>(() => promptDefaultRatio(prompt))
  const [photos, setPhotos] = useState<readonly StagedPhoto[]>([])
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The scene and the grade are drawn once per open, then walked one step per
  // reroll: the prompt preview always shows exactly what would be sent.
  const [roll] = useState(() => Math.random())
  const [step, setStep] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const varies = promptVaries(prompt)
  // The before half belongs to a fixed prompt that ships a pair; the varied one
  // shows a single guide image.
  const before = varies ? undefined : prompt.before
  const description = t(`prompt.${prompt.id}.description`)
  const draft = promptDraft(prompt, ratio, t, variationAt(roll, step))

  // Preview URLs are this popup's own: revoke every one still staged when it
  // closes, whatever it closes through.
  useEffect(() => () => {
    for (const photo of photos) URL.revokeObjectURL(photo.url)
  }, [photos])

  /**
   * Stage the chosen files and preview each one.
   * @param files - the files the picker answered.
   */
  const stage = (files: readonly File[]): void => {
    setNotice(null)
    setPhotos(current => [
      ...current,
      ...files.map(file => ({ file, url: URL.createObjectURL(file) })),
    ])
  }

  /**
   * Drop one staged photo and its preview URL.
   * @param url - the staged photo's preview URL.
   */
  const unstage = (url: string): void => {
    URL.revokeObjectURL(url)
    setPhotos(current => current.filter(photo => photo.url !== url))
  }

  /** Write the message into the composer with the staged photos, or report why not. */
  const apply = (): void => {
    // Photos first: a draft that cannot take them keeps the popup open with the
    // reason, and nothing is written.
    if (photos.length > 0) {
      const refused = inputActions.addImageFiles(photos.map(photo => photo.file))
      if (refused !== null) {
        setNotice(refused)
        return
      }
    }
    inputActions.setDraft(draft)
    onClose()
  }

  return (
    <Modal open headless onClose={onClose} title={t(`prompt.${prompt.id}.title`)} className={css.dialog as string}>
      <div className={css.layout} data-art={prompt.image === undefined ? 'none' : before === undefined ? 'single' : 'pair'}>
        {prompt.image !== undefined && (
          // A retouch shows its original beside the result; every other prompt
          // shows the one example it ships.
          <div className={css.stage} data-images={before === undefined ? 'single' : 'pair'}>
            {before !== undefined && <img className={css.art} src={promptImageUrl(before)} alt="" />}
            <img className={css.art} src={promptImageUrl(prompt.image)} alt="" />
          </div>
        )}
        <div className={css.detail}>
          <div className={css.head}>
            <h2 className={css.title}>{t(`prompt.${prompt.id}.title`)}</h2>
            <button type="button" className={css.close} aria-label={t('dialog.close')} onClick={onClose}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          <p className={css.description} data-clamped={!expanded && description.length > CLAMP_ABOVE}>
            {description}
          </p>
          {description.length > CLAMP_ABOVE && (
            <button type="button" className={css.more} onClick={() => { setExpanded(!expanded) }}>
              {expanded ? t('dialog.less') : t('dialog.more')}
            </button>
          )}
          <section className={css.section}>
            <div className={css.sectionHead}>
              <span className={css.sectionLabel}>{t('dialog.aspect.label')}</span>
              <span className={css.ratioSize}>
                {ratio.size === undefined
                  ? t('dialog.aspect.autoSize')
                  : t('dialog.aspect.size', { size: ratio.size })}
              </span>
            </div>
            <div className={css.ratios}>
              {promptRatios(prompt).map(offered => (
                <button
                  key={offered.id}
                  type="button"
                  className={css.ratio}
                  aria-pressed={offered.id === ratio.id}
                  onClick={() => { setRatio(offered) }}
                >
                  {t(`dialog.aspect.${offered.id}`)}
                </button>
              ))}
            </div>
          </section>
          {!varies && (
            <section className={css.section}>
              <div className={css.sectionHead}>
                <span className={css.sectionLabel}>{t('dialog.photo.label')}</span>
                {prompt.needsPhoto !== true && <span className={css.ratioSize}>{t('dialog.photo.optional')}</span>}
              </div>
              <div className={css.photos}>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className={css.fileInput}
                  onChange={(event) => {
                    stage(Array.from(event.currentTarget.files ?? []))
                    event.currentTarget.value = ''
                  }}
                />
                {photos.map(photo => (
                  <span key={photo.url} className={css.thumb}>
                    <img className={css.thumbImage} src={photo.url} alt="" />
                    <button
                      type="button"
                      className={css.thumbRemove}
                      aria-label={t('dialog.photo.remove')}
                      onClick={() => { unstage(photo.url) }}
                    >
                      <IconCloseOutline16 size={12} />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className={css.addTile}
                  aria-label={t('dialog.photo.add')}
                  onClick={() => { fileInput.current?.click() }}
                >
                  <IconPlusOutline20 />
                </button>
              </div>
            </section>
          )}
          <section className={css.section}>
            <div className={css.sectionHead}>
              <span className={css.sectionLabel}>{t('dialog.prompt.label')}</span>
              <span className={css.promptActions}>
                {varies && (
                  <button
                    type="button"
                    className={css.another}
                    onClick={() => { setStep(step + 1) }}
                  >
                    <IconRefreshOutline16 size={12} />
                    {t('dialog.another')}
                  </button>
                )}
                <CopyIconButton text={draft} label={t('image.prompt.copy')} copiedLabel={t('image.prompt.copied')} />
              </span>
            </div>
            <p className={clsx(css.promptText, 'no-scrollbar')} data-imagine-prompt="">{draft}</p>
          </section>
        </div>
      </div>
      <div className={css.foot}>
        {notice !== null && <p className={css.notice} role="alert">{notice}</p>}
        <Button variant="primary" onClick={apply}>{t('dialog.try')}</Button>
      </div>
    </Modal>
  )
}
