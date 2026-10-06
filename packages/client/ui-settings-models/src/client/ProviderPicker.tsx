/**
 * Searchable provider picker for the add-provider card: a trigger showing the
 * chosen provider and a popover list filtered by name or route id. It replaces
 * a native select because the catalog holds dozens of providers and a native
 * list can neither be searched nor styled.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useDismissOnOutsidePointer } from '@aeven/client-ui-primitives'
import styles from './ModelsSection.module.css'

/** One pickable provider. */
export interface ProviderPickerOption {
  /** Stable provider route id. */
  id: string
  /** Human-facing provider name. */
  label: string
}

/** Props of {@link ProviderPicker}. */
export interface ProviderPickerProps {
  /** Providers in display order. */
  options: readonly ProviderPickerOption[]
  /** Chosen provider id; undefined before a choice. */
  value: string | undefined
  /** Accessible name and trigger text before a choice. */
  label: string
  /** Search field placeholder. */
  searchLabel: string
  /** Text shown when the search matches nothing. */
  emptyLabel: string
  /** Open the list on mount, for a card that exists only to pick. */
  defaultOpen?: boolean
  disabled?: boolean
  /** @param id - the chosen provider id. */
  onChange: (id: string) => void
  /** The list closed without a choice. */
  onDismiss?: () => void
}

/**
 * Render the provider trigger and its searchable list.
 * @param props - options, the current choice, and copy.
 * @returns the picker.
 */
export function ProviderPicker(props: ProviderPickerProps): ReactNode {
  const { options, value, onChange } = props
  const [open, setOpen] = useState(props.defaultOpen === true)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const close = (): void => {
    setOpen(false)
    setQuery('')
    props.onDismiss?.()
  }
  useDismissOnOutsidePointer(root, open, (next) => { if (!next) close() })

  const needle = query.trim().toLowerCase()
  const matches = needle === ''
    ? options
    : options.filter(option => option.label.toLowerCase().includes(needle) || option.id.toLowerCase().includes(needle))
  const selected = options.find(option => option.id === value)

  useEffect(() => { if (open) search.current?.focus() }, [open])
  useEffect(() => { setActive(0) }, [needle])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (id: string): void => {
    setOpen(false)
    setQuery('')
    onChange(id)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(index => Math.min(index + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const match = matches[active]
      if (match !== undefined) choose(match.id)
    } else if (event.key === 'Escape') {
      // The settings panel closes on Escape too; the open list takes it first.
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      close()
    }
  }

  return (
    <div ref={root} className={styles['picker']}>
      <button
        type="button"
        className={styles['pickerTrigger']}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        disabled={props.disabled}
        onClick={() => { if (open) close(); else setOpen(true) }}
      >
        <span className={selected === undefined ? styles['pickerPlaceholder'] : undefined}>{selected?.label ?? props.label}</span>
      </button>
      {open
        ? (
          <div className={styles['pickerPopover']}>
            <input
              ref={search}
              className={styles['pickerSearch']}
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={matches[active] === undefined ? undefined : `${listId}-${String(active)}`}
              aria-label={props.searchLabel}
              placeholder={props.searchLabel}
              value={query}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
              onKeyDown={onKeyDown}
            />
            <ul ref={list} id={listId} role="listbox" aria-label={props.label} className={styles['pickerList']}>
              {matches.length === 0 ? <li className={styles['pickerEmpty']}>{props.emptyLabel}</li> : null}
              {matches.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-${String(index)}`}
                  data-index={index}
                  role="option"
                  aria-selected={option.id === value}
                  className={`${styles['pickerOption']} ${index === active ? styles['pickerOptionActive'] : ''}`}
                  onPointerMove={() => { setActive(index) }}
                  onClick={() => { choose(option.id) }}
                >
                  <span>{option.label}</span>
                  {option.label.toLowerCase() === option.id.toLowerCase() ? null : <span className={styles['pickerOptionId']}>{option.id}</span>}
                </li>
              ))}
            </ul>
          </div>
        )
        : null}
    </div>
  )
}
