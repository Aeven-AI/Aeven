/** The selector pill that opens a menu of choices for one settings row. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import { Menu } from './Menu.tsx'
import type { MenuItem } from './Menu.tsx'
import css from './SettingsSelect.module.css'

/** Props of {@link SettingsSelect}. */
export interface SettingsSelectProps {
  /** The choices. */
  items: readonly MenuItem[]
  /** The current choice. */
  selectedId: string
  /**
   * Called with the chosen item's id; the menu closes first.
   * @param id - the chosen item's id.
   */
  onSelect: (id: string) => void
  /** Pill text; absent shows the selected item's label. */
  value?: ReactNode
  disabled?: boolean | undefined
}

/**
 * Render a selector pill with its menu, aligned to the pill's trailing edge.
 * @param props - see {@link SettingsSelectProps}.
 * @returns the anchored menu element.
 */
export function SettingsSelect({ items, selectedId, onSelect, value, disabled }: SettingsSelectProps) {
  const [open, setOpen] = useState(false)
  const close = () => { setOpen(false) }
  return (
    <Menu
      open={open}
      onClose={close}
      items={items}
      selectedId={selectedId}
      onSelect={(id) => {
        close()
        onSelect(id)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={css.selector}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          {value ?? items.find(item => item.id === selectedId)?.label}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}
