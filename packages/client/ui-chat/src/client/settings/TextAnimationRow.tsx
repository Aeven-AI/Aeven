/** General Settings row for the streamed-text word fade-in. */

import { useState } from 'react'
import type { SnapshotStore } from '@aeven/client-store'
import { IconChevronDownOutline14, Menu } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './TranscriptViewRow.module.css'

/** Registration-side fade-in preference face. */
export interface TextAnimationRowInjected {
  hooks: {
    /** Persisted fade-in preference bound as useTextAnimationSetting. */
    textAnimationSetting: SnapshotStore<boolean>
  }
  /** Turn the word fade-in on or off. */
  setTextAnimation: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type TextAnimationRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<TextAnimationRowInjected>

/**
 * Render the word fade-in selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TextAnimationRow({ useTextAnimationSetting, setTextAnimation, t }: TextAnimationRowProps) {
  const enabled = useTextAnimationSetting(value => value)
  const [open, setOpen] = useState(false)
  const closeMenu = () => { setOpen(false) }
  const select = (id: string) => {
    closeMenu()
    setTextAnimation(id === 'on')
  }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {t(enabled ? 'settings.textAnimation.on' : 'settings.textAnimation.off')}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.textAnimation.title')}</div>
        <div className={css.desc}>{t('settings.textAnimation.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={[
          { id: 'on', label: t('settings.textAnimation.on') },
          { id: 'off', label: t('settings.textAnimation.off') },
        ]}
        selectedId={enabled ? 'on' : 'off'}
        onSelect={select}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
