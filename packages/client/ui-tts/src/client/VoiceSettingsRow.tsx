/**
 * Settings → General → Voice row for read-aloud voices. The selector pill opens the popupSelect card's
 * markup and behavior — the card the composer's Image model, Video model, and voice rows open — which
 * cannot render here because it lives in the composer's overlay seat. The card lists the languages,
 * searchable by name or subtag; picking one turns it to that language's voices, and picking a voice
 * stores it in the preference store the composer card writes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { IconChevronDownOutline14, SettingsRow } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-settings/client'
import { NS } from './locales.ts'
import type { VoiceCatalogInjected } from './SystemVoice.tsx'
import {
  DEFAULT_ROW, filterRows, languageRows, readPreferences, voiceRows, writePreference, type ReadAloudCatalog,
} from './voices.ts'
import css from './VoiceSettingsRow.module.css'

/** Voice-group seat, dictionaries, and the injected catalogue reader. */
export type VoiceSettingsRowProps = PropsRuntime<'settings.voice.item'> & PropsLocale<typeof NS> & VoiceCatalogInjected

/** The popupSelect card's design cap on its height. */
const MAX_HEIGHT = 320
/** Step between the pill and the card. */
const GAP = 4
/** Distance the card keeps from the viewport edges. */
const VIEWPORT_MARGIN = 16

/**
 * Place the fixed card under the pill with their trailing edges aligned, or above it when there is more
 * room there, and follow the pill through scrolls and resizes.
 * @param open - whether the card is showing.
 * @param anchor - the pill.
 * @returns fixed coordinates and height cap, or null while closed.
 */
function useTrailingPlacement(open: boolean, anchor: RefObject<HTMLElement | null>): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) { setStyle(null); return }
    const place = (): void => {
      const rect = anchor.current?.getBoundingClientRect()
      if (rect === undefined) return
      const below = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN
      const above = rect.top - GAP - VIEWPORT_MARGIN
      const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right)
      setStyle(below < MAX_HEIGHT && above > below
        ? { right, bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) }
        : { right, top: rect.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor])
  return style
}

/**
 * Render the voices row and, while open, its card portaled above the settings panel.
 * @param props - dictionaries, the catalogue reader, and standard Slot props.
 * @returns the settings row.
 */
export function VoiceSettingsRow({ loadCatalog, t }: VoiceSettingsRowProps) {
  const [open, setOpen] = useState(false)
  /** The language whose voices the card lists; null while it lists the languages. */
  const [language, setLanguage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const [catalog, setCatalog] = useState<ReadAloudCatalog | null>(null)
  const [failed, setFailed] = useState(false)
  const [preferences, setPreferences] = useState<Record<string, string>>(readPreferences)
  const pill = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const placement = useTrailingPlacement(open, pill)

  const rows = useMemo(() => {
    if (catalog === null) return []
    return language === null
      ? languageRows(catalog, voices => t('voice.count', { count: String(voices) }))
      : voiceRows(catalog, language, preferences, t('voice.default'))
  }, [catalog, language, preferences, t])
  const shown = filterRows(rows, search)

  const close = (): void => {
    setOpen(false)
    setLanguage(null)
    setSearch('')
  }

  useEffect(() => {
    if (!open || catalog !== null) return
    let live = true
    void loadCatalog().then((loaded) => { if (live) setCatalog(loaded) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [catalog, loadCatalog, open])

  // A list opens on its current choice when it marks one, as the popupSelect card does; typing starts
  // the highlight over at the first match.
  useEffect(() => {
    const marked = search === '' ? rows.findIndex(row => row.active === true) : -1
    setActive(marked === -1 ? 0 : marked)
  }, [rows, search])
  useEffect(() => {
    card.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => { if (open) searchRef.current?.focus() }, [open, language])

  // Any pointer press outside the card or the pill dismisses it, as the popupSelect card's does.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (card.current?.contains(event.target) === true || pill.current?.contains(event.target) === true) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open])

  const select = (index: number): void => {
    const row = shown[index]
    if (row === undefined) return
    if (language === null) {
      setLanguage(row.id)
      setSearch('')
      return
    }
    setPreferences(writePreference(language, row.id === DEFAULT_ROW ? null : row.id))
    close()
    pill.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive(index => Math.min(index + 1, shown.length - 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive(index => Math.max(index - 1, 0))
        return
      case 'Enter':
        event.preventDefault()
        select(active)
        return
      case 'Escape':
        // The settings panel closes on a document-level Escape; the open card takes it first.
        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        close()
        pill.current?.focus()
        return
      default:
    }
  }

  const customized = Object.keys(preferences).length
  return (
    <SettingsRow
      title={t('voice.settings.title')}
      description={t('voice.settings.description')}
      control={(
        <>
          <button
            ref={pill}
            type="button"
            className={css.selector}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              if (open) { close(); return }
              setPreferences(readPreferences())
              setFailed(false)
              setOpen(true)
            }}
          >
            {customized === 0 ? t('voice.default') : t('voice.customized', { count: String(customized) })}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
          {open && createPortal((
            <div
              ref={card}
              className={css.card}
              style={placement ?? { visibility: 'hidden' }}
              aria-label={t('voice.settings.title')}
              onKeyDown={onKeyDown}
            >
              <input
                ref={searchRef}
                className={css.search}
                type="text"
                placeholder={t('voice.search')}
                aria-label={t('voice.search')}
                value={search}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
              {failed && <div className={css.status}>{t('voice.unavailable')}</div>}
              {!failed && catalog === null && <div className={css.status}>{t('voice.loading')}</div>}
              {catalog !== null && shown.length === 0 && <div className={css.status}>{t('voice.noMatch')}</div>}
              {catalog !== null && (
                <div role="listbox" aria-label={t('voice.settings.title')} className={clsx(css.viewport, 'no-scrollbar')}>
                  {shown.map((row, index) => (
                    <div
                      key={row.id}
                      role="option"
                      aria-selected={index === active}
                      className={clsx(css.row, row.active === true && css.rowSelected, index === active && css.rowActive)}
                      onClick={() => { select(index) }}
                      onMouseEnter={() => { setActive(index) }}
                    >
                      <span className={css.label}>{row.label}</span>
                      {row.detail !== undefined && <span className={css.detail}>{row.detail}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ), document.body)}
        </>
      )}
    />
  )
}
