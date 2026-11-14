/**
 * One template's popup, for the Slides and Resumes galleries: the template's slides or pages,
 * large, with a strip of every one beneath to page through, and beside them what the template is
 * and what using it gives.
 *
 * Choosing never builds on its own: `Use template` writes a request for a presentation or a CV in
 * this template into the composer and sends nothing. The reader may first add their existing
 * material (a presentation, CV or document, and for a CV a portrait photo, picked or dropped):
 * those files join the draft as attachments and the request asks for the work rebuilt from them.
 * Without files the request leaves room for what it is about, or for attaching material in the
 * composer.
 *
 * The pictures take the popup's left side, landscape for slides and portrait for A4 pages; the copy
 * and the action share the right-hand column of the image prompt popup, whose shell styles this one
 * reuses.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconCloseOutline16, IconPlusOutline20, Modal } from '@aeven/client-ui-primitives'
import type { InputActions } from '@aeven/client-ui-conversation/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import { SLIDE_TEMPLATES, slideAssetUrl, slideFile } from './slides.ts'
import type { SlideTemplateId } from './slides.ts'
import { RESUME_TEMPLATES, resumeAssetUrl } from './resumes.ts'
import type { ResumeTemplateId } from './resumes.ts'
import shell from './PromptDialog.module.css'
import css from './TemplateDialog.module.css'

/** The template a gallery card opened. */
export type OpenTemplate =
  | { readonly kind: 'slides'; readonly id: SlideTemplateId }
  | { readonly kind: 'resumes'; readonly id: ResumeTemplateId }

/** Material each picker offers: what a deck, or a CV and its photo, can be rebuilt from. */
const ACCEPT = {
  slides: '.pptx,.ppt,.key,.pages,.pdf,.docx,.doc,.odp,.odt,.md,.txt',
  resumes: '.pdf,.docx,.doc,.pages,.odt,.rtf,.md,.txt,.jpg,.jpeg,.png,.webp,.heic',
} as const satisfies Record<OpenTemplate['kind'], string>

/** The image gallery's arrow glyph frame, so paging here reads like gallery paging. */
function StepIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/**
 * Render one template's popup.
 * @param props.template - the gallery and template the card opened.
 * @param props.inputActions - the Session's composer input face.
 * @param props.t - the Imagine translator.
 * @param props.onClose - dismiss the popup.
 * @returns the popup.
 */
export function TemplateDialog({ template, inputActions, t, onClose }: {
  template: OpenTemplate
  inputActions: InputActions
  t: TranslateNS<'imagine'>
  onClose: () => void
}) {
  const { kind } = template
  const total = template.kind === 'slides'
    ? SLIDE_TEMPLATES.find(item => item.id === template.id)?.slides ?? 0
    : RESUME_TEMPLATES.find(item => item.id === template.id)?.pages ?? 0
  const picture = (index: number): string => template.kind === 'slides'
    ? slideAssetUrl(template.id, slideFile(index))
    : resumeAssetUrl(template.id, index)
  const title = template.kind === 'slides' ? t(`slides.${template.id}.title`) : t(`resumes.${template.id}.title`)
  const description = template.kind === 'slides' ? t(`slides.${template.id}.description`) : t(`resumes.${template.id}.description`)
  const [current, setCurrent] = useState(0)
  const [files, setFiles] = useState<readonly File[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const strip = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const position = (index: number): string => t(`${kind}.dialog.slide`, { n: String(index + 1), total: String(total) })

  // The arrow keys page through the pictures while the popup is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight') setCurrent(index => Math.min(total - 1, index + 1))
      else if (event.key === 'ArrowLeft') setCurrent(index => Math.max(0, index - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [total])

  // The strip follows the picture on show, so paging by key never loses its thumbnail.
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
    inputActions.setDraft(t(files.length > 0 ? `${kind}.draftFromFiles` : `${kind}.draft`, { name: title }))
    onClose()
  }

  return (
    <Modal open headless onClose={onClose} title={title} className={clsx(shell.dialog, shell.media, css.dialog, kind === 'resumes' && css.portrait)}>
      <div className={clsx(shell.layout, css.layout)}>
        <div className={css.stage}>
          <div className={css.view}>
            <img className={css.slide} src={picture(current)} alt={position(current)} />
            <button
              type="button"
              className={clsx(css.step, css.prev)}
              aria-label={t(`${kind}.dialog.previous`)}
              disabled={current === 0}
              onClick={() => { setCurrent(current - 1) }}
            >
              <StepIcon><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></StepIcon>
            </button>
            <button
              type="button"
              className={clsx(css.step, css.next)}
              aria-label={t(`${kind}.dialog.next`)}
              disabled={current === total - 1}
              onClick={() => { setCurrent(current + 1) }}
            >
              <StepIcon><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></StepIcon>
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
                aria-label={position(index)}
                onClick={() => { setCurrent(index) }}
              >
                <img src={picture(index)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <div className={shell.detail}>
          <div className={shell.head}>
            <div className={shell.headText}>
              <h2 className={shell.title}>{title}</h2>
              <p className={shell.description}>{description}</p>
            </div>
            <button type="button" className={shell.close} aria-label={t('dialog.close')} onClick={onClose}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          <div className={`${shell.body} no-scrollbar`}>
            <ul className={css.facts}>
              <li>{t(`${kind}.dialog.design`, { count: String(total) })}</li>
              <li>{t(`${kind}.dialog.together`)}</li>
              <li>{t(`${kind}.dialog.adjust`)}</li>
              <li>{t(`${kind}.dialog.formats`)}</li>
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
                <span className={shell.sectionLabel}>{t(`${kind}.dialog.material.label`)}</span>
                <span className={shell.sectionMeta}>{t('dialog.photo.optional')}</span>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT[kind]}
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
                    aria-label={t(`${kind}.dialog.material.remove`)}
                    onClick={() => { setFiles(staged => staged.filter(s => s !== file)) }}
                  >
                    <IconCloseOutline16 size={12} />
                  </button>
                </div>
              ))}
              <button type="button" className={css.addFile} onClick={() => { fileInput.current?.click() }}>
                <IconPlusOutline20 />
                <span className={css.addText}>
                  <span>{t(`${kind}.dialog.material.add`)}</span>
                  <span className={css.addHint}>{t(`${kind}.dialog.material.hint`)}</span>
                </span>
              </button>
            </section>
          </div>
          <div className={shell.foot}>
            {notice !== null && <p className={shell.notice} role="alert">{notice}</p>}
            <Button variant="primary" className={shell.try} onClick={apply}>{t(`${kind}.dialog.use`)}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
