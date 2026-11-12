/**
 * One slide template's popup: the template's slides, large, with a strip of every slide beneath to page through,
 * and beside them what the template is and what using it gives.
 *
 * Choosing never builds on its own: `Use template` writes a request for a presentation in this template into the
 * composer and sends nothing. The reader may first add their existing material (a presentation, PDF or document,
 * picked or dropped): those files join the draft as attachments and the request asks for a deck rebuilt from them.
 * Without files the request leaves room for what the deck is about, or for attaching material in the composer.
 *
 * The slides take the popup's left side; the copy and the action share the right-hand column of the image prompt
 * popup, whose shell styles this one reuses.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, IconCloseOutline16, IconPlusOutline20, Modal } from '@aeven/client-ui-primitives'
import type { InputActions } from '@aeven/client-ui-conversation/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import { SLIDE_TEMPLATES, slideAssetUrl, slideFile } from './slides.ts'
import type { SlideTemplateId } from './slides.ts'
import shell from './PromptDialog.module.css'
import css from './SlideDialog.module.css'

/** Material the picker offers: presentations, PDFs and documents a deck can be rebuilt from. */
const ACCEPT = '.pptx,.ppt,.key,.pages,.pdf,.docx,.doc,.odp,.odt,.md,.txt'

/**
 * Render one slide template's popup.
 * @param props.id - the template the card opened.
 * @param props.inputActions - the Session's composer input face.
 * @param props.t - the Imagine translator.
 * @param props.onClose - dismiss the popup.
 * @returns the popup.
 */
export function SlideDialog({ id, inputActions, t, onClose }: {
  id: SlideTemplateId
  inputActions: InputActions
  t: TranslateNS<'imagine'>
  onClose: () => void
}) {
  const total = SLIDE_TEMPLATES.find(template => template.id === id)?.slides ?? 0
  const [current, setCurrent] = useState(0)
  const [files, setFiles] = useState<readonly File[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const strip = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const title = t(`slides.${id}.title`)

  // The arrow keys page through the slides while the popup is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight') setCurrent(index => Math.min(total - 1, index + 1))
      else if (event.key === 'ArrowLeft') setCurrent(index => Math.max(0, index - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [total])

  // The strip follows the slide on show, so paging by key never loses its thumbnail.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  /**
   * Stage chosen or dropped files, skipping ones already staged.
   * @param chosen - the files the picker or the drop answered.
   */
  const stage = (chosen: readonly File[]): void => {
    setNotice(null)
    setFiles(staged => [...staged, ...chosen.filter(file => !staged.some(s => s.name === file.name && s.size === file.size))])
  }

  /** Attach the staged material, write the request into the composer and close; a refused attach keeps the popup open with the reason. */
  const apply = (): void => {
    if (files.length > 0) {
      const refused = inputActions.addFiles(files)
      if (refused !== null) {
        setNotice(refused)
        return
      }
    }
    inputActions.setDraft(t(files.length > 0 ? 'slides.draftFromFiles' : 'slides.draft', { name: title }))
    onClose()
  }

  return (
    <Modal open headless onClose={onClose} title={title} className={clsx(shell.dialog, shell.media, css.dialog)}>
      <div className={clsx(shell.layout, css.layout)}>
        <div className={css.stage}>
          <div className={css.view}>
            <img className={css.slide} src={slideAssetUrl(id, slideFile(current))} alt={t('slides.dialog.slide', { n: String(current + 1), total: String(total) })} />
            <button
              type="button"
              className={clsx(css.step, css.prev)}
              aria-label={t('slides.dialog.previous')}
              disabled={current === 0}
              onClick={() => { setCurrent(current - 1) }}
            >
              ‹
            </button>
            <button
              type="button"
              className={clsx(css.step, css.next)}
              aria-label={t('slides.dialog.next')}
              disabled={current === total - 1}
              onClick={() => { setCurrent(current + 1) }}
            >
              ›
            </button>
          </div>
          <div ref={strip} className={`${css.strip} no-scrollbar`}>
            {Array.from({ length: total }, (_, index) => (
              <button
                key={index}
                type="button"
                data-index={index}
                className={css.thumb}
                aria-pressed={index === current}
                aria-label={t('slides.dialog.slide', { n: String(index + 1), total: String(total) })}
                onClick={() => { setCurrent(index) }}
              >
                <img src={slideAssetUrl(id, slideFile(index))} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <div className={shell.detail}>
          <div className={shell.head}>
            <div className={shell.headText}>
              <h2 className={shell.title}>{title}</h2>
              <p className={shell.description}>{t(`slides.${id}.description`)}</p>
            </div>
            <button type="button" className={shell.close} aria-label={t('dialog.close')} onClick={onClose}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          <div className={`${shell.body} no-scrollbar`}>
            <ul className={css.facts}>
              <li>{t('slides.dialog.design', { count: String(total) })}</li>
              <li>{t('slides.dialog.together')}</li>
              <li>{t('slides.dialog.adjust')}</li>
              <li>{t('slides.dialog.formats')}</li>
            </ul>
            <section
              className={clsx(shell.section, css.material)}
              data-dragging={dragging}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => { setDragging(false) }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                stage(Array.from(event.dataTransfer.files))
              }}
            >
              <div className={shell.sectionHead}>
                <span className={shell.sectionLabel}>{t('slides.dialog.material.label')}</span>
                <span className={shell.sectionMeta}>{t('dialog.photo.optional')}</span>
              </div>
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
              {files.map(file => (
                <div key={`${file.name}:${file.size}`} className={css.file}>
                  <span className={css.fileName}>{file.name}</span>
                  <button
                    type="button"
                    className={css.fileRemove}
                    aria-label={t('slides.dialog.material.remove')}
                    onClick={() => { setFiles(staged => staged.filter(s => s !== file)) }}
                  >
                    <IconCloseOutline16 size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className={css.addFile} onClick={() => { fileInput.current?.click() }}>
                <IconPlusOutline20 />
                <span className={css.addText}>
                  <span>{t('slides.dialog.material.add')}</span>
                  <span className={css.addHint}>{t('slides.dialog.material.hint')}</span>
                </span>
              </button>
            </section>
          </div>
          <div className={shell.foot}>
            {notice !== null && <p className={shell.notice} role="alert">{notice}</p>}
            <Button variant="primary" className={shell.try} onClick={apply}>{t('slides.dialog.use')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
