/** The failure control a generated-image or generated-video frame carries. @module */
import { useState } from 'react'
import { IconCloseOutline16, IconLucideCircleAlert, Modal, Tooltip } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import css from './ImageToolView.module.css'

/**
 * The failure state of one generation call: a round alert trigger in the
 * frame's upper-left corner that opens the call's error message in the same
 * dialog the prompt control uses. The frame itself carries no message, so a
 * failed call keeps the box its image or clip would have filled.
 * @param props.title - the localized failure the call ended in.
 * @param props.message - the error text the call reported; empty when it reported none.
 * @param props.t - the Imagine translator.
 * @returns the trigger and, while open, the error dialog.
 */
export function ErrorDetailControl({ title, message, t }: { title: string; message: string; t: PropsLocale<'imagine'>['t'] }) {
  const [open, setOpen] = useState(false)
  const close = (): void => { setOpen(false) }
  return (
    <>
      <Tooltip label={title} side="top-start">
        <button
          type="button"
          className={`${css.promptTrigger} ${css.errorTrigger}`}
          data-error-trigger=""
          aria-label={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          <IconLucideCircleAlert />
        </button>
      </Tooltip>
      <Modal open={open} headless onClose={close} title={title} className={css.promptDialog as string}>
        <header className={css.promptHeader}>
          <h2 className={css.promptTitle}>{title}</h2>
          <span className={css.promptActions}>
            <button type="button" className={css.promptClose} aria-label={t('error.close')} onClick={close}>
              <IconCloseOutline16 size={14} />
            </button>
          </span>
        </header>
        <div className={`${css.promptBody} no-scrollbar`} data-error-card="">
          <p className={css.promptText}>{message === '' ? t('error.noDetail') : message}</p>
        </div>
      </Modal>
    </>
  )
}
