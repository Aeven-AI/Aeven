/** General Settings row whose selector chooses On or Off. */

import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import css from './OnOffRow.module.css'

/** Props of one on/off preference row; `t` supplies the On and Off labels. */
export type OnOffRowProps = PropsLocale<'settings'> & {
  readonly title: string
  readonly description: string
  readonly enabled: boolean
  /** @param enabled - the value the reader chose. */
  readonly onChange: (enabled: boolean) => void
}

/**
 * Render one on/off preference row.
 * @param props - row copy, current value, and change handler.
 * @returns the preference row.
 */
export function OnOffRow({ title, description, enabled, onChange, t }: OnOffRowProps) {
  const [open, setOpen] = useState(false)
  const closeMenu = () => { setOpen(false) }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {t(enabled ? 'choice.on' : 'choice.off')}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={[
          { id: 'on', label: t('choice.on') },
          { id: 'off', label: t('choice.off') },
        ]}
        selectedId={enabled ? 'on' : 'off'}
        onSelect={(id) => {
          closeMenu()
          onChange(id === 'on')
        }}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
