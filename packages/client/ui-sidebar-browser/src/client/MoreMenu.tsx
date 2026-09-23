/**
 * The chrome row's three-dot menu, ported from t3code's `PreviewMoreMenu`:
 * hard reload, DevTools, appearance, zoom, and clearing the session's
 * browser storage.
 */
import type { MouseEvent, ReactNode } from 'react'
import { useState } from 'react'
import { Menu, Tooltip, type MenuEntry } from '@aeven/client-ui-primitives'
import type { BrowserColorScheme } from './guest.ts'
import { Check, Minus, MoreVertical, Plus, RotateCcw } from './icons.tsx'
import type { SidebarBrowserKey } from './locales.ts'
import css from './BrowserPane.module.css'

/** Schemes the appearance submenu offers, in order. */
const COLOR_SCHEMES: readonly BrowserColorScheme[] = ['system', 'light', 'dark']

/** Props of the three-dot menu. */
export interface MoreMenuProps {
  /** Whether the guest has a page the tab actions can address. */
  disabled: boolean
  zoomFactor: number
  colorScheme: BrowserColorScheme
  onHardReload: () => void
  onOpenDevTools: () => void
  onColorScheme: (scheme: BrowserColorScheme) => void
  /** Step the zoom by one level, or reset it with 0. */
  onZoom: (direction: -1 | 0 | 1) => void
  onClearCookies: () => void
  onClearCache: () => void
  t: (key: SidebarBrowserKey) => string
}

/**
 * Render the three-dot menu.
 * @param props - see {@link MoreMenuProps}.
 * @returns the menu trigger with its anchored list.
 */
export function MoreMenu(props: MoreMenuProps): ReactNode {
  const { t, disabled } = props
  const [open, setOpen] = useState(false)

  // Inline zoom controls sit inside the row's own button, so they are spans:
  // a nested button is invalid, and the row stays open while they are used.
  const zoomControl = (label: string, direction: -1 | 0 | 1, glyph: ReactNode) => (
    <span
      role="button"
      aria-label={label}
      className={direction === 0 ? css.zoomReset : css.zoomStep}
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        props.onZoom(direction)
      }}
    >
      {glyph}
    </span>
  )

  const items: MenuEntry[] = [
    { id: 'hard-reload', label: t('menu.hardReload'), disabled },
    { id: 'devtools', label: t('menu.devtools'), disabled },
    {
      id: 'appearance',
      label: t('menu.appearance'),
      disabled,
      submenu: COLOR_SCHEMES.map(scheme => ({
        id: `scheme:${scheme}`,
        label: t(`scheme.${scheme}`),
        icon: scheme === props.colorScheme ? <Check size={14} /> : <span className={css.checkSpacer} />,
      })),
    },
    { type: 'separator', id: 'sep-zoom' },
    {
      id: 'zoom',
      disabled,
      label: (
        <span className={css.zoomRow}>
          <span>{t('menu.zoom')}</span>
          <span className={css.zoomControls}>
            {zoomControl(t('zoom.out'), -1, <Minus size={14} />)}
            <span className={css.zoomValue}>{`${String(Math.round(props.zoomFactor * 100))}%`}</span>
            {zoomControl(t('zoom.in'), 1, <Plus size={14} />)}
            {zoomControl(t('zoom.reset'), 0, <RotateCcw size={14} />)}
          </span>
        </span>
      ),
    },
    { type: 'separator', id: 'sep-data' },
    { id: 'clear-cookies', label: t('menu.clearCookies') },
    { id: 'clear-cache', label: t('menu.clearCache') },
  ]

  const select = (id: string): void => {
    // The zoom row is a container for its controls, not an action.
    if (id === 'zoom') return
    setOpen(false)
    if (id.startsWith('scheme:')) {
      props.onColorScheme(id.slice('scheme:'.length) as BrowserColorScheme)
      return
    }
    switch (id) {
      case 'hard-reload': props.onHardReload(); return
      case 'devtools': props.onOpenDevTools(); return
      case 'clear-cookies': props.onClearCookies(); return
      case 'clear-cache': props.onClearCache(); return
    }
  }

  return (
    <Menu
      open={open}
      portal
      align="end"
      items={items}
      onSelect={select}
      onClose={() => { setOpen(false) }}
      anchor={(
        <Tooltip label={t('menu.label')} side="bottom" disabled={open}>
          <button
            type="button"
            className={css.control}
            aria-label={t('menu.label')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <MoreVertical />
          </button>
        </Tooltip>
      )}
    />
  )
}
