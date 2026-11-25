/**
 * Composer Options row for the reading voice. It opens the shared popupSelect card beside itself — the
 * card the Image model and Video model rows open — listing the languages, searchable by name or subtag;
 * picking a language reopens the card on that language's voices, and picking a voice stores it for that
 * language.
 */
import type { MouseEvent } from 'react'
import type { PropsLocale, PropsRuntime, SessionIdOf } from '@aeven/client-ui-slots'
import { IconChevronRightOutline14, IconLucideVolume2 } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import { NS } from './locales.ts'
import type { ReadAloudCatalog } from './voices.ts'
import css from './SystemVoice.module.css'

/** Copy the picker rows carry, read from this plugin's dictionaries by the row that opens it. */
export interface VoicePickerLabels {
  /** Name of a language's Default row. */
  readonly default: string
  /**
   * @param voices - number of voices a language has.
   * @returns the localized count line.
   */
  readonly count: (voices: number) => string
}

/** Catalogue reader shared with the Settings row. */
export interface VoiceCatalogInjected {
  /** Read the Host's voices and language mapping. */
  loadCatalog: () => Promise<ReadAloudCatalog>
}

/** The composer row's face: open the languages card for one session beside the row. */
export interface SystemVoiceInjected {
  /**
   * @param sessionId - session whose popupSelect card opens.
   * @param anchor - the row, which the card sits beside.
   * @param labels - copy the rows carry.
   */
  openPicker: (sessionId: SessionIdOf, anchor: Element, labels: VoicePickerLabels) => void
}

/** Options-popup seat, dictionaries, and the injected opener. */
export type SystemVoiceProps = PropsRuntime<'conversation.input.options'>
  & PropsLocale<typeof NS> & SystemVoiceInjected & { sessionId: SessionIdOf }

/** Keep the draft focused when the row is pressed, as the popup's own rows do. */
function keepFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
}

/**
 * Render the voice row.
 * @param props - session, dictionaries, and the injected opener.
 * @returns the row.
 */
export function SystemVoice({ sessionId, openPicker, t }: SystemVoiceProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={css.row}
      aria-label={t('voice.row')}
      onMouseDown={keepFocus}
      onClick={(event) => {
        openPicker(sessionId, event.currentTarget, {
          default: t('voice.default'),
          count: voices => t('voice.count', { count: String(voices) }),
        })
      }}
    >
      <span className={css.rowIcon} aria-hidden><IconLucideVolume2 /></span>
      <span className={css.rowLabel}>{t('voice.row')}</span>
      <span className={css.rowChevron} aria-hidden><IconChevronRightOutline14 /></span>
    </button>
  )
}
