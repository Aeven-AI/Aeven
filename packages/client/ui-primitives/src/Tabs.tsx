/**
 * The settings tab strip: `underline` for pages inside one section, `pill`
 * for the sections that share one nav entry. Arrow keys, Home, and End move
 * between tabs; only the selected tab is in the tab order.
 */
import { useRef } from 'react'
import type { ReactNode } from 'react'
import css from './Tabs.module.css'

/** One tab. */
export interface TabItem {
  id: string
  label: ReactNode
}

/** Props of {@link Tabs}. */
export interface TabsProps {
  items: readonly TabItem[]
  /** The selected tab's id; undefined selects none. */
  activeId: string | undefined
  /**
   * Called when the reader picks a tab by click or keyboard.
   * @param id - the picked tab's id.
   */
  onSelect: (id: string) => void
  /** Accessible name of the tab list; absent leaves it unnamed. */
  label?: string | undefined
  /**
   * Prefix pairing each tab with its panel: tab `${idPrefix}-tab-${id}`
   * controls panel `${idPrefix}-panel-${id}`. Absent renders no pairing.
   */
  idPrefix?: string | undefined
  /** `underline` (default) for pages inside a section; `pill` for sections grouped under one nav entry. */
  variant?: 'underline' | 'pill' | undefined
}

/**
 * Render a tab list.
 * @param props - see {@link TabsProps}.
 * @returns the `tablist` element.
 */
export function Tabs({ items, activeId, onSelect, label, idPrefix, variant = 'underline' }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className={variant === 'pill' ? css.pills : css.tabs} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const selected = item.id === activeId
        return (
          <button
            key={item.id}
            ref={(element) => { refs.current[index] = element }}
            id={idPrefix === undefined ? undefined : `${idPrefix}-tab-${item.id}`}
            type="button"
            role="tab"
            className={variant === 'pill' ? css.pill : css.tab}
            aria-selected={selected}
            aria-controls={idPrefix === undefined ? undefined : `${idPrefix}-panel-${item.id}`}
            data-active={selected ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => { onSelect(item.id) }}
            onKeyDown={(event) => {
              let next: number
              switch (event.key) {
                case 'ArrowRight': next = (index + 1) % items.length; break
                case 'ArrowLeft': next = (index - 1 + items.length) % items.length; break
                case 'Home': next = 0; break
                case 'End': next = items.length - 1; break
                default: return
              }
              event.preventDefault()
              // `next` indexes the rendered items, so both lookups hit.
              const target = refs.current[next] as HTMLButtonElement
              onSelect((items[next] as TabItem).id)
              target.focus()
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
