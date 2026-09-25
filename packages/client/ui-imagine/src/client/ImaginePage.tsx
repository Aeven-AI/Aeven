/**
 * The Imagine start page: the chat's New Session hero (product name and
 * greeting) over Imagine's own composer card, centered in the column exactly
 * as the chat's hero composer is. The card has no generation behind it yet:
 * typing is kept locally and the send control stays disabled.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { HeroShell, IconArrowUpOutline20, IconPlusOutline20, Tooltip } from '@aeven/client-ui-primitives'
import type { ImaginePageProps } from './slots.ts'
import css from './ImaginePage.module.css'

/**
 * Size the draft box to its content; the CSS max-height caps it and the box
 * scrolls beyond that.
 * @param el - the draft textarea.
 */
function fitDraft(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${String(el.scrollHeight)}px`
}

/**
 * Render the Imagine start page.
 * @param props - composed slot props.
 * @returns the page element tree.
 */
export function ImaginePage({ heroT, t }: ImaginePageProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className={css.root} data-imagine-root="">
      <div className={clsx(css.scrollBody, 'no-scrollbar')}>
        <div className={css.header} aria-hidden="true" />
        <div className={css.seat}>
          <div className={css.stack}>
            <HeroShell t={heroT} />
            <div className={css.composer}>
              <div className={css.card}>
                <textarea
                  ref={(el) => { if (el !== null) fitDraft(el) }}
                  className={css.input}
                  rows={1}
                  value={draft}
                  placeholder={t('placeholder')}
                  aria-label={t('placeholder')}
                  onChange={(event) => {
                    fitDraft(event.currentTarget)
                    setDraft(event.currentTarget.value)
                  }}
                />
                <div className={css.row}>
                  <Tooltip label={t('add')} side="top">
                    <button type="button" className={css.add} aria-label={t('add')} disabled>
                      <IconPlusOutline20 />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('send')} side="top">
                    <button type="button" className={css.primary} aria-label={t('send')} disabled>
                      <IconArrowUpOutline20 />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
