/** General Settings row turning Developer mode on or off. */

import { useState } from 'react'
import type { SnapshotStore } from '@aeven/client-store'
import { IconChevronDownOutline14, Menu } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import css from './DeveloperModeRow.module.css'

/** Registration-side Developer mode face. */
export interface DeveloperModeRowInjected {
  hooks: {
    /** Persisted Developer mode, bound as useDeveloperMode. */
    developerMode: SnapshotStore<boolean>
  }
  /** Turn Developer mode on or off. */
  setDeveloperMode: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type DeveloperModeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<DeveloperModeRowInjected>

/**
 * Render the Developer mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DeveloperModeRow({ useDeveloperMode, setDeveloperMode, t }: DeveloperModeRowProps) {
  const enabled = useDeveloperMode(value => value)
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
      {t(enabled ? 'developer.on' : 'developer.off')}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('developer.title')}</div>
        <div className={css.desc}>{t('developer.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={[
          { id: 'on', label: t('developer.on') },
          { id: 'off', label: t('developer.off') },
        ]}
        selectedId={enabled ? 'on' : 'off'}
        onSelect={(id) => {
          closeMenu()
          setDeveloperMode(id === 'on')
        }}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
