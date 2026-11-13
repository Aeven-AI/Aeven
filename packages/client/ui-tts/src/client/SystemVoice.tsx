/**
 * Composer Options row for the reading voice: the row opens the picker beside the popup, the same way
 * the permission row opens its mode card (on the side the viewport has room for, or stacked over the
 * popup on a screen too narrow for either), and each language keeps the voice the reader chooses.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import {
  IconCheckOutline16, IconChevronRightOutline14, IconLucideVolume2, useBesidePlacement,
} from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import { NS } from './locales.ts'
import { groupVoices, readPreferences, writePreference, type ReadAloudCatalog } from './voices.ts'
import css from './SystemVoice.module.css'

/** Catalogue loading and preference writes the picker needs, injected through the entry face. */
export interface SystemVoiceInjected {
  /** Read the Host's voices and language mapping once, when the picker opens. */
  loadCatalog: () => Promise<ReadAloudCatalog>
}

/** Options-popup seat, dictionaries, and the injected catalogue reader. */
export type SystemVoiceProps = PropsRuntime<'conversation.input.options'>
  & PropsLocale<typeof NS> & SystemVoiceInjected

/** Space kept free above the card, so it ends below the fade the app draws at the top of the screen. */
const TOP_CLEARANCE = 64
/** The stylesheet's `.pane` step from the row seat, matching the permission row's card. */
const PANE_GAP = 10
/** Step between the card and its row's top edge when it is stacked over the popup. */
const PANE_LIFT = 4
/** Distance the card keeps from the viewport edges; the stylesheet's `100vw - 32px` cap. */
const VIEWPORT_MARGIN = 16

/**
 * Render the voice row and the card it opens beside the popup.
 * @param props - dictionaries, the catalogue reader, and standard Slot props.
 * @returns the row and, while open, its card.
 */
export function SystemVoice({ loadCatalog, t }: SystemVoiceProps) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ReadAloudCatalog | null>(null)
  const [preferences, setPreferences] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)
  const seat = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | undefined>(undefined)
  const placement = useBesidePlacement({
    open, anchorRef: seat, panelRef: pane, gap: PANE_GAP, lift: PANE_LIFT, margin: VIEWPORT_MARGIN,
  })
  const stacked = placement.side === 'stacked'

  // The card grows upward from its anchor edge — the row's bottom beside the popup, the row's top when
  // stacked over it — so its height is the room the viewport leaves above that edge, less the top band
  // the app fades the transcript under: the card stays clear of that fade instead of disappearing
  // beneath it.
  useEffect(() => {
    if (!open) return
    const measure = (): void => {
      const rect = seat.current?.getBoundingClientRect()
      if (rect === undefined) return
      const anchor = stacked ? rect.top - PANE_LIFT : rect.bottom
      setRoom(Math.max(160, Math.round(anchor - TOP_CLEARANCE)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [open, stacked])

  useEffect(() => {
    if (!open || catalog !== null) return
    let live = true
    void loadCatalog().then((loaded) => { if (live) setCatalog(loaded) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [catalog, loadCatalog, open])

  const groups = useMemo(() => (catalog === null ? [] : groupVoices(catalog)), [catalog])

  const choose = (language: string, voiceId: string | null): void => {
    setPreferences(writePreference(language, voiceId))
  }

  return (
    <div className={css.seat} ref={seat}>
      <button
        type="button"
        role="menuitem"
        className={css.row}
        data-open={open ? '' : undefined}
        aria-label={t('voice.row')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setPreferences(readPreferences()); setFailed(false); setOpen(current => !current) }}
      >
        <span className={css.rowIcon} aria-hidden><IconLucideVolume2 /></span>
        <span className={css.rowLabel}>{t('voice.row')}</span>
        <span className={css.rowChevron} aria-hidden><IconChevronRightOutline14 /></span>
      </button>
      {!open ? null : (
        <div ref={pane} className={css.pane} role="group" aria-label={t('voice.row')}
          style={{ ...placement.style, ...(room === undefined ? {} : { maxHeight: `${String(room)}px` }) }}>
          {failed
            ? <p className={css.empty}>{t('voice.unavailable')}</p>
            : catalog === null
              ? <p className={css.empty}>{t('voice.loading')}</p>
              : groups.map(group => (
                <section key={group.language} className={css.section}>
                  <header className={css.sectionHeader}>
                    <span className={css.language}>{group.name}</span>
                    <span className={css.count}>{t('voice.count', { count: String(group.voices.length) })}</span>
                  </header>
                  <VoiceOption
                    name={t('voice.default')}
                    detail={group.defaultVoice?.name}
                    checked={(preferences[group.language] ?? group.mapped) === undefined}
                    onSelect={() => { choose(group.language, null) }}
                  />
                  {group.voices.map(voice => (
                    <VoiceOption
                      key={voice.id}
                      name={voice.name}
                      checked={(preferences[group.language] ?? group.mapped) === voice.id}
                      onSelect={() => { choose(group.language, voice.id) }}
                    />
                  ))}
                </section>
              ))}
        </div>
      )}
    </div>
  )
}

/**
 * One selectable voice inside a language section, drawn as the permission list draws a mode: the
 * name, and a trailing check on the row that is current.
 * @param props - voice name and whether it is the language's current voice.
 * @returns a menu radio row.
 */
function VoiceOption({ name, detail, checked, onSelect }: {
  name: string
  /** Voice the row resolves to, shown muted; omitted when the row names the voice itself. */
  detail?: string | undefined
  checked: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className={css.option}
      onClick={onSelect}>
      <span className={css.optionLabel}>{name}</span>
      {detail === undefined ? null : <span className={css.optionDetail}>{detail}</span>}
      {checked ? <IconCheckOutline16 className={css.check} /> : null}
    </button>
  )
}
